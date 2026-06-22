import { z } from "zod";
import { checkAndConsume, getClientIp, getUserPlan } from "@/lib/limits";
import {
  BOOKING_IDENTITY_LIMITS,
  BOOKING_IP_LIMITS,
  BOOKING_MONTHLY_CAP,
  bookingIdentityKey,
  bookingIpKey,
} from "@/lib/bookings/limits";
import {
  claimBookingSlot,
  countBookingsSince,
  getBooking,
  getBusyIntervals,
  getService,
  recordBookingEvent,
} from "@/lib/bookings/store";
import { isSlotBookable } from "@/lib/bookings/rules";
import { isKnownTimeZone } from "@/lib/bookings/tz";
import { manageToken } from "@/lib/bookings/manage-token";
import { notifyBooking } from "@/lib/bookings/notify";
import { json, loadBookingsSite, resolveMember } from "../_shared";

// POST /api/bk/[sub]/book — create a booking (guest or member).
//
// Order is deliberate: resolve identity → rate-limit (IP, then identity, then
// per-site monthly cap) → RE-VALIDATE the requested instant against the live
// rules (never trust the client) → atomically claim the slot. id is client-
// generated so a retried POST is idempotent (claimBookingSlot replays it).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  id: z.string().uuid(),
  serviceId: z.string().min(1).max(80),
  startUtcMs: z.number().int().positive(),
  visitorTz: z.string().max(60).optional(),
  name: z.string().trim().max(120).optional(),
  email: z.string().trim().email().max(200).optional(),
  note: z.string().trim().max(1000).optional(),
  // Session visitor id (lib/analytics/cid.ts) — funnel attribution. Optional.
  cid: z.string().trim().max(40).regex(/^[A-Za-z0-9-]+$/).optional(),
});

const DAY = 86400000;

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sub: string }> },
): Promise<Response> {
  const { sub } = await params;
  const site = await loadBookingsSite(sub);
  if (!site) return json({ error: "not_found" }, 404);
  if (!site.bookingsEnabled) return json({ error: "disabled" }, 403);

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid_body" }, 400);
  const body = parsed.data;

  // Idempotent replay: a retried POST with the same client id returns the
  // existing booking BEFORE re-validation (the slot is now busy with this very
  // booking) and without burning rate budget. The id is an unguessable UUID, so
  // an exact (project,id) match is the same logical request.
  const prior = await getBooking(site.projectId, body.id);
  if (prior) {
    return json(
      {
        ok: true,
        bookingId: prior.id,
        status: prior.status,
        start: prior.startUtc.getTime(),
        end: prior.endUtc.getTime(),
        replay: true,
        manageToken: manageToken(site.projectId, prior.id),
      },
      200,
    );
  }

  const service = await getService(site.projectId, body.serviceId);
  if (!service || service.status !== "active") {
    return json({ error: "service_unavailable" }, 404);
  }

  // ── Identity ──
  const member = await resolveMember(req, site.projectId);
  if (site.requireLogin && !member) return json({ error: "auth" }, 401);

  let guestName: string | null;
  let guestEmail: string;
  let memberId: string | null;
  if (member) {
    memberId = member.memberId;
    guestName = body.name?.trim() || member.name;
    guestEmail = member.email;
  } else {
    // Guest: name + email required.
    if (!body.email) return json({ error: "email_required" }, 400);
    memberId = null;
    guestName = body.name?.trim() || null;
    guestEmail = body.email.trim().toLowerCase();
  }
  const identity = memberId ?? guestEmail;

  // ── Rate limits (soft) ──
  const ip = getClientIp(req);
  const ipDecision = await checkAndConsume(bookingIpKey(site.projectId, ip), BOOKING_IP_LIMITS);
  if (!ipDecision.ok) return json({ error: "rate_limited" }, 429);
  const idDecision = await checkAndConsume(
    bookingIdentityKey(site.projectId, identity),
    BOOKING_IDENTITY_LIMITS,
  );
  if (!idDecision.ok) return json({ error: "rate_limited" }, 429);

  // ── Per-site monthly cap (hard, counted from the table) ──
  const plan = await getUserPlan(site.ownerUserId);
  const cap = BOOKING_MONTHLY_CAP[plan];
  const used = await countBookingsSince(site.projectId, new Date(Date.now() - 30 * DAY));
  if (used >= cap) return json({ error: "site_cap" }, 403);

  // ── Re-validate the requested instant against the live rules ──
  const visitorTz = body.visitorTz && isKnownTimeZone(body.visitorTz) ? body.visitorTz : service.creatorTz;
  const nowUtcMs = Date.now();
  const busy = await getBusyIntervals(service.id, body.startUtcMs, body.startUtcMs + DAY);
  if (!isSlotBookable({ service, startUtcMs: body.startUtcMs, nowUtcMs, visitorTz, busy })) {
    return json({ error: "slot_unavailable" }, 409);
  }

  // ── Atomic claim ──
  const startUtc = new Date(body.startUtcMs);
  const endUtc = new Date(body.startUtcMs + service.durationMin * 60000);
  const status = site.autoConfirm ? "confirmed" : "pending";
  const claim = await claimBookingSlot({
    id: body.id,
    projectId: site.projectId,
    serviceId: service.id,
    startUtc,
    endUtc,
    status,
    memberId,
    guestName,
    guestEmail,
    note: body.note ?? null,
    creatorTz: service.creatorTz,
    visitorTz,
    cid: body.cid ?? null,
  });
  if (!claim.ok) return json({ error: "slot_unavailable" }, 409);

  if (!claim.replay) {
    await recordBookingEvent(site.projectId, claim.booking.id, "created", "visitor", {
      serviceId: service.id,
      status,
      via: member ? "member" : "guest",
    });
    // Confirmation to the visitor + a notice to the creator. Best-effort.
    await notifyBooking({
      kind: status === "confirmed" ? "confirmed" : "pending",
      booking: claim.booking,
      serviceName: service.name,
      serviceDescription: service.description,
      locationText: service.locationText,
      sub: site.subdomain,
      // DB-trusted host, NOT a request header — a forgeable X-Forwarded-Host
      // would otherwise bake an attacker domain into the emailed manage link
      // (the HMAC token isn't host-bound). Custom domains use the openlen host.
      baseUrl: `https://${site.subdomain}.openlen.com`,
      locale: site.locale,
      ownerEmail: site.ownerEmail,
      ownerName: site.ownerName,
      notifyCreator: true,
    });
  }

  return json(
    {
      ok: true,
      bookingId: claim.booking.id,
      status: claim.booking.status,
      start: claim.booking.startUtc.getTime(),
      end: claim.booking.endUtc.getTime(),
      replay: claim.replay,
      manageToken: manageToken(site.projectId, claim.booking.id),
    },
    claim.replay ? 200 : 201,
  );
}
