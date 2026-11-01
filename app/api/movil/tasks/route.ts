// GET /api/movil/tasks — the phone's «Tareas» (spec local 2026-10-31-len-movil, §5.4), like Claude
// Duet's Tasks: what needs the person, what Len is doing, their scheduled tasks and what was resolved,
// across every project they can see (`buildTasksOverview`, with the real stores here).
import { liveTurns } from "@/lib/agent/direcciones";
import { activeIncident, resolvedSince } from "@/lib/len-watch/store";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { buildTasksOverview } from "@/lib/movil/tasks-overview";
import { goalOfProject, lastFinishedTurnOf } from "@/lib/projects/chat";
import { visibleProjects } from "@/lib/projects/visible-projects";
import { getRun, listTasksOfProjects, runsSince } from "@/lib/scheduled-tasks/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = paraLaApp(async (req: Request): Promise<Response> => {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const overview = await buildTasksOverview(userId, {
    visibleProjects,
    now: () => new Date(),
    liveTurns: () => liveTurns(),
    tasksOf: listTasksOfProjects,
    runOf: getRun,
    runsSince,
    goalOf: goalOfProject,
    lastTurnOf: lastFinishedTurnOf,
    incidentOf: activeIncident,
    resolvedIncidents: resolvedSince,
  });
  return Response.json(overview, { headers: { "cache-control": "no-store" } });
});

export const OPTIONS = respuestaPrevia;
