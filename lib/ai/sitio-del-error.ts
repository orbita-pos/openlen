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
// Y si la app va EMPAQUETADA (plan 02), la traza apunta al paquete: su
// sourcemap la devuelve al fichero y la línea del proyecto (`traductorDeMapas`).
//
// Puro: lo usan los tres que oyen `pageerror` (los dos renderizadores y
// `use_page`) y quien convierte lo medido en diagnósticos.

import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";

export interface SitioDelError {
  /** La ruta del fichero en el sitio: `/src/Carrito.jsx`. */
  readonly ruta: string;
  readonly linea: number;
  readonly columna: number;
}

/** Un marco → su sitio en el proyecto, `"vendor"` si es del catálogo (se
 *  salta), o `null` si el mapa no lo sabe (se deja como venía). */
export type Traductor = (sitio: SitioDelError) => SitioDelError | "vendor" | null;

/**
 * UNA APP SE SIRVE EMPAQUETADA (plan 02): la traza dice `/src/main.jsx:4123:9`,
 * que es el paquete. Su sourcemap lo devuelve al fichero y la línea del
 * proyecto (`app:/src/App.jsx` → `/src/App.jsx`); lo que cae en el catálogo
 * (`vendor:…`, React por dentro) se salta. `mapas`: ruta servida → su mapa
 * (el JSON de esbuild).
 */
export function traductorDeMapas(mapas: Readonly<Record<string, string>> | undefined): Traductor | undefined {
  if (!mapas || Object.keys(mapas).length === 0) return undefined;
  const leidos = new Map<string, TraceMap | null>();
  return (sitio) => {
    const texto = mapas[sitio.ruta];
    if (texto === undefined) return sitio;
    if (!leidos.has(sitio.ruta)) {
      try {
        leidos.set(sitio.ruta, new TraceMap(texto));
      } catch {
        leidos.set(sitio.ruta, null);
      }
    }
    const mapa = leidos.get(sitio.ruta);
    if (!mapa) return null;
    const o = originalPositionFor(mapa, { line: sitio.linea, column: Math.max(0, sitio.columna - 1) });
    if (!o.source || o.line === null) return null;
    if (o.source.startsWith("vendor:") || o.source.startsWith("mock:") || o.source.startsWith("empty:")) return "vendor";
    // LAS PRUEBAS (plan 04): la parte izada de una prueba tiene SUS líneas, así
    // que es ella; lo demás virtual (el runtime `vitest`, las entradas) no es de la app.
    if (o.source.startsWith("virtual:")) {
      if (!o.source.startsWith("virtual:hoist:")) return "vendor";
      return { ruta: o.source.slice("virtual:hoist:".length), linea: o.line, columna: (o.column ?? 0) + 1 };
    }
    return { ruta: o.source.replace(/^app:/, ""), linea: o.line, columna: (o.column ?? 0) + 1 };
  };
}

/** Un marco de la traza con un fichero de módulo y su línea y columna. */
const MARCO = /https?:\/\/[^\s/()]+(\/[^\s:()?#]+\.(?:jsx|tsx|ts|mjs|js)):(\d+):(\d+)/;

/**
 * El primer marco de la traza que es código DEL PROYECTO: ni el catálogo (React
 * por dentro, que dentro del paquete dice su mapa) ni el documento mismo.
 * Lo relativo al documento medido llega con su identificador delante
 * (`/<uuid>/src/x.jsx`): se le quita, y queda la ruta del sitio.
 */
export function sitioEnLaTraza(traza: string | undefined | null, traducir?: Traductor): SitioDelError | null {
  for (const linea of (traza ?? "").split("\n")) {
    const m = MARCO.exec(linea);
    if (!m) continue;
    const ruta = m[1]!.replace(/^\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//i, "/");
    let sitio: SitioDelError = { ruta, linea: Number(m[2]), columna: Number(m[3]) };
    if (traducir) {
      const t = traducir(sitio);
      if (t === "vendor") continue;
      if (t) sitio = t;
    }
    return sitio;
  }
  return null;
}

const SUFIJO = / \(at (\/[^\s:()]+):(\d+):(\d+)\)$/;

/**
 * El texto de un `pageerror`: su mensaje, recortado a `max`, y detrás dónde
 * nació si la traza lo dice — ` (at /src/Carrito.jsx:6:13)`.
 */
export function textoDelError(error: unknown, max: number, traducir?: Traductor): string {
  const mensaje = String(error instanceof Error ? error.message : error).slice(0, max);
  const sitio = error instanceof Error ? sitioEnLaTraza(error.stack, traducir) : null;
  return sitio ? `${mensaje} (at ${sitio.ruta}:${sitio.linea}:${sitio.columna})` : mensaje;
}

/** Lo contrario: el sitio que `textoDelError` puso al final, y el mensaje sin él. */
export function sitioDelTexto(texto: string): { readonly mensaje: string; readonly sitio: SitioDelError | null } {
  const m = SUFIJO.exec(texto);
  if (!m) return { mensaje: texto, sitio: null };
  return { mensaje: texto.slice(0, m.index), sitio: { ruta: m[1]!, linea: Number(m[2]), columna: Number(m[3]) } };
}
