import "server-only";

import { createSign } from "node:crypto";
import { promises as dnsPromises } from "node:dns";

// ─────────────────────────────────────────────────────────────────────────────
// Domain Connect — service-provider side.
//
// Domain Connect (domainconnect.org) is the open protocol Resend + Vercel use
// for "one-click" DNS setup. Two flows exist; we only support the synchronous
// one (the only one Cloudflare supports, and the only one any DNS provider
// supports universally):
//
//   1. User adds a domain in OpenLen → we claim it + generate a token.
//   2. We discover the user's DNS provider (TXT lookup, NS fallback).
//   3. We build a signed Apply URL pointing at the provider's sync endpoint,
//      embedding our template id + the variables (host, token).
//   4. User is redirected → provider asks for consent → records get added.
//   5. User comes back to OpenLen → we run our existing verify endpoint.
//
// Signing: the URL query string (excluding `sig` + `key`) is RSA-SHA256
// signed with our private key (env DOMAIN_CONNECT_SIGNING_KEY). The DNS
// provider fetches the public key from a TXT record at v1._dc.openlen.com
// (the v1 part is the `key` parameter we append; lets us rotate later).
// ─────────────────────────────────────────────────────────────────────────────

const KEY_ID = "v1";
const PUB_KEY_DOMAIN = "dc.openlen.com";

const TEMPLATE_SERVICE_SUBDOMAIN = "custom-domain-subdomain";
const TEMPLATE_SERVICE_APEX = "custom-domain-apex";
const PROVIDER_ID = "openlen.com";

// Hard-coded NS → provider mapping for the fallback path. Used when a
// domain's zone doesn't advertise a _domainconnect TXT record (which is
// the case for newly-onboarded providers or zones with manual overrides).
// Each entry is a substring match against the lowercased NS hostname.
const NS_PROVIDER_HINTS: ReadonlyArray<{
  hint: string;
  providerId: string;
  providerName: string;
}> = [
  { hint: "ns.cloudflare.com", providerId: "cloudflare", providerName: "Cloudflare" },
  // Additional providers wired in here as we onboard each (template review +
  // launch with each is a per-provider effort, not one-off).
];

export interface ProviderInfo {
  /** Stable id ("cloudflare", "godaddy", …). Used to render UI hints. */
  providerId: string;
  /** Display name shown on the Connect button. */
  providerName: string;
  /** Where to send the user to apply a template. Inherited from the
   *  provider's published settings (or hardcoded fallback). */
  urlSyncUX: string;
  /** Whether the discovery method was authoritative (TXT) or heuristic (NS).
   *  Currently informational; could be surfaced in the UI as a "verified"
   *  vs "best-guess" pill later. */
  source: "txt" | "ns";
}

/** Resolve which DNS provider runs the zone for `domain`, if we know how
 *  to integrate with them. Returns null when neither discovery path
 *  matches a supported provider. */
export async function discoverDnsProvider(
  domain: string,
): Promise<ProviderInfo | null> {
  const root = rootDomainOf(domain);

  // Path 1: authoritative discovery via _domainconnect TXT at the zone apex.
  // The TXT value is the hostname of the provider's Domain Connect API
  // endpoint; we GET https://<that-host>/v2/<domain>/settings for urlSyncUX.
  try {
    const txt = await dnsPromises.resolveTxt(`_domainconnect.${root}`);
    const host = txt[0]?.join("") ?? "";
    if (host) {
      const settings = await fetchSettings(host, root);
      if (settings?.urlSyncUX) {
        return {
          providerId: settings.providerId ?? "unknown",
          providerName: settings.providerName ?? "your DNS provider",
          urlSyncUX: stripTrailingSlash(settings.urlSyncUX),
          source: "txt",
        };
      }
    }
  } catch {
    // No _domainconnect TXT — fall through to NS heuristic.
  }

  // Path 2: NS heuristic. Match against known nameserver substrings.
  // Less precise than TXT (a provider could change their NS suffix at
  // any time) but covers the case where Domain Connect isn't auto-
  // advertised by the zone.
  try {
    const ns = await dnsPromises.resolveNs(root);
    const lower = ns.map((n) => n.toLowerCase());
    for (const hint of NS_PROVIDER_HINTS) {
      if (lower.some((n) => n.endsWith(hint.hint))) {
        const url = providerSyncUrlForId(hint.providerId);
        if (!url) continue;
        return {
          providerId: hint.providerId,
          providerName: hint.providerName,
          urlSyncUX: url,
          source: "ns",
        };
      }
    }
  } catch {
    /* domain doesn't resolve or no NS — give up */
  }

  return null;
}

