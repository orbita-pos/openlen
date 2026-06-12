// Members-module caps + rate-limit keys.
//
// Same philosophy as lib/credits.ts: the numbers live here as named constants
// (PLACEHOLDERS to tune with real usage), enforcement happens at the call
// sites via lib/limits.ts checkAndConsume → the shared rateLimitEvents table.
// Window-scoped COUNTs make the 30-day site cap work without any retention
// job (rateLimitEvents rows are never pruned today — pre-existing behavior).

import { createHash } from "node:crypto";
import type { LimitWindow, Plan } from "@/lib/limits";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export interface MemberCaps {
  /** Max member rows per site (enforced at signup + invite). */
  members: number;
  /** Magic-link emails a site may send per rolling 30 days. */
  monthlyEmails: number;
}

export const MEMBER_CAPS: Record<Plan, MemberCaps> = {
  free: { members: 25, monthlyEmails: 300 },
  pro: { members: 1000, monthlyEmails: 3000 },
};

/** Per-IP burst guard on the magic-link request endpoint. */
export const MEMBER_LOGIN_IP_LIMITS: LimitWindow[] = [
  { windowMs: HOUR, max: 10, label: "hourly" },
];

/** Per-target-email guard — caps how often any inbox can be hit with login
 *  mail through us (mail-bombing), regardless of requester IP. */
export const MEMBER_LOGIN_EMAIL_LIMITS: LimitWindow[] = [
  { windowMs: 15 * MINUTE, max: 3, label: "15-minute" },
];

/** Rolling-month email budget for one site, sized by the owner's plan. */
export function memberEmailCapWindows(plan: Plan): LimitWindow[] {
  return [
    { windowMs: 30 * DAY, max: MEMBER_CAPS[plan].monthlyEmails, label: "monthly" },
  ];
}

/** Rate-limit key for a target email — hashed so no raw PII lands in
 *  rateLimitEvents. Normalized first so case/whitespace can't dodge it. */
export function emailLimitKey(email: string): string {
  const h = createHash("sha256")
    .update(email.trim().toLowerCase(), "utf8")
    .digest("hex")
    .slice(0, 16);
  return `email:${h}:member-login`;
}

/** Rate-limit key for a site's monthly magic-link email budget. */
export function siteEmailCapKey(projectId: string): string {
  return `site:${projectId}:member-email`;
}
