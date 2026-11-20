// WHAT A SIGN-IN THAT DIDN'T FINISH SAYS (spec local 2026-11-17-oauth-de-conectores-mcp, §10.2, §10.5). Every code the
// start, the way back and the popup can end with has a sentence in the person's language (`panelsChat` →
// `mcpApproval.errors.<key>`); a code nobody listed — an HTTP status, a message the server made up — is the generic one:
// the card never shows a raw code. Client-safe: no imports.

/** The keys of `mcpApproval.errors`, one sentence each. */
export const SIGN_IN_ERROR_KEYS = [
  "popupBlocked",
  "unsafeUrl",
  "notApproved",
  "noClient",
  "unreachable",
  "expired",
  "lost",
  "issuerChanged",
  "exchangeFailed",
  "off",
  "unauthorized",
  "notAvailable",
  "configUnreadable",
  "failed",
] as const;
export type SignInErrorKey = (typeof SIGN_IN_ERROR_KEYS)[number];

const KEY_OF_CODE: Readonly<Record<string, SignInErrorKey>> = {
  // The popup (open-sign-in.ts).
  popup_blocked: "popupBlocked",
  sign_in_url_refused: "unsafeUrl",
  // The start (`POST /api/mcp-connectors/<name>/oauth`, `…/directory/<id>`) and the approval.
  not_approved: "notApproved",
  no_client: "noClient",
  unreachable: "unreachable",
  off: "off",
  unauthorized: "unauthorized",
  not_found: "notAvailable",
  config_unreadable: "configUnreadable",
  // The way back (the callback page's `reason`).
  expired: "expired",
  used: "lost",
  unknown: "lost",
  issuer_changed: "issuerChanged",
  exchange_failed: "exchangeFailed",
};

export function signInErrorKey(code: string): SignInErrorKey {
  return Object.hasOwn(KEY_OF_CODE, code) ? KEY_OF_CODE[code]! : "failed";
}

/** The codes whose server-side `detail` is worth showing under the sentence (a credential's name, what to set in the
 *  file): an English line from OpenLen's own server, already redacted and cut short. */
const CODES_WITH_DETAIL: ReadonlySet<string> = new Set(["no_client", "unreachable", "config_unreadable"]);
export const showsDetail = (code: string): boolean => CODES_WITH_DETAIL.has(code);
