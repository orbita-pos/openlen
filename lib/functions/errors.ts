// lib/functions/errors.ts — LOS ERRORES DE LA PUERTA, como los da Supabase (spec
// local 2026-10-11, Parte 3): su código en la cabecera `sb-error-code` y en el
// JSON, con su estado. Los textos de NOT_FOUND y WORKER_RESOURCE_LIMIT son los
// de su documentación; los que no documenta, en su mismo estilo. CORS abierto:
// sin él, la página no podría leer por qué falló. Puro.

export type FunctionsErrorCode =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "UNAUTHORIZED_NO_AUTH_HEADER"
  | "UNAUTHORIZED_INVALID_JWT_FORMAT"
  | "UNAUTHORIZED_LEGACY_JWT"
  | "WORKER_ERROR"
  | "BOOT_ERROR"
  | "IDLE_TIMEOUT"
  | "WORKER_RESOURCE_LIMIT"
  | "REQUEST_TOO_LARGE"
  | "RATE_LIMIT_EXCEEDED"
  | "QUOTA_EXCEEDED"
  | "FUNCTIONS_UNAVAILABLE";

const ERRORES: Record<FunctionsErrorCode, readonly [number, string]> = {
  NOT_FOUND: [404, "Requested function was not found"],
  FORBIDDEN: [403, "This canvas does not belong to this project."],
  UNAUTHORIZED_NO_AUTH_HEADER: [401, "Missing authorization header"],
  UNAUTHORIZED_INVALID_JWT_FORMAT: [401, "Invalid JWT format"],
  UNAUTHORIZED_LEGACY_JWT: [401, "Invalid JWT"],
  WORKER_ERROR: [500, "Function exited due to an error (please check logs)"],
  BOOT_ERROR: [503, "Function failed to start (please check logs)"],
  IDLE_TIMEOUT: [504, "Function did not respond in time"],
  WORKER_RESOURCE_LIMIT: [546, "Function failed due to not having enough compute resources (please check logs)"],
  REQUEST_TOO_LARGE: [413, "The request body is larger than 4 MB"],
  RATE_LIMIT_EXCEEDED: [429, "Too many concurrent calls to this project's Edge Functions"],
  QUOTA_EXCEEDED: [429, "This project has used its Edge Function calls for this month"],
  FUNCTIONS_UNAVAILABLE: [503, "Edge Functions are not available on this server"],
};

export function statusOf(code: FunctionsErrorCode): number {
  return ERRORES[code][0];
}

export function functionsError(code: FunctionsErrorCode, o: { readonly message?: string } = {}): Response {
  return new Response(JSON.stringify({ code, message: o.message ?? ERRORES[code][1] }), {
    status: ERRORES[code][0],
    headers: {
      "content-type": "application/json; charset=utf-8",
      "sb-error-code": code,
      "access-control-allow-origin": "*",
      "access-control-expose-headers": "sb-error-code",
    },
  });
}
