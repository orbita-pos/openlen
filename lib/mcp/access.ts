// ABRIR UN PROYECTO DESDE EL MCP: la MISMA puerta que las rutas
// (`exigirAcceso`), traducida a errores que el modelo puede actuar.
import { realDeps, type AgentDeps } from "@/lib/agent/tools";
import { exigirAcceso, type AccesoAlProyecto, type Permiso } from "@/lib/projects/acceso";
import type { McpCaller } from "./auth";
import { toolError, type ToolResult } from "./results";

export type LoadedProject = NonNullable<Awaited<ReturnType<AgentDeps["loadProject"]>>>;

const NOT_FOUND = toolError(
  "not_found",
  "There is no project with that id that you can open. Call list_projects to get valid ids.",
);

export async function openProject(
  caller: McpCaller,
  projectId: string,
  permiso: Permiso,
): Promise<{ ok: true; acceso: AccesoAlProyecto; row: LoadedProject } | { ok: false; result: ToolResult }> {
  if (caller.projectId && caller.projectId !== projectId) {
    return {
      ok: false,
      result: toolError("out_of_scope", `This connection only reaches project ${caller.projectId}. Use that project_id.`),
    };
  }
  const acceso = await exigirAcceso(projectId, caller.userId, permiso);
  if (acceso instanceof Response) {
    if (acceso.status === 403) {
      return {
        ok: false,
        result: toolError("read_only", "You can view this project but not edit it: the owner gave you the viewer role."),
      };
    }
    return { ok: false, result: NOT_FOUND };
  }
  const row = await realDeps().loadProject(projectId, acceso.duenoId);
  if (!row) return { ok: false, result: NOT_FOUND };
  return { ok: true, acceso, row };
}
