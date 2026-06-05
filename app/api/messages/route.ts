import { auth } from "@/auth";
import { listSubmissionsForUser } from "@/lib/projects/forms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/messages — the user's cross-project leads inbox, newest first. Raw
// ip/ua are stripped; only the derived triage fields ship. Mirrors the
// /messages route so the in-workspace Messages section can fetch it.
export async function GET(): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return json({ error: "unauthorized" }, 401);
  }
  const rows = await listSubmissionsForUser(session.user.id);
  const leads = rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    projectTitle: r.projectTitle,
    subdomain: r.subdomain,
    data: r.data,
    country: r.meta?.country ?? null,
    device: r.meta?.device ?? null,
    createdAt: r.createdAt,
  }));
  return json({ leads }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
