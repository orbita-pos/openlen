import { and, eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { releaseDomain } from "@/lib/custom-domains";

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/projects/[id]/domains/[domain] — release a claim.
//
// Once released, the domain is immediately re-claimable by any project.
// The Caddy-issued cert remains on the proxy until it expires naturally;
// without a verified row at lookup time, no traffic will reach the project.
// ─────────────────────────────────────────────────────────────────────────────

export const runtime = "nodejs";

async function ensureOwner(
  projectId: string,
  userId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.projects.id })
    .from(schema.projects)
    .where(
      and(eq(schema.projects.id, projectId), eq(schema.projects.userId, userId)),
    )
    .limit(1);
  return Boolean(rows[0]);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; domain: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id, domain } = await params;
  if (!(await ensureOwner(id, session.user.id))) {
    return json({ error: "not_found" }, 404);
  }
  await releaseDomain({ projectId: id, domain: decodeURIComponent(domain) });
  return json({ ok: true }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
