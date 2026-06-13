import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { countPending, listAllComments, type CommentStatus } from "@/lib/comments/store";

// GET /api/projects/[id]/comments?status=hidden|visible&page=<slug>
// Owner-only moderation read — everything incl. hidden, with the pending count.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const status: CommentStatus | undefined =
    statusParam === "hidden" || statusParam === "visible" ? statusParam : undefined;

  const [comments, pending] = await Promise.all([
    listAllComments(id, status ? { status } : undefined),
    countPending(id),
  ]);
  return json({ comments, pending }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
