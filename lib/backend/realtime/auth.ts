// La puerta del socket de Realtime y lo que dura un canal, como Supabase
// Realtime (supabase/realtime @ f86df8c3, Apache-2.0): `RealtimeWeb.UserSocket`
// (`connect` + `handle_error`), `ChannelsAuthorization.authorize_conn` y el
// `confirm_token` de `RealtimeChannel`. Sus textos, copiados.
//
// Lo nuestro: las claves `sb_publishable_…`/`sb_secret_…`. En Supabase las
// traduce su pasarela antes de llegar a Realtime; aquí, como en /rest/v1 y
// /storage/v1, la publicable es `anon` y la secreta `service_role`. No caducan.

import { decodeJwt, decodeProtectedHeader } from "jose";

import { hashSecretKey, verifyJwt } from "../keys";

export interface RealtimeKeys {
  readonly publishableKey: string;
  readonly secretKeyHash: string;
  readonly jwtSecret: string;
}

export type SocketAuth =
  | { readonly ok: true; readonly claims: Record<string, unknown> }
  | { readonly ok: false; readonly status: number; readonly error: string };

/** Su `@confirm_token_ms_max_interval`. */
const CONFIRM_MAX_MS = 60 * 60 * 1000;

type Verified =
  | { ok: true; claims: Record<string, unknown> }
  | { ok: false; reason: "missing_api_key" | "token_malformed" | "signature_error" | "missing_claims" | "expired_token"; message: string };

/** `sb_…` → sus claims; un JWT → `authorize_conn`. */
async function verify(token: string | null | undefined, keys: RealtimeKeys): Promise<Verified> {
  if (typeof token !== "string" || token === "") return { ok: false, reason: "missing_api_key", message: "API key is missing" };
  // Su `clean_token`: sin espacios ni saltos (y decodificado de URL).
  let clean = token;
  try {
    clean = decodeURIComponent(token);
  } catch {
    // tal cual
  }
  clean = clean.replace(/\s/g, "");
  if (clean === keys.publishableKey) return { ok: true, claims: { role: "anon" } };
  if (clean.startsWith("sb_secret_") && hashSecretKey(clean) === keys.secretKeyHash) return { ok: true, claims: { role: "service_role" } };

  let claims: Record<string, unknown>;
  try {
    decodeProtectedHeader(clean);
    claims = decodeJwt(clean) as Record<string, unknown>;
  } catch {
    return { ok: false, reason: "token_malformed", message: "The token provided is not a valid JWT" };
  }
  const r = await verifyJwt(keys.jwtSecret, clean);
  if (!r.ok) {
    if (r.reason === "expired") {
      const exp = typeof claims.exp === "number" ? claims.exp : 0;
      return { ok: false, reason: "expired_token", message: `Token has expired ${Math.floor(Date.now() / 1000) - exp} seconds ago` };
    }
    if (r.reason === "bad_signature") return { ok: false, reason: "signature_error", message: "Failed to validate JWT signature" };
    return { ok: false, reason: "token_malformed", message: "The token provided is not a valid JWT" };
  }
  if (!("role" in r.claims) || !("exp" in r.claims)) {
    return { ok: false, reason: "missing_claims", message: "Fields `role` and `exp` are required in JWT" };
  }
  return { ok: true, claims: r.claims };
}

/** Su `error_response` (la respuesta HTTP del apretón que no entra). */
const HANDSHAKE_ERROR: Record<Exclude<Verified, { ok: true }>["reason"], string> = {
  missing_api_key: "API key is missing",
  expired_token: "Token has expired",
  missing_claims: "Fields `role` and `exp` are required in JWT",
  token_malformed: "The token provided is not a valid JWT",
  signature_error: "Failed to validate JWT signature",
};

/** El `apikey` del socket (su `connect`). */
export async function authorizeSocket(apikey: string | null | undefined, keys: RealtimeKeys): Promise<SocketAuth> {
  const v = await verify(apikey, keys);
  if (v.ok) return { ok: true, claims: v.claims };
  return { ok: false, status: 401, error: HANDSHAKE_ERROR[v.reason] };
}

export type Confirmed =
  | { readonly ok: true; readonly claims: Record<string, unknown>; readonly msUntilRecheck: number | null }
  | { readonly ok: false; readonly reason: string; readonly message: string };

/** El token de un canal (su `confirm_token`): sus claims y cuándo volver a
 *  mirarlo (al caducar, topado en una hora; `null` para una clave `sb_`). */
export async function confirmToken(token: string | null | undefined, keys: RealtimeKeys): Promise<Confirmed> {
  const v = await verify(token, keys);
  if (!v.ok) return { ok: false, reason: v.reason, message: v.message };
  const exp = v.claims.exp;
  if (typeof exp !== "number") return { ok: true, claims: v.claims, msUntilRecheck: null };
  const left = exp * 1000 - Date.now();
  if (left <= 0) return { ok: false, reason: "expired_token", message: `Token has expired ${Math.floor(-left / 1000)} seconds ago` };
  return { ok: true, claims: v.claims, msUntilRecheck: Math.min(CONFIRM_MAX_MS, left) };
}
