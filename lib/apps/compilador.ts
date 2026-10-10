// lib/apps/compilador.ts — EL COMPILADOR DE LA APP: un fichero fuente → el
// JavaScript que el navegador ejecuta, servido EN LA MISMA RUTA.
//
// Es la única puerta de los fuentes (spec local
// docs/superpowers/specs/2026-10-07-apps-design.md, §5.2 y H3): la usan el
// lienzo, los ojos de Len y la publicación. Ninguno sirve un `.jsx` sin pasar
// por aquí, y los tres reciben lo mismo — la doctrina de «un solo camino de
// renderizado».
//
// Y SU SALIDA VA AL EMPAQUETADOR (plan 02, `lib/apps/bundler/`). Cada fichero
// se traduce por separado, aquí; esbuild junta lo traducido con lo que usa del
// catálogo en UN paquete, el mismo en los tres caminos (de desarrollo en el
// lienzo y los ojos, de producción al publicar). Los diagnósticos son de aquí,
// no de esbuild: con la línea del fuente.
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
//      y un `.json` lleva `with { type: "json" }`; un `.svg`, `.txt`, `.md` o
//      `.webmanifest` —o cualquiera con `?url`— es su URL, y con `?raw` su
//      texto, como en Vite. Un nombre que no está en el
//      catálogo, o un fichero que no existe, es un ERROR con su ruta y su
//      línea: vuelve a Len en el acto, como un compilador.
//   4. Comprueba los NOMBRES que se importan de cada paquete
//      (`import { Cafe } from "lucide-react"`) contra lo que exporta de verdad su
//      fichero (`exportaciones.json`, que sale de sus bytes). Sin esto, un icono
//      que no está deja la app EN BLANCO en el navegador, con un error que sólo
//      se ve al mirarla; aquí es un error del fichero, con su línea, y con los
//      nombres parecidos que sí hay.
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
// El parser de CSS de Tailwind (`usesTailwindDirectives`). Síncrono y puro.
import postcss from "postcss";
import { catalogo as catalogoDe, dependenciaDe } from "./dependencias";
import { PISTAS_DEL_ENRUTADOR } from "./enrutador";
// Lo que exporta cada fichero de cada catálogo, leído de sus bytes por
// `npm run apps:vendor` (que lo comprueba con `--comprobar`).
import EXPORTACIONES from "./exportaciones.json";
import { isTestSupportFile } from "./tests/test-files";

/** Lo que el compilador traduce SIEMPRE: el navegador no ejecuta ni JSX ni TS. */
const SIEMPRE = [".jsx", ".tsx", ".ts"] as const;
/** Lo que traduce sólo en una app: ahí un `.js` también resuelve imports. En
 *  una página, el `/js/app.js` de siempre se sirve como está. */
const EN_UNA_APP = [".js", ".mjs"] as const;
/** El orden en que se prueba un import sin extensión, como Vite. */
const EXTENSIONES_RESOLUBLES = [".tsx", ".ts", ".jsx", ".js", ".mjs"] as const;
/** Lo que se importa como su URL, como en Vite (la carpeta sólo guarda texto:
 *  las fotos son subidas, con su URL). */
const EXTENSIONES_DE_URL = [".svg", ".txt", ".md", ".webmanifest"] as const;

