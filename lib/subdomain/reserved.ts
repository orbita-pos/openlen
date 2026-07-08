// ─────────────────────────────────────────────────────────────────────────────
// Reserved subdomain list.
//
// These labels are blocked from user claim — either because they collide with
// system services (mail, ftp, autodiscover…), because they're operational
// surfaces we want to keep for ourselves (api, admin, app, dashboard…), or
// because they're brand-adjacent and shouldn't be squatted (openlen, blog,
// docs, status, support).
//
// We also reject (in validate.ts):
//   • Names starting with `xn--` — punycode prefix; would let a user claim a
//     visually-confusable IDN label.
//   • Pure-numeric names — risk confusion with IP-shaped hostnames and DNS
//     edge cases on resolvers that try to interpret all-numeric labels.
// ─────────────────────────────────────────────────────────────────────────────

export const RESERVED_SUBDOMAINS: ReadonlySet<string> = new Set([
  // System / mail / DNS
  "www",
  "mail",
  "ftp",
  "smtp",
  "pop",
  "imap",
  "ns1",
  "ns2",
  "mx",
  "mx1",
  "mx2",
  "autodiscover",
  "autoconfig",
  // Product surfaces
  "api",
  "admin",
  "app",
  "dashboard",
  "cdn",
  "static",
  "assets",
  // Brand / content
  "openlen",
  "blog",
  "docs",
  "status",
  "support",
  "help",
  // Product-adjacent (ES/EN) — collides with the platform's own account
  // concept ("Mi cuenta" / Members sign-in), same reasoning as app/dashboard.
  // Mirrors lib/projects/site-pages.ts's RESERVED_SLUGS (a per-project page
  // path list, not this one) which already reserves both spellings.
  "cuenta",
  "account",
  // Infra / fallbacks
  "_default",
  "root",
  "host",
  "localhost",
  "internal",
  "staging",
  "dev",
  "test",
  "prod",
  "production",
]);

export function isReserved(name: string): boolean {
  return RESERVED_SUBDOMAINS.has(name.toLowerCase());
}
