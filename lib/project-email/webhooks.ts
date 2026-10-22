// lib/project-email/webhooks.ts — WHAT RESEND SAYS HAPPENED TO AN EMAIL (spec local
// 2026-10-22-email-integration, 6.7): its webhooks come signed the Svix way
// (resend.com/docs/dashboard/webhooks/verify-webhooks-requests → Svix's manual
// verification, read 22/10). Delivered marks the row; a hard bounce, Resend's own
// suppression or a complaint also put the address on the project's list, which
// stops the sign-in emails too. A soft bounce changes nothing. Pure apart from the store.

import { createHmac, timingSafeEqual } from "node:crypto";

import type { EmailStore } from "./types";

const TOLERANCE_S = 5 * 60;

export function verifyResendWebhook(payload: string, headers: { id: string; timestamp: string; signature: string }, secret: string, now: Date): boolean {
  if (!secret.startsWith("whsec_") || !headers.id || !/^\d+$/.test(headers.timestamp)) return false;
  if (Math.abs(Math.floor(now.getTime() / 1000) - Number(headers.timestamp)) > TOLERANCE_S) return false;
  const key = Buffer.from(secret.slice("whsec_".length), "base64");
  const want = Buffer.from(createHmac("sha256", key).update(`${headers.id}.${headers.timestamp}.${payload}`).digest("base64"));
  return headers.signature.split(" ").some((entry) => {
    const [version, sig] = entry.split(",", 2);
    if (version !== "v1" || !sig) return false;
    const given = Buffer.from(sig);
    return given.length === want.length && timingSafeEqual(given, want);
  });
}

export interface ResendEvent {
  readonly type: string;
  readonly data: { readonly email_id?: string; readonly bounce?: { readonly type?: string; readonly message?: string } };
}

export async function handleResendEvent(event: ResendEvent, store: EmailStore): Promise<void> {
  const id = event.data?.email_id;
  if (!id) return;
  if (event.type === "email.delivered") {
    await store.setStatusByResendId(id, "delivered", null);
    return;
  }
  const hard = (event.type === "email.bounced" && event.data.bounce?.type === "Permanent") || event.type === "email.suppressed";
  if (hard) {
    const row = await store.setStatusByResendId(id, "bounced", event.data.bounce?.message?.slice(0, 300) ?? "Suppressed by the email provider");
    if (row) await store.suppress(row.projectId, row.toAddress, "bounced");
    return;
  }
  if (event.type === "email.complained") {
    const row = await store.setStatusByResendId(id, "complained", null);
    if (row) await store.suppress(row.projectId, row.toAddress, "complained");
  }
}
