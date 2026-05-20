import { eq } from "drizzle-orm";
import { auth } from "@/auth";
import { db, schema } from "@/lib/db";
import { listReleases } from "@/lib/publish/filesystem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/projects/[id]/releases
// Returns the on-disk release history for the project's subdomain.
// Used by the TopBar "Previous deploys" dropdown.
//
// Response: { releases: [{ sha, mtime: ISO string, isCurrent: boolean }] }
// Empty array if the project has no subdomain or no releases on disk.

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;

  const rows = await db
    .select({
      subdomain: schema.projects.subdomain,
      userId: schema.projects.userId,
    })
    .from(schema.projects)
    .where(eq(schema.projects.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) return json({ error: "not_found" }, 404);
  if (row.userId !== session.user.id) {
    return json({ error: "forbidden" }, 403);
  }
  if (!row.subdomain) {
    return json({ releases: [] }, 200);
  }

  const releases = await listReleases(row.subdomain);
  return json(
    {
      releases: releases.map((r) => ({
        sha: r.sha,
        mtime: r.mtime.toISOString(),
        isCurrent: r.isCurrent,
      })),
    },
    200,
  );
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
