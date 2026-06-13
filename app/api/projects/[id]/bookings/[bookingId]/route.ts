import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import {
  cancelBooking,
  getBooking,
  recordBookingEvent,
  setBookingStatus,
  type BookingRow,
} from "@/lib/bookings/store";

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
    .select({ id: schema.projects.id })
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
  // R5 wires owner-cancel email here when action === "cancel".

  return json({ ok: true, status: updated.status }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
