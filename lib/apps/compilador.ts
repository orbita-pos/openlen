// lib/apps/compilador.ts — EL COMPILADOR DE LA APP: un fichero fuente → el
// JavaScript que el navegador ejecuta, servido EN LA MISMA RUTA.
//
// Es la única puerta de los fuentes (spec local
// docs/superpowers/specs/2026-10-07-apps-design.md, §5.2 y H3): la usan el
// lienzo, los ojos de Len y la publicación. Ninguno sirve un `.jsx` sin pasar
// por aquí, y los tres reciben lo mismo — la doctrina de «un solo camino de
// renderizado».
//
// SIN BUNDLER (§2). Cada fichero se traduce por separado y el navegador junta
// las piezas con sus `import` nativos; los nombres del catálogo los resuelve el
// import map (`lib/apps/dependencias.ts`). Es lo que hace Vite en desarrollo.
//
// LO QUE HACE, en orden:
//   1. Traduce JSX y TypeScript con sucrase, que CONSERVA LOS NÚMEROS DE LÍNEA:
//      un error del navegador en `/src/Carrito.tsx:6` es la línea 6 del fuente
//      (medido el 2026-10-07). No hacen falta mapas de fuente.
//   2. Sustituye `import.meta.env` por un objeto con los valores PÚBLICOS del
//      proyecto: los modelos escriben código de Vite por reflejo, y en un
//      navegador `import.meta.env` es `undefined`.
//   3. Reescribe cada `import` (H4 de la spec): lo relativo, lo absoluto y el
//      alias `@/` se resuelven contra la carpeta —con o sin extensión, o su
//      `index`— y se reescriben a la ruta real; un `.css` se vuelve un `<link>`
//      y un `.json` lleva `with { type: "json" }`. Un nombre que no está en el
//      catálogo, o un fichero que no existe, es un ERROR con su ruta y su
//      línea: vuelve a Len en el acto, como un compilador.
//
// Cada sustitución deja el mismo número de saltos de línea que quita, así que
// las líneas siguen cuadrando después del paso 3.
//
// Los mensajes van en inglés: los lee el modelo (como los de folder.ts).
// Puro: sin disco, sin red, sin `server-only`. Lo prueba vitest.

import { createHash } from "node:crypto";
import { transform, type Transform } from "sucrase";
// La versión en JavaScript del analizador: SÍNCRONA, sin `init` ni wasm. Los
// ojos de Len contestan cada petición sin `await` (`localResponseFor`).
import { parse } from "es-module-lexer/js";
import { catalogo as catalogoDe, dependenciaDe } from "./dependencias";

/** Lo que el compilador traduce SIEMPRE: el navegador no ejecuta ni JSX ni TS. */
const SIEMPRE = [".jsx", ".tsx", ".ts"] as const;
/** Lo que traduce sólo en una app: ahí un `.js` también resuelve imports. En
 *  una página, el `/js/app.js` de siempre se sirve como está. */
const EN_UNA_APP = [".js", ".mjs"] as const;
/** El orden en que se prueba un import sin extensión, como Vite. */
const EXTENSIONES_RESOLUBLES = [".tsx", ".ts", ".jsx", ".js", ".mjs"] as const;

export interface ContextoDeCompilacion {
  /** La carpeta del proyecto: ruta (`/src/App.jsx`) → contenido. */
  readonly carpeta: Readonly<Record<string, string>>;
  /** El catálogo de la app (`ProjectData.app.catalogo`), o `null` en una
   *  página: ahí ningún nombre se resuelve. */
  readonly catalogo: string | null;
  /** Lo que vale `import.meta.env` además de MODE/DEV/PROD. SÓLO valores que
   *  pueden ir en una página: la URL del backend y su clave publicable. */
  readonly entorno?: Readonly<Record<string, string>>;
}

export interface Diagnostico {
  readonly ruta: string;
  /** 1-based, o `null` si el error no tiene sitio (p. ej. un fichero vacío). */
  readonly linea: number | null;
  readonly columna: number | null;
  readonly mensaje: string;
}

export type Compilado =
  | {
      readonly ok: true;
      readonly js: string;
      /** Los módulos LOCALES que importa, ya resueltos: el grafo de la app. */
      readonly locales: readonly string[];
      /** Los nombres del catálogo que importa (`react`, `react-dom/client`). */
      readonly paquetes: readonly string[];
    }
  | { readonly ok: false; readonly errores: readonly Diagnostico[] };

