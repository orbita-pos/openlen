/**
 * LA TERMINAL DEL USUARIO NO TOCA EL JAVASCRIPT (la #17 de
 * plans/len-agente-2026/notas/fase-5-taller.md).
 *
 * La regla es la de la plataforma, escrita en `lib/page-engine/conservar-scripts.ts`:
 * «la entrada del navegador se sanea. Punto» — si no, cualquiera publicaría el
 * `<script>` que quisiera bajo un subdominio nuestro. El editor la cumple porque
 * sólo manda textos y atributos y el código sale de lo guardado; la terminal
 * escribe ficheros ENTEROS, así que su forma de cumplirla es ésta: lo ACTIVO de
 * una página —`<script>`, atributos `on…`, `javascript:`, `iframe`/`object`/
 * `embed`/`base`, `meta refresh`— sólo puede ser lo que el sitio GUARDADO ya
 * tiene en alguna de sus páginas. Copiarlo o moverlo (`cp /index.html
 * /promo/index.html`, que lleva el `<script>` del CDN de Tailwind) y quitarlo,
 * sí: es la página del usuario y no entra código nuevo. Inventarlo o cambiarlo,
 * no: eso es cosa de Len. Es la regla de `conservarScripts` (retirado el
 * 2026-10-04: ya no lo llamaba nadie) dicha de otra forma: el código sale de lo
 * guardado, no de la petición.
 *
 * Aquí nos separamos de DeepSeek, y a propósito: allí la terminal del usuario
 * tiene todos sus permisos porque corre en SU ordenador
 * (`2026-09-16-user-terminal-permissions.md`). Ésta corre en nuestro servidor y
 * lo que escribe se publica bajo nuestro dominio.
 *
 * Se compara DESPUÉS de deshacer los disfraces con los que un navegador sigue
 * ejecutando (`jav&#x61;script:`, un tabulador dentro de `java	script:`): las
 * entidades se decodifican y los saltos y tabuladores se quitan. Puro: lo prueba
 * vitest.
 */

const ACTIVO: readonly RegExp[] = [
  /<script\b[^>]*>[\s\S]*?<\/script\s*>/g,
  /<script\b[^>]*>/g,
  /\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/g,
  /[a-z-]+\s*=\s*["']?\s*javascript:[^"'\s>]*/g,
  /javascript:/g,
  /<(?:iframe|frame|frameset|object|embed|base|applet|portal)\b[^>]*>/g,
  /<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*>/g,
];

const ENTIDADES: Readonly<Record<string, string>> = {
  colon: ":",
  tab: "\t",
  newline: "\n",
  lpar: "(",
  rpar: ")",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  amp: "&",
  sol: "/",
  equals: "=",
};

/** Sin disfraces: entidades decodificadas, sin saltos ni tabuladores, en minúscula. */
export function sinDisfraces(html: string): string {
  return html
    .replace(/&#x([0-9a-f]+);?/gi, (_, h: string) => String.fromCodePoint(Number.parseInt(h, 16) || 0xfffd))
    .replace(/&#(\d+);?/g, (_, d: string) => String.fromCodePoint(Number(d) || 0xfffd))
    .replace(/&([a-z]+);/gi, (m, n: string) => ENTIDADES[n.toLowerCase()] ?? m)
    .replace(/[\t\n\r\f\0]/g, "")
    .toLowerCase();
}

/** Todo lo activo de una página, en orden estable: dos páginas con lo mismo dan lo mismo. */
export function loActivo(html: string): string[] {
  const limpio = sinDisfraces(html);
  return ACTIVO.flatMap((re) => limpio.match(re) ?? []).sort();
}

/** Todo lo activo que el sitio guardado tiene, en cualquiera de sus páginas. */
export function activoDelSitio(paginas: Iterable<string>): Set<string> {
  const todo = new Set<string>();
  for (const html of paginas) for (const a of loActivo(html)) todo.add(a);
  return todo;
}

/** Por qué no se guarda, o null si todo lo activo de la página ya estaba en el sitio. */
export function codigoNuevo(despues: string, delSitio: ReadonlySet<string>): string | null {
  if (loActivo(despues).every((a) => delSitio.has(a))) return null;
  // Sin «tu terminal»: lo dicen también el editor de la lente «Código» (la #18).
  return "the page's JavaScript (scripts, on… attributes, javascript: links, iframes) cannot be added or changed by hand — that is Len's job: ask in the chat.";
}

/**
 * LA CARPETA (pieza 9 de Len 2.5): la misma regla para los ficheros. Un
 * `.js`/`.mjs` es código entero: lo que el dueño escribe a mano sólo puede ser
 * una COPIA de uno guardado (`cp`, `mv`). Un `.svg` puede llevar `<script>` y
 * `on…`: lo activo tiene que estar ya en el sitio (sus páginas y sus SVG). Lo
 * demás —datos, CSS, texto, y las pruebas, que no corren en el navegador del
 * visitante— no ejecuta código: libre. Borrar no pasa por aquí: quitar código
 * no lo añade.
 */
export function newCodeInFolderFile(path: string, content: string, savedBefore: Readonly<Record<string, string>>): string | null {
  const ext = path.slice(path.lastIndexOf(".")).toLowerCase();
  if (ext === ".js" || ext === ".mjs") {
    const copia = Object.entries(savedBefore).some(([p, t]) => /\.m?js$/i.test(p) && t === content);
    return copia ? null : "JavaScript files cannot be added or changed by hand — that is Len's job: ask in the chat.";
  }
  if (ext === ".svg") {
    const delSitio = activoDelSitio(
      Object.entries(savedBefore)
        .filter(([p]) => /\.(?:html|svg)$/i.test(p))
        .map(([, t]) => t),
    );
    return codigoNuevo(content, delSitio) === null
      ? null
      : "an SVG's scripts and on… attributes cannot be added or changed by hand — that is Len's job: ask in the chat.";
  }
  return null;
}
