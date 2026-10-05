// LA CUENTA DE TOKENS de la compactación: la misma de `context.ts` (caracteres
// / 3,5 y 1.024 por foto). DeepSeek mide con los tokens REALES de la última
// llamada y estima sólo lo añadido después; el bucle hace eso mismo
// (`lastInputTokens`) y usa esto para lo nuevo y para elegir el tramo.
import type { Message } from "@/lib/ai-gateway";
import { TOKENS_POR_FOTO } from "@/lib/agent/context";

const CHARS_PER_TOKEN = 3.5;

export function estimateMessageTokens(m: Message): number {
  const chars =
    m.content.length +
    (m.reasoning?.length ?? 0) +
    (m.functionCalls ? JSON.stringify(m.functionCalls).length : 0) +
    (m.functionResponses ? JSON.stringify(m.functionResponses).length : 0);
  return Math.ceil(chars / CHARS_PER_TOKEN) + (m.images?.length ?? 0) * TOKENS_POR_FOTO;
}

export function estimateTokens(messages: readonly Message[]): number {
  return messages.reduce((total, m) => total + estimateMessageTokens(m), 0);
}