function extensionDe(ruta: string): string {
  const nombre = ruta.slice(ruta.lastIndexOf("/") + 1);
  const punto = nombre.lastIndexOf(".");
  return punto > 0 ? nombre.slice(punto).toLowerCase() : "";
}

/** ¿Pasa este fichero por el compilador? `.jsx/.tsx/.ts` siempre; `.js/.mjs`
 *  sólo en una app. */
export function esFuenteCompilable(ruta: string, esApp: boolean): boolean {
  const ext = extensionDe(ruta);
  if ((SIEMPRE as readonly string[]).includes(ext)) return true;
  return esApp && (EN_UNA_APP as readonly string[]).includes(ext);
}

function transformsDe(ruta: string): Transform[] {
  const ext = extensionDe(ruta);
  if (ext === ".ts") return ["typescript"];
  if (ext === ".tsx") return ["typescript", "jsx"];
  return ["jsx"];
}

/** `(3:14)` al final del mensaje de sucrase → línea y columna (1-based). */
function sitioDelError(err: unknown): { linea: number | null; columna: number | null; mensaje: string } {
  const texto = err instanceof Error ? err.message : String(err);
  const m = /\((\d+):(\d+)\)\s*$/.exec(texto);
  const limpio = texto.replace(/^Error transforming [^:]+:\s*/, "").replace(/\s*\(\d+:\d+\)\s*$/, "");
  return m ? { linea: Number(m[1]), columna: Number(m[2]) + 1, mensaje: limpio } : { linea: null, columna: null, mensaje: limpio };
}

function lineaDe(texto: string, posicion: number): number {
  let n = 1;
  for (let i = 0; i < posicion && i < texto.length; i++) if (texto.charCodeAt(i) === 10) n++;
  return n;
}

/** Normaliza `/src/./a/../b` → `/src/b`. `null` si se sale de la raíz. */
function normalizar(ruta: string): string | null {
  const partes: string[] = [];
  for (const p of ruta.split("/")) {
    if (p === "" || p === ".") continue;
    if (p === "..") {
      if (partes.length === 0) return null;
      partes.pop();
    } else partes.push(p);
  }
  return `/${partes.join("/")}`;
}

/** Lo relativo, lo absoluto y `@/` → la ruta del fichero que existe. `null` =
 *  no es una ruta (es un nombre); `undefined` = es una ruta y no existe. */
function resolver(especificador: string, desde: string, carpeta: Readonly<Record<string, string>>): string | null | undefined {
  let base: string | null;
  if (especificador.startsWith("@/")) base = normalizar(`/src/${especificador.slice(2)}`);
  else if (especificador.startsWith("/")) base = normalizar(especificador);
  else if (especificador.startsWith("./") || especificador.startsWith("../")) {
    base = normalizar(`${desde.slice(0, desde.lastIndexOf("/"))}/${especificador}`);
  } else return null;
  if (base === null) return undefined;
  const candidatos = [
    base,
    ...EXTENSIONES_RESOLUBLES.map((e) => base + e),
    ...EXTENSIONES_RESOLUBLES.map((e) => `${base}/index${e}`),
  ];
  return candidatos.find((c) => Object.hasOwn(carpeta, c));
}

/** El `<link>` que sustituye a `import "./x.css"`: una línea, sin dependencias.
 *  No lo duplica si dos módulos importan la misma hoja. */
function enlaceCss(ruta: string): string {
  const r = JSON.stringify(ruta);
  return `if(!document.querySelector('link[data-ol-css=${r.replace(/'/g, "\\'")}]')){const l=document.createElement("link");l.rel="stylesheet";l.href=${r};l.setAttribute("data-ol-css",${r});document.head.append(l)}`;
}

/** Tantos saltos de línea como los que tenía lo sustituido. */
function conSusLineas(sustituto: string, original: string): string {
  return sustituto + "\n".repeat((original.match(/\n/g) ?? []).length);
}

const CACHE_MAX = 500;
const cache = new Map<string, Compilado>();

function claveDeCache(ruta: string, codigo: string, ctx: ContextoDeCompilacion): string {
  // La resolución depende de QUÉ ficheros hay, no de lo que dicen: las rutas
  // entran en la clave, sus contenidos no.
  return createHash("sha256")
    .update(ruta)
    .update("\0")
    .update(codigo)
    .update("\0")
    .update(ctx.catalogo ?? "")
    .update("\0")
    .update(JSON.stringify(ctx.entorno ?? {}))
    .update("\0")
    .update(Object.keys(ctx.carpeta).sort().join("\n"))
    .digest("hex");
}

