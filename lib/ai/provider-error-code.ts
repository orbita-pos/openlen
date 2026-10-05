// LOS FALLOS DEL PROVEEDOR QUE EL BUCLE SABE REINTENTAR, con los nombres del
// arnés de DeepSeek (`packages/llm/llm/src/retry-policy.ts`: RATE_LIMIT,
// SERVER, TRANSPORT, EMPTY_RESPONSE). El cliente los pone; el bucle del agente
// decide (`lib/agent/retry-policy.ts`). Un fallo SIN código —un 400, una clave
// mala— es un defecto nuestro y no se repite: repetirlo sólo cuesta.
//
// `context_window_exceeded` (CONTEXT_WINDOW_EXCEEDED de DeepSeek) NO se
// reintenta así: lo recupera la compactación (`lib/agent/compaction/`), que
// resume lo más viejo y repite el paso UNA vez.
export type ProviderErrorCode = "rate_limit" | "server" | "transport" | "empty_response" | "context_window_exceeded";

export function codeForHttpStatus(status: number): ProviderErrorCode | undefined {
  if (status === 429) return "rate_limit";
  if (status >= 500 && status <= 599) return "server";
  return undefined;
}

// ─── EL DESBORDE DE CONTEXTO, reconocido por el TEXTO ──────────────────────
//
// Copiado TAL CUAL de `isContextWindowExceededError` del arnés de DeepSeek
// (`packages/llm/llm/src/error.ts` @ 5badb15, MIT, © 2026 DeepSeek —
// LICENSES/deepseek-harness.MIT.txt): las frases de los proveedores
// compatibles con OpenAI (vLLM, Fireworks…) y sus códigos. Es estricto a
// propósito: «maximum … tokens» de un `max_tokens` inválido NO es un desborde.

/** Structured codes and plain phrases that explicitly name a context bound being exceeded. */
const STRUCTURED_CONTEXT_OVERFLOW = new RegExp(
  String.raw`(?:^|[^a-z0-9])context[\s_-](?:length|window)[\s_-]`
  + String.raw`(?:exceed(?:ed|s)?|overflow(?:ed)?|limit[\s_-]exceeded)(?:$|[^a-z0-9])`,
  "i",
);

/** Request-size wording that ties "too large" directly to model context capacity. */
const TOO_LARGE_FOR_CONTEXT = new RegExp(
  String.raw`\b(?:request|prompt|input|messages?)\s+(?:is\s+|are\s+)?`
  + String.raw`too\s+(?:large|long)\s+for\s+(?:(?:this|the)\s+)?`
  + String.raw`(?:model(?:'s)?\s+)?context(?:\s+window)?\b`,
  "i",
);

/** "Exceeds" wording is safe only when its object is explicitly the model context. */
const EXCEEDS_MODEL_CONTEXT = new RegExp(
  String.raw`\b(?:input|prompt|request|messages?)\b.{0,40}`
  + String.raw`\b(?:exceed(?:s|ed)?|overflows?|is\s+larger\s+than)\b.{0,40}`
  + String.raw`\b(?:the\s+)?(?:model(?:'s)?\s+)?context(?:\s+(?:length|window))?\b`,
  "i",
);

export function isContextWindowExceededError(detail: string): boolean {
  return STRUCTURED_CONTEXT_OVERFLOW.test(detail)
    || /\b(?:maximum|max)(?:\s+(?:allowed|supported))?\s+context\s+(?:length|window)\b/i.test(detail)
    || TOO_LARGE_FOR_CONTEXT.test(detail)
    || /\b(?:input|prompt|request)\s+(?:is\s+)?too\s+(?:long|large)\s+for\s+(?:this|the)\s+model\b/i.test(detail)
    || EXCEEDS_MODEL_CONTEXT.test(detail);
}

/** El código de una respuesta HTTP de error, con su cuerpo. En el orden de
 *  `providerError` de DeepSeek: credenciales y límite de peticiones antes que
 *  el contexto; el contexto antes que «petición inválida» y que el servidor. */
export function codeForProviderError(status: number, body: string): ProviderErrorCode | undefined {
  if (status !== 401 && status !== 403 && status !== 429 && isContextWindowExceededError(body)) return "context_window_exceeded";
  return codeForHttpStatus(status);
}

/** Un error que el proveedor manda DENTRO del stream (`data: {"error": …}`),
 *  ya empezada la respuesta: con su estado, el de ese estado — y un 4xx que no
 *  es 429 es defecto nuestro y NO se reintenta, como el mismo estado por HTTP —;
 *  sin estado, límite si lo dice y, si no, «server»: el proveedor falló a
 *  medias. */
export function codeForInBandError(error: Readonly<Record<string, unknown>>): ProviderErrorCode | undefined {
  const status = typeof error.code === "number" ? error.code : typeof error.status === "number" ? error.status : undefined;
  // El texto con los campos que lee DeepSeek (`providerErrorDetail`): tipo,
  // código si es texto, y mensaje.
  const text = [error.type, error.code, error.message].filter((v): v is string => typeof v === "string").join(" ");
  if (status !== undefined) return codeForProviderError(status, text);
  if (/rate.?limit|too many requests|\b429\b/i.test(text)) return "rate_limit";
  return isContextWindowExceededError(text) ? "context_window_exceeded" : "server";
}
