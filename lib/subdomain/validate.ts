import { isReserved } from "./reserved";

// ─────────────────────────────────────────────────────────────────────────────
// Pure subdomain validator.
//
// The regex IS THE SAME ONE the wildcard nginx server_name uses in
// infra/nginx/openlen.conf. Drift between the two would mean the app
// accepts names that nginx refuses to route (or vice versa), so keep
// them byte-identical when either side is touched.
//
// DNS label rules baked into the regex:
//   • Lowercase a-z, 0-9, hyphens.
//   • Cannot start or end with a hyphen.
//   • 1–63 chars total.
// On top of that we reject `xn--*` (punycode) and pure-numeric names
// (Unicode IDN risk + DNS resolver edge cases), then the reserved list.
// ─────────────────────────────────────────────────────────────────────────────

export const SUBDOMAIN_REGEX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export type ValidationResult =
  | { ok: true; value: string }
  | { ok: false; reason: "invalid" | "reserved" };

export function validateSubdomain(raw: string): ValidationResult {
  const value = String(raw ?? "").trim().toLowerCase();
  if (value.length < 1 || value.length > 63) {
    return { ok: false, reason: "invalid" };
  }
  if (!SUBDOMAIN_REGEX.test(value)) {
    return { ok: false, reason: "invalid" };
  }
  // xn-- is the ACE prefix for IDN (punycode) labels. Banning it stops
  // a user claiming a visually-confusable name via its raw ASCII form.
  if (value.startsWith("xn--")) {
    return { ok: false, reason: "invalid" };
  }
  // Pure-numeric labels are valid per the regex but ambiguous in
  // practice — block them.
  if (/^[0-9]+$/.test(value)) {
    return { ok: false, reason: "invalid" };
  }
  if (isReserved(value)) {
    return { ok: false, reason: "reserved" };
  }
  return { ok: true, value };
}
