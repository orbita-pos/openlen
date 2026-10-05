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

/** Un error que el proveedor manda DENTRO del stream (`data: {"error": …}`),
 *  ya empezada la respuesta: con su estado, el de ese estado; sin él, límite si
 *  lo dice y, si no, «server» — el proveedor falló a medias, no es defecto
 *  nuestro (un 400 nuestro llega antes, como estado HTTP). */
export function codeForInBandError(error: Readonly<Record<string, unknown>>): ProviderErrorCode {
  const status = typeof error.code === "number" ? error.code : typeof error.status === "number" ? error.status : undefined;
  const byStatus = status !== undefined ? codeForHttpStatus(status) : undefined;
  if (byStatus) return byStatus;
  const text = `${typeof error.type === "string" ? error.type : ""} ${typeof error.message === "string" ? error.message : ""}`;
  return /rate.?limit|too many requests|\b429\b/i.test(text) ? "rate_limit" : "server";
}
