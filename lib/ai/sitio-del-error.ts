// lib/ai/sitio-del-error.ts — DÓNDE NACIÓ UN ERROR DEL NAVEGADOR, en el fichero
// del proyecto (F3 de la spec local docs/superpowers/specs/2026-10-07-apps-design.md).
//
// El navegador da el mensaje («Cannot read properties of undefined (reading
// 'precio')») y, en su traza, el fichero y la línea. En una página el
// JavaScript está DENTRO del documento y la traza apunta al propio documento;
// en una app está en /src, y su traza dice `/src/Carrito.jsx:6:13` — que es la
// línea del fuente, porque el compilador las conserva (§6 de la spec). Sin
// esto, los ojos de Len anclaban todo error de una app en `/index.html:1:1`,
// que es el único sitio donde seguro que NO está.
//
// Puro: lo usan los tres que oyen `pageerror` (los dos renderizadores y
// `use_page`) y quien convierte lo medido en diagnósticos.

export interface SitioDelError {
  /** La ruta del fichero en el sitio: `/src/Carrito.jsx`. */
  readonly ruta: string;
  readonly linea: number;
  readonly columna: number;
}

/** Un marco de la traza con un fichero de módulo y su línea y columna. */
const MARCO = /https?:\/\/[^\s/()]+(\/[^\s:()?#]+\.(?:jsx|tsx|ts|mjs|js)):(\d+):(\d+)/;

/**
 * El primer marco de la traza que es código DEL PROYECTO: ni las dependencias
 * del catálogo (`/openlen/vendor/`, React por dentro) ni el documento mismo.
 * Lo relativo al documento medido llega con su identificador delante
 * (`/<uuid>/src/x.jsx`): se le quita, y queda la ruta del sitio.
 */
export function sitioEnLaTraza(traza: string | undefined | null): SitioDelError | null {
  for (const linea of (traza ?? "").split("\n")) {
    const m = MARCO.exec(linea);
    if (!m) continue;
    const ruta = m[1]!.replace(/^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//i, "/");
    if (ruta.startsWith("/openlen/vendor/")) continue;
    return { ruta, linea: Number(m[2]), columna: Number(m[3]) };
  }
  return null;
}

const SUFIJO = / \(at (\/[^\s:()]+):(\d+):(\d+)\)$/;

/**
 * El texto de un `pageerror`: su mensaje, recortado a `max`, y detrás dónde
 * nació si la traza lo dice — ` (at /src/Carrito.jsx:6:13)`.
 */
export function textoDelError(error: unknown, max: number): string {
  const mensaje = String(error instanceof Error ? error.message : error).slice(0, max);
  const sitio = error instanceof Error ? sitioEnLaTraza(error.stack) : null;
  return sitio ? `${mensaje} (at ${sitio.ruta}:${sitio.linea}:${sitio.columna})` : mensaje;
}

/** Lo contrario: el sitio que `textoDelError` puso al final, y el mensaje sin él. */
export function sitioDelTexto(texto: string): { readonly mensaje: string; readonly sitio: SitioDelError | null } {
  const m = SUFIJO.exec(texto);
  if (!m) return { mensaje: texto, sitio: null };
  return { mensaje: texto.slice(0, m.index), sitio: { ruta: m[1]!, linea: Number(m[2]), columna: Number(m[3]) } };
}
