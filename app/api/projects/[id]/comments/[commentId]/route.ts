import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { deleteComment, setCommentStatus } from "@/lib/comments/store";

// PATCH  /api/projects/[id]/comments/[commentId] {status} — hide / unhide.
// DELETE /api/projects/[id]/comments/[commentId]          — hard delete.
// Owner-only.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function ownsProject(projectId: string, userId: string): Promise<boolean> {
  const rows = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)))
    .limit(1);
  return rows.length > 0;
}

const PatchSchema = z.object({ status: z.enum(["visible", "hidden"]) });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id, commentId } = await params;
  if (!(await ownsProject(id, session.user.id))) return json({ error: "not_found" }, 404);

  const parsed = PatchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ error: "invalid_body" }, 400);

  const ok = await setCommentStatus(id, commentId, parsed.data.status);
  if (!ok) return json({ error: "not_found" }, 404);
  return json({ ok: true }, 200);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id, commentId } = await params;
  if (!(await ownsProject(id, session.user.id))) return json({ error: "not_found" }, 404);

  const ok = await deleteComment(id, commentId);
  if (!ok) return json({ error: "not_found" }, 404);
  return json({ ok: true }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
