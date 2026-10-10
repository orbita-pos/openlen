// lib/apps/servir.ts — LO QUE SE SIRVE DE UNA APP, y de los fuentes de una
// página. Lo usan el lienzo (`/api/lienzo/site`), los ojos de Len
// (`lib/lienzo/documento.ts` → `lib/ai/origen-de-medida.ts`) y la publicación
// (`publishToDir`), con las mismas funciones: los tres reciben lo mismo.
//
// UNA APP ES UN PAQUETE (plan 02): de su carpeta se sirve la ENTRADA —el
// paquete (`bundleApp`), o un módulo que lanza sus errores— y lo que no es un
// fuente (hojas, .svg, .json…), tal cual (`ficherosDeLaApp`). Ni los fuentes
// sueltos ni el catálogo: van DENTRO del paquete, y la publicada no los lleva.
//
// UN FUENTE QUE NO COMPILA NO DA UN 404 (spec local 2026-10-07-apps, §5.2): da
// un módulo que LANZA su error, con fichero y línea. Un 404 en la consola dice
// «Failed to load module» y nada más; esto dice «/src/App.jsx:12 — Unexpected
// token», que es lo que Len necesita leer para arreglarlo y lo que el dueño ve
// en las herramientas del navegador. La publicación, en cambio, se NIEGA a
// publicar una app que no compila (ver `publishToDir`).

import path from "node:path";
import { isPublishableFolderPath } from "@/lib/agent/ficheros/folder";
import type { AppDeProyecto } from "@/lib/projects/types";
import type { AppBundle } from "./bundler/bundle-app";
import { compilarFuente, esFuenteCompilable, textoDeDiagnostico, type Diagnostico } from "./compilador";

/** Dónde están las dependencias construidas (`npm run apps:vendor`): las
 *  entradas del empaquetador y los tipos del comprobador. En producción
 *  `process.cwd()` es /opt/openlen-app, con `public/` dentro (lo copia el
 *  deploy); `OPENLEN_APP_VENDOR_DIR` lo cambia para las pruebas. */
export function directorioVendor(): string {
  return process.env.OPENLEN_APP_VENDOR_DIR?.trim() || path.join(process.cwd(), "public", "app-vendor");
}

/** El aviso cuando el empaquetador no contesta (`bundleApp` → `null`). */
export const BUNDLER_DID_NOT_ANSWER = "The bundler didn't answer in time: nothing was built. Try again.";

/** El módulo que se sirve en lugar de un fuente que no compila. */
export function moduloDeError(ruta: string, errores: readonly Diagnostico[]): string {
  const texto = `OpenLen could not compile ${ruta}:\n${errores.map(textoDeDiagnostico).join("\n")}`;
  return `throw new SyntaxError(${JSON.stringify(texto)});\n`;
}

/** Lo que el lienzo y los ojos sirven en la entrada de una app: el paquete, o
 *  un módulo que lanza los errores del compilador, o el aviso de que el
 *  empaquetador no contestó. (La publicación no sirve nada de eso: se niega.) */
export function entradaServida(entrada: string, paquete: AppBundle | null): string {
  if (!paquete) return moduloDeError(entrada, [{ ruta: entrada, linea: null, columna: null, mensaje: BUNDLER_DID_NOT_ANSWER }]);
  return paquete.ok ? paquete.js : moduloDeError(entrada, paquete.errores);
}

/** La carpeta de una app tal como se sirve: lo publicable que no es un fuente,
 *  tal cual, y en su entrada, `cuerpoDeLaEntrada`. Lo mismo en el lienzo, los
 *  ojos y la release. */
export function ficherosDeLaApp(
  carpeta: Readonly<Record<string, string>>,
  app: AppDeProyecto,
  cuerpoDeLaEntrada: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [ruta, contenido] of Object.entries(carpeta)) {
    if (isPublishableFolderPath(ruta) && !esFuenteCompilable(ruta, true)) out[ruta] = contenido;
  }
  out[app.entrada] = cuerpoDeLaEntrada;
  return out;
}

/**
 * UNA PÁGINA con un `.jsx`, `.tsx` o `.ts` en su carpeta: compilado, en su
 * misma ruta (el navegador no ejecuta JSX), o `null` si `ruta` no es un fuente
 * de la carpeta. `carpeta` es la carpeta ENTERA: resolver un import la necesita.
 */
export function servirFuenteDePagina(
  ruta: string,
  carpeta: Readonly<Record<string, string>>,
  entorno?: Readonly<Record<string, string>>,
): string | null {
  if (!esFuenteCompilable(ruta, false) || !Object.hasOwn(carpeta, ruta)) return null;
  const r = compilarFuente(ruta, carpeta[ruta]!, { carpeta, catalogo: null, ...(entorno ? { entorno } : {}) });
  return r.ok ? r.js : moduloDeError(ruta, r.errores);
}
