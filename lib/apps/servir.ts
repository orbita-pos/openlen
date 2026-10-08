// lib/apps/servir.ts — LO QUE CONTESTA EL ORIGEN DE UNA APP a una ruta que no
// es su documento: una dependencia del catálogo (`/openlen/vendor/…`) o un
// fuente, compilado. Lo usan el lienzo (`/api/lienzo/site`) y los ojos de Len
// (`lib/lienzo/documento.ts` → `lib/ai/origen-de-medida.ts`), con la misma
// función; la publicación compila la carpeta entera (`compilarCarpeta`) porque
// escribe ficheros, pero con el mismo compilador.
//
// UN FUENTE QUE NO COMPILA NO DA UN 404 (spec local 2026-10-07-apps, §5.2): da
// un módulo que LANZA su error, con fichero y línea. Un 404 en la consola dice
// «Failed to load module» y nada más; esto dice «/src/App.jsx:12 — Unexpected
// token», que es lo que Len necesita leer para arreglarlo y lo que el dueño ve
// en las herramientas del navegador. La publicación, en cambio, se NIEGA a
// publicar una app que no compila (ver `publishToDir`).

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import type { AppDeProyecto } from "@/lib/projects/types";
import { compilarFuente, esFuenteCompilable, textoDeDiagnostico, type Diagnostico } from "./compilador";
// La versión en JavaScript del analizador, la misma que usa el compilador.
import { parse } from "es-module-lexer/js";
import { dependenciaDe, ficherosDelCatalogo, rutaDeVendor, rutaDeVendorValida, type ModoVendor } from "./dependencias";

/** Dónde están las dependencias construidas (`npm run apps:vendor`). En
 *  producción `process.cwd()` es /opt/openlen-app, con `public/` dentro (lo
 *  copia el deploy); `OPENLEN_APP_VENDOR_DIR` lo cambia para las pruebas. */
function directorioVendor(): string {
  return process.env.OPENLEN_APP_VENDOR_DIR?.trim() || path.join(process.cwd(), "public", "app-vendor");
}

const cacheVendor = new Map<string, string | null>();

/** Los bytes de un fichero del catálogo en un modo, o `null` si no existe. Se
 *  leen una vez: un catálogo no cambia nunca. */
export function leerVendor(catalogo: string, fichero: string, modo: ModoVendor): string | null {
  if (!ficherosDelCatalogo(catalogo).includes(fichero)) return null;
  const clave = `${directorioVendor()}\0${catalogo}\0${modo}\0${fichero}`;
  if (cacheVendor.has(clave)) return cacheVendor.get(clave)!;
  const ruta = path.join(directorioVendor(), catalogo, modo, fichero);
  const cuerpo = existsSync(ruta) ? readFileSync(ruta, "utf8") : null;
  cacheVendor.set(clave, cuerpo);
  return cuerpo;
}

/** Todo el catálogo de una app, por ruta (`/openlen/vendor/2026-10/react.js`):
 *  lo que necesita el navegador que mide, que contesta de un mapa. */
export function vendorPorRuta(catalogo: string, modo: ModoVendor): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of ficherosDelCatalogo(catalogo)) {
    const cuerpo = leerVendor(catalogo, f, modo);
    if (cuerpo !== null) out[rutaDeVendor(catalogo, f)] = cuerpo;
  }
  return out;
}

const FUENTE_JS = /\.(?:m?js|jsx|tsx?)$/i;

/**
 * LOS FICHEROS DEL CATÁLOGO QUE UNA APP ALCANZA (2026-10-08): los paquetes que
 * importa algún fichero compilado —estático o `import("…")` literal—, y lo que
 * esos ficheros importan a su vez (`./react-todo.js`, `./chunk-*.js`). Es lo que
 * la publicación copia a cada release: el catálogo 2026-11 entero son 3,2 MB, y
 * una app que no dibuja gráficas no necesita los 516 KB de recharts. Si un
 * fichero compilado no se puede leer, se copia el catálogo entero: sobrar sólo
 * cuesta disco; faltar, una app rota.
 */
export function vendorFilesFor(nombreCatalogo: string, compilados: Readonly<Record<string, string>>): string[] {
  const pila: string[] = [];
  for (const [ruta, js] of Object.entries(compilados)) {
    if (!FUENTE_JS.test(ruta)) continue;
    let imports: ReturnType<typeof parse>[0];
    try {
      [imports] = parse(js);
    } catch {
      return ficherosDelCatalogo(nombreCatalogo);
    }
    for (const i of imports) {
      const especificador = "specifier" in i ? i.specifier : undefined;
      const d = typeof especificador === "string" ? dependenciaDe(nombreCatalogo, especificador) : null;
      if (d) pila.push(d.fichero);
    }
  }
  const vistos = new Set<string>();
  while (pila.length > 0) {
    const f = pila.pop()!;
    if (vistos.has(f)) continue;
    vistos.add(f);
    const cuerpo = leerVendor(nombreCatalogo, f, "produccion");
    if (cuerpo === null) continue;
    for (const i of parse(cuerpo)[0]) {
      const especificador = "specifier" in i ? i.specifier : undefined;
      if (typeof especificador === "string" && especificador.startsWith("./")) pila.push(especificador.slice(2));
    }
  }
  return [...vistos].sort();
}

export interface OpcionesDeServicio {
  /** La app, o `null` si el proyecto es una página. */
  readonly app: AppDeProyecto | null;
  /** Los valores públicos de `import.meta.env` (`entornoPublicoDeLaApp`). */
  readonly entorno?: Readonly<Record<string, string>>;
  readonly modo: ModoVendor;
}

export interface Servido {
  readonly cuerpo: string;
  readonly tipo: string;
  /** Una dependencia del catálogo: sus bytes no cambian nunca. */
  readonly inmutable: boolean;
}

const JS = "text/javascript; charset=utf-8";

/** El módulo que se sirve en lugar de un fuente que no compila. */
export function moduloDeError(ruta: string, errores: readonly Diagnostico[]): string {
  const texto = `OpenLen could not compile ${ruta}:\n${errores.map(textoDeDiagnostico).join("\n")}`;
  return `throw new SyntaxError(${JSON.stringify(texto)});\n`;
}

/**
 * La respuesta para `ruta`, o `null` si no es cosa de la app (el llamador
 * sigue con lo suyo: el documento, un fichero que se sirve tal cual, un 404).
 * `carpeta` es la carpeta ENTERA del proyecto: la resolución de imports la
 * necesita aunque se pida un solo fichero.
 */
export function servirRutaDeLaApp(
  ruta: string,
  carpeta: Readonly<Record<string, string>>,
  opciones: OpcionesDeServicio,
): Servido | null {
  const vendor = rutaDeVendorValida(ruta);
  if (vendor) {
    const cuerpo = leerVendor(vendor.catalogo, vendor.fichero, opciones.modo);
    return cuerpo === null ? null : { cuerpo, tipo: JS, inmutable: true };
  }
  if (!esFuenteCompilable(ruta, opciones.app !== null) || !Object.hasOwn(carpeta, ruta)) return null;
  const r = compilarFuente(ruta, carpeta[ruta]!, {
    carpeta,
    catalogo: opciones.app?.catalogo ?? null,
    ...(opciones.entorno ? { entorno: opciones.entorno } : {}),
  });
  return { cuerpo: r.ok ? r.js : moduloDeError(ruta, r.errores), tipo: JS, inmutable: false };
}
