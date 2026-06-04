import { auth } from "@/auth";
import { getProfile } from "@/lib/business-profiles/store";
import { listProjectsForProfile } from "@/lib/projects";

// GET /api/profiles/[id]/projects — the pages that belong to this business.
// Ownership-scoped (404 if the business isn't the caller's).

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return json(401, { error: "unauthenticated" });
  const { id } = await params;
  const profile = await getProfile(session.user.id, id);
  if (!profile) return json(404, { error: "profile not found" });
  const pages = await listProjectsForProfile(session.user.id, id);
  return json(200, { pages });
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
