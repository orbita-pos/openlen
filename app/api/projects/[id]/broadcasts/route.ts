import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { getUsage, getUserPlan } from "@/lib/limits";
import { broadcastCapWindows, broadcastEmailCapKey } from "@/lib/broadcast/limits";
import { createBroadcast, listBroadcasts } from "@/lib/broadcast/store";

// ─────────────────────────────────────────────────────────────────────────────
// GET  /api/projects/[id]/broadcasts — campaign history + remaining email cap.
// POST /api/projects/[id]/broadcasts — create a draft (subject + body).
// Owner-only — same gate as /members and /submissions.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function loadOwned(projectId: string, userId: string) {
  const rows = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Remaining sends this month against the shared email budget. */
async function remainingCap(projectId: string, userId: string): Promise<number> {
  const plan = await getUserPlan(userId);
  const usage = await getUsage(broadcastEmailCapKey(projectId), broadcastCapWindows(plan));
  return usage[0]?.remaining ?? 0;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;

  const owned = await loadOwned(id, session.user.id);
  if (!owned) return json({ error: "not_found" }, 404);

  const [broadcasts, remaining] = await Promise.all([
    listBroadcasts(id),
    remainingCap(id, session.user.id),
  ]);
  return json({ broadcasts, remaining }, 200);
}

const CreateSchema = z.object({
  subject: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20000),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;

  const owned = await loadOwned(id, session.user.id);
  if (!owned) return json({ error: "not_found" }, 404);

  const parsed = CreateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid_body" }, 400);

  const broadcast = await createBroadcast(id, parsed.data);
  return json({ broadcast }, 201);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
