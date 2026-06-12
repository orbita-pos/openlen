import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { deleteMember } from "@/lib/members/store";

// DELETE /api/projects/[id]/members/[memberId] — revoke a member. The row
// delete IS the revocation: every protected fetch re-checks the row, so
// access dies on the member's next request. Owner-only.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; memberId: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id, memberId } = await params;

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

  const removed = await deleteMember(id, memberId);
  if (!removed) return json({ error: "not_found" }, 404);
  return json({ ok: true }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
