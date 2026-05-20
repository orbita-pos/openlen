import { auth } from "@/auth";
import { restoreVersion } from "@/lib/projects/versions";

export const runtime = "nodejs";

// POST /api/projects/<id>/versions/<vid>/restore — overwrites the project's
// current data.html with the version's snapshot. Snapshots the pre-restore
// state as a new version first, so the restore is itself undoable.
//
// Returns the restored HTML so the client can refresh the iframe without
// having to round-trip through GET /api/projects/<id>.
export async function POST(
  _req: Request,
  ctx: { params: Promise<{ id: string; vid: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);

  const { id, vid } = await ctx.params;
  if (!id || !vid) return json({ error: "missing id" }, 400);

  const result = await restoreVersion({
    projectId: id,
    versionId: vid,
    userId: session.user.id,
  });
  if (!result) return json({ error: "not found" }, 404);

  return json(result, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
