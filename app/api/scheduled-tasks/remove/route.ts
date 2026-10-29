// POST /api/scheduled-tasks/remove — «Quitar esta tarea» from the email (spec local
// 2026-10-29-tareas-programadas, §7.8). Body `{ task, token }`: the token is the HMAC the email carried
// (lib/scheduled-tasks/removal-token.ts), so no sign-in is needed and only that task can go. There is no
// GET: mail scanners open links on their own; the page at /<locale>/scheduled-tasks/remove asks first.
import { deleteTask, getTaskById } from "@/lib/scheduled-tasks/store";
import { verifyRemovalToken } from "@/lib/scheduled-tasks/removal-token";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const body = (await req.json().catch(() => null)) as { task?: unknown; token?: unknown } | null;
  const taskId = typeof body?.task === "string" ? body.task : "";
  const token = typeof body?.token === "string" ? body.token : "";
  if (!taskId || !verifyRemovalToken(taskId, token)) return Response.json({ error: "forbidden" }, { status: 403 });
  const task = await getTaskById(taskId);
  if (task) await deleteTask(task.projectId, task.id);
  // Already gone is the same answer: what the person wanted is true.
  return Response.json({ ok: true });
}
