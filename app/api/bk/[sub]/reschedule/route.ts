import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  getBooking,
  getBusyIntervals,
  getService,
  rescheduleBooking,
  recordBookingEvent,
} from "@/lib/bookings/store";
import { isSlotBookable } from "@/lib/bookings/rules";
import { isKnownTimeZone } from "@/lib/bookings/tz";
import { verifyManageToken } from "@/lib/bookings/manage-token";
import { notifyBooking } from "@/lib/bookings/notify";
import { json, loadBookingsSite, siteBaseUrl } from "../_shared";

// POST /api/bk/[sub]/reschedule { b, t, newStartUtcMs, visitorTz? }
// Token-authenticated (the manage link). Re-validates the NEW instant against
// the live rules, then claim-new-first / cancel-old via the store. The manage
// token stays valid (it's keyed on the ORIGINAL booking id, which persists).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAY = 86400000;

const BodySchema = z.object({
  b: z.string().min(1),
  t: z.string().min(1),
  newStartUtcMs: z.number().int().positive(),
  visitorTz: z.string().max(60).optional(),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ sub: string }> },
): Promise<Response> {
  const { sub } = await params;
  const site = await loadBookingsSite(sub);
  if (!site || !site.bookingsEnabled) return json({ error: "disabled" }, 403);

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid_body" }, 400);
  const { b, t, newStartUtcMs, visitorTz: tzRaw } = parsed.data;

  if (!verifyManageToken(site.projectId, b, t)) return json({ error: "auth" }, 401);

  const booking = await getBooking(site.projectId, b);
  if (!booking) return json({ error: "not_found" }, 404);
  const service = await getService(site.projectId, booking.serviceId);
  if (!service || service.status !== "active") return json({ error: "service_unavailable" }, 409);

  const visitorTz = tzRaw && isKnownTimeZone(tzRaw) ? tzRaw : booking.visitorTz || service.creatorTz;
  const nowUtcMs = Date.now();
  const busy = await getBusyIntervals(service.id, newStartUtcMs, newStartUtcMs + DAY);
  if (!isSlotBookable({ service, startUtcMs: newStartUtcMs, nowUtcMs, visitorTz, busy })) {
    return json({ error: "slot_unavailable" }, 409);
  }

  const result = await rescheduleBooking(site.projectId, b, {
    newId: randomUUID(),
    startUtc: new Date(newStartUtcMs),
    endUtc: new Date(newStartUtcMs + service.durationMin * 60000),
    visitorTz,
  });
  if (!result.ok) {
    const code = result.reason === "slot_taken" ? 409 : result.reason === "not_active" ? 409 : 404;
    return json({ error: result.reason }, code);
  }

  await recordBookingEvent(site.projectId, result.booking.id, "rescheduled", "visitor", {
    from: result.old.id,
    fromStart: result.old.startUtc.getTime(),
    toStart: result.booking.startUtc.getTime(),
  });
  await notifyBooking({
    kind: "rescheduled",
    booking: result.booking,
    serviceName: service.name,
    serviceDescription: service.description,
    locationText: service.locationText,
    sub: site.subdomain,
    baseUrl: siteBaseUrl(req),
    locale: site.locale,
    ownerEmail: site.ownerEmail,
    ownerName: site.ownerName,
    notifyCreator: true,
  });

  return json(
    {
      ok: true,
      bookingId: result.booking.id,
      start: result.booking.startUtc.getTime(),
      end: result.booking.endUtc.getTime(),
      status: result.booking.status,
    },
    200,
  );
}
