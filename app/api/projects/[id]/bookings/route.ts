import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { listBookings, listServices, type BookingStatus } from "@/lib/bookings/store";

// GET /api/projects/[id]/bookings?status=&service=&from=&to=
// Owner-only — the Reservas panel's booking list + the services for filtering.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES: BookingStatus[] = ["pending", "confirmed", "cancelled", "completed", "no_show"];

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;

  const owned = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, id), eq(schema.projects.userId, session.user.id)))
    .limit(1);
  if (owned.length === 0) return json({ error: "not_found" }, 404);

  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status");
  const status = statusParam && STATUSES.includes(statusParam as BookingStatus)
    ? [statusParam as BookingStatus]
    : undefined;
  const serviceId = url.searchParams.get("service") || undefined;
  // A MISSING param must be undefined, not 0 — Number(null) === 0 would set the
  // filter to 1970 and exclude every real booking (the panel sends no params).
  const dateParam = (k: string): Date | undefined => {
    const v = url.searchParams.get(k);
    if (v === null) return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? new Date(n) : undefined;
  };

  const [bookings, services] = await Promise.all([
    listBookings(id, {
      status,
      serviceId,
      fromUtc: dateParam("from"),
      toUtc: dateParam("to"),
    }),
    listServices(id, { includeArchived: true }),
  ]);

  return json(
    {
      services: services.map((s) => ({ id: s.id, name: s.name, status: s.status })),
      bookings: bookings.map((b) => ({
        id: b.id,
        serviceId: b.serviceId,
        start: b.startUtc.getTime(),
        end: b.endUtc.getTime(),
        status: b.status,
        memberId: b.memberId,
        guestName: b.guestName,
        guestEmail: b.guestEmail,
        note: b.note,
        creatorTz: b.creatorTz,
        visitorTz: b.visitorTz,
        createdAt: b.createdAt.getTime(),
      })),
    },
    200,
  );
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
