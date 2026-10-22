// lib/project-email/domain.ts — A PROJECT'S SENDING DOMAIN (spec local
// 2026-10-22-email-integration, 6.1): connect it (in the customers' Resend
// account), check it, disconnect it. Only `ready` sends. Becoming ready or
// stopping being ready reapplies the functions' environment (OPENLEN_EMAIL_FROM)
// and tells the owner. Pure: everything real comes in DomainDeps.

import type { EmailDomainEvent } from "@/lib/notifications/types";
import type { Plan } from "@/lib/plan";

import type { ResendClients } from "./resend-clients";
import type { EmailDomainRow, EmailDomainStatus, EmailStore } from "./types";

export interface DomainDeps {
  store: EmailStore;
  resend: ResendClients;
  planOfProject(projectId: string): Promise<Plan>;
  ownerOf(projectId: string): Promise<{ userId: string; email: string } | null>;
  notify(e: EmailDomainEvent): Promise<void>;
  applyFunctionEnv(projectId: string): Promise<void>;
  now(): Date;
}

export type ConnectResult =
  | { readonly kind: "ok"; readonly row: EmailDomainRow }
  | { readonly kind: "free_plan" | "invalid_domain" | "host_taken" | "provider_error"; readonly message: string };

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** What people type → the domain (lower case, no scheme, path, port, «www.» nor final dot, IDN in punycode), or null. */
export function normalizeDomain(input: string): string | null {
  let s = input.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  s = s.split(/[/?#]/)[0]!.replace(/:\d+$/, "").replace(/\.$/, "").replace(/^www\./, "");
  if (!s || /\s/.test(s)) return null;
  let host: string;
  try {
    host = new URL(`http://${s}`).hostname;
  } catch {
    return null;
  }
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return null;
  // An IP is not a domain; a TLD has letters (or is punycode).
  if (!/^(?:[a-z]{2,}|xn--[a-z0-9-]+)$/.test(labels.at(-1)!)) return null;
  return host;
}

export function sendingHostFor(domain: string, showAsRoot: boolean): string {
  if (showAsRoot || domain.startsWith("notify.")) return domain;
  return `notify.${domain}`;
}

export async function connectDomain(projectId: string, input: { domain: string; showAsRoot: boolean }, d: DomainDeps): Promise<ConnectResult> {
  if ((await d.planOfProject(projectId)) === "free") return { kind: "free_plan", message: "Email from your own domain is part of the paid plans." };
  const domain = normalizeDomain(input.domain);
  if (!domain) return { kind: "invalid_domain", message: `"${input.domain}" isn't a domain like yourbusiness.com.` };
  const sendingHost = sendingHostFor(domain, input.showAsRoot);
  const holder = await d.store.domainByHost(sendingHost);
  if (holder && holder.projectId !== projectId) return { kind: "host_taken", message: `${sendingHost} already sends for another project.` };
  if (holder) return { kind: "ok", row: holder };

  const previous = await d.store.getDomain(projectId);
  let created: Awaited<ReturnType<ResendClients["createDomain"]>>;
  try {
    created = await d.resend.createDomain(sendingHost);
  } catch (e) {
    return { kind: "provider_error", message: e instanceof Error ? e.message : String(e) };
  }
  if (previous) {
    await d.resend.deleteDomain(previous.resendDomainId).catch(() => {});
  }
  const row: Omit<EmailDomainRow, "createdAt"> = {
    projectId,
    domain,
    sendingHost,
    showAsRoot: input.showAsRoot,
    resendDomainId: created.id,
    records: created.records,
    status: "pending",
    lastCheckedAt: null,
    verifiedAt: null,
  };
  await d.store.putDomain(row);
  if (previous?.status === "ready") await d.applyFunctionEnv(projectId);
  return { kind: "ok", row: (await d.store.getDomain(projectId))! };
}

function nextStatus(previous: EmailDomainStatus, resendStatus: string | null): EmailDomainStatus {
  // partially_verified: one of two sending CNAMEs still pending, and Resend sends normally
  // (resend.com/docs/dashboard/domains/manage-domains, read 22/10).
  if (resendStatus === "verified" || resendStatus === "partially_verified") return "ready";
  const wasSending = previous === "ready" || previous === "offline";
  // Resend is checking: right after a verify (ours, or one pressed in its dashboard) a verified
  // domain reads `pending` for a while (measured 22/10). It says nothing new.
  if (resendStatus === "pending") return wasSending ? previous : "verifying";
  if (wasSending) return "offline";
  if (resendStatus === null || resendStatus === "failed") return "failed";
  return "verifying";
}

/** What Resend isn't checking by itself: asking it to verify starts it (or starts it again). */
const NEEDS_VERIFY: ReadonlySet<string> = new Set(["not_started", "failed", "temporary_failure", "partially_failed"]);

export async function checkDomain(projectId: string, d: DomainDeps): Promise<EmailDomainStatus | null> {
  const row = await d.store.getDomain(projectId);
  if (!row) return null;
  // Read first, and ask Resend to verify only when it isn't already checking nor verified: its
  // verify flips the domain to `pending` for some seconds, and reading right after it showed a
  // ready domain as not ready (the real test, 22/10).
  const remote = await d.resend.getDomain(row.resendDomainId);
  if (remote && NEEDS_VERIFY.has(remote.status)) await d.resend.verifyDomain(row.resendDomainId).catch(() => {});
  const status = nextStatus(row.status, remote?.status ?? null);
  await d.store.setDomainStatus(projectId, status, d.now());
  const becameReady = status === "ready" && row.status !== "ready";
  const stoppedReady = row.status === "ready" && status !== "ready";
  if (becameReady || stoppedReady) {
    await d.applyFunctionEnv(projectId);
    const owner = await d.ownerOf(projectId);
    if (owner && (status === "ready" || status === "offline")) {
      await d.notify({ type: "email_domain", projectId, recipientUserId: owner.userId, domain: row.domain, status });
    }
  }
  return status;
}

export async function disconnectDomain(projectId: string, d: DomainDeps): Promise<void> {
  const row = await d.store.getDomain(projectId);
  if (!row) return;
  // Gone in Resend already, or Resend failing: it stops sending here either way.
  await d.resend.deleteDomain(row.resendDomainId).catch(() => {});
  await d.store.deleteDomain(projectId);
  await d.applyFunctionEnv(projectId);
}
