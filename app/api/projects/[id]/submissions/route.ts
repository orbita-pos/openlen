import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { listSubmissions } from "@/lib/projects/forms";

export const runtime = "nodejs";

// GET /api/projects/[id]/submissions — the project's lead submissions,
// newest-first. Owner-only.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await ctx.params;

  const owned = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(
      and(
        eq(schema.projects.id, id),
        eq(schema.projects.userId, session.user.id),
      ),
    )
    .limit(1);
  if (owned.length === 0) return json({ error: "not_found" }, 404);

  const submissions = await listSubmissions(id);
  return json({ submissions }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
