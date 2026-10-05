// LOS FALLOS DEL PROVEEDOR QUE EL BUCLE SABE REINTENTAR, con los nombres del
// arnés de DeepSeek (`packages/llm/llm/src/retry-policy.ts`: RATE_LIMIT,
// SERVER, TRANSPORT, EMPTY_RESPONSE). El cliente los pone; el bucle del agente
// decide (`lib/agent/retry-policy.ts`). Un fallo SIN código —un 400, una clave
// mala— es un defecto nuestro y no se repite: repetirlo sólo cuesta.
export type ProviderErrorCode = "rate_limit" | "server" | "transport" | "empty_response";

export function codeForHttpStatus(status: number): ProviderErrorCode | undefined {
  if (status === 429) return "rate_limit";
  if (status >= 500 && status <= 599) return "server";
  return undefined;
}
