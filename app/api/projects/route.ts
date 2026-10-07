import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { findOrCreateBlankProject, listProjects } from "@/lib/projects";
import { getProjectStatsForUser } from "@/lib/analytics/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/projects — the signed-in user's projects (newest first) with the
// last-7-day stats merged in. Powers both the /projects dashboard data and
// the in-workspace Projects section.
export const GET = paraLaApp(async (req: Request): Promise<Response> => {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) {
    return json({ error: "unauthorized" }, 401);
  }
  const [projects, statsMap] = await Promise.all([
    listProjects(userId),
    getProjectStatsForUser(userId, 7),
  ]);
  const withStats = projects.map((p) => ({ ...p, stats: statsMap.get(p.id) }));
  return json({ projects: withStats }, 200);
});

// POST /api/projects — EL PROYECTO EN BLANCO (plans/crear-es-len): el que ya
// tenía el usuario o uno nuevo. Es lo que abre `/new`, como la «New Session»
// de DeepSeek: el proyecto existe antes del primer mensaje.
export const POST = paraLaApp(async (req: Request): Promise<Response> => {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return json({ error: "unauthorized" }, 401);
  const id = await findOrCreateBlankProject(userId);
  return json({ id }, 200);
});

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const OPTIONS = respuestaPrevia;
