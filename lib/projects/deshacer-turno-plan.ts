// lib/projects/deshacer-turno-plan.ts — QUÉ SE DESHACE de un turno de Len, y si
// se puede. Puro: dos fotos o unos cambios dentro, un plan fuera. Lo escribe en
// la base `lib/projects/deshacer-turno.ts`, en una sola sentencia.
//
// POR QUÉ EXISTE (F2 de las apps web, spec local
// docs/superpowers/specs/2026-10-07-apps-design.md, H7). El Deshacer del chat
// restauraba la página y los ficheros UNO A UNO desde el navegador
// (`components/workspace-v2/panels/undo-turn.ts`), con dos agujeros que en una
// app —un turno toca cinco ficheros— dejan de ser raros:
//   · si fallaba el tercero, los dos primeros ya habían vuelto: media app
//     deshecha y la otra media no, que casi siempre es una app rota;
//   · no miraba si el dueño había cambiado después esos mismos ficheros, y
//     desde el 2026-10-07 el dueño escribe código a mano: deshacer el turno de
//     Len le borraba su trabajo en silencio.
//
// LA REGLA ES LA DE `lib/agent/deshacer-lo-de-len.ts`: no se descarta lo que
// no escribió Len. Si algún fichero ya no está como lo dejó el turno, NO SE
// DESHACE NADA y se dice cuáles. Nunca a medias.
//
// LAS RUTAS son las de las fotos del turno (`cargarFicherosDeLaTerminal`): las
// páginas SIN `data-op-id` (`sinOpIds`) y la carpeta tal cual. Comparar con
// otra lectura daría choques que no existen.

import { esDeLaPlataforma } from "@/lib/agent/ficheros/manual";
import { classifyFolderPath } from "@/lib/agent/ficheros/folder";
import { leerFichero, paginaDeRuta, sinOpIds } from "@/lib/agent/ficheros/sitio";
import { esDelProyecto } from "@/lib/agent/terminal/ficheros";
import type { ProjectData } from "@/lib/projects/types";

/** Lo que el turno cambió en una ruta. */
export interface CambioDelTurno {
  readonly ruta: string;
  /** `null`: no existía al empezar (o no se guarda, si no es deshacible). */
  readonly antes: string | null;
  /** `null`: no existe al acabar (o no se guarda, si no es deshacible). */
  readonly despues: string | null;
  /** Falso: cambió, pero deshacer el turno no lo devuelve (ver `esDeshacible`). */
  readonly deshacible: boolean;
}

/**
 * ¿Vuelve esta ruta al deshacer el turno? Las páginas y la carpeta, sí. Fuera:
 *   · `/supabase/` — un fichero de migración se podría restaurar, pero lo que
 *     `supabase db push` ya aplicó a la BASE no vuelve con él, y dejaría el
 *     fichero diciendo una cosa y la base otra;
 *   · `/memoria/` — sólo crece, y es de Len, no del sitio;
 *   · `/ajustes/proyecto.json` — título y módulos, con sus propios caminos.
 * Lo que no vuelve se DICE (`noSeDeshacen`), no se calla.
 */
export function esDeshacible(ruta: string): boolean {
  if (paginaDeRuta(ruta)) return true;
  const c = classifyFolderPath(ruta);
  return c.ok && (c.kind === "web" || c.kind === "tests");
}

/** De las dos fotos del turno, lo que se guarda para poder deshacerlo. */
export function cambiosDelTurnoParaDeshacer(
  antes: Readonly<Record<string, string>>,
  despues: Readonly<Record<string, string>>,
): CambioDelTurno[] {
  const rutas = [...new Set([...Object.keys(antes), ...Object.keys(despues)])]
    .filter((r) => !esDeLaPlataforma(r) && esDelProyecto(r))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const out: CambioDelTurno[] = [];
  for (const ruta of rutas) {
    const a = Object.hasOwn(antes, ruta) ? antes[ruta]! : null;
    const d = Object.hasOwn(despues, ruta) ? despues[ruta]! : null;
    if (a === d) continue;
    out.push(esDeshacible(ruta) ? { ruta, antes: a, despues: d, deshacible: true } : { ruta, antes: null, despues: null, deshacible: false });
  }
  return out;
}

