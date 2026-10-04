// Los errores de /rest/v1, con la forma y los estados de PostgREST
// (src/library/PostgREST/Error.hs, v16.4): el cuerpo es siempre
// `{code, details, hint, message}`, y el estado de un error de Postgres sale de
// su SQLSTATE con `mapSQLtoHTTP`, copiada aquí línea a línea.

export interface PostgrestErrorBody {
  readonly code: string;
  readonly message: string;
  readonly details: string | null;
  readonly hint: string | null;
}

export class PostgrestError extends Error {
  constructor(
    readonly status: number,
    readonly body: PostgrestErrorBody,
    readonly headers: Record<string, string> = {},
  ) {
    super(body.message);
  }

  get code(): string {
    return this.body.code;
  }
}

/** `mapSQLtoHTTP`: el estado HTTP de un SQLSTATE. `authed` = la petición
 *  llevaba un JWT (no es `anon`): un 42501 es entonces 403, si no 401. */
export function statusForSqlState(code: string, message: string, authed: boolean): number {
  const two = code.slice(0, 2);
  if (two === "08") return 503;
  if (two === "09") return 500;
  if (two === "0L" || two === "0P") return 403;
  if (code === "23503" || code === "23505") return 409;
  if (code === "25006") return 405;
  if (code === "21000") return message.endsWith("requires a WHERE clause") ? 400 : 500;
  if (code === "22023") return message.startsWith("role") && message.endsWith("does not exist") ? 401 : 400;
  if (two === "25") return 500;
  if (two === "28") return 403;
  if (two === "2D" || two === "38" || two === "39" || two === "3B" || two === "40") return 500;
  if (code === "53400") return 500;
  if (two === "53") return 503;
  if (two === "54" || two === "55") return 500;
  if (code === "57P01") return 503;
  if (two === "57" || two === "58" || two === "F0" || two === "HV") return 500;
  if (code === "P0001") return 400;
  if (two === "P0" || two === "XX") return 500;
  if (code === "42883") return message.startsWith("function xmlagg(") ? 406 : 404;
  if (code === "42P01") return 404;
  if (code === "42P17") return 500;
  if (code === "42501") return authed ? 403 : 401;
  if (two === "PT") {
    const n = Number.parseInt(code.slice(2), 10);
    return Number.isFinite(n) && n >= 100 && n <= 599 ? n : 500;
  }
  return 400;
}

/** Un error de Postgres (de `pg` o de PGlite: los dos traen `code`, `message`,
 *  `detail` y `hint`) en la respuesta de PostgREST. */
export function fromPgError(err: unknown, authed: boolean): PostgrestError {
  const e = err as { code?: string; message?: string; detail?: string | null; hint?: string | null };
  if (typeof e?.code !== "string") {
    return new PostgrestError(500, { code: "PGRSTX00", message: String(e?.message ?? err), details: null, hint: null });
  }
  const message = e.message ?? "";
  // `RAISE SQLSTATE 'PGRST'`: el cuerpo y el estado los decide la función.
  if (e.code === "PGRST") return fromRaisePgrst(message, e.detail ?? null);
  const status = statusForSqlState(e.code, message, authed);
  return new PostgrestError(
    status,
    { code: e.code, message, details: e.detail ?? null, hint: e.hint ?? null },
    status === 401 ? { "WWW-Authenticate": "Bearer" } : {},
  );
}

function fromRaisePgrst(message: string, detail: string | null): PostgrestError {
  try {
    const m = JSON.parse(message) as { code: string; message: string; details?: string; hint?: string };
    if (detail === null) throw new Error("no detail");
    const d = JSON.parse(detail) as { status: number; headers?: Record<string, string> };
    return new PostgrestError(
      d.status,
      { code: m.code, message: m.message, details: m.details ?? null, hint: m.hint ?? null },
      d.headers ?? {},
    );
  } catch {
    return new PostgrestError(500, {
      code: "PGRST121",
      message: `Could not parse JSON in the "RAISE SQLSTATE 'PGRST'" error`,
      details: detail === null ? "DETAIL is missing in the RAISE statement" : `Invalid JSON value for MESSAGE: '${message}'`,
      hint: "MESSAGE must be a JSON object with obligatory keys: 'code', 'message' and optional keys: 'details', 'hint'.",
    });
  }
}
