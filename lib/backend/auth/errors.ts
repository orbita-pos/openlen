// Los errores de /auth/v1, como GoTrue (internal/api/errors.go,
// HandleResponseError): con `X-Supabase-Api-Version: 2024-01-01` —auth-js lo
// manda siempre— el cuerpo es `{code: "<error_code>", message}` y la cabecera
// vuelve; sin ella, el formato inicial `{code: <estado>, error_code, msg}`.
// La contraseña débil lleva además `weak_password: {reasons}`.

export class AuthError extends Error {
  constructor(
    readonly status: number,
    readonly errorCode: string,
    message: string,
    readonly weakPasswordReasons?: readonly string[],
  ) {
    super(message);
  }
}

/** Los errores OAuth (`{error, error_description}`), p. ej. un refresh sin token. */
export class OAuthError extends Error {
  constructor(
    readonly error: string,
    readonly description: string,
  ) {
    super(description);
  }
}

const API_VERSION_HEADER = "x-supabase-api-version";
const API_VERSION_2024 = "2024-01-01";

function usesApiVersion2024(req: Request): boolean {
  const v = req.headers.get(API_VERSION_HEADER);
  return v !== null && /^\d{4}-\d{2}-\d{2}$/.test(v) && v >= API_VERSION_2024;
}

export function authErrorResponse(err: AuthError | OAuthError, req: Request): Response {
  const headers: Record<string, string> = { "content-type": "application/json; charset=utf-8" };
  if (err instanceof OAuthError) {
    return new Response(JSON.stringify({ error: err.error, error_description: err.description }), { status: 400, headers });
  }
  let body: Record<string, unknown>;
  if (usesApiVersion2024(req)) {
    headers["X-Supabase-Api-Version"] = API_VERSION_2024;
    body = { code: err.errorCode, message: err.message };
  } else {
    headers["x-sb-error-code"] = err.errorCode;
    body = { code: err.status, error_code: err.errorCode, msg: err.message };
  }
  if (err.weakPasswordReasons) body.weak_password = { reasons: err.weakPasswordReasons };
  return new Response(JSON.stringify(body), { status: err.status, headers });
}

export const badRequest = (code: string, message: string) => new AuthError(400, code, message);
export const forbidden = (code: string, message: string) => new AuthError(403, code, message);
export const unprocessable = (code: string, message: string) => new AuthError(422, code, message);
