import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { generateSlots } from "@/lib/bookings/availability";
import { notifyBooking } from "@/lib/bookings/notify";
import { isSlotBookable, serviceToRules } from "@/lib/bookings/rules";
import {
  getBooking,
  getBusyIntervals,
  getService,
  recordBookingEvent,
  rescheduleBooking,
} from "@/lib/bookings/store";

// Owner-side reschedule for one booking. The visitor reaches the same store
// call through /api/bk/[sub]/reschedule with their manage token; the owner is
// authenticated by session + project ownership instead.
//
// GET  → the open slots for this booking's service, labelled in the service's
//        own zone (the panel shows appointments in that zone too).
// POST { startUtcMs } → move it. 409 if the slot went away or was taken.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HORIZON_MS = 45 * 86400000;
const DAY = 86400000;

const BodySchema = z.object({ startUtcMs: z.number().int().positive() });

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

function localeFromHtml(html: string | undefined | null): string {
  const m = html ? /<html[^>]*\blang=["']?([a-zA-Z]{2})/i.exec(html) : null;
  return m ? m[1].toLowerCase() : "en";
}

async function load(id: string, bookingId: string) {
  const session = await auth();
  const user = session?.user;
  if (!user?.id) return { ok: false, res: json({ error: "unauthorized" }, 401) } as const;
  const owned = await db
    .select({
      subdomain: schema.projects.subdomain,
      data: schema.projects.data,
    })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, id), eq(schema.projects.userId, user.id)))
    .limit(1);
  if (owned.length === 0) return { ok: false, res: json({ error: "not_found" }, 404) } as const;

  const booking = await getBooking(id, bookingId);
  if (!booking) return { ok: false, res: json({ error: "not_found" }, 404) } as const;
  const service = await getService(id, booking.serviceId);
  if (!service || service.status !== "active") {
    return { ok: false, res: json({ error: "service_unavailable" }, 409) } as const;
  }
  return { ok: true, user, project: owned[0], booking, service } as const;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; bookingId: string }> },
): Promise<Response> {
  const { id, bookingId } = await params;
  const ctx = await load(id, bookingId);
  if (!ctx.ok) return ctx.res;

  const nowUtcMs = Date.now();
  const busy = await getBusyIntervals(ctx.service.id, nowUtcMs, nowUtcMs + HORIZON_MS);
  const slots = generateSlots(serviceToRules(ctx.service), {
    nowUtcMs,
    rangeStartUtcMs: nowUtcMs,
    rangeEndUtcMs: nowUtcMs + HORIZON_MS,
    visitorTz: ctx.service.creatorTz,
    busy,
  });

  return json(
    {
      tz: ctx.service.creatorTz,
      slots: slots.map((s) => ({ start: s.startUtcMs, label: s.label, date: s.localDate })),
    },
    200,
  );
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string; bookingId: string }> },
): Promise<Response> {
  const { id, bookingId } = await params;
  const ctx = await load(id, bookingId);
  if (!ctx.ok) return ctx.res;
  const { booking, service } = ctx;

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid_body" }, 400);
  const startUtcMs = parsed.data.startUtcMs;

  const nowUtcMs = Date.now();
  const busy = await getBusyIntervals(service.id, startUtcMs, startUtcMs + DAY);
  const visitorTz = booking.visitorTz || service.creatorTz;
  if (!isSlotBookable({ service, startUtcMs, nowUtcMs, visitorTz, busy })) {
    return json({ error: "slot_unavailable" }, 409);
  }

  const result = await rescheduleBooking(id, bookingId, {
    newId: randomUUID(),
    startUtc: new Date(startUtcMs),
    endUtc: new Date(startUtcMs + service.durationMin * 60000),
  });
  if (!result.ok) {
    const code = result.reason === "not_found" ? 404 : 409;
    return json({ error: result.reason }, code);
  }

  await recordBookingEvent(id, result.booking.id, "rescheduled", "owner", {
    from: result.old.id,
    fromStart: result.old.startUtc.getTime(),
    toStart: result.booking.startUtc.getTime(),
  });

  const sub = ctx.project.subdomain ?? "";
  if (sub && result.booking.guestEmail) {
    await notifyBooking({
      kind: "rescheduled",
      booking: result.booking,
      serviceName: service.name,
      serviceDescription: service.description,
      locationText: service.locationText,
      sub,
      baseUrl: `https://${sub}.openlen.com`,
      locale: localeFromHtml(ctx.project.data?.html),
      ownerEmail: ctx.user.email ?? null,
      ownerName: ctx.user.name ?? null,
      notifyCreator: false, // the owner initiated it — don't email themselves
    });
  }

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
