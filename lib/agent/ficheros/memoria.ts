/**
 * LA MEMORIA, COMO FICHEROS (H3 de Len 2.x) — el `CLAUDE.md` de Claude Code.
 *
 * Claude Code no tiene una herramienta «recordar»: la memoria es un fichero que
 * lee y edita. Len igual, con los dos alcances que ya había:
 *   - `/memoria/dueno.md` — lo que sabe del DUEÑO, para todas sus páginas
 *     (`users.agentMemory`; el `~/.claude/CLAUDE.md` de Claude Code).
 *   - `/memoria/proyecto.md` — el brief de ESTE proyecto, con su bloque de
 *     preferencias al final (`projects.userBrief`; el `CLAUDE.md` del repo).
 *
 * Decidido en voz alta: SÓLO SE AÑADE. En Claude Code el modelo edita su
 * memoria como quiere, pero aquí borrar es del dueño —lo dice
 * `forgetAboutUser`: «No hay herramienta del modelo que llame a esto — el
 * borrado es del dueño»—, y esa decisión se conserva. Una edición que quita o
 * cambia una línea ya guardada se rechaza con el porqué; cada línea NUEVA se
 * guarda con la mecánica de siempre (`lib/agent/preferencias.ts`).
 *
 * Puro: sin base ni red.
 */

import { normalizarFinales, type Leidos } from "./read";

export const RUTA_MEMORIA_DUENO = "/memoria/dueno.md";
export const RUTA_MEMORIA_PROYECTO = "/memoria/proyecto.md";

export type AlcanceDeMemoria = "siempre" | "esta_pagina";

/**
 * LA MEMORIA QUE YA VA EN EL CONTEXTO CUENTA COMO LEÍDA. Claude Code siembra
 * así el `CLAUDE.md` que carga al empezar (`seedMemoryFile`,
 * `seededFromContext`): se puede editar sin un Read antes. Con el mismo texto
 * que servirá el fichero, así que si el dueño lo cambia a mitad de turno el
 * Edit lo nota como con cualquier otro fichero.
 */
export function memoriaSembrada(dueno: string | null, proyecto: string | null): Leidos {
  const lectura = (t: string | null) => ({ instantanea: normalizarFinales(t ?? ""), offset: undefined, limit: undefined });
  return new Map([
    [RUTA_MEMORIA_DUENO, lectura(dueno)],
    [RUTA_MEMORIA_PROYECTO, lectura(proyecto)],
  ]);
}

export function alcanceDeRuta(ruta: string): AlcanceDeMemoria | null {
  if (ruta === RUTA_MEMORIA_DUENO) return "siempre";
  if (ruta === RUTA_MEMORIA_PROYECTO) return "esta_pagina";
  return null;
}

/** Las líneas de encabezado que escribe el servidor: no son preferencias. */
const MARCADORES = ["— Lo que sé de ti —", "— Preferencias guardadas por el agente —"];

const lineas = (t: string) =>
  t
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/**
 * Lo que la edición AÑADE, sin viñeta, o por qué no se acepta. Todas las
 * líneas de antes tienen que seguir (el orden da igual; el dueño o el servidor
 * pueden haberlas reordenado).
 */
export function lineasNuevas(
  antes: string,
  despues: string,
  ruta: string,
): { readonly ok: true; readonly nuevas: string[] } | { readonly ok: false; readonly error: string } {
  const quedan = new Map<string, number>();
  for (const l of lineas(despues)) quedan.set(l, (quedan.get(l) ?? 0) + 1);
  const faltan: string[] = [];
  for (const l of lineas(antes)) {
    const n = quedan.get(l) ?? 0;
    if (n === 0) faltan.push(l);
    else quedan.set(l, n - 1);
  }
  if (faltan.length > 0) {
    return {
      ok: false,
      error: `${ruta} only grows: removing or changing what is already saved is the user's decision, and they do it from the editor. These saved lines are missing from your version: ${faltan.map((l) => `«${l}»`).join(", ")}. Put them back and only add new lines; if the user wants one gone, tell them where to remove it.`,
    };
  }
  const nuevas: string[] = [];
  for (const [l, n] of quedan) {
    if (MARCADORES.includes(l)) continue;
    const limpia = l.replace(/^(?:[•*-]\s+)/, "").trim();
    for (let i = 0; i < n; i++) if (limpia) nuevas.push(limpia);
  }
  return { ok: true, nuevas };
}
