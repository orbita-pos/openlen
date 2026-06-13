import { generateSlots } from "@/lib/bookings/availability";
import { getBusyIntervals, getService } from "@/lib/bookings/store";
import { isKnownTimeZone } from "@/lib/bookings/tz";
import { serviceToRules } from "@/lib/bookings/rules";
import { json, loadBookingsSite } from "../_shared";

// GET /api/bk/[sub]/availability?service=<id>&from=<ms>&to=<ms>&tz=<ianaTz>
// Public: the bookable slots for a service in a window, labelled in the
// visitor's zone. The window is clamped to a 62-day span; the engine itself
// re-clamps by the service's lead time / horizon, so an over-wide ask is safe.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SPAN_MS = 62 * 86400000;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ sub: string }> },
): Promise<Response> {
  const { sub } = await params;
  const site = await loadBookingsSite(sub);
  if (!site || !site.bookingsEnabled) return json({ slots: [] }, 200);

  const url = new URL(req.url);
  const serviceId = url.searchParams.get("service") || "";
  const fromRaw = Number(url.searchParams.get("from"));
  const toRaw = Number(url.searchParams.get("to"));
  const tzRaw = url.searchParams.get("tz") || "";

  if (!serviceId || !Number.isFinite(fromRaw) || !Number.isFinite(toRaw)) {
    return json({ error: "invalid_query" }, 400);
  }
  const service = await getService(site.projectId, serviceId);
  if (!service || service.status !== "active") return json({ slots: [] }, 200);

  const nowUtcMs = Date.now();
  // Never look into the past, and bound the span.
  const rangeStartUtcMs = Math.max(fromRaw, nowUtcMs);
  const rangeEndUtcMs = Math.min(toRaw, rangeStartUtcMs + MAX_SPAN_MS);
  if (rangeEndUtcMs <= rangeStartUtcMs) return json({ slots: [] }, 200);

  const visitorTz = isKnownTimeZone(tzRaw) ? tzRaw : service.creatorTz;
  const busy = await getBusyIntervals(service.id, rangeStartUtcMs, rangeEndUtcMs);

  const slots = generateSlots(serviceToRules(service), {
    nowUtcMs,
    rangeStartUtcMs,
    rangeEndUtcMs,
    visitorTz,
    busy,
  });

  return json(
    {
      visitorTz,
      durationMin: service.durationMin,
      slots: slots.map((s) => ({
        start: s.startUtcMs,
        end: s.endUtcMs,
        label: s.label,
        date: s.localDate,
      })),
    },
    200,
  );
}
