// lib/project-email/domain-connect.ts — THE ONE-CLICK BUTTON (spec local
// 2026-10-22-email-integration, 6.2), with Domain Connect as its specification
// says (github.com/Domain-Connect/spec): discovery by the `_domainconnect` TXT
// and `/v2/{domain}/settings`, the template check, and the synchronous apply
// URL signed with OpenLen's key (RS256 over the query without `sig` and `key`).
// OpenLen is the service provider `openlen.app`, service `email`; its template
// is infra/domain-connect/openlen.app.email.json and its public key lives in
// TXT `_dcpubkeyv1.openlen.app`. Pure apart from what comes in DcDeps.

import { createSign } from "node:crypto";

import type { DnsRecord } from "./types";

export const DC_PROVIDER_ID = "openlen.app";
export const DC_SERVICE_ID = "email";
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

export async function templateSupported(s: DcSettings, d: DcDeps): Promise<boolean> {
  try {
    const res = await d.fetch(`${trimSlash(s.urlAPI)}/v2/domainTemplates/providers/${DC_PROVIDER_ID}/services/${DC_SERVICE_ID}`);
    return res.status >= 200 && res.status < 300;
  } catch {
    return false;
  }
}

const enc = (k: string, v: string) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;

export function applyUrl(
  o: { settings: DcSettings; domain: string; host: string; vars: Readonly<Record<string, string>>; redirectUri: string; state: string },
  privateKeyPem: string,
): string {
  const base = trimSlash(o.settings.urlSyncUX ?? o.settings.urlAPI);
  const parts = [enc("domain", o.domain), ...(o.host ? [enc("host", o.host)] : []), ...Object.entries(o.vars).map(([k, v]) => enc(k, v)), enc("redirect_uri", o.redirectUri), enc("state", o.state)];
  const query = parts.join("&");
  const sig = createSign("sha256").update(query).sign(privateKeyPem, "base64");
  return `${base}/v2/domainTemplates/providers/${DC_PROVIDER_ID}/services/${DC_SERVICE_ID}/apply?${query}&sig=${encodeURIComponent(sig)}&key=${DC_KEY_HOST}`;
}

/** The template's variables from Resend's records: the DKIM key, the MX host, and the host relative to the domain. */
export function templateVars(records: readonly DnsRecord[], sendingHost: string, domain: string): Record<string, string> {
  const dkim = records.find((r) => r.type === "TXT" && r.name.startsWith("resend._domainkey"))?.value ?? "";
  const mxhost = records.find((r) => r.type === "MX")?.value ?? "";
  const host = sendingHost === domain ? "" : sendingHost.slice(0, -(domain.length + 1));
  return { dkim, mxhost, host };
}

/** «Show as @domain» wants a DMARC record at the root; if the domain has none, a p=none one is the optional fourth line. */
export async function dmarcSuggestion(domain: string, d: Pick<DcDeps, "resolveTxt">): Promise<DnsRecord | null> {
  const existing = await txt(`_dmarc.${domain}`, d);
  if (existing.some((v) => v.trim().toLowerCase().startsWith("v=dmarc1"))) return null;
  return { type: "TXT", name: "_dmarc", value: "v=DMARC1; p=none;" };
}
