// A destination typed into the inspector's Link field lands on the element
// verbatim. A value with no scheme ("instagram.com/juan") is therefore a
// RELATIVE path — and on a published site a relative path that doesn't exist
// does NOT 404: Caddy's `try_files {path} {path}/index.html /index.html`
// (infra/caddy/Caddyfile) serves the HOME with 200. The visitor taps
// "Instagram", lands back on the same page, and nothing anywhere reports an
// error. The break is invisible to the creator too, which is why this is fixed
// at the point of entry rather than left to the publish pipeline.
//
// The rule is: pick the scheme the value obviously already is — never invent a
// value we weren't given. A bare host becomes https://, a bare email becomes
// mailto:, a bare phone becomes tel:. Anything already addressed (a scheme, a
// #anchor, a /root-path, a ./relative) passes through byte-for-byte, query
// string and letter case intact. A value that names no destination — "@juan"
// alone names no platform — is left exactly as typed; guessing the platform
// would be the same sin as an invented link.

/** Any RFC-3986 scheme — https:, mailto:, tel:, sms:, whatsapp:, … */
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;
/** "//cdn.x.com/y" — already absolute against the page's protocol. */
const PROTOCOL_RELATIVE = /^\/\//;
/** A dotted host at the head of the value: "instagram.com/juan", "www.x.io",
 *  "shop.co:8080/a?b=1". At least one dot is required, so a lone word ("menu")
 *  is NOT treated as a host — it may well be an intended relative path. */
const BARE_HOST =
  /^(?:www\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?::\d+)?(?:[/?#]|$)/i;
/** "hola@cafe.com" — an @ with a dotted domain and no scheme is an email. */
const BARE_EMAIL = /^[^\s@]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;
/** "+52 55 1234 5678", "(55) 1234-5678" — nothing else in a link field looks
 *  like this (the leading "(" carries the MX area-code style). tel: wants the
 *  number unformatted. */
const BARE_PHONE = /^\+?[\d(][\d\s().-]{6,}$/;

/** Normalize a user-typed link destination into an addressable href. */
export function normalizeHref(raw: string): string {
  const v = raw.trim();
  if (!v) return "";
  if (HAS_SCHEME.test(v) || PROTOCOL_RELATIVE.test(v)) return v;
  if (v.startsWith("#") || v.startsWith("/") || v.startsWith("./") || v.startsWith("../")) return v;
  if (BARE_EMAIL.test(v)) return `mailto:${v}`;
  if (BARE_PHONE.test(v)) return `tel:${v.replace(/[\s().-]/g, "")}`;
  if (BARE_HOST.test(v)) return `https://${v}`;
  return v;
}
