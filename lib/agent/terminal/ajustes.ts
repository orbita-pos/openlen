/**
 * `/ajustes/proyecto.json` (F5 de plans/len-agente-2026, tarea 10): los ajustes
 * del proyecto como un fichero que la terminal lee y escribe.
 *
 *   { "titulo": "…", "idiomas": ["en", …], "modulos": { "chat": false, "assistant": true } }
 *
 * Escribirlo NO es escribir un JSON en ningún sitio: se valida con su esquema
 * (estricto: nada que no esté aquí) y cada campo que cambió va por el MISMO
 * camino que ya tiene su botón o su herramienta:
 *
 * - `titulo`  → `renameProject`, el de `PATCH /api/projects/[id]` (1–200 caracteres).
 * - `modulos` → `activar_modulo` entero (validar → aplicar → provisionar el
 *   chat → guardar), y su aviso de si los visitantes ya lo ven va a la salida.
 * - `idiomas` → se ven pero NO se cambian aquí: hoy se eligen al publicar
 *   (`publicar` añade; quitar es del modal de Publicar). Cambiarlos desde la
 *   terminal es una decisión de Jesús, no de esta tarea.
 *
 * Publicar sigue siendo un toque del usuario. No se retira `activar_modulo`.
 */
import "server-only";

import { z } from "zod";

import type { AgentDeps, AgentSession, ToolOutcome } from "@/lib/agent/tools";
import { AGENT_MODULES, type AgentModule } from "@/lib/agent/catalog";
import type { ProjectData } from "@/lib/projects/types";

export const RUTA_AJUSTES = "/ajustes/proyecto.json";

const ESQUEMA = z
  .object({
    titulo: z.string().trim().min(1).max(200),
    idiomas: z.array(z.string()),
    modulos: z.object({ chat: z.boolean(), assistant: z.boolean() }).strict(),
  })
  .strict();

type Ajustes = z.infer<typeof ESQUEMA>;

function ajustesDe(row: { title: string; data: ProjectData }): Ajustes {
  const s = row.data.settings;
  return {
    titulo: row.title,
    idiomas: [...(s?.languages ?? [])],
    modulos: { chat: s?.chat?.enabled === true, assistant: s?.assistant?.enabled === true },
  };
}

/** El fichero tal como está ahora. */
export function textoDeAjustes(row: { title: string; data: ProjectData }): string {
  return JSON.stringify(ajustesDe(row), null, 2) + "\n";
}

export type GuardadoDeAjustes =
  | {
      readonly ok: true;
      readonly notas: string[];
      readonly escrituras: ToolOutcome[];
      readonly texto: string;
      /** Algún módulo no se pudo cambiar: el comando no hizo todo lo pedido. */
      readonly incompleto: boolean;
    }
  | { readonly ok: false; readonly motivo: string };

/** Lo escrito en `/ajustes/proyecto.json`, por los caminos de cada campo. */
export async function guardarAjustes(
  session: AgentSession,
  deps: AgentDeps,
  contenido: string,
): Promise<GuardadoDeAjustes> {
  let crudo: unknown;
  try {
    crudo = JSON.parse(contenido);
  } catch (e) {
    return { ok: false, motivo: `it is not valid JSON (${e instanceof Error ? e.message : String(e)}).` };
  }
  const leido = ESQUEMA.safeParse(crudo);
  if (!leido.success) {
    const p = leido.error.issues[0];
    return {
      ok: false,
      motivo: `it does not match its schema: ${p ? `${p.path.join(".") || "(root)"}: ${p.message}` : "invalid"}. The shape is {"titulo": string, "idiomas": [...], "modulos": {"chat": boolean, "assistant": boolean}}.`,
    };
  }
  const nuevo = leido.data;
  const row = await deps.loadProject(session.projectId, session.userId);
  if (!row) return { ok: false, motivo: "the project was not found." };
  const antes = ajustesDe(row);

  const mismosIdiomas =
    nuevo.idiomas.length === antes.idiomas.length && nuevo.idiomas.every((x, i) => x === antes.idiomas[i]);
  if (!mismosIdiomas) {
    return {
      ok: false,
      motivo:
        "the languages are chosen when publishing (publicar adds them; removing them is in the Publish dialog), not here.",
    };
  }
  if (nuevo.titulo !== antes.titulo && !deps.renombrarProyecto) {
    return { ok: false, motivo: "the title cannot be changed from here." };
  }

  const notas: string[] = [];
  const escrituras: ToolOutcome[] = [];
  let incompleto = false;
  if (nuevo.titulo !== antes.titulo) {
    const ok = await deps.renombrarProyecto!(session.projectId, session.userId, nuevo.titulo);
    if (!ok) return { ok: false, motivo: "the title could not be saved." };
    notas.push(`title: "${nuevo.titulo}".`);
  }
  // Import en la llamada: tools.ts importa la terminal, y la terminal no
  // puede importar tools.ts al cargarse sin cerrar un ciclo.
  const { toolActivarModulo } = await import("@/lib/agent/tools");
  for (const modulo of AGENT_MODULES as readonly AgentModule[]) {
    if (nuevo.modulos[modulo] === antes.modulos[modulo]) continue;
    const o = await toolActivarModulo(session, deps, { modulo, encender: nuevo.modulos[modulo] });
    if (o.response.ok === false) {
      notas.push(`${modulo}: not changed — ${String(o.response.error ?? "it was rejected")}.`);
      incompleto = true;
      continue;
    }
    escrituras.push(o);
    const aviso = typeof o.response.aviso === "string" ? ` ${o.response.aviso}` : "";
    notas.push(`${modulo}: ${nuevo.modulos[modulo] ? "on" : "off"}.${aviso}`);
  }
  const ahora = await deps.loadProject(session.projectId, session.userId);
  return { ok: true, notas, escrituras, texto: ahora ? textoDeAjustes(ahora) : contenido, incompleto };
}
