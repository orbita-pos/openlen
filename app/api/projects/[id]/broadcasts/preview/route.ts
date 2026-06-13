import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { getUsage, getUserPlan } from "@/lib/limits";
import { broadcastCapWindows, broadcastEmailCapKey } from "@/lib/broadcast/limits";
import { previewBroadcastAudience } from "@/lib/broadcast/audience";

// GET /api/projects/[id]/broadcasts/preview — audience count + a tiny name
// sample + remaining cap, for the compose screen's "Send to N members".
// Owner-only.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
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

  const plan = await getUserPlan(session.user.id);
  const [{ audienceCount, sampleNames }, usage] = await Promise.all([
    previewBroadcastAudience(id),
    getUsage(broadcastEmailCapKey(id), broadcastCapWindows(plan)),
  ]);
  return json(
    { audienceCount, sampleNames, remaining: usage[0]?.remaining ?? 0 },
    200,
  );
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}
