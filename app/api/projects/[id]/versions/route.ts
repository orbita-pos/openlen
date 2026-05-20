import { auth } from "@/auth";
import { listVersions } from "@/lib/projects/versions";

export const runtime = "nodejs";

// GET /api/projects/<id>/versions — returns the user's version history for
// this project, newest-first. Cap at 50 (enforced by the helper).
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);

  const { id } = await ctx.params;
  if (!id) return json({ error: "missing id" }, 400);

  const versions = await listVersions({
    projectId: id,
    userId: session.user.id,
  });
  return json({ versions }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
