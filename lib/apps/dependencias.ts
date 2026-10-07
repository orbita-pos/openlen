// lib/apps/dependencias.ts — lo que el código de una app web puede importar
// por su nombre (`import { useState } from "react"`).
//
// Es a las apps lo que `lib/librerias.ts` es a las páginas: una lista CORTA Y
// CERRADA, y cada entrada entra por una decisión explícita, porque es código de
// terceros que corre en el navegador de cada visitante (spec local
// docs/superpowers/specs/2026-10-07-apps-design.md, §5.3).
//
// CÓMO LLEGAN AL NAVEGADOR. Sin bundler (§2 de la spec): el navegador resuelve
// `"react"` con el import map que inyecta la plataforma (`lib/apps/documento.ts`)
// y lo pide a `/openlen/vendor/<catálogo>/<fichero>`, DEL MISMO ORIGEN que la
// página. No a un CDN: un módulo de otro origen exige CORS, y `libs.openlen.com`
// no lo manda (`ORIGEN_MANDA_CORS` en lib/librerias.ts); y los ojos de Len
// navegan detrás de un proxy de salida que cortaría a un tercero.
//
// POR QUÉ `/openlen/` Y NO `/assets/`. En el host del lienzo, Caddy reparte
// `/assets/*` entre el disco y Next según el ORDEN de sus `handle`, que cambia
// con la versión (lo cuenta el Caddyfile en el bloque del lienzo). Una raíz sin
// `handle` propio va a Next en el lienzo y a la release en la publicada, con
// cualquier versión. Está reservada en `lib/agent/ficheros/folder.ts`.
//
// 🔴 CONGELADO SIGNIFICA CONGELADO, como en `librerias.ts`: un catálogo
// publicado NUNCA cambia de bytes. Las apps lo fijan (`ProjectData.app`) y sus
// páginas publicadas lo cachean como inmutable. Versión nueva = catálogo nuevo;
// añadir una entrada a uno existente sí vale (no cambia ningún byte de lo que
// ya hay). Lo construye `npm run apps:vendor` y lo vigila su manifiesto.
//
// Puro y sin imports: lo leen el cliente, el servidor y las pruebas.

/** El catálogo con el que nace una app nueva. */
export const CATALOGO_ACTUAL = "2026-10";

/** Dónde se sirven, en el origen de la página (lienzo, medidor y publicada). */
export const RAIZ_VENDOR = "/openlen/vendor";

export interface Dependencia {
  /** Lo que el código escribe en el `import`. */
  readonly especificador: string;
  /** El fichero, dentro del catálogo. */
  readonly fichero: string;
  /** Para qué sirve, en una línea: lo leerá el manual de Len. */
  readonly para: string;
}

export interface Catalogo {
  /** Las versiones exactas que lo construyen. Informativo: los bytes los fija
   *  el manifiesto (`public/app-vendor/<catálogo>/manifest.json`). */
  readonly versiones: Readonly<Record<string, string>>;
  /** Lo que se puede importar por su nombre. */
  readonly dependencias: readonly Dependencia[];
  /** Ficheros que las fachadas importan y nadie nombra: el bundle compartido
   *  de React, que es lo que garantiza UNA sola copia (dos rompen los hooks). */
  readonly internos: readonly string[];
}

export const CATALOGOS: Readonly<Record<string, Catalogo>> = {
  "2026-10": {
    versiones: { react: "19.2.6", "react-dom": "19.2.6", "@supabase/supabase-js": "2.117.2" },
    dependencias: [
      { especificador: "react", fichero: "react.js", para: "React: componentes, estado y efectos." },
      { especificador: "react/jsx-runtime", fichero: "react-jsx-runtime.js", para: "El runtime de JSX (lo usa el compilador)." },
      { especificador: "react-dom", fichero: "react-dom.js", para: "createPortal, flushSync." },
      { especificador: "react-dom/client", fichero: "react-dom-client.js", para: "createRoot: montar la app." },
      {
        especificador: "@supabase/supabase-js",
        fichero: "supabase-js.js",
        para: "El backend del proyecto: base de datos, Auth, Storage y Realtime.",
      },
    ],
    internos: ["react-todo.js"],
  },
};

/** Los modos en que se sirve un catálogo. La vista (lienzo y ojos de Len) usa
 *  React de desarrollo, con sus mensajes de error enteros para que Len los
 *  lea; la publicada, el de producción. */
export type ModoVendor = "desarrollo" | "produccion";

export function catalogo(nombre: string): Catalogo | null {
  return Object.hasOwn(CATALOGOS, nombre) ? CATALOGOS[nombre]! : null;
}

/** `react` → la dependencia, o `null` si el catálogo no la tiene. */
export function dependenciaDe(nombreCatalogo: string, especificador: string): Dependencia | null {
  return catalogo(nombreCatalogo)?.dependencias.find((d) => d.especificador === especificador) ?? null;
}

export function rutaDeVendor(nombreCatalogo: string, fichero: string): string {
  return `${RAIZ_VENDOR}/${nombreCatalogo}/${fichero}`;
}

/** Todos los ficheros de un catálogo: los que se nombran y los internos. */
export function ficherosDelCatalogo(nombreCatalogo: string): string[] {
  const c = catalogo(nombreCatalogo);
  return c ? [...c.dependencias.map((d) => d.fichero), ...c.internos] : [];
}

/** El import map de un catálogo: especificador → ruta del mismo origen. */
export function importMapDe(nombreCatalogo: string): { imports: Record<string, string> } {
  const c = catalogo(nombreCatalogo);
  const imports: Record<string, string> = {};
  for (const d of c?.dependencias ?? []) imports[d.especificador] = rutaDeVendor(nombreCatalogo, d.fichero);
  return { imports };
}

/** `/openlen/vendor/2026-10/react.js` → `{ catalogo, fichero }`, sólo si es
 *  un fichero REAL de un catálogo que existe. Lo demás, `null`. */
export function rutaDeVendorValida(ruta: string): { catalogo: string; fichero: string } | null {
  const m = /^\/openlen\/vendor\/([0-9]{4}-[0-9]{2}[a-z]?)\/([a-z0-9-]+\.js)$/.exec(ruta);
  if (!m) return null;
  const [, nombre, fichero] = m;
  return ficherosDelCatalogo(nombre!).includes(fichero!) ? { catalogo: nombre!, fichero: fichero! } : null;
}
