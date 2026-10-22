// lib/project-email/send.ts — EVERY EMAIL A PROJECT SENDS GOES THROUGH HERE (spec
// local 2026-10-22-email-integration, 6.3–6.7): the /email/v1 gateway (the
// functions' Resend SDK), the sign-in emails and the form replies. In order:
// required fields, OpenLen's switch, the paid plan, the ready domain, the
// `from` on it, size and recipients, the suppression list, the draft's rule
// (only the project's team), the hourly cap, the month's allowance or credits.
// Every refusal is logged and answered with Resend's own error names, so the
// SDK in a function reads it as Resend's. app and form emails get the
// unsubscribe footer and the one-click headers (RFC 8058) and go one per
// recipient, each with its own link. Pure: everything real comes in SendDeps.

import { randomUUID } from "node:crypto";

import type { EmailQuotaEvent } from "@/lib/notifications/types";
import type { Plan } from "@/lib/plan";

import { EMAIL_LIMITS, EXTRA_CENTICREDITS_PER_EMAIL, monthOf } from "./limits";
import type { ResendClients, ResendEmail, ResendError } from "./resend-clients";
import { normalizeAddress, type EmailKind, type EmailStore } from "./types";

export interface SendInput {
  projectId: string;
  environment: "draft" | "live";
  kind: EmailKind;
  email: ResendEmail;
  idempotencyKey?: string;
  /** The form's key, for a form reply (the brakes count by it). */
  tag?: string;
}

export type SendOutcome =
  | { readonly kind: "sent"; readonly id: string; readonly skipped: readonly string[] }
  | { readonly kind: "not_sent_draft"; readonly id: string }
  | { readonly kind: "rejected"; readonly error: ResendError };

export interface SendDeps {
  store: EmailStore;
  resend: ResendClients;
  ownerOf(projectId: string): Promise<{ userId: string; email: string } | null>;
  planOf(userId: string): Promise<Plan>;
  /** The owner's and the members' addresses, normalized. */
  team(projectId: string): Promise<string[]>;
  debitIfEnough(userId: string, centicredits: number, projectId: string): Promise<boolean>;
  refund(userId: string, centicredits: number, projectId: string): Promise<void>;
  unsubscribeUrl(projectId: string, address: string): string;
  notify(e: EmailQuotaEvent): Promise<void>;
  now(): Date;
}

const MAX_BYTES = 100 * 1024;
const MAX_RECIPIENTS = 50;
const ADDRESS = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
const HOUR_MS = 60 * 60 * 1000;

const err = (statusCode: number, name: string, message: string): ResendError => ({ statusCode, name, message });
const notVerified = (domain: string) => err(403, "validation_error", `The \`${domain}\` domain is not verified. Please, add and verify your domain.`);

/** "Name <a@b.c>" or "a@b.c" → the address's domain, lower case. */
function fromDomain(from: string): string {
  const addr = /<([^>]+)>\s*$/.exec(from)?.[1] ?? from;
  return addr.trim().slice(addr.trim().lastIndexOf("@") + 1).toLowerCase();
}

/** One send at a time per owner: the hourly cap and the allowance are read and spent together. */
const locks = new Map<string, Promise<unknown>>();
async function withOwnerLock<T>(ownerId: string, work: () => Promise<T>): Promise<T> {
  const before = locks.get(ownerId) ?? Promise.resolve();
  const run = before.then(work, work);
  const tail = run.catch(() => {});
  locks.set(ownerId, tail);
  try {
    return await run;
  } finally {
    if (locks.get(ownerId) === tail) locks.delete(ownerId);
  }
}

