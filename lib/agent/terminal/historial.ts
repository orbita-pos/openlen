/**
 * LOS COMANDOS DE TURNOS ANTERIORES, sacados de la transcripción guardada
 * (F6a de plans/len-agente-2026: la lente «Terminal» del lienzo).
 *
 * No hay una tabla de comandos: cada `bash` ya queda en
 * `projectChatMessages.transcript` como una llamada más (su `command` en la
 * llamada del asistente, su salida en la respuesta que sigue), que es lo que
 * dice el invariante 5 de CLAUDE.md. Aquí sólo se emparejan.
 *
 * El bucle guarda cada vuelta como un mensaje del asistente con N llamadas y,
 * justo detrás, uno del usuario con las N respuestas EN EL MISMO ORDEN
 * (`loop.ts`, `functionResponses`): se empareja por posición.
 *
 * Una salida vieja puede llegar vaciada por el microcompact
 * (`RESULTADO_VACIADO`): se enseña así, que es la verdad de lo guardado.
 *
 * Puro: lo usa la ruta y lo prueban sin base.
 */
import { NOMBRE_BASH } from "./declaracion";
import { CLAVE_CAMBIOS_DEL_COMANDO, leerCambiosDelComando, type CambiosDelComando } from "./cambios-del-comando";

/** Lo que de un mensaje guardado hace falta aquí. */
export interface MensajeConLlamadas {
  readonly role: string;
  readonly functionCalls?: readonly { readonly name: string; readonly args?: Record<string, unknown> }[];
  readonly functionResponses?: readonly { readonly name: string; readonly response?: Record<string, unknown> }[];
}

export interface ComandoDeLaTerminal {
  readonly command: string;
  /** Lo que imprimió, tal cual lo leyó el modelo. Null si la respuesta no se guardó. */
  readonly salida: string | null;
  /** Sacado de la última línea de la salida; null si no se puede leer. */
  readonly exitCode: number | null;
  /** Lo que cambió, por fichero (la #10). Ausente si no cambió nada o no se guardó. */
  readonly cambios?: CambiosDelComando;
}

/** La última línea de la salida de DeepSeek: «[Command finished with exit code N]». */
const LINEA_DE_SALIDA = /\[Command finished with exit code (-?\d+)\]/g;

export function codigoDeSalida(salida: string): number | null {
  let ultimo: number | null = null;
  for (const m of salida.matchAll(LINEA_DE_SALIDA)) ultimo = Number(m[1]);
  return ultimo;
}

function textoDeLaRespuesta(response: Record<string, unknown> | undefined): string | null {
  if (!response) return null;
  const t = response.tool_result;
  if (typeof t === "string") return t;
  return typeof response.error === "string" ? response.error : null;
}

export function comandosDeLaTranscripcion(mensajes: readonly MensajeConLlamadas[]): ComandoDeLaTerminal[] {
  const comandos: ComandoDeLaTerminal[] = [];
  for (let i = 0; i < mensajes.length; i++) {
    const llamadas = mensajes[i]!.functionCalls ?? [];
    if (llamadas.length === 0) continue;
    const siguiente = mensajes[i + 1];
    const respuestas = siguiente?.functionResponses ?? [];
    llamadas.forEach((llamada, j) => {
      if (llamada.name !== NOMBRE_BASH) return;
      const command = typeof llamada.args?.command === "string" ? llamada.args.command : "";
      if (!command) return;
      const respuesta = respuestas[j];
      const salida = respuesta?.name === NOMBRE_BASH ? textoDeLaRespuesta(respuesta.response) : null;
      const cambios = respuesta?.name === NOMBRE_BASH ? leerCambiosDelComando(respuesta.response?.[CLAVE_CAMBIOS_DEL_COMANDO]) : null;
      comandos.push({ command, salida, exitCode: salida === null ? null : codigoDeSalida(salida), ...(cambios ? { cambios } : {}) });
    });
  }
  return comandos;
}
