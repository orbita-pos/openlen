// GET /api/movil/delivered?limit=50 — the phone's «Entregado» (spec local 2026-10-31-len-movil, §5.3),
// like Claude Duet's Make: what Len delivered with `present` in every project the person can see,
// newest first, with each project's title. Seeing the project is enough, like the deliveries route
// that serves each file. At most 100.
import { listDeliveries } from "@/lib/agent/skills/delivery-index";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { visibleProjects } from "@/lib/projects/visible-projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export const GET = paraLaApp(async (req: Request): Promise<Response> => {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const asked = Number(new URL(req.url).searchParams.get("limit"));
  const limit = Number.isFinite(asked) && asked > 0 ? Math.min(Math.floor(asked), MAX_LIMIT) : DEFAULT_LIMIT;
  const projects = await visibleProjects(userId);
  const titleOf = new Map(projects.map((p) => [p.id, p.title]));
  const rows = await listDeliveries(projects.map((p) => p.id), limit);
  return Response.json({ items: rows.map((r) => ({ ...r, projectTitle: titleOf.get(r.projectId) ?? "" })) }, { headers: { "cache-control": "no-store" } });
});

export const OPTIONS = respuestaPrevia;
