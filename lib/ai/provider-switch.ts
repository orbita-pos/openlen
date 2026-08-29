/**
 * Quien escribe ESTE turno.
 *
 * Aqui vivia un conmutador de proveedor con TRES interruptores
 * —`OPENLEN_GENERATE_PROVIDER`, `OPENLEN_CHAT_PROVIDER`,
 * `OPENLEN_AGENT_PROVIDER`— y una sola regla: opt-out, la ausencia significa
 * DeepSeek y solo el literal `gemini` volvia atras. El 2026-08-28 salio Gemini
 * del repo y los tres se quedaron sin destino al que volver.
 *
 * NO se conservan apagados. Un interruptor que solo apunta a si mismo se lee
 * como una alternativa que existe, y quien lo encuentre en produccion va a
 * creer que puede tirar de el.
 *
 * Lo que SI queda es la unica pregunta que todavia tiene dos respuestas: al
 * razonador nunca se le manda una imagen, asi que un turno con pixeles lo lleva
 * Qwen. Los dos viajan por Fireworks.
 */

/** Quién escribe DE VERDAD este turno. */
export type TurnWriter = "deepseek" | "qwen";

/** Con imagen adjunta escribe Qwen —el papel con vision—; sin ella, el
 *  razonador. Sigue siendo una funcion y no un `if` suelto porque tres
 *  superficies preguntan lo mismo y la respuesta tiene que ser una. */
export function writerForTurn(hasImages: boolean): TurnWriter {
  return hasImages ? "qwen" : "deepseek";
}
