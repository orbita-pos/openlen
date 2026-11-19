// WHAT A REMOTE SERVER SAYS ABOUT A SIGN-IN, KEPT IN BOUNDS (spec local 2026-11-17-oauth-de-conectores-mcp, §5.5). The
// scope of a `WWW-Authenticate` challenge and the issuer of the authorization server's metadata come from a server the
// person doesn't control, and they end up stored, in a card and in the model's tool description and context. So both pass
// through here: when they are WRITTEN (mount.ts, store.ts `markNeedsAuth`, `NeedsSignIn`) and again when they are READ
// into what the model or a card gets (turn.ts, approval.ts), because a row written by an older build is not trusted.
//
// A scope is a list of words, so this can't tell a real one from a sentence made of such words; it bounds what a server
// can slip in — one short line of the characters RFC 6749 allows in a scope token (%x21 / %x23-5B / %x5D-7E), no quote
// to close the one the description puts around it — and the description frames it as the server's own word. Pure.

/** The most characters of scope the model or a card ever gets. */
export const SCOPE_MAX = 200;
/** The longest issuer kept: a real one is a short URL. */
export const ISSUER_MAX = 200;

/** Everything RFC 6749 §3.3 doesn't allow in a scope token: `scope-token = 1*( %x21 / %x23-5B / %x5D-7E )`. */
const NOT_SCOPE_CHAR = /[^\x21\x23-\x5B\x5D-\x7E]/g;
/** Any whitespace or control character: an address has none. */
const NOT_ADDRESS_CHAR = /[\s\u0000-\u001F\u007F]/;

/**
 * The scope the server asked for, as one short line: whitespace-separated tokens made only of scope characters, joined
 * by single spaces, at most `SCOPE_MAX` characters. Over the bound, whole tokens are dropped from the end (a half token
 * would ask the provider for a scope nobody named); a token that alone doesn't fit is dropped. Null when nothing is left.
 */
export function cleanScope(scope: string | null | undefined): string | null {
  if (typeof scope !== "string") return null;
  const tokens = scope
    .split(/\s+/)
    .map((t) => t.replace(NOT_SCOPE_CHAR, ""))
    .filter((t) => t.length > 0);
  let out = "";
  for (const t of tokens) {
    const next = out === "" ? t : `${out} ${t}`;
    if (next.length > SCOPE_MAX) {
      if (out === "") continue;
      break;
    }
    out = next;
  }
  return out === "" ? null : out;
}

/** The authorization server's issuer, if it is an https URL with nothing in it that isn't an address (no whitespace, no
 *  control characters) and a sensible length; as written, because an issuer is an identity. Else null. */
export function cleanIssuer(issuer: string | null | undefined): string | null {
  if (typeof issuer !== "string" || issuer.length === 0 || issuer.length > ISSUER_MAX || NOT_ADDRESS_CHAR.test(issuer)) return null;
  try {
    return new URL(issuer).protocol === "https:" ? issuer : null;
  } catch {
    return null;
  }
}
