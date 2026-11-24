// GOOGLE'S OFFLINE ACCESS (spec local 2026-11-24-servidor-de-google-calendar, §5.2). Google gives a web client a refresh
// token only when the sign-in asks for offline access, and only on a consent screen: the first one, or one forced with
// `prompt=consent`. The connector can't tell which sign-in is a person's first, so every Google sign-in asks. Without it
// the connection lapses an hour later. Pure, so `flow.ts` (no imports of its own needed) and `store.ts` both use it.
import type { StoredOAuthTokens } from "@modelcontextprotocol/client";

import { GOOGLE_ISSUER } from "../directory-entries";

/** On a Google authorization URL, asks for offline access on a consent screen; any other issuer's URL is left alone. */
export function withGoogleOfflineAccess(url: URL, issuer: string): void {
  if (issuer !== GOOGLE_ISSUER) return;
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
}

/** The tokens to save: `next`, keeping the refresh token saved before when `next` brings none (a refresh, or a sign-in
 *  Google answered without one). */
export function withKeptRefreshToken(previous: StoredOAuthTokens | null, next: StoredOAuthTokens): StoredOAuthTokens {
  if (next.refresh_token || !previous?.refresh_token) return next;
  return { ...next, refresh_token: previous.refresh_token };
}
