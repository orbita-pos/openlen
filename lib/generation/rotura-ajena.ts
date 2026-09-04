// lib/generation/rotura-ajena.ts — separar lo que rompió el MODELO de lo que
// rompió la RED.
//
// POR QUÉ EXISTE, con la avería que lo pidió (2026-09-04). El prompt repartía
// las librerías con `integrity` + `crossorigin="anonymous"` y el origen que las
// sirve no mandaba `Access-Control-Allow-Origin`, así que el navegador
// bloqueaba el fichero. La página gritaba tres cosas:
//
//   Access to script at 'https://libs.openlen.com/chart.js/…' has been blocked
//     by CORS policy: No 'Access-Control-Allow-Origin' header…
//   Failed to load resource: net::ERR_FAILED
//   Chart is not defined
//
// Las tres entraban como «el JavaScript de la página falla», o sea como rotura
// medida, y ahí la tubería de crear hacía exactamente lo que debe con un
// defecto que cree del modelo: reparar → no baja → descartar → **reescribir la
// página entera**. Cuatro veces seguidas, ninguna entregada, y al final
// `Generation failed`. La avería estaba en una cabecera HTTP.
//
// LA REGLA, en una frase: **al modelo sólo se le cobra lo que el modelo puede
// arreglar.** Un fichero que no baja no lo arregla reescribiendo la página —
// ni él ni nadie desde dentro del documento. Gastarle una reescritura por eso
// es cobrarle al usuario nuestra avería.
//
// ⚠️ AJENA NO ES INVISIBLE. Estos gritos NO se tiran: salen por otro canal
// (`roturaDeRed`), se registran y se cuentan en la etapa de medición. Un fallo
// que sólo deja de disparar una acción y además deja de oírse es la degradación
// silenciosa que este repo persigue — ver la doctrina de degradación.

import { LIBRERIAS } from "@/lib/librerias";

/**
 * Un fichero que el navegador no pudo bajar o no pudo ejecutar por CÓMO se
 * pidió. Deliberadamente NO incluye las negativas de la CSP: «Refused to load
 * the script 'https://cdn.jsdelivr.net/…'» sí es del modelo —usó un CDN que no
 * sobrevive— y ésa sí se arregla reescribiendo.
 */
// ⚓ ANCLADAS AL PRINCIPIO, salvo una, y no por gusto: un script del modelo que
// hace `console.error("... failed to load resource ...")` está HABLANDO, no
// fallando la red, y callarlo convertiría este filtro en un silenciador. Es la
// invariante que ya sujetaba `lib/ai/inline-image.test.ts` y que este módulo
// heredó al quedarse con la lista.
const CARGA_FALLIDA: readonly RegExp[] = [
  // Chromium. La forma completa es «Access to script at 'URL' from origin 'X'
  // has been blocked by CORS policy: …», y también sale con `fetch` y
  // `XMLHttpRequest` en vez de `script`.
  /^Access to \S.*has been blocked by CORS policy/i,
  /^Failed to load resource/i,
  // Firefox, para el mismo caso que el `Failed to load resource` de Chromium.
  /^Loading failed for the <script>/i,
  // SRI que no cuadra: los bytes servidos no son los que promete la etiqueta.
  // También nuestro, no suyo — el catálogo pone el hash, no el modelo.
  /^Failed to find a valid digest in the 'integrity' attribute/i,
  // La única SIN anclar: `net::ERR_CONNECTION_REFUSED` va detrás del método y
  // la URL («GET https://… net::ERR_FAILED»), así que no hay principio al que
  // agarrarse. Se permite porque el token es del propio Chromium y nadie lo
  // escribe por casualidad en un mensaje suyo.
  /net::ERR_[A-Z_]+/,
];

/** Los nombres que sólo existen porque una librería NUESTRA se cargó. */
const NOMBRES_DE_LIBRERIA: readonly string[] = LIBRERIAS.flatMap((l) => [
  l.global.toLowerCase(),
  // `chart.js` deja `Chart`; el id sin la extensión cubre el resto de formas
  // (`photoswipe` es el global del núcleo, que el catálogo no declara porque
  // el que se nombra es el del lightbox).
  l.id.replace(/\.js$/i, "").toLowerCase(),
]);

/**
 * ¿Es este grito un fichero que no bajó, en vez de código que reventó?
 *
 * Suelto porque hay un sitio que juzga los gritos DE UNO EN UNO según llegan
 * —el escucha de consola de `lib/ai/inline-image.ts`— y ahí no hay tanda sobre
 * la que razonar. La regla colateral (el «no está definido» que viene detrás)
 * necesita la tanda entera y vive en `partirGritos`.
 */
export function esCargaFallida(grito: string): boolean {
  return CARGA_FALLIDA.some((r) => r.test(grito));
}

/** El identificador de un `ReferenceError`, o `null` si el grito no lo es. */
function nombreNoDefinido(grito: string): string | null {
  const m =
    /\b([A-Za-z_$][A-Za-z0-9_$]*) is not defined\b/.exec(grito) ??
    /Can't find variable:\s*([A-Za-z_$][A-Za-z0-9_$]*)/.exec(grito) ??
    // Safari/WebKit, mismo fallo con otras palabras.
    /\b([A-Za-z_$][A-Za-z0-9_$]*) is not a function\b.*undefined/.exec(grito);
  return m ? (m[1] ?? null) : null;
}

export interface GritosPartidos {
  /** Lo que el modelo escribió mal. Es lo único que justifica gastarle una
   *  reparación o una reescritura. */
  readonly propios: readonly string[];
  /** Lo que se cayó por debajo: un fichero que no bajó, y el «no está
   *  definido» que viene detrás. Se informa; no se le cobra a nadie. */
  readonly ajenos: readonly string[];
}

/**
 * Parte los gritos del render en los del modelo y los de la red.
 *
 * EL SEGUNDO PASO ES EL QUE IMPORTA. Filtrar sólo el mensaje de CORS no arregla
 * nada: el que dispara la reescritura es el `Chart is not defined` que viene
 * detrás, y ése tiene toda la pinta de código roto. Así que un `X is not
 * defined` cuenta como AJENO cuando (a) en la misma carga hubo un fallo de
 * descarga y (b) `X` es el nombre de una librería del catálogo. Las dos
 * condiciones: sin la primera, un typo del modelo sobre `Chart` dejaría de
 * verse; sin la segunda, un typo cualquiera se colaría detrás de una imagen 404.
 */
export function partirGritos(
  gritos: readonly string[] | null | undefined,
): GritosPartidos {
  const todos = gritos ?? [];
  if (todos.length === 0) return { propios: [], ajenos: [] };

  const huboFalloDeCarga = todos.some(esCargaFallida);
  const propios: string[] = [];
  const ajenos: string[] = [];

  for (const grito of todos) {
    if (esCargaFallida(grito)) {
      ajenos.push(grito);
      continue;
    }
    const nombre = huboFalloDeCarga ? nombreNoDefinido(grito) : null;
    if (nombre !== null && NOMBRES_DE_LIBRERIA.includes(nombre.toLowerCase())) {
      ajenos.push(grito);
      continue;
    }
    propios.push(grito);
  }

  return { propios, ajenos };
}
