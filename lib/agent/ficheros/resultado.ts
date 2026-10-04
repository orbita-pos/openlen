/**
 * LO QUE UNA HERRAMIENTA DE FICHEROS LE DEVUELVE AL MODELO: texto, tal cual.
 *
 * Claude Code no contesta con un objeto: su `tool_result` es el texto que el
 * modelo lee (el `cat -n`, «Edited …», o el
 * error envuelto en `<tool_use_error>`). Si pasara por el `JSON.stringify` que
 * lleva el resto de nuestras herramientas, el modelo recibiría el HTML con cada
 * salto de línea escapado — otra cosa de por medio.
 *
 * `texto` es ese `tool_result`. `error` es el mismo mensaje sin envolver, para
 * lo que ya lee el bucle (`ok`) y el diario del turno.
 */
export type Resultado =
  | { readonly ok: true; readonly texto: string; readonly error?: undefined }
  | { readonly ok: false; readonly texto: string; readonly error: string };

/** La clave con la que el texto viaja dentro de `ToolOutcome.response`; el
 *  puente la manda tal cual en vez de serializar el objeto. */
export const CLAVE_TOOL_RESULT = "tool_result";

export function exito(texto: string): Resultado {
  return { ok: true, texto };
}

/** Como Claude Code: `<tool_use_error>${mensaje}</tool_use_error>`. */
export function fallo(mensaje: string): Resultado {
  return { ok: false, texto: `<tool_use_error>${mensaje}</tool_use_error>`, error: mensaje };
}

/** Los bytes como los escribe Claude Code: «812 bytes», «256KB», «1.5MB». */
export function formatoDeBytes(bytes: number): string {
  const kb = bytes / 1024;
  if (kb < 1) return `${bytes} bytes`;
  if (kb < 1024) return `${kb.toFixed(1).replace(/\.0$/, "")}KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1).replace(/\.0$/, "")}MB`;
  return `${(mb / 1024).toFixed(1).replace(/\.0$/, "")}GB`;
}
