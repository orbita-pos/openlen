// Booking-create anti-abuse. A booking is a write a stranger can trigger (guest
// mode), so it's rate-limited on two axes: by source IP (stops one host from
// hammering) and by booking identity — member id or guest email, hashed (stops
// one person from spamming holds across IPs). Keys are project-scoped so abuse
// of site A can't burn site B's budget.
//
// SOFT caps: the rate-limit engine is count-then-insert without a transaction
// (documented in crates/rate-limit), so two requests racing at the limit may
// both pass. Acceptable — the real no-double-booking guarantee is the DB slot
// guard (bookings_slot_uq), not these windows; these only blunt flooding.

import { createHash } from "node:crypto";
import type { LimitWindow } from "@/lib/limits";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Per-source-IP create limits — the coarse flood stop. */
export const BOOKING_IP_LIMITS: LimitWindow[] = [
  { windowMs: MINUTE, max: 5, label: "cooldown" },
  { windowMs: HOUR, max: 20, label: "hourly" },
  { windowMs: DAY, max: 60, label: "daily" },
];

/** Per-identity (member id or guest email) create limits — stops one actor
 *  from holding a calendar hostage across IPs. */
export const BOOKING_IDENTITY_LIMITS: LimitWindow[] = [
  { windowMs: HOUR, max: 6, label: "hourly" },
  { windowMs: DAY, max: 15, label: "daily" },
];

export function bookingIpKey(projectId: string, ip: string): string {
  return `ip:${ip}:${projectId}:booking-create`;
}

/** Project-scoped identity key. The identity (memberId or normalized guest
 *  email) is hashed — no PII in the rate-limit ledger, bounded length. */
export function bookingIdentityKey(projectId: string, identity: string): string {
  const h = createHash("sha256")
    .update(identity.trim().toLowerCase())
    .digest("hex")
    .slice(0, 16);
  return `bk-id:${projectId}:${h}:booking-create`;
}

// Per-site monthly cap on total bookings — a backstop against a runaway site
// (or an abuse campaign that slips the rate windows). Enforced by counting live
// rows in the bookings table over a 30-day window, NOT the rate-limit engine,
// so it survives ledger pruning. Mirrors the members monthly email cap.
export const BOOKING_MONTHLY_CAP = { free: 200, pro: 2000 } as const;
