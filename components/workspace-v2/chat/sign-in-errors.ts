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

/** The sign-in host an `issuer_changed` names (final review F3, spec §10.2): a hostname as OpenLen's server writes it,
 *  null for «the server's own page», undefined for anything else — which is never shown. */
const HOST = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
export function signInHostFrom(v: unknown): string | null | undefined {
  if (v === null) return null;
  return typeof v === "string" && HOST.test(v) ? v : undefined;
}

const ASK_REASONS: ReadonlySet<string> = new Set(["first", "lapsed", "scope"]);

/** Where a server that turned out to need a sign-in wants the person, as the approval (or the connectors list) answers
 *  it (final review F4, spec §10.5): a host that isn't one is «the server's own page», a reason nobody listed is a first
 *  sign-in. */
export function signInAskFrom(raw: unknown): { issuerHost: string | null; reason: "first" | "lapsed" | "scope" } {
  const o = raw && typeof raw === "object" ? (raw as { issuerHost?: unknown; reason?: unknown }) : {};
  const reason = typeof o.reason === "string" && ASK_REASONS.has(o.reason) ? (o.reason as "first" | "lapsed" | "scope") : "first";
  return { issuerHost: signInHostFrom(o.issuerHost) ?? null, reason };
}

/** The codes whose server-side `detail` is worth showing under the sentence (a credential's name, what to set in the
 *  file): an English line from OpenLen's own server, already redacted and cut short. */
const CODES_WITH_DETAIL: ReadonlySet<string> = new Set(["no_client", "unreachable", "config_unreadable"]);
export const showsDetail = (code: string): boolean => CODES_WITH_DETAIL.has(code);
