// /api/projects/[id]/scheduled-tasks/[taskId] — the clock's «Guardar» and «Borrar» (spec local
// 2026-10-29-tareas-programadas, §7.8). PATCH takes `schedule_update`'s arguments (title, prompt, one of
// at / every_seconds / daily / weekly / cron) and answers its DeepSeek value: the same road as Len's
// tool (lib/scheduled-tasks/update-task.ts). Creating stays with Len, so he confirms the time.
import { auth } from "@/auth";
import { exigirAcceso } from "@/lib/projects/acceso";
import { scheduleEnabled } from "@/lib/scheduled-tasks/enabled";
import { deleteTask, listTasks, updateTask } from "@/lib/scheduled-tasks/store";
import { asValue, updateScheduledTask } from "@/lib/scheduled-tasks/update-task";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; taskId: string }> };

async function allowed(ctx: Ctx): Promise<{ id: string; taskId: string } | Response> {
  if (!scheduleEnabled()) return Response.json({ error: "scheduled_tasks_off" }, { status: 503 });
  const userId = (await auth())?.user?.id;
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id, taskId } = await ctx.params;
  const acceso = await exigirAcceso(id, userId, "editar");
  return acceso instanceof Response ? acceso : { id, taskId };
}

const STATUS: Readonly<Record<string, number>> = { schedule_not_found: 404, schedule_ended: 409, schedule_conflict: 409, internal_error: 500 };

export async function PATCH(req: Request, ctx: Ctx): Promise<Response> {
  const ok = await allowed(ctx);
  if (ok instanceof Response) return ok;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ code: "invalid_selector", message: "A JSON object is required." }, { status: 400 });
  const value = (await asValue(() => updateScheduledTask(ok.id, { ...body, id: ok.taskId }, { list: listTasks, update: updateTask, now: () => Date.now() }))) as Record<string, unknown>;
  const code = typeof value.code === "string" ? value.code : null;
  return Response.json(value, { status: code ? (STATUS[code] ?? 400) : 200 });
}

export async function DELETE(_req: Request, ctx: Ctx): Promise<Response> {
  const ok = await allowed(ctx);
  if (ok instanceof Response) return ok;
  return (await deleteTask(ok.id, ok.taskId)) ? Response.json({ id: ok.taskId, deleted: true }) : Response.json({ id: ok.taskId, deleted: false, code: "schedule_not_found" }, { status: 404 });
}
