// LA PUERTA DE ESCRITURA DEL MCP: la MISMA que la terminal y la lente Código
// (`guardarLoDeLaTerminal`), con una sesión de la persona «desde el MCP» y la
// app puesta, dentro de `conAutor` para que Versiones diga quién fue.
import { cargarFicherosDeLaTerminal, guardarLoDeLaTerminal } from "@/lib/agent/herramientas-de-ficheros";
import { diagnosticosDeLaApp } from "@/lib/agent/compila-la-app";
import { redactarDiagnosticos } from "@/lib/agent/diagnosticos";
import type { CambioDeLaTerminal } from "@/lib/agent/terminal/ficheros";
import { realDeps } from "@/lib/agent/tools";
import { ESM_LOCK_PATH } from "@/lib/apps/npm/paths";
import { conAutor } from "@/lib/projects/autor-del-cambio";
import type { AccesoAlProyecto } from "@/lib/projects/acceso";
import { openProject, type LoadedProject } from "./access";
import type { McpCaller } from "./auth";
import { fileVersion } from "./file-version";
import { toolError, type ToolResult } from "./results";
import { mcpAgentSession } from "./session";
import type { ToolAnnotations } from "./tools/define";

export interface OpenedProject {
  projectId: string;
  acceso: AccesoAlProyecto;
  row: LoadedProject;
}

export const WRITE_ANNOTATIONS: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false };
export const DESTRUCTIVE_ANNOTATIONS: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false };

function sessionFor(caller: McpCaller, open: OpenedProject) {
  return mcpAgentSession({ projectId: open.projectId, ownerId: open.acceso.duenoId, personId: caller.userId, app: open.row.data.app });
}

export async function loadTreeForWrite(
  caller: McpCaller,
  projectId: string,
): Promise<{ ok: true; open: OpenedProject; tree: Record<string, string> } | { ok: false; result: ToolResult }> {
  const opened = await openProject(caller, projectId, "editar");
  if (!opened.ok) return opened;
  const open: OpenedProject = { projectId, acceso: opened.acceso, row: opened.row };
  return { ok: true, open, tree: await cargarFicherosDeLaTerminal(sessionFor(caller, open), realDeps()) };
}

/** null = la versión cuadra; si no, el conflicto con la versión de ahora. */
export function checkVersion(tree: Readonly<Record<string, string>>, path: string, expected: string): ToolResult | null {
  const now = fileVersion(tree[path] ?? "");
  if (now === expected) return null;
  return toolError(
    "version_conflict",
    `${path} changed since you read it (now version ${now}, you sent ${expected}). Read it again and redo your change on the new content.`,
  );
}

export async function applyChanges(
  caller: McpCaller,
  open: OpenedProject,
  cambios: CambioDeLaTerminal[],
  antes: Readonly<Record<string, string>>,
): Promise<{ ok: true; saved: Record<string, string | null>; diagnostics: string | null } | { ok: false; result: ToolResult }> {
  const session = sessionFor(caller, open);
  const g = await conAutor(caller.userId, () => guardarLoDeLaTerminal(session, realDeps(), cambios, antes));
  if (g.rechazado) return { ok: false, result: toolError("rejected", g.notas.join("\n")) };
  // NPM ABIERTO (spec 2026-10-13): lo que dijo instalar lo que importa lo guardado.
  const found = [...(g.npmNotes ?? []), ...g.escrituras.flatMap((e) => [...(e.diagnosticos ?? [])])];
  // UNA APP: la terminal guarda como «bash» y no pide los diagnósticos (los pide
  // ella al acabar el comando entero), así que aquí se calculan tras guardar,
  // con la función pura de Len: sólo lo NUEVO frente a lo de antes de escribir.
  // Sin `typesAndLintAfterWrite`: su resultado se recoge en el turno siguiente
  // de Len, y aquí no hay turno siguiente (los tipos los da get_diagnostics).
  const app = open.row.data.app;
  if (app) {
    const after = await cargarFicherosDeLaTerminal(session, realDeps());
    // El lock de esm.sh vive en /.openlen, que la terminal no lleva: el del servidor.
    const lock = (await realDeps().projectFiles?.(session.projectId).catch(() => null))?.[ESM_LOCK_PATH];
    found.push(
      ...diagnosticosDeLaApp({
        app,
        ahora: lock === undefined ? after : { ...after, [ESM_LOCK_PATH]: lock },
        alEmpezar: antes,
        escritos: cambios.map((c) => c.ruta),
        cascaron: after["/index.html"] ?? open.row.data.html ?? "",
      }),
    );
  }
  return { ok: true, saved: g.enLaTerminal, diagnostics: redactarDiagnosticos(found) };
}
