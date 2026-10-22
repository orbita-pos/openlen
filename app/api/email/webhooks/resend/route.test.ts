// @vitest-environment node
//
// Resend's webhooks for the customers' account (spec local
// 2026-10-22-email-integration, 6.7): only a signed one changes anything.
import { createHmac } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { memoryEmailStore } from "@/lib/project-email/store";

const KEY = Buffer.from("una-clave-de-prueba-de-32-bytes!");
const m = vi.hoisted(() => ({ store: null as unknown }));
vi.mock("@/lib/project-email/real", () => ({ realWebhookDeps: () => ({ store: m.store, secret: `whsec_${Buffer.from("una-clave-de-prueba-de-32-bytes!").toString("base64")}` }) }));

import { POST } from "./route";

const store = () => m.store as ReturnType<typeof memoryEmailStore>;

function request(body: string, signedBody = body) {
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = `v1,${createHmac("sha256", KEY).update(`msg_1.${ts}.${signedBody}`).digest("base64")}`;
  return new Request("https://openlen.com/api/email/webhooks/resend", { method: "POST", headers: { "svix-id": "msg_1", "svix-timestamp": ts, "svix-signature": sig }, body });
}

beforeEach(async () => {
  m.store = memoryEmailStore();
  await store().logMessage({ projectId: "p1", ownerId: "u1", environment: "live", kind: "app", toAddress: "ana@x.com", subject: "Hola", status: "sent", reason: null, resendId: "re_1", tag: null });
});

describe("/api/email/webhooks/resend", () => {
  const complaint = JSON.stringify({ type: "email.complained", data: { email_id: "re_1" } });

  it("a signed complaint suppresses the address", async () => {
    const r = await POST(request(complaint));
    expect(r.status).toBe(200);
    expect(await store().isSuppressed("p1", "ana@x.com", "auth")).toBe(true);
  });

  it("an unsigned or tampered one is refused and changes nothing", async () => {
    const r = await POST(request(complaint, JSON.stringify({ type: "email.delivered", data: { email_id: "re_1" } })));
    expect(r.status).toBe(400);
    expect(await store().isSuppressed("p1", "ana@x.com", "app")).toBe(false);
  });
});
