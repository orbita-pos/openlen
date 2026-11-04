// /api/projects/[id]/scheduled-tasks/[taskId] — the clock's «Guardar» and «Borrar» (spec local
// 2026-10-29-tareas-programadas, §7.8). PATCH takes `schedule_update`'s arguments (title, prompt, one of
// at / every_seconds / daily / weekly / cron) and answers its DeepSeek value: the same road as Len's
// tool (lib/scheduled-tasks/update-task.ts). Creating stays with Len, so he confirms the time. From the
// web or the phone (spec local 2026-10-31-len-movil). An event task (spec local 2026-11-03-len-que-avisa) changes
// only its name and prompt, by the same rule as Len's tool (lib/event-tasks/update.ts).
import { deleteEventTask, getEventTask, updateEventTask } from "@/lib/event-tasks/store";
import { eventTaskPatch } from "@/lib/event-tasks/update";
import { paraLaApp, respuestaPrevia } from "@/lib/movil/cors";
import { usuarioDeLaPeticion } from "@/lib/movil/quien";
import { exigirAcceso } from "@/lib/projects/acceso";
import { scheduleEnabled } from "@/lib/scheduled-tasks/enabled";
import { deleteTask, listTasks, updateTask } from "@/lib/scheduled-tasks/store";
import { asValue, updateScheduledTask } from "@/lib/scheduled-tasks/update-task";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string; taskId: string }> };

async function allowed(req: Request, ctx: Ctx): Promise<{ id: string; taskId: string; owner: boolean } | Response> {
  if (!scheduleEnabled()) return Response.json({ error: "scheduled_tasks_off" }, { status: 503 });
  const userId = await usuarioDeLaPeticion(req);
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id, taskId } = await ctx.params;
  const acceso = await exigirAcceso(id, userId, "editar");
  return acceso instanceof Response ? acceso : { id, taskId, owner: acceso.rol === "dueno" };
}

const STATUS: Readonly<Record<string, number>> = { schedule_not_found: 404, schedule_ended: 409, schedule_conflict: 409, internal_error: 500 };

export const PATCH = paraLaApp(async (req: Request, ctx: Ctx): Promise<Response> => {
  const ok = await allowed(req, ctx);
  if (ok instanceof Response) return ok;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ code: "invalid_selector", message: "A JSON object is required." }, { status: 400 });
  // An event task is the owner's (final review I8): for a member it isn't there.
  if (ok.owner && (await getEventTask(ok.id, ok.taskId))) {
    const change = eventTaskPatch(body);
    if (!change.ok) return Response.json(change.error, { status: 400 });
    const row = await updateEventTask(ok.id, ok.taskId, change.patch, new Date());
    return row ? Response.json({ id: row.id, kind: "event", title: row.title, prompt: row.prompt }) : Response.json({ code: "schedule_not_found" }, { status: 404 });
  }
  const value = (await asValue(() => updateScheduledTask(ok.id, { ...body, id: ok.taskId }, { list: listTasks, update: updateTask, now: () => Date.now() }))) as Record<string, unknown>;
  const code = typeof value.code === "string" ? value.code : null;
  return Response.json(value, { status: code ? (STATUS[code] ?? 400) : 200 });
});

export const DELETE = paraLaApp(async (req: Request, ctx: Ctx): Promise<Response> => {
  const ok = await allowed(req, ctx);
  if (ok instanceof Response) return ok;
  const deleted = (await deleteTask(ok.id, ok.taskId)) || (ok.owner && (await deleteEventTask(ok.id, ok.taskId)));
  return deleted ? Response.json({ id: ok.taskId, deleted: true }) : Response.json({ id: ok.taskId, deleted: false, code: "schedule_not_found" }, { status: 404 });
});

export const OPTIONS = respuestaPrevia;
