// GET /api/projects/[id]/scheduled-tasks — THE CLOCK'S LIST (spec local 2026-10-29-tareas-programadas,
// §7.8): the project's active tasks, as the model sees them (DeepSeek's view + the local next run), with
// who created each and how its last run went. For whoever can talk to Len there (owner and editors),
// from the web or the phone (spec local 2026-10-31-len-movil). And the event tasks (spec local
// 2026-11-03-len-que-avisa, §8) in `events`, each with its latest records: what each look found and what came of
// it — never what a visitor sent (a record's candidate) nor the judge's conversation. The owner's only (final
// review I8): they read what the site's visitors send.
import { eventTasksEnabled } from "@/lib/event-tasks/enabled";
import { listEventTasks, recordsOf } from "@/lib/event-tasks/store";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { exigirAcceso } from "@/lib/projects/acceso";
import { getRun, listTasks } from "@/lib/scheduled-tasks/store";
import { viewForModel } from "@/lib/scheduled-tasks/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const OPTIONS = respuestaPrevia;

const RECORDS = 50;

export const GET = paraLaApp(async (req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> => {
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const acceso = await exigirAcceso(id, userId, "editar");
  if (acceso instanceof Response) return acceso;
  // WHOSE CLOCK (spec local 2026-11-19-agentes-para-todos, §6.4): Len's chat lists Len's tasks; an agent's place
  // (`?assistantId=`) only that agent's, and only for its owner and where it lives. An agent watches no sources.
  const assistantId = new URL(req.url).searchParams.get("assistantId");
  if (assistantId) {
    const { assistantById } = await import("@/lib/assistants/store");
    const agent = await assistantById(assistantId.slice(0, 100)).catch(() => null);
    if (!agent || agent.personId !== userId || agent.homeProjectId !== id) return Response.json({ tasks: [], events: [] });
  }
  const now = Date.now();
  const tasks = await Promise.all(
    (await listTasks(id, { scope: { assistantId: assistantId || null } })).map(async (task) => {
      const run = task.lastRunId ? await getRun(task.lastRunId) : null;
      return {
        ...viewForModel(task.record, now, task.timeZone, { pausedAt: task.pausedAt }),
        createdBy: task.createdBy,
        lastRun: run ? { at: run.occurrenceAt.toISOString(), outcome: run.outcome, reason: run.reason } : null,
      };
    }),
  );
  const events = eventTasksEnabled() && acceso.rol === "dueno" && !assistantId
    ? await Promise.all(
        (await listEventTasks(id)).map(async (task) => ({
          id: task.id,
          kind: "event" as const,
          title: task.title,
          prompt: task.prompt,
          source: task.source,
          params: task.params,
          lastCheckedAt: task.lastCheckedAt ? task.lastCheckedAt.toISOString() : null,
          createdBy: task.createdBy,
          ...(task.pausedAt ? { paused: true as const } : {}),
          records: (await recordsOf(task.id, RECORDS)).map((r) => ({ id: r.id, kind: r.kind, reason: r.reason, count: r.count, notified: r.notified, at: r.lastAt.toISOString() })),
        })),
      )
    : [];
  return Response.json({ tasks, events });
});
