import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { archiveService, getService, updateService } from "@/lib/bookings/store";
import { serviceUpdateSchema } from "@/lib/bookings/service-input";
import type { BookingException, DayRange, Weekday } from "@/lib/bookings/availability";

// PATCH  /api/projects/[id]/bookings/services/[serviceId] — owner: update.
// DELETE /api/projects/[id]/bookings/services/[serviceId] — owner: archive (soft).

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function owns(projectId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; serviceId: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id, serviceId } = await params;
  if (!(await owns(id, session.user.id))) return json({ error: "not_found" }, 404);

  const parsed = serviceUpdateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "invalid_body", issues: parsed.error.issues.slice(0, 5) }, 400);
  }
  const v = parsed.data;

  const service = await updateService(id, serviceId, {
    ...(v.name !== undefined ? { name: v.name } : {}),
    ...(v.description !== undefined ? { description: v.description } : {}),
    ...(v.durationMin !== undefined ? { durationMin: v.durationMin } : {}),
    ...(v.slotIncrementMin !== undefined ? { slotIncrementMin: v.slotIncrementMin } : {}),
    ...(v.bufferBeforeMin !== undefined ? { bufferBeforeMin: v.bufferBeforeMin } : {}),
    ...(v.bufferAfterMin !== undefined ? { bufferAfterMin: v.bufferAfterMin } : {}),
    ...(v.minLeadTimeMin !== undefined ? { minLeadTimeMin: v.minLeadTimeMin } : {}),
    ...(v.maxDaysAhead !== undefined ? { maxDaysAhead: v.maxDaysAhead } : {}),
    ...(v.creatorTz !== undefined ? { creatorTz: v.creatorTz } : {}),
    ...(v.weeklyHours !== undefined
      ? { weeklyHours: v.weeklyHours as Partial<Record<Weekday, DayRange[]>> }
      : {}),
    ...(v.exceptions !== undefined ? { exceptions: v.exceptions as BookingException[] } : {}),
    ...(v.capacity !== undefined ? { capacity: v.capacity } : {}),
    ...(v.priceDisplay !== undefined ? { priceDisplay: v.priceDisplay } : {}),
    ...(v.locationText !== undefined ? { locationText: v.locationText } : {}),
    ...(v.sortOrder !== undefined ? { sortOrder: v.sortOrder } : {}),
  });
  if (!service) return json({ error: "not_found" }, 404);
  return json({ service }, 200);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; serviceId: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id, serviceId } = await params;
  if (!(await owns(id, session.user.id))) return json({ error: "not_found" }, 404);

  const found = await getService(id, serviceId);
  if (!found) return json({ error: "not_found" }, 404);
  await archiveService(id, serviceId);
  return json({ ok: true }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
