// lib/project-email/form-reply.ts — A PAGE'S FORM ANSWERS WHOEVER FILLED IT (spec local
// 2026-10-22-email-integration, 6.5): the form's own setting (`autoReply`, next to
// the owner's notice), sent from the project's domain through the sending core as
// a form email (unsubscribe footer included). Against a bot filling it with other
// people's addresses: one reply per address and day, 20 per form and hour, and no
// links to sites that aren't the project's. Without a paid plan or a ready domain
// it does nothing and the form works as today. Pure apart from SendDeps.

import type { FormConfig } from "@/lib/projects/types";

import { sendProjectEmail, type SendDeps, type SendOutcome } from "./send";
import { normalizeAddress } from "./types";

const ADDRESS = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/;
const EMAIL_FIELD = /e-?mail|correo/i;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const PER_FORM_PER_HOUR = 20;

/** The one address to reply to: the field named like an email, else any value that is exactly one address. */
export function replyAddress(data: Readonly<Record<string, string>>): string | null {
  const ok = (v: string | undefined) => (typeof v === "string" && v.length <= 254 && ADDRESS.test(v.trim()) ? normalizeAddress(v) : null);
  const named = Object.keys(data).filter((k) => EMAIL_FIELD.test(k));
  if (named.length > 0) return ok(data[named[0]!]);
  for (const v of Object.values(data)) {
    const a = ok(v);
    if (a) return a;
  }
  return null;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fillWith = (text: string, data: Readonly<Record<string, string>>, map: (v: string) => string) => text.replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (_m, name: string) => map(data[name] ?? ""));
const URL_IN_TEXT = /https?:\/\/([^\s/?#<>"']+)/gi;

function allowedHost(host: string, hosts: readonly string[]): boolean {
  const h = host.toLowerCase().replace(/:\d+$/, "");
  return hosts.some((ok) => h === ok || h.endsWith(`.${ok}`));
}

export function renderReply(tpl: { subject: string; body: string }, data: Readonly<Record<string, string>>, projectHosts: readonly string[]): { subject: string; html: string; text: string } | { error: string } {
  const text = fillWith(tpl.body, data, (v) => v);
  for (const m of text.matchAll(URL_IN_TEXT)) {
    if (!allowedHost(m[1]!, projectHosts)) return { error: `The reply links to ${m[1]}, which isn't one of this project's sites.` };
  }
  const subject = fillWith(tpl.subject, data, (v) => v).replace(/[\r\n]+/g, " ").trim();
  const html = fillWith(tpl.body, data, escapeHtml)
    .split(/\r?\n\s*\r?\n/)
    .map((p) => `<p>${p.replace(/\r?\n/g, "<br>")}</p>`)
    .join("");
  return { subject, html, text };
}

/** The form's reply setting and its key, resolved as the owner's lead notice resolves it. */
export function formReplyConfig(
  forms: Readonly<Record<string, FormConfig>> | undefined,
  formId: string | null,
  formIndex: number | null,
  page: string | null,
): { key: string; reply: { subject: string; body: string } } | null {
  if (!forms) return null;
  const keys = [...(formId ? [formId] : []), ...(formIndex !== null ? [...(page ? [`${page}:${formIndex}`] : []), String(formIndex)] : [])];
  for (const key of keys) {
    const reply = forms[key]?.autoReply;
    if (reply?.subject && reply.body) return { key, reply };
  }
  return null;
}

export async function sendFormReply(
  i: { projectId: string; formKey: string; fromName: string | null; hosts: readonly string[]; reply: { subject: string; body: string }; data: Readonly<Record<string, string>> },
  d: SendDeps,
): Promise<SendOutcome | null> {
  const to = replyAddress(i.data);
  if (!to) return null;
  const domain = await d.store.getDomain(i.projectId);
  if (domain?.status !== "ready") return null;
  const owner = await d.ownerOf(i.projectId);
  if (!owner || (await d.planOf(owner.userId)) === "free") return null;
  const now = d.now().getTime();
  if ((await d.store.countMessages({ projectId: i.projectId, kind: "form", toAddress: to, since: new Date(now - DAY_MS) })) > 0) return null;
  if ((await d.store.countMessages({ projectId: i.projectId, kind: "form", tag: i.formKey, since: new Date(now - HOUR_MS) })) >= PER_FORM_PER_HOUR) return null;
  const rendered = renderReply(i.reply, i.data, [...i.hosts, domain.domain]);
  if ("error" in rendered) return null;
  const name = (i.fromName ?? "").replace(/[<>"\r\n]/g, "").trim();
  const from = name ? `${name} <noreply@${domain.sendingHost}>` : `noreply@${domain.sendingHost}`;
  return sendProjectEmail({ projectId: i.projectId, environment: "live", kind: "form", tag: i.formKey, email: { from, to: [to], ...rendered } }, d);
}