export interface ContextoDeCompilacion {
  /** La carpeta del proyecto: ruta (`/src/App.jsx`) → contenido. */
  readonly carpeta: Readonly<Record<string, string>>;
  /** El catálogo de la app (`ProjectData.app.catalogo`), o `null` en una
   *  página: ahí ningún nombre se resuelve. */
  readonly catalogo: string | null;
  /** Lo que vale `import.meta.env` además de MODE/DEV/PROD. SÓLO valores que
   *  pueden ir en una página: la URL del backend y su clave publicable. */
  readonly entorno?: Readonly<Record<string, string>>;
  /** Nombres que se dejan como están aunque no sean del catálogo: los de las
   *  pruebas (`vitest`, Testing Library: `lib/apps/tests/test-kit.ts`). Los
   *  resuelve el empaquetador de pruebas. */
  readonly extraSpecifiers?: readonly string[];
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
export function resolveLocalImport(especificador: string, desde: string, carpeta: Readonly<Record<string, string>>): string | null | undefined {
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

/** `./x.svg?raw` → `["./x.svg", "?raw"]`. Sólo `?raw` y `?url` se entienden. */
function separarConsulta(especificador: string): readonly [string, string] {
  const i = especificador.indexOf("?");
  return i === -1 ? [especificador, ""] : [especificador.slice(0, i), especificador.slice(i)];
}

/** El nombre por defecto de `import logo from "…"`, o `null` si no lo hay. */
function nombrePorDefecto(sentencia: string): string | null {
  return /^import\s+([A-Za-z_$][\w$]*)\s+from\s*["'`]/.exec(sentencia)?.[1] ?? null;
}

/** Las at-rules que procesa Tailwind 3. `@layer` aparte: sólo las suyas. */
const DIRECTIVAS_DE_TAILWIND = new Set(["apply", "tailwind", "config", "screen", "variants", "responsive"]);
const CAPAS_DE_TAILWIND = /^(?:base|components|utilities)$/;
const FUNCIONES_DE_TAILWIND = /\b(?:theme|screen)\(/;

/** ¿Usa esta hoja algo que sólo entiende Tailwind? Un `<link>` la llevaría al
 *  navegador con el `@apply` sin traducir, y el navegador lo tira (2026-10-08).
 *
 *  SE LEE CON EL PARSER DE CSS, no con una regex sobre el texto (como hace
 *  Claude Code: preguntarle a la herramienta, no adivinar). La regex contaba un
 *  `@apply` dentro de un comentario o de un `content: "…"`, y cualquier `@layer`,
 *  también el nativo de CSS (`@layer reset`), que Tailwind deja pasar intacto.
 *  Postcss es el mismo parser que usa Tailwind. Un CSS que no se puede leer va
 *  como `<link>`: el navegador es tolerante y no se adivina. */
export function usesTailwindDirectives(css: string): boolean {
  let raiz: ReturnType<typeof postcss.parse>;
  try {
    raiz = postcss.parse(css);
  } catch {
    return false;
  }
  let usa = false;
  raiz.walk((nodo) => {
    if (nodo.type === "atrule") {
      usa = DIRECTIVAS_DE_TAILWIND.has(nodo.name) || (nodo.name === "layer" && CAPAS_DE_TAILWIND.test(nodo.params.trim()));
    } else if (nodo.type === "decl") {
      usa = FUNCIONES_DE_TAILWIND.test(nodo.value);
    }
    return usa ? false : undefined;
  });
  return usa;
}

/** Lo que sustituye a `import "./x.css"` cuando la hoja usa Tailwind: un
 *  `<style type="text/tailwindcss">` con su texto DENTRO del módulo. El CDN del
 *  lienzo y de los ojos lo procesa al vuelo (medido en Chromium el 2026-10-08:
 *  `@layer`, `@apply` y el theme del cascarón), y la publicación lo hornea
 *  (`bakeTailwind`, con las hojas de la carpeta). Así los tres caminos reciben
 *  el mismo JS. Una línea, como `enlaceCss`; no se repite si dos módulos la importan. */
function tailwindStyle(ruta: string, css: string): string {
  const r = JSON.stringify(ruta);
  return `if(!document.querySelector('style[data-ol-css=${r.replace(/'/g, "\\'")}]')){const s=document.createElement("style");s.type="text/tailwindcss";s.setAttribute("data-ol-css",${r});s.textContent=${JSON.stringify(css)};document.head.append(s)}`;
}

/** Tantos saltos de línea como los que tenía lo sustituido. */
function conSusLineas(sustituto: string, original: string): string {
  return sustituto + "\n".repeat((original.match(/\n/g) ?? []).length);
}

/** Lo que el modelo escribe por reflejo y no está, con lo que va en su lugar. */
const PISTAS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  "react-router.js": PISTAS_DEL_ENRUTADOR,
};

export function catalogExportsOf(nombreCatalogo: string, fichero: string): readonly string[] | null {
  const delCatalogo = (EXPORTACIONES as Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>)[nombreCatalogo];
  return delCatalogo && Object.hasOwn(delCatalogo, fichero) ? delCatalogo[fichero]! : null;
}

/** Distancia de edición, sin distinguir mayúsculas. */
function distancia(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  let fila = Array.from({ length: y.length + 1 }, (_, j) => j);
  for (let i = 1; i <= x.length; i++) {
    const nueva = [i];
    for (let j = 1; j <= y.length; j++) {
      nueva.push(Math.min(fila[j]! + 1, nueva[j - 1]! + 1, fila[j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1)));
    }
    fila = nueva;
  }
  return fila[y.length]!;
}

/** Los nombres de la lista que más se parecen a `nombre`: los que lo contienen
 *  (o están contenidos en él) primero, luego por distancia. */
export function parecidos(nombre: string, lista: readonly string[], cuantos = 6): string[] {
  const n = nombre.toLowerCase().replace(/icon$/, "");
  return lista
    .filter((c) => !c.endsWith("Icon"))
    .map((c) => {
      const l = c.toLowerCase();
      const contiene = n.length >= 3 && (l.includes(n) || n.includes(l));
      return { c, puntos: (contiene ? 0 : 100) + distancia(n, l) };
    })
    .filter((x) => x.puntos < 100 + Math.max(3, Math.floor(n.length / 2)))
    .sort((a, b) => a.puntos - b.puntos || a.c.localeCompare(b.c))
    .slice(0, cuantos)
    .map((x) => x.c);
}

/** Los nombres que una sentencia toma de su módulo: `import X, { a, b as c }`
 *  → `["default", "a", "b"]`; `export { a } from` → `["a"]`. `null` si no se
 *  pueden saber (`import * as`, `export *`, o una forma que no se reconoce). */
export function nombresImportados(sentencia: string): string[] | null {
  const m = /^(import|export)\s*([\s\S]*?)\s*from\s*["'`]/.exec(sentencia);
  if (!m) return [];
  const clausula = m[2]!.trim();
  if (clausula.startsWith("*") || /,\s*\*/.test(clausula)) return null;
  const nombres: string[] = [];
  const llaves = /\{([\s\S]*)\}/.exec(clausula);
  const fuera = (llaves ? clausula.replace(llaves[0], "") : clausula).replace(/,/g, " ").trim();
  if (m[1] === "import" && fuera && fuera !== "type") nombres.push("default");
  for (const parte of (llaves?.[1] ?? "").split(",")) {
    const p = parte.trim().replace(/^type\s+/, "");
    if (!p) continue;
    const importado = p.split(/\s+as\s+/)[0]!.trim().replace(/^["']|["']$/g, "");
    if (importado) nombres.push(importado);
  }
  return nombres;
}

/** El error de un nombre que el paquete no exporta, con lo que va en su lugar. */
function mensajeDeNombre(especificador: string, fichero: string, nombre: string, hay: readonly string[]): string {
  const pista = PISTAS[fichero]?.[nombre];
  if (pista) return `"${nombre}" is not available from "${especificador}": ${pista}`;
  if (nombre === "default") {
    return `"${especificador}" has no default export here: import what you need by name (import { … } from "${especificador}").`;
  }
  const cerca = parecidos(nombre, hay);
  const sugerencia = cerca.length > 0 ? ` Closest: ${cerca.join(", ")}.` : "";
  if (fichero === "lucide-react.js") {
    return `"${nombre}" is not one of the icons available here: "lucide-react" has a selection, not all of lucide.${sugerencia} Or draw it as an inline <svg>.`;
  }
  return `"${especificador}" has no export named "${nombre}" here.${sugerencia}`;
}

const CACHE_MAX = 500;
const cache = new Map<string, Compilado>();

function claveDeCache(ruta: string, codigo: string, ctx: ContextoDeCompilacion): string {
  // La resolución depende de QUÉ ficheros hay, no de lo que dicen: las rutas
  // entran en la clave, sus contenidos no. Salvo las HOJAS: una con `@apply`
  // viaja dentro del módulo que la importa (`tailwindStyle`), así que su texto
  // también decide lo que sale. Son pocas y pequeñas. Y si el fuente pide el
  // TEXTO de otro fichero (`?raw`, plan 02), ése también: cualquiera, entero.
  const conRaw = codigo.includes("?raw");
  const hojas = Object.keys(ctx.carpeta)
    .filter((r) => conRaw || extensionDe(r) === ".css")
    .sort()
    .map((r) => `${r}\0${ctx.carpeta[r]}`)
    .join("\0");
  return createHash("sha256")
    .update(ruta)
    .update("\0")
    .update(codigo)
    .update("\0")
    .update(ctx.catalogo ?? "")
    .update("\0")
    .update(JSON.stringify(ctx.entorno ?? {}))
    .update("\0")
    .update((ctx.extraSpecifiers ?? []).join("\n"))
    .update("\0")
    .update(Object.keys(ctx.carpeta).sort().join("\n"))
    .update("\0")
    .update(hojas)
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
  const nombres = catalogoDe(ctx.catalogo ?? "")?.dependencias.map((d) => d.especificador) ?? [];
  const error = (posicion: number, mensaje: string) =>
    errores.push({ ruta, linea: lineaDe(js, posicion), columna: null, mensaje });

  // De atrás hacia delante: reescribir uno no mueve las posiciones de los anteriores.
  for (const imp of [...imports].reverse()) {
    // `export * from "./x"` es su propio tipo en el lexer ("reexport-star"):
    // sin él, el fichero barril llegaba al empaquetador sin resolver.
    if (imp.type !== "static" && imp.type !== "dynamic" && imp.type !== "reexport-star") continue;
    const especificador = imp.specifier;
    // `import(variable)`: no se puede resolver aquí; el navegador dirá.
    if (typeof especificador !== "string") continue;
    const dinamico = imp.type === "dynamic";
    const sustituirEspecificador = (nuevo: string) => {
      const literal = js.slice(imp.start, imp.end);
      const conComillas = /^["'`]/.test(literal);
      js = js.slice(0, imp.start) + (conComillas ? JSON.stringify(nuevo) : nuevo) + js.slice(imp.end);
    };

    const [sinConsulta, consulta] = separarConsulta(especificador);
    if (consulta !== "" && consulta !== "?raw" && consulta !== "?url") {
      error(imp.start, `"${especificador}": only ?raw (the file's text) and ?url (its URL) are supported after a path.`);
      continue;
    }
    const resuelto = resolveLocalImport(sinConsulta, ruta, ctx.carpeta);
    if (resuelto === null) {
      if (consulta) {
        error(imp.start, `"${especificador}": ?raw and ?url go after a file's path, not a package name.`);
        continue;
      }
      // Lo de las pruebas (vitest, Testing Library) pasa por su nombre: lo pone el kit.
      if (ctx.extraSpecifiers?.includes(especificador)) continue;
      // UN NOMBRE: o es del catálogo (lo resuelve el empaquetador) o no existe.
      const dependencia = ctx.catalogo ? dependenciaDe(ctx.catalogo, especificador) : null;
      if (ctx.catalogo && dependencia) {
        const hay = catalogExportsOf(ctx.catalogo, dependencia.fichero);
        const tomados = dinamico || !hay ? null : nombresImportados(js.slice(imp.importStart, imp.importEnd));
        for (const nombre of tomados ?? []) {
          if (!hay!.includes(nombre)) error(imp.start, mensajeDeNombre(especificador, dependencia.fichero, nombre, hay!));
        }
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
    // UN FICHERO COMO MÓDULO, como en Vite: su URL (`?url`, o un .svg/.txt/.md
    // por defecto) o su texto (`?raw`). Se queda una constante en su línea.
    if (consulta || (EXTENSIONES_DE_URL as readonly string[]).includes(ext)) {
      const sentencia = js.slice(imp.importStart, imp.importEnd);
      const nombre = dinamico ? null : nombrePorDefecto(sentencia);
      if (!nombre) {
        error(imp.start, `${resuelto}: import it with a default name, statically: import file from "${especificador}".`);
        continue;
      }
      const valor = consulta === "?raw" ? (ctx.carpeta[resuelto] ?? "") : resuelto;
      js = js.slice(0, imp.importStart) + conSusLineas(`const ${nombre} = ${JSON.stringify(valor)};`, sentencia) + js.slice(imp.importEnd);
      continue;
    }
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
      const hoja = ctx.carpeta[resuelto] ?? "";
      const sustituto = usesTailwindDirectives(hoja) ? tailwindStyle(resuelto, hoja) : enlaceCss(resuelto);
      js = js.slice(0, imp.importStart) + conSusLineas(sustituto, sentencia) + js.slice(imp.importEnd);
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
  return { ok: true, js, locales: [...locales].sort() };
}

export interface CarpetaCompilada {
  /** Cada fuente compilada, y el resto tal cual: lo que entra al empaquetador.
   *  Un fuente que no compila NO está, no a medias: su error, en `errores`. */
  readonly ficheros: Readonly<Record<string, string>>;
  readonly errores: readonly Diagnostico[];
}

/** Toda la carpeta de una vez: lo que publica una app y lo que ven los ojos. */
export function compilarCarpeta(ctx: ContextoDeCompilacion): CarpetaCompilada {
  const esApp = ctx.catalogo !== null;
  const ficheros: Record<string, string> = {};
  const errores: Diagnostico[] = [];
  const localesDe = new Map<string, readonly string[]>();
  for (const [ruta, codigo] of Object.entries(ctx.carpeta)) {
    // LAS PRUEBAS NO SON DE LA APP (plan 04): ni se compilan con ella —importan
    // `vitest`, que no es del catálogo— ni se empaquetan ni se publican. Las
    // compila `compileTestFile` cuando Len corre `npm test`.
    if (esApp && isTestSupportFile(ruta, ctx.carpeta)) continue;
    if (!esFuenteCompilable(ruta, esApp)) {
      ficheros[ruta] = codigo;
      continue;
    }
    const r = compilarFuente(ruta, codigo, ctx);
    if (r.ok) {
      ficheros[ruta] = r.js;
      localesDe.set(ruta, r.locales);
    } else errores.push(...r.errores);
  }
  errores.push(...nombresLocalesQueNoExisten(ficheros, localesDe));
  return { ficheros, errores };
}

/**
 * LOS NOMBRES QUE UN FICHERO TOMA DE OTRO DEL PROYECTO y ése ya no exporta
 * (F3). Es el fallo típico de un cambio a medias: se renombra `Carrito` a
 * `Cesta` en su fichero y un import se queda atrás. El navegador lo dice al
 * enlazar los módulos —y la app entera se queda en blanco—; aquí es un error del
 * fichero que importa, con su línea y lo que sí exporta el otro.
 *
 * Sólo se puede ver con la carpeta entera, así que vive aquí y no en
 * `compilarFuente`. Un `export *` en el destino deja su lista incompleta: ese
 * destino no se comprueba.
 */
function nombresLocalesQueNoExisten(
  ficheros: Readonly<Record<string, string>>,
  localesDe: ReadonlyMap<string, readonly string[]>,
): Diagnostico[] {
  const exportan = new Map<string, Set<string> | null>();
  const deDestino = (destino: string): Set<string> | null => {
    if (!exportan.has(destino)) {
      let nombres: Set<string> | null = null;
      try {
        const [, exps] = parse(ficheros[destino]!);
        nombres = exps.every((e) => "name" in e) ? new Set(exps.map((e) => ("name" in e ? e.name : ""))) : null;
      } catch {
        nombres = null;
      }
      exportan.set(destino, nombres);
    }
    return exportan.get(destino)!;
  };
  const errores: Diagnostico[] = [];
  for (const [ruta, locales] of localesDe) {
    if (locales.length === 0) continue;
    const js = ficheros[ruta]!;
    let imports: ReturnType<typeof parse>[0];
    try {
      [imports] = parse(js);
    } catch {
      continue;
    }
    for (const imp of imports) {
      if (imp.type !== "static" || typeof imp.specifier !== "string" || !locales.includes(imp.specifier)) continue;
      // Un destino que no compiló ya tiene su propio error.
      if (!Object.hasOwn(ficheros, imp.specifier) || !localesDe.has(imp.specifier)) continue;
      const hay = deDestino(imp.specifier);
      if (!hay) continue;
      for (const nombre of nombresImportados(js.slice(imp.importStart, imp.importEnd)) ?? []) {
        if (hay.has(nombre)) continue;
        const lista = [...hay].filter((n) => n !== "default").sort();
        const exporta = [hay.has("default") ? "a default export" : "", lista.join(", ")].filter(Boolean).join(" and ") || "nothing";
        errores.push({
          ruta,
          linea: lineaDe(js, imp.start),
          columna: null,
          mensaje:
            nombre === "default"
              ? `${imp.specifier} has no default export: it exports ${exporta}, by name.`
              : `${imp.specifier} has no export named "${nombre}": it exports ${exporta}.`,
        });
      }
    }
  }
  return errores;
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