/** El objeto que sustituye a `import.meta.env`. Siempre el de producción: la
 *  vista y la publicada ejecutan el MISMO código. */
function objetoEntorno(ctx: ContextoDeCompilacion): string {
  return JSON.stringify({ ...(ctx.entorno ?? {}), MODE: "production", DEV: false, PROD: true, SSR: false, BASE_URL: "/" });
}

export function compilarFuente(ruta: string, codigo: string, ctx: ContextoDeCompilacion): Compilado {
  const clave = claveDeCache(ruta, codigo, ctx);
  const enCache = cache.get(clave);
  if (enCache) {
    cache.delete(clave);
    cache.set(clave, enCache);
    return enCache;
  }
  const resultado = compilarSinCache(ruta, codigo, ctx);
  cache.set(clave, resultado);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value!);
  return resultado;
}

function compilarSinCache(ruta: string, codigo: string, ctx: ContextoDeCompilacion): Compilado {
  // 1. JSX y TypeScript. `disableESTransforms`: el navegador ya entiende el
  // JavaScript moderno; bajarlo de versión sólo añadiría código.
  let js: string;
  try {
    js = transform(codigo, {
      transforms: transformsDe(ruta),
      jsxRuntime: "automatic",
      production: true,
      disableESTransforms: true,
      filePath: ruta,
    }).code;
  } catch (err) {
    const sitio = sitioDelError(err);
    return { ok: false, errores: [{ ruta, ...sitio }] };
  }

  // 2. `import.meta.env` → los valores públicos.
  js = js.replace(/\bimport\.meta\.env\b/g, `(${objetoEntorno(ctx)})`);

  // 3. Los imports.
  let imports: ReturnType<typeof parse>[0];
  try {
    [imports] = parse(js);
  } catch (err) {
    return { ok: false, errores: [{ ruta, linea: null, columna: null, mensaje: err instanceof Error ? err.message : String(err) }] };
  }
  const errores: Diagnostico[] = [];
  const locales = new Set<string>();
  const paquetes = new Set<string>();
  const nombres = catalogoDe(ctx.catalogo ?? "")?.dependencias.map((d) => d.especificador) ?? [];
  const error = (posicion: number, mensaje: string) =>
    errores.push({ ruta, linea: lineaDe(js, posicion), columna: null, mensaje });

  // De atrás hacia delante: reescribir uno no mueve las posiciones de los anteriores.
  for (const imp of [...imports].reverse()) {
    if (imp.type !== "static" && imp.type !== "dynamic") continue;
    const especificador = imp.specifier;
    // `import(variable)`: no se puede resolver aquí; el navegador dirá.
    if (typeof especificador !== "string") continue;
    const dinamico = imp.type === "dynamic";
    const sustituirEspecificador = (nuevo: string) => {
      const literal = js.slice(imp.start, imp.end);
      const conComillas = /^["'`]/.test(literal);
      js = js.slice(0, imp.start) + (conComillas ? JSON.stringify(nuevo) : nuevo) + js.slice(imp.end);
    };

    const resuelto = resolver(especificador, ruta, ctx.carpeta);
    if (resuelto === null) {
      // UN NOMBRE: o es del catálogo (lo resuelve el import map) o no existe.
      if (ctx.catalogo && dependenciaDe(ctx.catalogo, especificador)) {
        paquetes.add(especificador);
        continue;
      }
      if (/^[a-z][a-z0-9+.-]*:/i.test(especificador)) {
        error(imp.start, `"${especificador}": imports from URLs or "${especificador.split(":")[0]}:" are not supported here. Available packages: ${nombres.join(", ") || "none (this is not an app)"}.`);
      } else if (!ctx.catalogo) {
        error(imp.start, `"${especificador}" is a package name, and packages can only be imported in an app. Import files by path (./file.js).`);
      } else {
        error(imp.start, `"${especificador}" is not available in this app. Available packages: ${nombres.join(", ")}. Anything else has to be written in the project.`);
      }
      continue;
    }
    if (resuelto === undefined) {
      error(imp.start, `Cannot find "${especificador}" (imported from ${ruta}). Paths are resolved against the project's files, with or without extension.`);
      continue;
    }

    const ext = extensionDe(resuelto);
    if ((EXTENSIONES_RESOLUBLES as readonly string[]).includes(ext)) {
      locales.add(resuelto);
      sustituirEspecificador(resuelto);
      continue;
    }
    if (ext === ".css") {
      const sentencia = js.slice(imp.importStart, imp.importEnd);
      if (dinamico || !/^import\s*["'`]/.test(sentencia)) {
        error(imp.start, `${resuelto}: a CSS file can only be imported for its side effect (import "${especificador}"). CSS modules are not supported; use Tailwind classes or plain CSS.`);
        continue;
      }
      js = js.slice(0, imp.importStart) + conSusLineas(enlaceCss(resuelto), sentencia) + js.slice(imp.importEnd);
      continue;
    }
    if (ext === ".json") {
      if (dinamico) {
        error(imp.start, `${resuelto}: import JSON statically (import data from "${especificador}"), or fetch it.`);
        continue;
      }
      // Primero lo de detrás (la sentencia), luego el especificador.
      if (imp.attributesStart === -1) {
        const fin = imp.importEnd;
        const conPuntoYComa = js[fin - 1] === ";";
        js = js.slice(0, conPuntoYComa ? fin - 1 : fin) + ' with { type: "json" }' + (conPuntoYComa ? ";" : "") + js.slice(fin);
      }
      sustituirEspecificador(resuelto);
      continue;
    }
    error(imp.start, `${resuelto}: ${ext || "this kind of"} files cannot be imported. Reference it by its URL instead ("${resuelto}").`);
  }

  if (errores.length > 0) return { ok: false, errores: errores.sort((a, b) => (a.linea ?? 0) - (b.linea ?? 0)) };
  return { ok: true, js, locales: [...locales].sort(), paquetes: [...paquetes].sort() };
}

export interface CarpetaCompilada {
  /** Lo que se sirve: cada fuente compilada, y el resto tal cual. Un fuente
   *  que no compila NO está: se sirve como 404, no a medias. */
  readonly ficheros: Readonly<Record<string, string>>;
  readonly errores: readonly Diagnostico[];
  /** Los módulos alcanzables desde la entrada, en orden estable: lo que la
   *  publicada precarga (`modulepreload`, H13). Vacío sin entrada. */
  readonly grafo: readonly string[];
  /** Los nombres del catálogo que importa ese grafo. */
  readonly paquetes: readonly string[];
}

/** Toda la carpeta de una vez: lo que publica una app y lo que ven los ojos. */
export function compilarCarpeta(ctx: ContextoDeCompilacion & { readonly entrada?: string | null }): CarpetaCompilada {
  const esApp = ctx.catalogo !== null;
  const ficheros: Record<string, string> = {};
  const errores: Diagnostico[] = [];
  const localesDe = new Map<string, readonly string[]>();
  const paquetesDe = new Map<string, readonly string[]>();
  for (const [ruta, codigo] of Object.entries(ctx.carpeta)) {
    if (!esFuenteCompilable(ruta, esApp)) {
      ficheros[ruta] = codigo;
      continue;
    }
    const r = compilarFuente(ruta, codigo, ctx);
    if (r.ok) {
      ficheros[ruta] = r.js;
      localesDe.set(ruta, r.locales);
      paquetesDe.set(ruta, r.paquetes);
    } else errores.push(...r.errores);
  }
  const grafo: string[] = [];
  const paquetes = new Set<string>();
  if (ctx.entrada && Object.hasOwn(ctx.carpeta, ctx.entrada)) {
    const vistos = new Set<string>();
    const pila = [ctx.entrada];
    while (pila.length > 0) {
      const m = pila.pop()!;
      if (vistos.has(m)) continue;
      vistos.add(m);
      for (const dep of localesDe.get(m) ?? []) pila.push(dep);
    }
    grafo.push(...[...vistos].sort());
    for (const m of grafo) for (const p of paquetesDe.get(m) ?? []) paquetes.add(p);
  }
  return { ficheros, errores, grafo, paquetes: [...paquetes].sort() };
}

/** Un diagnóstico como lo lee Len: `ruta:línea:columna — mensaje`. */
export function textoDeDiagnostico(d: Diagnostico): string {
  const sitio = d.linea === null ? d.ruta : d.columna === null ? `${d.ruta}:${d.linea}` : `${d.ruta}:${d.linea}:${d.columna}`;
  return `${sitio} — ${d.mensaje}`;
}

/** Una app que no compila NO SE PUBLICA (spec local 2026-10-07-apps, §5.6):
 *  media app en el subdominio del dueño es peor que la release anterior. La
 *  lanza `publishToDir` antes de tocar el disco, con todos los errores. */
export class AppNoCompilaError extends Error {
  constructor(readonly errores: readonly Diagnostico[]) {
    super(`la app no compila:\n${errores.map(textoDeDiagnostico).join("\n")}`);
    this.name = "AppNoCompilaError";
  }
}
