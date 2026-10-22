// lib/project-email/panel.ts — WHAT THE CORREOS TAB SHOWS (spec local
// 2026-10-22-email-integration, 4 and 6.9): the plan, the domain with its
// records, its provider and its help page or one-click button, the month
// against the allowance, the latest emails and the suppression list. Only the
// owner gets here (the route checks). Pure apart from PanelDeps.

import { createHmac, timingSafeEqual } from "node:crypto";

import type { Plan } from "@/lib/plan";

import { instructionsUrl, providerFromNs, type DnsProvider } from "./dns-instructions";
import type { DomainDeps } from "./domain";
import { applyUrl, discover, dmarcSuggestion, templateSupported, templateVars, type DcDeps } from "./domain-connect";
import { EMAIL_LIMITS, EXTRA_CENTICREDITS_PER_EMAIL, monthOf } from "./limits";
import type { DnsRecord, EmailDomainRow, EmailMessageRow, SuppressionReason } from "./types";

export interface PanelDeps extends DomainDeps {
  dc: DcDeps;
  resolveNs(domain: string): Promise<string[]>;
  /** OpenLen's Domain Connect signing key; without it there is no one-click button. */
  privateKeyPem: string | null;
  customDomainOf(projectId: string): Promise<string | null>;
  returnUrl: string;
  /** What signs the Domain Connect `state` (the server's AUTH_SECRET). */
  stateSecret: string;
}

export interface EmailPanel {
  readonly available: boolean;
  readonly plan: Plan;
  readonly domain:
    | (Pick<EmailDomainRow, "domain" | "sendingHost" | "showAsRoot" | "records" | "status" | "verifiedAt"> & {
        readonly provider: DnsProvider;
        readonly instructionsUrl: string | null;
        readonly oneClickUrl: string | null;
      })
    | null;
  readonly dmarc: DnsRecord | null;
  /** The project's own domain (custom domains), proposed in the empty field. */
  readonly suggestedDomain: string | null;
  readonly usage: { readonly month: string; readonly sent: number; readonly included: number; readonly extraCenticredits: number };
  readonly recent: readonly Pick<EmailMessageRow, "toAddress" | "subject" | "kind" | "status" | "reason" | "createdAt">[];
  readonly suppressions: readonly { address: string; reason: SuppressionReason; createdAt: Date }[];
}

const RECENT = 50;

/** `<project>.<hmac>`: the Domain Connect state, so the return proves which project it was. */
export function dcState(projectId: string, secret: string): string {
  return `${projectId}.${createHmac("sha256", secret).update(`domain-connect:${projectId}`).digest("base64url")}`;
}

export function dcStateProject(state: string, secret: string): string | null {
  const dot = state.lastIndexOf(".");
  if (dot <= 0) return null;
  const projectId = state.slice(0, dot);
  const given = Buffer.from(state.slice(dot + 1));
  const want = Buffer.from(dcState(projectId, secret).slice(dot + 1));
  return given.length === want.length && timingSafeEqual(given, want) ? projectId : null;
}

async function oneClick(row: EmailDomainRow, d: PanelDeps): Promise<string | null> {
  if (!d.privateKeyPem || row.status === "ready") return null;
  const settings = await discover(row.domain, d.dc);
  if (!settings || !(await templateSupported(settings, d.dc))) return null;
  const { host, ...vars } = templateVars(row.records, row.sendingHost, row.domain);
  return applyUrl({ settings, domain: row.domain, host: host ?? "", vars, redirectUri: d.returnUrl, state: dcState(row.projectId, d.stateSecret) }, d.privateKeyPem);
}

export async function emailPanel(projectId: string, d: PanelDeps): Promise<EmailPanel> {
  const [plan, owner, row, suggestedDomain] = await Promise.all([d.planOfProject(projectId), d.ownerOf(projectId), d.store.getDomain(projectId), d.customDomainOf(projectId)]);
  const month = monthOf(d.now());
  const sent = owner ? await d.store.usage(owner.userId, month) : 0;
  const included = plan === "free" ? 0 : EMAIL_LIMITS[plan].includedPerMonth;
  const [recent, suppressions] = await Promise.all([d.store.recentMessages(projectId, RECENT), d.store.listSuppressions(projectId)]);
  let domain: EmailPanel["domain"] = null;
  let dmarc: DnsRecord | null = null;
  if (row) {
    const provider = providerFromNs(await d.resolveNs(row.domain).catch(() => []));
    domain = {
      domain: row.domain,
      sendingHost: row.sendingHost,
      showAsRoot: row.showAsRoot,
      records: row.records,
      status: row.status,
      verifiedAt: row.verifiedAt,
      provider,
      instructionsUrl: instructionsUrl(provider),
      oneClickUrl: await oneClick(row, d),
    };
    if (row.showAsRoot) dmarc = await dmarcSuggestion(row.domain, d.dc);
  }
  return {
    available: true,
    plan,
    domain,
    dmarc,
    suggestedDomain,
    usage: { month, sent, included, extraCenticredits: Math.max(0, sent - included) * EXTRA_CENTICREDITS_PER_EMAIL },
    recent: recent.map(({ toAddress, subject, kind, status, reason, createdAt }) => ({ toAddress, subject, kind, status, reason, createdAt })),
    suppressions,
  };
}
