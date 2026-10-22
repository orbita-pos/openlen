// /api/email/webhooks/resend — RESEND'S WEBHOOKS FOR THE CUSTOMERS' ACCOUNT (spec local
// 2026-10-22-email-integration, 6.7): delivered, bounced, complained. Only a
// signed one is read (RESEND_CLIENTS_WEBHOOK_SECRET); Resend retries anything
// that isn't a 2xx, so a known event that changes nothing still answers 200.

import type { ResendEvent } from "@/lib/project-email/webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const [{ realWebhookDeps }, { handleResendEvent, verifyResendWebhook }] = await Promise.all([import("@/lib/project-email/real"), import("@/lib/project-email/webhooks")]);
  const deps = realWebhookDeps();
  const payload = await req.text();
  const headers = { id: req.headers.get("svix-id") ?? "", timestamp: req.headers.get("svix-timestamp") ?? "", signature: req.headers.get("svix-signature") ?? "" };
  if (!verifyResendWebhook(payload, headers, deps.secret, new Date())) return new Response("Invalid signature", { status: 400 });
  let event: ResendEvent;
  try {
    event = JSON.parse(payload) as ResendEvent;
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  await handleResendEvent(event, deps.store);
  return new Response("ok");
}
