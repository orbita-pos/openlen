import { auth } from "@/auth";
import { duplicateProject } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/projects/[id]/duplicate — clones the project (same data + title
// suffixed with " (copy)") and returns the new id. Status resets to draft
// and deployUrl is cleared, so a duplicate of a published page doesn't
// inherit its deployment.
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) return json({ error: "unauthorized" }, 401);
  const { id } = await params;
  const newId = await duplicateProject(id, session.user.id);
  if (!newId) return json({ error: "not_found" }, 404);
  return json({ id: newId }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
