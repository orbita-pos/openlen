// El Agente habla el protocolo de Gemini; Fireworks habla el de OpenAI. Este
// módulo traduce, y es el único sitio donde vive esa diferencia.
//
// No son cosméticas: Gemini declara los tipos del esquema en MAYÚSCULAS
// ("OBJECT", "BOOLEAN") y empareja cada respuesta de herramienta con su llamada
// por NOMBRE y posición; el cable los quiere en minúsculas y emparejados por un
// id que Gemini nunca emitió. Un turno mal traducido no falla a medias: el
// proveedor rechaza la petición entera.

import type { Message } from "@/lib/ai-gateway";
import type { FireworksStreamMessage, FireworksStreamToolCall } from "@/lib/ai/fireworks-stream-client";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Baja a minúsculas los `type` del esquema, en toda su profundidad. */
function wireSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(wireSchema);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "type" && typeof entry === "string") out[key] = entry.toLowerCase();
    else out[key] = wireSchema(entry);
  }
  return out;
}

export function toolsForFireworks(declarations: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return declarations
    .filter((declaration) => typeof declaration.name === "string" && declaration.name.length > 0)
    .map((declaration) => ({
      type: "function",
      function: {
        name: declaration.name,
        ...(typeof declaration.description === "string" ? { description: declaration.description } : {}),
        parameters: wireSchema(declaration.parameters ?? { type: "object", properties: {} }),
      },
    }));
}

/**
 * Convierte la conversación del Agente al cable.
 *
 * El emparejamiento es por POSICIÓN dentro del par de mensajes —el loop empuja
 * las respuestas en el mismo orden en que recorrió las llamadas—, porque el
 * nombre no basta: un turno puede llamar dos veces a la misma herramienta y el
 * cable exige un id distinto para cada una.
 */
export function messagesForFireworks(messages: readonly Message[]): FireworksStreamMessage[] {
  const out: FireworksStreamMessage[] = [];
  let pending: FireworksStreamToolCall[] = [];

  messages.forEach((message, turn) => {
    if (message.functionResponses?.length) {
      message.functionResponses.forEach((response, index) => {
        const call = pending[index];
        // Sin llamada que la reclame, una respuesta de herramienta hace que el
        // proveedor rechace el turno entero. Baja a texto: el modelo pierde la
        // etiqueta, no el dato.
        if (!call) {
          out.push({ role: "user", content: `${response.name}: ${JSON.stringify(response.response)}` });
          return;
        }
        out.push({ role: "tool", content: JSON.stringify(response.response), toolCallId: call.id });
      });
      // 🔴 Y EL `content` DEL MENSAJE, QUE NO ES DECORACIÓN.
      //
      // Aquí se hacía `return` sin mirarlo, y ese olvido dejó MUERTA una función
      // entera durante un día: `medirYRedactar` mide la página recién guardada y
      // pone el aviso —con el `data-op-id` del nodo roto— justo en este campo
      // (`loop.ts`, el push del final del bucle). El puente lo tiraba, así que
      // el modelo no lo vio NUNCA.
      //
      // MEDIDO el 2026-09-06, 6 corridas pagadas sobre dos páginas rotas: las
      // seis cerraron sin tocar el defecto ni mencionarlo, y la lectura fácil
      // —«el modelo ignora el aviso»— era falsa. El aviso no llegaba.
      //
      // Va como mensaje APARTE y DESPUÉS de los `tool`, que es la forma de
      // Claude Code: sus diagnósticos nuevos son un mensaje hermano del
      // resultado, nunca parte de su payload. Y sólo si hay algo que decir: el
      // bucle empuja `content: ""` en cada tanda, y un mensaje vacío por tanda
      // sería ruido en todos los turnos del producto.
      if (message.content) out.push({ role: "user", content: message.content });
      pending = [];
      return;
    }
    if (message.role === "assistant" && message.functionCalls?.length) {
      const calls = message.functionCalls.map((call, index) => ({
        id: `call_${turn}_${index}`,
        name: call.name,
        argumentsJson: JSON.stringify(call.args ?? {}),
      }));
      pending = calls;
      out.push({ role: "assistant", content: message.content, toolCalls: calls });
      return;
    }
    pending = [];
    out.push({ role: message.role, content: message.content });
  });

  return out;
}
