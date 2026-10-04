// lib/len-bench/web-sustituta.ts — LA INTERNET DE LEN-BENCH: un buscador y
// unas páginas fijas por caso.
//
// Para medir si Len BUSCA bien (plans/len-agente-2026, F0 y F2), la búsqueda
// tiene que dar lo mismo en cada corrida. Contra Brave de verdad los resultados
// cambian cada día, y se mediría la web y no a Len (HOJA-DE-RUTA.md, F0,
// alternativas descartadas). Es la misma idea que tenía el sustituto de `/api/d`
// (retirado el 2026-10-04 con los almacenes): en memoria, con las reglas del
// servicio real.
//
// La consulta es texto libre del modelo, así que «fijo por consulta» quiere
// decir que cada caso declara REGLAS (`WebDelCaso.busquedas`): la primera
// expresión que casa con la consulta da sus resultados, y si no casa ninguna, la
// búsqueda no encuentra nada, como un buscador al que se le pregunta otra cosa.
//
// DESDE F2 la consultan `web_search` y `web_fetch` en el servidor de Len-Bench:
// el conductor deja la web de cada proyecto en `DIR_WEB/<proyecto>.json`
// (`webASerializable`, lib/len-bench/entorno.ts) y `lib/agent/web/buscar.ts` la
// lee con `OPENLEN_WEB_DE_PRUEBA_DIR`. Ni una petición sale a la red. Los
// graders siguen contando lo publicado en esta web como dato DADO (`textoDeLaWeb`).

import { textoVisible } from "./extraer";
import type { ResultadoDeBusqueda, WebDelCaso } from "./tipos";

/** Los resultados de buscar `consulta`: los de la primera regla que casa, o ninguno. */
export function buscarEnLaWeb(web: WebDelCaso | undefined, consulta: string): readonly ResultadoDeBusqueda[] {
  return web?.busquedas.find((b) => b.si.test(consulta))?.resultados ?? [];
}

/** La misma dirección escrita de otra forma: con o sin `www.`, `http` o `https`, la barra final o el ancla. */
function clave(url: string): string | null {
  try {
    const u = new URL(url.trim());
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return `${u.host.replace(/^www\./i, "").toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
  } catch {
    return null;
  }
}

/** El HTML de la página `url`, o `null` si en esta web no existe. */
export function leerDeLaWeb(web: WebDelCaso | undefined, url: string): string | null {
  const buscada = clave(url);
  if (!web || buscada === null) return null;
  const encontrada = Object.keys(web.paginas).find((u) => clave(u) === buscada);
  return encontrada === undefined ? null : web.paginas[encontrada]!;
}

/** Todo lo que se puede leer en esta web: los títulos y fragmentos de los resultados y el texto de cada página. */
export function textoDeLaWeb(web: WebDelCaso | undefined): string {
  if (!web) return "";
  const resultados = web.busquedas.flatMap((b) => b.resultados.map((r) => `${r.titulo}\n${r.fragmento}`));
  return [...resultados, ...Object.values(web.paginas).map(textoVisible)].join("\n");
}

/** El fichero donde vive la web de un proyecto: UNA regla para quien la escribe
 *  (el conductor) y quien la lee (el servidor, `lib/agent/web/buscar.ts`). */
export function ficheroDeLaWeb(dir: string, projectId: string): string {
  return `${dir.replace(/[\\/]+$/, "")}/${projectId.replace(/[^\w-]/g, "_")}.json`;
}

/** La web de un caso, como JSON: el conductor la deja así para el servidor de
 *  Len-Bench (`lib/agent/web/buscar.ts` la lee). Las expresiones viajan como
 *  fuente y banderas. */
export interface WebSerializada {
  readonly busquedas: readonly { readonly fuente: string; readonly banderas: string; readonly resultados: readonly ResultadoDeBusqueda[] }[];
  readonly paginas: Readonly<Record<string, string>>;
}

export function webASerializable(web: WebDelCaso): WebSerializada {
  return {
    busquedas: web.busquedas.map((b) => ({ fuente: b.si.source, banderas: b.si.flags, resultados: b.resultados })),
    paginas: web.paginas,
  };
}

/** Lo contrario; lo que no tenga la forma, no cuenta (una web vacía). */
export function webDeSerializable(x: unknown): WebDelCaso {
  const w = x as Partial<WebSerializada> | null;
  if (!w || !Array.isArray(w.busquedas) || typeof w.paginas !== "object" || w.paginas === null) return { busquedas: [], paginas: {} };
  return {
    busquedas: w.busquedas.flatMap((b) => {
      try {
        return [{ si: new RegExp(b.fuente, b.banderas), resultados: Array.isArray(b.resultados) ? b.resultados : [] }];
      } catch {
        return [];
      }
    }),
    paginas: Object.fromEntries(Object.entries(w.paginas).filter((e): e is [string, string] => typeof e[1] === "string")),
  };
}

/** Lo que tiene mal la web de un caso, en palabras: un resultado que lleva a una página que no existe. */
export function problemasDeLaWeb(web: WebDelCaso): string[] {
  return web.busquedas.flatMap((b) =>
    b.resultados.filter((r) => leerDeLaWeb(web, r.url) === null).map((r) => `el resultado «${r.titulo}» lleva a ${r.url}, que no está en sus páginas`),
  );
}
