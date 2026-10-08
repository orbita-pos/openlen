import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { findOrCreateBlankProject, listProjects, listProjectsByIds } from "@/lib/projects";
import { proyectosCompartidos } from "@/lib/projects/miembros";
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
  const [projects, statsMap, compartidos] = await Promise.all([
    listProjects(userId),
    getProjectStatsForUser(userId, 7),
    proyectosCompartidos(userId),
  ]);
  const withStats = projects.map((p) => ({ ...p, stats: statsMap.get(p.id) }));
  // Los compartidos contigo (compartir el proyecto), aparte y sin estadísticas:
  // los resultados son del dueño (lib/projects/acceso.ts).
  const deQuien = new Map(compartidos.map((c) => [c.projectId, c]));
  const shared = (await listProjectsByIds(compartidos.map((c) => c.projectId)))
    .filter((p) => !p.isBlank)
    .map((p) => {
      const c = deQuien.get(p.id)!;
      return { ...p, compartido: { rol: c.rol, duenoEmail: c.duenoEmail, duenoName: c.duenoName } };
    });
  return json({ projects: withStats, shared }, 200);
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
