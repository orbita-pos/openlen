/**
 * EDITAR UN FICHERO A MANO, desde la lente «Código» (la #18 de
 * plans/len-agente-2026/notas/fase-5-taller.md; Jesús, 02/10).
 *
 * Como el panel de fichero del escritorio de Claude Code: abres el fichero, lo
 * cambias, lo guardas, y si cambió por fuera mientras lo editabas, te avisa en
 * vez de pisarlo. Aquí «por fuera» es Len, el editor del lienzo o tu terminal:
 * se compara con lo que había cuando lo abriste (`base`) y, si ya no es eso, no
 * se guarda nada y se devuelve lo de ahora.
 *
 * Se guarda por el MISMO camino que tu terminal (la #17): `guardarLoDeLaTerminal`
 * con `autor: "usuario"`, así que valen sus guardas —el manual es de sólo
 * lectura, ni `data-slot-path` ni lo que no es del sitio; el JavaScript sí, desde
 * el 2026-10-07— y la versión queda a tu nombre («Code editor: …»,
 * origen `manual`), que es como Len sabe que no fue él.
 *
 * Sólo ficheros que ya existen: crear uno es cosa de Len o de tu terminal.
 */
import "server-only";

import { realDeps, type AgentDeps, type AgentSession } from "@/lib/agent/tools";
import { cargarFicherosDeLaTerminal, guardarLoDeLaTerminal } from "@/lib/agent/herramientas-de-ficheros";

export type GuardadoAMano =
  | { readonly ok: true; readonly contenido: string }
  /** Cambió desde que lo abriste: esto es lo que hay ahora. */
  | { readonly ok: false; readonly motivo: "cambio"; readonly actual: string }
  /** Una guarda lo rechazó: por qué, como lo dice la terminal. */
  | { readonly ok: false; readonly motivo: "rechazado"; readonly detalle: string }
  | { readonly ok: false; readonly motivo: "no_existe" };

export async function guardarAMano(
  projectId: string,
  userId: string,
  ruta: string,
  contenido: string,
  base: string,
  deps: AgentDeps = realDeps(),
  /** Quien edita, si no es el dueño: su memoria personal es la suya (lib/agent/person.ts). */
  personId?: string,
): Promise<GuardadoAMano> {
  const sesion: AgentSession = {
    projectId,
    userId,
    ...(personId && personId !== userId ? { personId } : {}),
    autor: "usuario",
    desde: "editor",
    page: null,
    ownerEmail: null,
    imageEditsThisTurn: 0,
    photoSearchesThisTurn: 0,
    busquedasVaciasSeguidas: 0,
  };
  const ahora = await cargarFicherosDeLaTerminal(sesion, deps);
  if (!Object.hasOwn(ahora, ruta)) return { ok: false, motivo: "no_existe" };
  const actual = ahora[ruta]!;
  if (actual !== base) return { ok: false, motivo: "cambio", actual };
  if (contenido === actual) return { ok: true, contenido };
  const g = await guardarLoDeLaTerminal(sesion, deps, [{ tipo: "escrito", ruta, contenido, crea: false }], ahora);
  if (g.rechazado) return { ok: false, motivo: "rechazado", detalle: g.notas.join("\n") };
  return { ok: true, contenido: g.enLaTerminal[ruta] ?? contenido };
}
