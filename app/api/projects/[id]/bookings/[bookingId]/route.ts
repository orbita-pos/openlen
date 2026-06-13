import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import {
  cancelBooking,
  getBooking,
  getService,
  recordBookingEvent,
  setBookingStatus,
  type BookingRow,
} from "@/lib/bookings/store";
import { notifyBooking } from "@/lib/bookings/notify";

function localeFromHtml(html: string | undefined | null): string {
  const m = html ? /<html[^>]*\blang=["']?([a-zA-Z]{2})/i.exec(html) : null;
  return m ? m[1].toLowerCase() : "en";
}

// PATCH /api/projects/[id]/bookings/[bookingId] { action }
// Owner status transitions: confirm a pending, cancel a live booking, or mark a
// past one completed / no_show. Each transition is guarded by its valid `from`
// states so the status machine stays honest.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  action: z.enum(["confirm", "cancel", "complete", "no_show"]),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; bookingId: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id, bookingId } = await params;

  const owned = await db
    .select({
      id: schema.projects.id,
      subdomain: schema.projects.subdomain,
      data: schema.projects.data,
    })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, id), eq(schema.projects.userId, session.user.id)))
    .limit(1);
  if (owned.length === 0) return json({ error: "not_found" }, 404);

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid_body" }, 400);

  const exists = await getBooking(id, bookingId);
  if (!exists) return json({ error: "not_found" }, 404);

  let updated: BookingRow | null = null;
  switch (parsed.data.action) {
    case "confirm":
      updated = await setBookingStatus(id, bookingId, "confirmed", ["pending"]);
      break;
    case "cancel":
      updated = await cancelBooking(id, bookingId); // bumps icsSequence
      break;
    case "complete":
      updated = await setBookingStatus(id, bookingId, "completed", ["confirmed"]);
      break;
    case "no_show":
      updated = await setBookingStatus(id, bookingId, "no_show", ["confirmed"]);
      break;
  }
  if (!updated) {
    // The booking exists but wasn't in a state this action can leave.
    return json({ error: "invalid_transition", status: exists.status }, 409);
  }

  await recordBookingEvent(id, bookingId, parsed.data.action, "owner");

  // Owner cancellation → tell the visitor (CANCEL .ics). The manage link is
  // moot on a cancelled booking, so the site base URL isn't needed.
  if (parsed.data.action === "cancel" && updated.guestEmail) {
    const service = await getService(id, updated.serviceId);
    const sub = owned[0].subdomain ?? "";
    await notifyBooking({
      kind: "cancelled",
      booking: updated,
      serviceName: service?.name ?? "Booking",
      serviceDescription: service?.description,
      locationText: service?.locationText,
      sub,
      baseUrl: sub ? `https://${sub}.openlen.com` : "",
      locale: localeFromHtml(owned[0].data?.html),
      ownerEmail: session.user.email ?? null,
      ownerName: session.user.name ?? null,
      notifyCreator: false, // the owner initiated it — don't email themselves
    });
  }

  return json({ ok: true, status: updated.status }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
