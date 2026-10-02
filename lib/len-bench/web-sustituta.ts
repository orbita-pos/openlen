// lib/len-bench/web-sustituta.ts — LA INTERNET DE LEN-BENCH: un buscador y
// unas páginas fijas por caso.
//
// Para medir si Len BUSCA bien (plans/len-agente-2026, F0 y F2), la búsqueda
// tiene que dar lo mismo en cada corrida. Contra Brave de verdad los resultados
// cambian cada día, y se mediría la web y no a Len (HOJA-DE-RUTA.md, F0,
// alternativas descartadas). Es la misma idea que el sustituto de `/api/d`
// (lib/page-data/sustituto.ts): en memoria, con las reglas del servicio real.
//
// La consulta es texto libre del modelo, así que «fijo por consulta» quiere
// decir que cada caso declara REGLAS (`WebDelCaso.busquedas`): la primera
// expresión que casa con la consulta da sus resultados, y si no casa ninguna, la
// búsqueda no encuentra nada, como un buscador al que se le pregunta otra cosa.
//
// Lo que NO hace todavía, a propósito: nadie la consulta. Len no tiene con qué
// buscar hasta F2, y una palanca que no llega a ningún sitio se lee como una
// alternativa que existe (memoria `la-palanca-que-no-vuelve-a-ningun-sitio`).
// En F2 se enchufan juntos el aviso al servidor de Len-Bench, el conductor que
// deja la web de cada proyecto donde ese servidor la lea, y `web_search` /
// `web_fetch` respondiendo desde aquí. Hasta entonces, los casos con web son la
// línea base «sin F2», y sus graders ya cuentan lo publicado en esta web como
// dato DADO (`textoDeLaWeb`).

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

/** Lo que tiene mal la web de un caso, en palabras: un resultado que lleva a una página que no existe. */
export function problemasDeLaWeb(web: WebDelCaso): string[] {
  return web.busquedas.flatMap((b) =>
    b.resultados.filter((r) => leerDeLaWeb(web, r.url) === null).map((r) => `el resultado «${r.titulo}» lleva a ${r.url}, que no está en sus páginas`),
  );
}
