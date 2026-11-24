// THE PERSON'S GOOGLE TOKEN, CHECKED (spec local 2026-11-24-servidor-de-google-calendar, §5.2). The connector sends the
// person's Google access token; the server keeps nothing of its own. Before using it, Google's tokeninfo says whom it was
// issued to (only OpenLen's client: the server is no open relay for any Google token), whether it is still alive and
// which scopes it carries. A token is never logged or echoed: the cache is keyed by its SHA-256.
//
// Asked the way Google's own library asks (google-auth-library's `getTokenInfo` over gaxios, which Claude Code bundles):
// a POST with the token in the Authorization header — never in a URL, where proxies and logs keep it —, retried 3 times
// on 408/429/5xx and 2 times when nothing answers, after 100 ms, 500 ms and 1.5 s. A token Google refused is remembered
// as refused for 15 minutes, the time Claude Code keeps a server's «needs authentication» before dialing it again.
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
  /** Waits between tokeninfo retries (tests pass one that doesn't). */
  readonly sleep?: (ms: number) => Promise<void>;
}

const TOKENINFO = "https://oauth2.googleapis.com/tokeninfo";
const CACHE_MAX = 5_000;
/** Claude Code's needs-auth cache TTL (its `Bm = 900000`). */
export const REFUSED_FOR_MS = 15 * 60_000;
/** gaxios: `retryDelay` 100 ms, then (2^n − 1) / 2 s. */
const RETRY_DELAYS_MS = [100, 500, 1_500] as const;
const STATUS_RETRIES = 3;
const NO_RESPONSE_RETRIES = 2;
const retriable = (status: number) => status === 408 || status === 429 || (status >= 500 && status <= 599);

type Entry = { readonly kind: "ok"; readonly authInfo: AuthInfo; readonly untilMs: number } | { readonly kind: "refused"; readonly untilMs: number };
const cache = new Map<string, Entry>();

/** For tests: forget every checked token. */
export function resetTokenCache(): void {
  cache.clear();
}

const keyOf = (token: string) => createHash("sha256").update(token).digest("hex");
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function remember(key: string, entry: Entry): void {
  if (!cache.has(key) && cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, entry);
}

/** Google refused this token in a call (revoked, or dead before its `exp`): the next request asks tokeninfo again. */
export function forgetGoogleToken(token: string): void {
  cache.delete(keyOf(token.trim()));
}

/** tokeninfo's answer, or null when nothing answered after the retries. */
async function askTokeninfo(token: string, d: TokenDeps): Promise<Response | null> {
  const sleep = d.sleep ?? wait;
  let statusRetries = 0;
  let noResponseRetries = 0;
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await d.fetch(TOKENINFO, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded;charset=UTF-8", authorization: `Bearer ${token}` },
      });
      if (!retriable(res.status) || statusRetries >= STATUS_RETRIES) return res;
      statusRetries++;
    } catch {
      if (noResponseRetries >= NO_RESPONSE_RETRIES) return null;
      noResponseRetries++;
    }
    await sleep(RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)]!);
  }
}

export async function checkGoogleToken(bearer: string | undefined, d: TokenDeps): Promise<TokenCheck> {
  const token = bearer?.trim();
  if (!token) return { ok: false, status: 401 };
  const key = keyOf(token);
  const now = d.now();
  const hit = cache.get(key);
  if (hit && hit.untilMs > now) return hit.kind === "ok" ? scopesOf(hit.authInfo) : { ok: false, status: 401 };
  if (hit) cache.delete(key);
  const refused = (): TokenCheck => {
    remember(key, { kind: "refused", untilMs: now + REFUSED_FOR_MS });
    return { ok: false, status: 401 };
  };

  // Only tokeninfo's verdict on the token is a 401. Anything else means Google couldn't say: a 503 the connector retries,
  // never a 401 that would park the person in «sign in again». Either way the request is refused.
  let info: Record<string, unknown>;
  try {
    const res = await askTokeninfo(token, d);
    if (!res) return { ok: false, status: 503 };
    if (res.status === 400 || res.status === 401) return refused();
    if (!res.ok) return { ok: false, status: 503 };
    const body: unknown = await res.json();
    if (body === null || typeof body !== "object") return { ok: false, status: 503 };
    info = body as Record<string, unknown>;
  } catch {
    return { ok: false, status: 503 };
  }

  if (info.azp !== d.clientId && info.aud !== d.clientId) return refused();
  const expSeconds = Number(info.exp);
  if (!Number.isFinite(expSeconds) || expSeconds * 1000 <= now) return refused();
  const scopes = typeof info.scope === "string" ? info.scope.split(/\s+/).filter(Boolean) : [];
  const authInfo: AuthInfo = { token, clientId: d.clientId, scopes, expiresAt: expSeconds };

  remember(key, { kind: "ok", authInfo, untilMs: expSeconds * 1000 });
  return scopesOf(authInfo);
}

function scopesOf(authInfo: AuthInfo): TokenCheck {
  const missing = GCAL_SCOPES.filter((s) => !authInfo.scopes.includes(s));
  return missing.length > 0 ? { ok: false, status: 403, missing } : { ok: true, authInfo };
}
