/**
 * EL EXPLORADOR COMO EL DE VS CODE, lo que no es pintar: qué nombre vale, en
 * qué carpeta nace un archivo nuevo, adónde va cada ruta al renombrar una
 * carpeta y qué es una página. Puro: lo prueba vitest y lo importa el cliente.
 */

/** Un trozo de ruta: letras, dígitos, `-`, `_` y `.`, sin empezar por punto —
 *  la misma regla que la carpeta del proyecto (`lib/agent/ficheros/folder.ts`). */
const SEGMENTO = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

/** ¿Vale como nombre de un archivo o una carpeta? Se admite `a/b.js`: crea las carpetas de en medio, como VS Code. */
export function nombreValido(nombre: string): boolean {
  const partes = nombre.trim().split("/");
  return partes.length > 0 && partes.length <= 8 && partes.every((p) => SEGMENTO.test(p));
}

/** La carpeta de una ruta (`""` es la raíz). */
export function carpetaDe(ruta: string): string {
  return ruta.slice(0, Math.max(0, ruta.lastIndexOf("/")));
}

/** La ruta de `nombre` dentro de `carpeta`. */
export function rutaDentro(carpeta: string, nombre: string): string {
  return `${carpeta.replace(/\/+$/, "")}/${nombre.trim().replace(/^\/+/, "")}`;
}

/** Dónde nace lo nuevo, como en VS Code: dentro de la carpeta elegida, junto al archivo elegido, o en la raíz. */
export function carpetaDestino(seleccion: { readonly ruta: string; readonly tipo: "carpeta" | "fichero" } | null): string {
  if (!seleccion) return "";
  return seleccion.tipo === "carpeta" ? seleccion.ruta : carpetaDe(seleccion.ruta);
}

/** ¿Está `ruta` dentro de `carpeta` (o es ella)? */
export function estaDentro(ruta: string, carpeta: string): boolean {
  return ruta === carpeta || ruta.startsWith(`${carpeta}/`);
}

/** Adónde va `ruta` si `de` pasa a llamarse `a` (un archivo, o una carpeta con todo lo de dentro). */
export function moverRuta(ruta: string, de: string, a: string): string {
  return estaDentro(ruta, de) ? a + ruta.slice(de.length) : ruta;
}

/** La página que guarda una ruta: `null` la portada, el slug, o `undefined` si no es una página. */
export function paginaDe(ruta: string): string | null | undefined {
  if (ruta === "/index.html") return null;
  const m = /^\/([^/]+)\/index\.html$/.exec(ruta);
  return m ? m[1]! : undefined;
}

/**
 * ARRASTRAR Y SOLTAR en el árbol: adónde va `arrastrada` si se suelta en
 * `carpeta` (`""` es la raíz), o `null` si no hay nada que mover — ya está ahí,
 * o es una carpeta que se soltaría dentro de sí misma.
 */
export function destinoAlSoltar(arrastrada: string, carpeta: string): string | null {
  if (carpetaDe(arrastrada) === carpeta) return null;
  if (carpeta !== "" && estaDentro(carpeta, arrastrada)) return null;
  return rutaDentro(carpeta, arrastrada.slice(arrastrada.lastIndexOf("/") + 1));
}
