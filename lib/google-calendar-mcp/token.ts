// THE PERSON'S GOOGLE TOKEN, CHECKED (spec local 2026-11-24-servidor-de-google-calendar, §5.2). The connector sends the
// person's Google access token; the server keeps nothing of its own. Before using it, Google's tokeninfo says whom it was
// issued to (only OpenLen's client: the server is no open relay for any Google token), whether it is still alive and
// which scopes it carries. A token is never logged or echoed: the cache is keyed by its SHA-256.
import { createHash } from "node:crypto";

import type { AuthInfo } from "@modelcontextprotocol/server";

import { GCAL_SCOPES } from "./config";

/** 401: Google says the token is no good. 503: Google couldn't say (tokeninfo unreachable, 5xx, 429) — not a sign-in. */
export type TokenCheck =
  | { ok: true; authInfo: AuthInfo }
  | { ok: false; status: 401 }
  | { ok: false; status: 403; missing: string[] }
  | { ok: false; status: 503 };

export interface TokenDeps {
  readonly clientId: string;
  readonly fetch: typeof fetch;
  /** Milliseconds since the epoch. */
  readonly now: () => number;
}

const TOKENINFO = "https://oauth2.googleapis.com/tokeninfo";
const CACHE_MAX = 5_000;
const cache = new Map<string, { readonly authInfo: AuthInfo; readonly expiresAtMs: number }>();

/** For tests: forget every checked token. */
export function resetTokenCache(): void {
  cache.clear();
}

const keyOf = (token: string) => createHash("sha256").update(token).digest("hex");

/** Google refused this token in a call (revoked, or dead before its `exp`): the next request asks tokeninfo again. */
export function forgetGoogleToken(token: string): void {
  cache.delete(keyOf(token.trim()));
}

export async function checkGoogleToken(bearer: string | undefined, d: TokenDeps): Promise<TokenCheck> {
  const token = bearer?.trim();
  if (!token) return { ok: false, status: 401 };
  const key = keyOf(token);
  const now = d.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAtMs > now) return scopesOf(hit.authInfo);
  if (hit) cache.delete(key);

  // Only tokeninfo's verdict on the token is a 401. Anything else means Google couldn't say: a 503 the connector retries,
  // never a 401 that would park the person in «sign in again». Either way the request is refused.
  let info: Record<string, unknown>;
  try {
    const res = await d.fetch(`${TOKENINFO}?access_token=${encodeURIComponent(token)}`);
    if (res.status === 400 || res.status === 401) return { ok: false, status: 401 };
    if (!res.ok) return { ok: false, status: 503 };
    const body: unknown = await res.json();
    if (body === null || typeof body !== "object") return { ok: false, status: 503 };
    info = body as Record<string, unknown>;
  } catch {
    return { ok: false, status: 503 };
  }

  if (info.azp !== d.clientId && info.aud !== d.clientId) return { ok: false, status: 401 };
  const expSeconds = Number(info.exp);
  if (!Number.isFinite(expSeconds) || expSeconds * 1000 <= now) return { ok: false, status: 401 };
  const scopes = typeof info.scope === "string" ? info.scope.split(/\s+/).filter(Boolean) : [];
  const authInfo: AuthInfo = { token, clientId: d.clientId, scopes, expiresAt: expSeconds };

  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { authInfo, expiresAtMs: expSeconds * 1000 });
  return scopesOf(authInfo);
}

function scopesOf(authInfo: AuthInfo): TokenCheck {
  const missing = GCAL_SCOPES.filter((s) => !authInfo.scopes.includes(s));
  return missing.length > 0 ? { ok: false, status: 403, missing } : { ok: true, authInfo };
}
