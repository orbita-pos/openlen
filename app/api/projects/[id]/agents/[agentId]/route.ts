import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { removeAgent } from "@/lib/chat/agents";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// DELETE /api/projects/[id]/agents/[agentId] — remove an agent (owner only)
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; agentId: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id, agentId } = await params;

  // Owner-only gate: verify the caller owns the project
  const rows = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, id),
        eq(schema.projects.userId, session.user.id),
      ),
    )
    .limit(1);
  if (!rows[0]) return json({ error: "not_found" }, 404);

  await removeAgent(id, agentId);
  return json({ ok: true }, 200);
}
