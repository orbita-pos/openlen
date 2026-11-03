// La misma lectura y el mismo ■ que la web, con la sesión del teléfono.
import type { ClienteDeOpenLen } from "@/components/llamada/cliente";
import type { RunDelMovil } from "../chat/subagentes";

export async function leerSubagentes(c: ClienteDeOpenLen, o: { projectId: string; fila: string; ids: readonly string[] }): Promise<RunDelMovil[]> {
  const query = new URLSearchParams({ project: o.projectId, row: o.fila, ids: o.ids.join(",") });
  const res = await c.pedir(`/api/agent/subagents?${query}`);
  if (!res.ok) throw new Error(`subagents: ${res.status}`);
  const body = await res.json() as { runs?: RunDelMovil[] };
  return (body.runs ?? []).map(r => ({
    id: r.id, preset: r.preset, description: r.description, status: r.status,
    toolUses: r.toolUses, durationMs: r.durationMs, worktree: r.worktree ?? null,
  }));
}

export async function pararSubagente(c: ClienteDeOpenLen, id: string): Promise<boolean> {
  const res = await c.pedir(`/api/agent/subagents/${encodeURIComponent(id)}/stop`, { method: "POST" });
  return res.ok && (await res.json() as { stopped?: boolean }).stopped === true;
}
