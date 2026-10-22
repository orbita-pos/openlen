// lib/project-email/domain-connect.ts — THE ONE-CLICK BUTTON (spec local
// 2026-10-22-email-integration, 6.2), with Domain Connect as its specification
// says (github.com/Domain-Connect/spec): discovery by the `_domainconnect` TXT
// and `/v2/{domain}/settings`, the template check, and the synchronous apply
// URL signed with OpenLen's key (RS256 over the query without `sig` and `key`).
// OpenLen is the service provider `openlen.app`, with one service per set of
// Resend's lines (`email`, `email-cname`: see templateFor); their templates are
// infra/domain-connect/openlen.app.<service>.json and the public key lives in
// TXT `_dcpubkeyv1.openlen.app`. Pure apart from what comes in DcDeps.

import { createSign } from "node:crypto";

import type { DnsRecord } from "./types";

export const DC_PROVIDER_ID = "openlen.app";
export type DcServiceId = "email" | "email-cname";
export const DC_KEY_HOST = "_dcpubkeyv1";

export interface DcSettings {
  readonly providerId: string;
  readonly providerName: string;
  readonly providerDisplayName?: string;
  readonly urlAPI: string;
  readonly urlSyncUX?: string;
}

export interface DcDeps {
  resolveTxt(name: string): Promise<string[][]>;
  fetch: typeof fetch;
}

const trimSlash = (u: string) => u.replace(/\/+$/, "");

async function txt(name: string, d: Pick<DcDeps, "resolveTxt">): Promise<string[]> {
  try {
    return (await d.resolveTxt(name)).map((chunks) => chunks.join(""));
  } catch {
    return [];
  }
}

export async function discover(domain: string, d: DcDeps): Promise<DcSettings | null> {
  const [host] = await txt(`_domainconnect.${domain}`, d);
  if (!host) return null;
  try {
    const res = await d.fetch(`https://${trimSlash(host.trim())}/v2/${domain}/settings`);
    if (!res.ok) return null;
    const j = (await res.json()) as Partial<DcSettings>;
    if (typeof j.providerId !== "string" || typeof j.providerName !== "string" || typeof j.urlAPI !== "string") return null;
    return {
      providerId: j.providerId,
      providerName: j.providerName,
      urlAPI: j.urlAPI,
      ...(typeof j.providerDisplayName === "string" ? { providerDisplayName: j.providerDisplayName } : {}),
      ...(typeof j.urlSyncUX === "string" ? { urlSyncUX: j.urlSyncUX } : {}),
    };
  } catch {
    return null;
  }
}

export async function templateSupported(s: DcSettings, serviceId: DcServiceId, d: DcDeps): Promise<boolean> {
  try {
    const res = await d.fetch(`${trimSlash(s.urlAPI)}/v2/domainTemplates/providers/${DC_PROVIDER_ID}/services/${serviceId}`);
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}

const enc = (k: string, v: string) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;

export function applyUrl(
  o: { settings: DcSettings; serviceId: DcServiceId; domain: string; host: string; vars: Readonly<Record<string, string>>; redirectUri: string; state: string },
  privateKeyPem: string,
): string {
  const base = trimSlash(o.settings.urlSyncUX ?? o.settings.urlAPI);
  const parts = [enc("domain", o.domain), ...(o.host ? [enc("host", o.host)] : []), ...Object.entries(o.vars).map(([k, v]) => enc(k, v)), enc("redirect_uri", o.redirectUri), enc("state", o.state)];
  const query = parts.join("&");
  const sig = createSign("sha256").update(query).sign(privateKeyPem, "base64");
  return `${base}/v2/domainTemplates/providers/${DC_PROVIDER_ID}/services/${o.serviceId}/apply?${query}&sig=${encodeURIComponent(sig)}&key=${DC_KEY_HOST}`;
}

const SPF_VALUE = "v=spf1 include:amazonses.com ~all";
const MX_PRIORITY = 10;

/** A Resend record's name relative to the sending host: `send.notify.pruebas` for notify.pruebas.openlen.com → `send`.
 *  Resend names its records relative to the zone, which OpenLen doesn't know: the first labels whose rest is the
 *  start of the sending host are the record's own. */
function ownLabel(name: string, sendingHost: string): string {
  const n = name.split(".");
  const h = sendingHost.split(".");
  for (let k = 1; k <= n.length; k++) {
    if (n.slice(k).every((label, i) => label === h[i])) return n.slice(0, k).join(".");
  }
  return name;
}

/**
 * Which of OpenLen's Domain Connect templates fits Resend's records EXACTLY, with its variables, or null —
 * then there is no one-click button and the owner adds the lines by hand. Domain Connect has no optional
 * records, and Resend's set varies: for domains created after August 2026 it may add a CNAME for SPF
 * (resend.com/docs/dashboard/domains/manage-domains, read 22/10; seen in the real test: `rsend.<host>` →
 * `send.forge.rmta.net`). So one template per set: `email` (DKIM TXT, MX, SPF TXT) and `email-cname`
 * (the same plus that CNAME). A set no template matches never gets a button that would leave lines out.
 */
export function templateFor(
  records: readonly DnsRecord[],
  sendingHost: string,
  domain: string,
): { serviceId: DcServiceId; host: string; vars: Record<string, string> } | null {
  const own = records.map((r) => ({ ...r, label: ownLabel(r.name, sendingHost) }));
  const one = (type: DnsRecord["type"], label: string) => {
    const found = own.filter((r) => r.type === type && r.label === label);
    return found.length === 1 ? found[0]! : null;
  };
  const dkim = one("TXT", "resend._domainkey");
  const mx = one("MX", "send");
  const spf = one("TXT", "send");
  const cname = one("CNAME", "rsend");
  if (!dkim || !mx || mx.priority !== MX_PRIORITY || !spf || spf.value !== SPF_VALUE) return null;
  const host = sendingHost === domain ? "" : sendingHost.slice(0, -(domain.length + 1));
  if (records.length === 3) return { serviceId: "email", host, vars: { dkim: dkim.value, mxhost: mx.value } };
  if (records.length === 4 && cname) return { serviceId: "email-cname", host, vars: { dkim: dkim.value, mxhost: mx.value, rsend: cname.value } };
  return null;
}

/** «Show as @domain» wants a DMARC record at the root; if the domain has none, a p=none one is the optional fourth line. */
export async function dmarcSuggestion(domain: string, d: Pick<DcDeps, "resolveTxt">): Promise<DnsRecord | null> {
  const existing = await txt(`_dmarc.${domain}`, d);
  if (existing.some((v) => v.trim().toLowerCase().startsWith("v=dmarc1"))) return null;
  return { type: "TXT", name: "_dmarc", value: "v=DMARC1; p=none;" };
}
