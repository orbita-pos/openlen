import { auth } from "@/auth";
import { listSubmissionsForUser } from "@/lib/projects/forms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/messages — the user's cross-project leads inbox, newest first. Raw
// ip/ua are stripped; only the derived triage fields ship. Mirrors the
// /messages route so the in-workspace Messages section can fetch it.
export async function GET(req: Request): Promise<Response> {
  const session = await auth();
  if (!session?.user?.id) {
    return json({ error: "unauthorized" }, 401);
  }
  const userId = session.user.id;
  const rows = await listSubmissionsForUser(userId);
  let leads = rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    projectTitle: r.projectTitle,
    subdomain: r.subdomain,
    data: r.data,
    country: r.meta?.country ?? null,
    device: r.meta?.device ?? null,
    page: r.meta?.page ?? null,
    createdAt: r.createdAt,
  }));
  // ⚰️ Aquí se acotaban los mensajes a UN negocio (`?business=`). Se fue con
  // el perfil el 2026-08-31: la bandeja es del usuario, no de una ficha suya.
  return json({ leads }, 200);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
