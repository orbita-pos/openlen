import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { createService, listServices } from "@/lib/bookings/store";
import { serviceInputSchema } from "@/lib/bookings/service-input";
import type { BookingException, DayRange, Weekday } from "@/lib/bookings/availability";

// GET  /api/projects/[id]/bookings/services — owner: full service list (incl. archived).
// POST /api/projects/[id]/bookings/services — owner: create a service.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SERVICES = 50;

async function owns(projectId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  if (!(await owns(id, session.user.id))) return json({ error: "not_found" }, 404);
  const services = await listServices(id, { includeArchived: true });
  return json({ services }, 200);
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  if (!(await owns(id, session.user.id))) return json({ error: "not_found" }, 404);

  const parsed = serviceInputSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return json({ error: "invalid_body", issues: parsed.error.issues.slice(0, 5) }, 400);
  }

  const existing = await listServices(id, { includeArchived: true });
  if (existing.length >= MAX_SERVICES) return json({ error: "too_many_services" }, 403);

  const v = parsed.data;
  const service = await createService(id, {
    name: v.name,
    description: v.description ?? null,
    durationMin: v.durationMin,
    slotIncrementMin: v.slotIncrementMin,
    bufferBeforeMin: v.bufferBeforeMin,
    bufferAfterMin: v.bufferAfterMin,
    minLeadTimeMin: v.minLeadTimeMin,
    maxDaysAhead: v.maxDaysAhead,
    creatorTz: v.creatorTz,
    weeklyHours: (v.weeklyHours ?? {}) as Partial<Record<Weekday, DayRange[]>>,
    exceptions: (v.exceptions ?? []) as BookingException[],
    capacity: v.capacity,
    priceDisplay: v.priceDisplay ?? null,
    locationText: v.locationText ?? null,
    sortOrder: v.sortOrder,
  });
  return json({ service }, 201);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
