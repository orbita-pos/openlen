/**
 * QUÉ LLAMADAS PUEDEN CORRER A LA VEZ — pieza 4 de Len 2.5, como el arnés de
 * DeepSeek (`deepseek-harness` @ 5badb15, MIT, LICENSES/deepseek-harness.MIT.txt:
 * `.agents/notes/implemented/feature/2026-07-10-parallel-tool-call-execution.md`).
 *
 * Cada herramienta puede declarar un clasificador UNARIO, síncrono y puro: mira
 * sólo los argumentos de ESA llamada, sin E/S ni estado. Sólo un `true`
 * explícito cuenta; lo desconocido, lo que lanza o cualquier otro valor deja la
 * llamada EXCLUSIVA. Devolver `true` es la promesa de la herramienta de que esa
 * llamada puede solaparse con cualquier otra que también devuelva `true`: el
 * planificador no compara llamadas entre sí (`lib/agent/tool-scheduler.ts`).
 */

/** `DEFAULT_MAX_PARALLEL_TOOL_CALLS` de DeepSeek
 *  (`packages/core/agent-loop/src/constants.ts` @ 5badb15). 1 = en serie. */
export const DEFAULT_MAX_PARALLEL_TOOL_CALLS = 10;

type Classifier = (args: Record<string, unknown>) => boolean;

const always: Classifier = () => true;

/** `usar_pagina` escribe en la base REAL de la página cuando un clic manda un
 *  formulario o dispara su JavaScript, y una visita con sesión abre una en el
 *  backend: dos así a la vez se pisan. De un clic no se puede saber de antemano
 *  si escribe, así que cualquier `pulsa` la deja exclusiva (§11 de la
 *  investigación). Escribir en un campo o elegir una opción no manda nada. */
const visitWithoutClicks: Classifier = (args) => {
  if (args.sign_in_as !== undefined && typeof args.sign_in_as !== "string") return false;
  if (typeof args.sign_in_as === "string" && args.sign_in_as.trim()) return false;
  const pasos = args.pasos;
  if (!Array.isArray(pasos) || pasos.length === 0) return false;
  return pasos.every((p) => typeof p === "object" && p !== null && !("pulsa" in p));
};

/** Las declaraciones, conservadoras como las de DeepSeek: lectura de ficheros,
 *  búsqueda y lectura web, y lo que sólo lee del proyecto (visitas, formularios,
 *  mensajes, mirar la página). Los nombres web son `NOMBRE_WEB_SEARCH` y
 *  `NOMBRE_WEB_FETCH` (la prueba lo sujeta). `elegir_foto` NO: su cuenta de
 *  búsquedas vacías seguidas depende del orden. */
const CLASSIFIERS: Readonly<Record<string, Classifier>> = {
  Read: always,
  Grep: always,
  Glob: always,
  web_search: always,
  web_fetch: always,
  ver_visitas: always,
  ver_formularios: always,
  ver_mensajes: always,
  mirar_pagina: always,
  usar_pagina: visitWithoutClicks,
  // Pieza 5: como DeepSeek, leer un evento es seguro; las dos búsquedas no.
  session_event_read: always,
};

export function isConcurrencySafe(name: string, args: Record<string, unknown>): boolean {
  const classify = Object.hasOwn(CLASSIFIERS, name) ? CLASSIFIERS[name] : undefined;
  if (!classify) return false;
  try {
    return classify(args) === true;
  } catch {
    return false;
  }
}