function withFooter(email: ResendEmail, url: string, domain: string): ResendEmail {
  const line = `Sent by ${domain} · <a href="${url}" style="color:#6b7280">Unsubscribe</a>`;
  const htmlFooter = `<p style="margin-top:24px;font-size:12px;color:#6b7280">${line}</p>`;
  const html = email.html === undefined ? undefined : /<\/body>/i.test(email.html) ? email.html.replace(/<\/body>/i, `${htmlFooter}</body>`) : `${email.html}${htmlFooter}`;
  const text = email.text === undefined ? undefined : `${email.text}\n\n—\nUnsubscribe: ${url}`;
  return {
    ...email,
    ...(html !== undefined ? { html } : {}),
    ...(text !== undefined ? { text } : {}),
    headers: { ...(email.headers ?? {}), "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  };
}

export async function sendProjectEmail(i: SendInput, d: SendDeps): Promise<SendOutcome> {
  const e = i.email;
  const raw = (Array.isArray(e.to) ? e.to : [e.to]).filter((t): t is string => typeof t === "string");
  const recipients = [...new Set(raw.map(normalizeAddress))].slice(0, MAX_RECIPIENTS + 1);
  const owner = await d.ownerOf(i.projectId);

  const log = (to: string, status: "rejected" | "not_sent_draft" | "sent", reason: string | null, resendId: string | null = null) =>
    owner
      ? d.store.logMessage({ projectId: i.projectId, ownerId: owner.userId, environment: i.environment, kind: i.kind, toAddress: to, subject: e.subject ?? "", status, reason, resendId, tag: i.tag ?? null })
      : Promise.resolve("");
  const reject = async (error: ResendError, who: readonly string[] = recipients.slice(0, MAX_RECIPIENTS)): Promise<SendOutcome> => {
    for (const to of who) await log(to, "rejected", error.message);
    return { kind: "rejected", error };
  };

  if (!e.from || recipients.length === 0 || !e.subject || (e.html === undefined && e.text === undefined)) {
    return reject(err(422, "missing_required_field", "The request body is missing one or more required fields."));
  }
  if (!owner) return reject(err(403, "validation_error", "This project no longer exists."));
  if (await d.store.isBlocked(i.projectId, owner.userId)) return reject(err(403, "suspended_api_key", "Sending is paused for this project."));
  const plan = await d.planOf(owner.userId);
  if (plan === "free") return reject(err(403, "validation_error", "Sending email from your own domain is part of the paid plans."));
  const domain = await d.store.getDomain(i.projectId);
  if (!domain || domain.status !== "ready") return reject(notVerified(domain?.sendingHost ?? "your"));
  const fd = fromDomain(e.from);
  if (fd !== domain.sendingHost && !(domain.showAsRoot && fd === domain.domain)) return reject(notVerified(fd));
  if (Buffer.byteLength(`${e.subject}${e.html ?? ""}${e.text ?? ""}`) > MAX_BYTES) return reject(err(400, "validation_error", "The email is over 100 KB."));
  if (recipients.length > MAX_RECIPIENTS) return reject(err(400, "validation_error", `Too many recipients: at most ${MAX_RECIPIENTS}.`));
  const bad = recipients.find((r) => !ADDRESS.test(r));
  if (bad) return reject(err(400, "validation_error", `Invalid \`to\` field: ${bad}.`));

  const skipped: string[] = [];
  const to: string[] = [];
  for (const r of recipients) ((await d.store.isSuppressed(i.projectId, r, i.kind)) ? skipped : to).push(r);
  if (to.length === 0) return reject(err(400, "validation_error", "Every recipient is on the project's do-not-send list."), skipped);

  if (i.environment === "draft") {
    const team = new Set((await d.team(i.projectId)).map(normalizeAddress));
    if (to.some((r) => !team.has(r))) {
      for (const r of to) await log(r, "not_sent_draft", "The draft only sends to the project's team.");
      return { kind: "not_sent_draft", id: `draft_${randomUUID()}` };
    }
  }

  return withOwnerLock(owner.userId, async () => {
    const limits = EMAIL_LIMITS[plan];
    const capKind = i.kind === "auth" ? "auth" : "app";
    const cap = capKind === "auth" ? limits.perHourAuth : limits.perHourApp;
    const lastHour = await d.store.countSentSince(owner.userId, capKind, new Date(d.now().getTime() - HOUR_MS));
    if (lastHour + to.length > cap) return reject(err(429, "rate_limit_exceeded", `This account's plan sends at most ${cap} of these emails an hour.`), to);

    const month = monthOf(d.now());
    const used = await d.store.usage(owner.userId, month);
    const included = limits.includedPerMonth;
    const extra = Math.max(0, used + to.length - included) - Math.max(0, used - included);
    if (extra > 0 && !(await d.debitIfEnough(owner.userId, extra * EXTRA_CENTICREDITS_PER_EMAIL, i.projectId))) {
      await d.notify({ type: "email_quota", projectId: i.projectId, recipientUserId: owner.userId, percent: 100, sent: used, included, noCredits: true });
      return reject(err(429, "monthly_quota_exceeded", "You have exceeded your monthly email sending quota, and there are no credits left for more."), to);
    }

    let firstId: string | null = null;
    let firstError: ResendError | null = null;
    let sent = 0;
    for (const r of to) {
      const one: ResendEmail = { ...e, to: [r], reply_to: e.reply_to ?? [owner.email] };
      const payload = i.kind === "auth" ? one : withFooter(one, d.unsubscribeUrl(i.projectId, r), domain.domain);
      const res = await d.resend.send(payload, i.idempotencyKey ? `${i.idempotencyKey}:${r}` : undefined);
      if ("error" in res) {
        firstError ??= res.error;
        await log(r, "rejected", res.error.message);
        continue;
      }
      firstId ??= res.id;
      sent++;
      await log(r, "sent", null, res.id);
    }
    const unsentExtra = Math.min(extra, to.length - sent);
    if (unsentExtra > 0) await d.refund(owner.userId, unsentExtra * EXTRA_CENTICREDITS_PER_EMAIL, i.projectId);
    if (sent === 0) return { kind: "rejected", error: firstError! };

    const after = await d.store.addUsage(owner.userId, month, sent);
    for (const percent of [80, 100] as const) {
      const line = (included * percent) / 100;
      if (used < line && after >= line) await d.notify({ type: "email_quota", projectId: i.projectId, recipientUserId: owner.userId, percent, sent: after, included, noCredits: false });
    }
    return { kind: "sent", id: firstId!, skipped };
  });
}
