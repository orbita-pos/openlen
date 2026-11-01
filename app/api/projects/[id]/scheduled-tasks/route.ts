// GET /api/projects/[id]/scheduled-tasks — THE CLOCK'S LIST (spec local 2026-10-29-tareas-programadas,
// §7.8): the project's active tasks, as the model sees them (DeepSeek's view + the local next run), with
// who created each and how its last run went. For whoever can talk to Len there (owner and editors).
import { auth } from "@/auth";
import { exigirAcceso } from "@/lib/projects/acceso";
import { getRun, listTasks } from "@/lib/scheduled-tasks/store";
import { viewForModel } from "@/lib/scheduled-tasks/view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  const userId = (await auth())?.user?.id;
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await ctx.params;
  const acceso = await exigirAcceso(id, userId, "editar");
  if (acceso instanceof Response) return acceso;
  const now = Date.now();
  const tasks = await Promise.all(
    (await listTasks(id)).map(async (task) => {
      const run = task.lastRunId ? await getRun(task.lastRunId) : null;
      return {
        ...viewForModel(task.record, now, task.timeZone, { pausedAt: task.pausedAt }),
        createdBy: task.createdBy,
        lastRun: run ? { at: run.occurrenceAt.toISOString(), outcome: run.outcome, reason: run.reason } : null,
      };
    }),
  );
  return Response.json({ tasks });
}
