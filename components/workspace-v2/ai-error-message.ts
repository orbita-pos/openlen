// El mensaje del upstream es para NOSOTROS, no para el usuario: a quien no
// programa, "upstream API returned HTTP 503: {"error":{"code":503…}}" no le
// dice qué pasó ni qué hacer — y encima suena a que OpenLen se rompió cuando
// el que está saturado es el proveedor. Clasificamos la causa a un mensaje
// accionable; el original se sigue logueando para depurar.

export type AiErrorReason = "saturated" | "quota" | "timeout" | "unknown";

export function classifyAiError(raw: string | null | undefined): AiErrorReason {
  const m = (raw ?? "").toLowerCase();
  if (!m) return "unknown";
  if (
    m.includes("503") ||
    m.includes("unavailable") ||
    m.includes("high demand") ||
    m.includes("overloaded")
  ) {
    return "saturated";
  }
  // 429 llega como cuota agotada o como límite por minuto — para el usuario es
  // la misma acción (esperar), así que un solo mensaje.
  if (
    m.includes("429") ||
    m.includes("quota") ||
    m.includes("rate limit") ||
    m.includes("rate-limit") ||
    m.includes("resource_exhausted")
  ) {
    return "quota";
  }
  if (
    m.includes("timeout") ||
    m.includes("timed out") ||
    m.includes("etimedout") ||
    m.includes("deadline")
  ) {
    return "timeout";
  }
  return "unknown";
}
