// POST /api/projects/[id]/scheduled-tasks/[taskId]/pause — the clock's «Pausar» / «Reanudar», on the web
// and on the phone (spec local 2026-10-31-len-movil, §5.5). Body { paused: boolean } → { id, paused }.
// Owner and editors, like the rest of the clock; only recurring tasks (409 `schedule_one_shot`). Resuming
// goes to the next run after now: what was missed while paused is not run.
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { exigirAcceso } from "@/lib/projects/acceso";
import { scheduleEnabled } from "@/lib/scheduled-tasks/enabled";
import { pauseTask, resumeTask } from "@/lib/scheduled-tasks/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; taskId: string }> };

export const POST = paraLaApp(async (req: Request, ctx: Ctx): Promise<Response> => {
  if (!scheduleEnabled()) return Response.json({ error: "scheduled_tasks_off" }, { status: 503 });
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id, taskId } = await ctx.params;
  const access = await exigirAcceso(id, userId, "editar");
  if (access instanceof Response) return access;
  const body = (await req.json().catch(() => null)) as { paused?: unknown } | null;
  if (typeof body?.paused !== "boolean") return Response.json({ code: "invalid_body" }, { status: 400 });
  const now = new Date();
  const result = body.paused ? await pauseTask(id, taskId, now) : await resumeTask(id, taskId, now);
  if (result === "not_found") return Response.json({ code: "schedule_not_found" }, { status: 404 });
  if (result === "one_shot") return Response.json({ code: "schedule_one_shot" }, { status: 409 });
  return Response.json({ id: taskId, paused: body.paused });
});

export const OPTIONS = respuestaPrevia;