/** Hardcoded sync URLs for providers we've onboarded but whose zones don't
 *  always publish a _domainconnect TXT (e.g. Cloudflare's TXT advertisement
 *  is opt-in per zone). Update as we ship more provider integrations. */
function providerSyncUrlForId(providerId: string): string | null {
  switch (providerId) {
    case "cloudflare":
      // Cloudflare's Domain Connect Apply endpoint. The trailing
      // `domainTemplates/...` path is built per-call in buildApplyUrl.
      return "https://dash.cloudflare.com/domain-connect";
    default:
      return null;
  }
}

interface ProviderSettings {
  providerId?: string;
  providerName?: string;
  urlSyncUX?: string;
  urlAsyncUX?: string;
  urlAPI?: string;
}

async function fetchSettings(
  host: string,
  domain: string,
): Promise<ProviderSettings | null> {
  // SECURITY: `host` is read from an attacker-controllable _domainconnect TXT
  // record, so this fetch is an SSRF sink. Accept only a bare https hostname
  // (no custom port) that resolves ENTIRELY to public IPs — this blocks
  // 169.254.169.254 (cloud metadata), localhost, RFC1918 / CGNAT, link-local,
  // etc. — and never follow redirects (a 3xx could hop to an internal URL).
  const hostname = parseHttpsHostname(host);
  if (!hostname || !(await resolvesToPublicIp(hostname))) return null;

  // Domain Connect spec — providers expose /v2/<domain>/settings.
  const url = `https://${hostname}/v2/${encodeURIComponent(domain)}/settings`;
  try {
    const res = await fetch(url, {
      headers: { accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    return (await res.json()) as ProviderSettings;
  } catch {
    return null;
  }
}

// ─── SSRF guards for the TXT-supplied provider host ──────────────────────────

/** Extract a bare hostname from a TXT-supplied value, accepting only plain
 *  https on the default port. Returns null for other schemes, explicit ports,
 *  or garbage. */
function parseHttpsHostname(raw: string): string | null {
  try {
    const u = new URL(raw.includes("://") ? raw : `https://${raw}`);
    if (u.protocol !== "https:") return null;
    if (u.port && u.port !== "443") return null;
    return u.hostname;
  } catch {
    return null;
  }
}

/** True only when every A/AAAA address `hostname` resolves to is a public,
 *  routable address. (A determined attacker could still DNS-rebind in the
 *  TOCTOU window, but the caller reads only `urlSyncUX` and discards non-2xx
 *  bodies, which bounds the residual risk.) */
async function resolvesToPublicIp(hostname: string): Promise<boolean> {
  try {
    const addrs = await dnsPromises.lookup(hostname, { all: true });
    return addrs.length > 0 && addrs.every((a) => isPublicIp(a.address));
  } catch {
    return false;
  }
}

function isPublicIp(ip: string): boolean {
  const v4 = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = v4.slice(1).map(Number);
    if (a === 0 || a === 10 || a === 127) return false; // this-net / private / loopback
    if (a === 169 && b === 254) return false; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false; // private
    if (a === 192 && b === 168) return false; // private
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a >= 224) return false; // multicast + reserved
    return true;
  }
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return false; // loopback / unspecified
  if (
    lower.startsWith("fe80") ||
    lower.startsWith("fc") ||
    lower.startsWith("fd")
  ) {
    return false; // link-local + unique-local
  }
  const mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return isPublicIp(mapped[1]);
  return true;
}

export interface BuildApplyUrlParams {
  provider: ProviderInfo;
  /** The full hostname the user is connecting (e.g. landing.miempresa.com
   *  or miempresa.com). We split this into root + host inside. */
  domain: string;
  /** Per-claim verification token from `customDomains.verificationToken`. */
  token: string;
  /** Where the user lands after the provider confirms. Typically the
   *  workspace URL with ?project=… so they end up back on the modal. */
  redirectUri: string;
}

/** Build the signed Apply URL the user is redirected to. The signature
 *  covers every query parameter except `sig` and `key`; the DNS provider
 *  refetches our public key by TXT lookup and verifies it.
 *
 *  Throws if DOMAIN_CONNECT_SIGNING_KEY isn't set in the environment —
 *  the modal should detect this upstream and fall back to manual DNS. */
export function buildApplyUrl(params: BuildApplyUrlParams): string {
  const privateKeyPem = decodeSigningKey(
    process.env.DOMAIN_CONNECT_SIGNING_KEY,
  );
  if (!privateKeyPem) {
    throw new Error(
      "DOMAIN_CONNECT_SIGNING_KEY is missing — run `npm run domain-connect:keygen` first",
    );
  }

  const root = rootDomainOf(params.domain);
  const host = subdomainOf(params.domain);
  const isApex = host === "";
  const serviceId = isApex ? TEMPLATE_SERVICE_APEX : TEMPLATE_SERVICE_SUBDOMAIN;

  const base = `${params.provider.urlSyncUX}/v2/domainTemplates/providers/${PROVIDER_ID}/services/${serviceId}/apply`;

  // Query order doesn't matter for the apply request itself but DOES
  // affect the signature — DNS providers sign-verify against the exact
  // query string they receive. We emit keys in a stable sorted order so
  // any retry produces an identical (cached-friendly) signature.
  const query = new URLSearchParams();
  query.set("domain", root);
  if (!isApex) query.set("host", host);
  query.set("token", params.token);
  query.set("redirect_uri", params.redirectUri);

  // Sign the query string (sorted), then append sig + key. The DNS
  // provider re-derives the signed string by removing sig + key from
  // the incoming URL.
  const sortedQuery = sortedSearchString(query);
  const sig = signRsaSha256(sortedQuery, privateKeyPem);
  const finalQuery = `${sortedQuery}&sig=${encodeURIComponent(sig)}&key=${KEY_ID}`;
  return `${base}?${finalQuery}`;
}

function signRsaSha256(payload: string, privateKeyPem: string): string {
  const signer = createSign("RSA-SHA256");
  signer.update(payload, "utf8");
  signer.end();
  return signer.sign(privateKeyPem).toString("base64");
}

function sortedSearchString(params: URLSearchParams): string {
  const entries = Array.from(params.entries()).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return entries
    .map(
      ([k, v]) =>
        `${encodeURIComponent(k)}=${encodeURIComponent(v)}`,
    )
    .join("&");
}

function decodeSigningKey(raw: string | undefined): string | null {
  if (!raw) return null;
  // .env files mangle real newlines into literal "\n" sequences — undo
  // that so the PEM has its proper line breaks.
  return raw.replace(/\\n/g, "\n").trim();
}

/** Best-effort root-domain extraction. Doesn't consult a PSL — assumes
 *  the user gives us either an apex (2 labels) or a single subdomain
 *  layered on top. Multi-label TLDs (co.uk, com.mx) get treated as 3-label
 *  apexes; users with those zones can still use manual DNS. */
function rootDomainOf(input: string): string {
  const labels = input.toLowerCase().split(".");
  if (labels.length <= 2) return labels.join(".");
  return labels.slice(-2).join(".");
}

function subdomainOf(input: string): string {
  const labels = input.toLowerCase().split(".");
  if (labels.length <= 2) return "";
  return labels.slice(0, -2).join(".");
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
