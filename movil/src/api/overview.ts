// The phone's calls for «Entregado» and «Tareas» (spec local 2026-10-31-len-movil, §5.3–5.5): the two
// global lists, and for a scheduled task the same pause, edit and delete routes as the web clock.
import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import type { DeliveryIndexRow } from "@/lib/agent/skills/delivery-index";
import type { TasksOverview } from "@/lib/movil/tasks-overview";

export type DeliveredItem = Omit<DeliveryIndexRow, "createdAt"> & { readonly createdAt: string; readonly projectTitle: string };

const JSON_HEADERS = { "content-type": "application/json" };
const taskPath = (projectId: string, taskId: string) => `/api/projects/${encodeURIComponent(projectId)}/scheduled-tasks/${encodeURIComponent(taskId)}`;

async function read<T>(c: ClienteDeOpenLen, path: string): Promise<T> {
  const res = await c.pedir(path);
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as T;
}

export async function fetchDelivered(c: ClienteDeOpenLen, limit = 50): Promise<DeliveredItem[]> {
  return (await read<{ items: DeliveredItem[] }>(c, `/api/movil/delivered?limit=${limit}`)).items;
}

export function fetchTasks(c: ClienteDeOpenLen): Promise<TasksOverview> {
  return read<TasksOverview>(c, "/api/movil/tasks");
}

export async function setTaskPaused(c: ClienteDeOpenLen, projectId: string, taskId: string, paused: boolean): Promise<boolean> {
  return (await c.pedir(`${taskPath(projectId, taskId)}/pause`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ paused }) })).ok;
}

/** The exact body the web clock sends (`components/workspace-v2/chat/scheduled-format.ts`). */
export async function editScheduledTask(c: ClienteDeOpenLen, projectId: string, taskId: string, patch: Record<string, unknown>): Promise<{ ok: boolean; code?: string; message?: string }> {
  const res = await c.pedir(taskPath(projectId, taskId), { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(patch) });
  const value = ((await res.json().catch(() => null)) ?? {}) as { code?: string; message?: string };
  return { ok: res.ok, ...(res.ok ? {} : { ...(value.code ? { code: value.code } : {}), ...(value.message ? { message: value.message } : {}) }) };
}

export async function deleteScheduledTask(c: ClienteDeOpenLen, projectId: string, taskId: string): Promise<boolean> {
  return (await c.pedir(taskPath(projectId, taskId), { method: "DELETE" })).ok;
}
