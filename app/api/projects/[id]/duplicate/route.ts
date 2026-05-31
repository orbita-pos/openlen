import { auth } from "@/auth";
import { duplicateProject, getProject } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/projects/[id]/duplicate — clones the project (same data + title
// suffixed with " (copy)") and returns the new project as a summary so the
// list can prepend it optimistically. Status resets to draft and deployUrl
// is cleared, so a duplicate of a published page doesn't inherit its
// deployment.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  const newId = await duplicateProject(id, session.user.id);
  if (!newId) return json({ error: "not_found" }, 404);
  const created = await getProject(newId, session.user.id);
  if (!created) return json({ error: "not_found" }, 404);
  const project = {
    id: created.id,
    title: created.title,
    status: created.status,
    tags: created.tags,
    deployUrl: created.deployUrl,
    thumbnailUrl: created.thumbnailUrl,
    logoUrl: created.logoUrl,
    subdomain: created.subdomain,
    publishedAt: created.publishedAt,
    hasUnpublishedChanges: created.hasUnpublishedChanges,
    sectionCount: created.sectionCount,
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
  };
  return json({ id: newId, project }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