/** Lo que hay AHORA en una ruta, leído como lo leen las fotos. */
function contenidoActual(ruta: string, data: ProjectData, ficheros: Readonly<Record<string, string>>): string | null {
  if (paginaDeRuta(ruta)) {
    const html = leerFichero(data, ruta);
    return html === null ? null : sinOpIds(html);
  }
  return Object.hasOwn(ficheros, ruta) ? ficheros[ruta]! : null;
}

export type PlanDeDeshacer =
  | {
      readonly ok: true;
      /** `project.data` con las páginas devueltas. */
      readonly data: ProjectData;
      /** Ficheros de la carpeta a escribir y a borrar. */
      readonly escribir: ReadonlyArray<{ readonly path: string; readonly content: string }>;
      readonly borrar: readonly string[];
      /** Lo que la base TIENE que tener aún en cada fichero de la carpeta para
       *  que el deshacer valga: la sentencia lo vuelve a comprobar al escribir. */
      readonly esperados: ReadonlyArray<{ readonly path: string; readonly content: string | null }>;
      /** Las páginas como quedan (`null` = la home), para el lienzo y Versiones. */
      readonly paginas: ReadonlyArray<{ readonly page: string | null; readonly html: string }>;
      /** Los ficheros de la carpeta que volvieron. */
      readonly ficheros: readonly string[];
      /** Lo que cambió en el turno y NO vuelve (ver `esDeshacible`). */
      readonly noSeDeshacen: readonly string[];
      /** El deshacer como un turno más: así se puede deshacer el deshacer. */
      readonly inverso: readonly CambioDelTurno[];
    }
  | { readonly ok: false; readonly motivo: "se_solapan"; readonly rutas: readonly string[] }
  | { readonly ok: false; readonly motivo: "sin_cambios"; readonly noSeDeshacen: readonly string[] };

/**
 * EL PLAN, o por qué no. `actual` es el proyecto de AHORA: su `data` y TODOS los
 * ficheros de su carpeta.
 */
export function planearDeshacer(
  cambios: readonly CambioDelTurno[],
  actual: { readonly data: ProjectData; readonly ficheros: Readonly<Record<string, string>> },
): PlanDeDeshacer {
  const noSeDeshacen = cambios.filter((c) => !c.deshacible).map((c) => c.ruta);
  const deshacibles = cambios.filter((c) => c.deshacible);
  if (deshacibles.length === 0) return { ok: false, motivo: "sin_cambios", noSeDeshacen };

  // 🔴 LO PRIMERO: ¿sigue todo como lo dejó el turno? Si no, nada.
  const choques = deshacibles.filter((c) => contenidoActual(c.ruta, actual.data, actual.ficheros) !== c.despues).map((c) => c.ruta);
  if (choques.length > 0) return { ok: false, motivo: "se_solapan", rutas: choques };

  let data: ProjectData = actual.data;
  const escribir: Array<{ path: string; content: string }> = [];
  const borrar: string[] = [];
  const esperados: Array<{ path: string; content: string | null }> = [];
  const paginas: Array<{ page: string | null; html: string }> = [];
  const ficheros: string[] = [];
  for (const c of deshacibles) {
    const donde = paginaDeRuta(c.ruta);
    if (donde) {
      if (donde.page === null) {
        data = { ...data, html: c.antes ?? "" };
        paginas.push({ page: null, html: c.antes ?? "" });
      } else if (c.antes === null) {
        // El turno CREÓ la página: deshacerlo es quitarla.
        const { [donde.page]: _creada, ...resto } = data.pages ?? {};
        void _creada;
        data = { ...data, pages: resto };
      } else {
        data = { ...data, pages: { ...data.pages, [donde.page]: { ...data.pages?.[donde.page], html: c.antes } } };
        paginas.push({ page: donde.page, html: c.antes });
      }
      continue;
    }
    esperados.push({ path: c.ruta, content: c.despues });
    ficheros.push(c.ruta);
    if (c.antes === null) borrar.push(c.ruta);
    else escribir.push({ path: c.ruta, content: c.antes });
  }
  const inverso = deshacibles.map((c) => ({ ruta: c.ruta, antes: c.despues, despues: c.antes, deshacible: true }));
  return { ok: true, data, escribir, borrar, esperados, paginas, ficheros, noSeDeshacen, inverso };
}
