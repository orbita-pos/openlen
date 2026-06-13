import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { getCommentAuthor } from "@/lib/comments/store";
import { deleteMember } from "@/lib/members/store";

// POST /api/projects/[id]/comments/[commentId]/ban — ban the comment's author.
// Deletes the siteMembers row → FK-cascades their sessions → future posts
// impossible. Their existing comments stay (snapshot, no FK) so the owner can
// still delete them individually. Owner-only.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string; commentId: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id, commentId } = await params;

  const owned = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(and(eq(schema.projects.id, id), eq(schema.projects.userId, session.user.id)))
    .limit(1);
  if (owned.length === 0) return json({ error: "not_found" }, 404);

  const author = await getCommentAuthor(id, commentId);
  if (!author) return json({ error: "not_found" }, 404);
  if (!author.memberId) return json({ error: "no_member" }, 409); // already gone

  await deleteMember(id, author.memberId);
  return json({ ok: true }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
