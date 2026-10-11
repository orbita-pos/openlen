// EL JSX DE DESARROLLO DEL LIENZO (spec 2026-10-11-modo-diseno-de-apps).
//
// En modo desarrollo el compilador escribe cada etiqueta como
// `jsxDEV(tipo, props, key, isStatic, { fileName, lineNumber }, this)`. El
// catálogo congelado no trae `react/jsx-dev-runtime`, así que lo damos
// nosotros: llama al `jsx`/`jsxs` de siempre —los mismos que usa la app
// publicada— y apunta de dónde salió cada elemento en un WeakMap cuya clave es
// `element.props`. React usa ese mismo objeto como `memoizedProps` de su
// fibra, así que desde un nodo del DOM se sube por las fibras y se lee el
// origen (`lib/apps/design/canvas-functions.ts`). No toca el DOM.
import { JSX_DEV_RUNTIME } from "@/lib/apps/compilador";

export { JSX_DEV_RUNTIME };

/** Dónde vive la tabla en el lienzo: `globalThis.__openlenSources`. */
export const SOURCES_GLOBAL = "__openlenSources";

export const JSX_DEV_RUNTIME_MODULE = `import { Fragment, jsx, jsxs } from "react/jsx-runtime";
const sources = (globalThis.${SOURCES_GLOBAL} ??= new WeakMap());
export { Fragment };
export function jsxDEV(type, props, key, isStaticChildren, source) {
  const element = isStaticChildren ? jsxs(type, props, key) : jsx(type, props, key);
  if (source && element && element.props && typeof element.props === "object") {
    sources.set(element.props, { path: source.fileName, line: source.lineNumber });
  }
  return element;
}
`;
