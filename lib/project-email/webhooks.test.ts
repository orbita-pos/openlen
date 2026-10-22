import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { memoryEmailStore } from "./store";
import { handleResendEvent, verifyResendWebhook } from "./webhooks";

const KEY = Buffer.from("una-clave-de-prueba-de-32-bytes!");
const SECRET = `whsec_${KEY.toString("base64")}`;
const NOW = new Date("2026-10-22T10:00:00Z");
const TS = String(Math.floor(NOW.getTime() / 1000));

const sign = (id: string, ts: string, body: string) => `v1,${createHmac("sha256", KEY).update(`${id}.${ts}.${body}`).digest("base64")}`;

describe("verifyResendWebhook (Svix)", () => {
  const body = '{"type":"email.delivered","data":{"email_id":"re_1"}}';

  it("a valid Svix signature passes; a tampered body or an old timestamp doesn't", () => {
    expect(verifyResendWebhook(body, { id: "msg_1", timestamp: TS, signature: sign("msg_1", TS, body) }, SECRET, NOW)).toBe(true);
    expect(verifyResendWebhook(body.replace("delivered", "bounced"), { id: "msg_1", timestamp: TS, signature: sign("msg_1", TS, body) }, SECRET, NOW)).toBe(false);
    const old = String(Math.floor(NOW.getTime() / 1000) - 6 * 60);
    expect(verifyResendWebhook(body, { id: "msg_1", timestamp: old, signature: sign("msg_1", old, body) }, SECRET, NOW)).toBe(false);
  });

  it("any one of several signatures may match; none, a missing secret or junk don't", () => {
    expect(verifyResendWebhook(body, { id: "msg_1", timestamp: TS, signature: `v1,AAAA ${sign("msg_1", TS, body)}` }, SECRET, NOW)).toBe(true);
    expect(verifyResendWebhook(body, { id: "msg_1", timestamp: TS, signature: "v1,AAAA v1,BBBB" }, SECRET, NOW)).toBe(false);
    expect(verifyResendWebhook(body, { id: "msg_1", timestamp: TS, signature: sign("msg_1", TS, body) }, "", NOW)).toBe(false);
    expect(verifyResendWebhook(body, { id: "msg_1", timestamp: "ayer", signature: sign("msg_1", "ayer", body) }, SECRET, NOW)).toBe(false);
  });
});

async function world() {
  const store = memoryEmailStore(() => NOW);
  for (const [resendId, kind] of [["re_app", "app"], ["re_auth", "auth"]] as const) {
    await store.logMessage({ projectId: "p1", ownerId: "u1", environment: "live", kind, toAddress: "ana@x.com", subject: "Hola", status: "sent", reason: null, resendId, tag: null });
  }
  return store;
}

describe("handleResendEvent", () => {
  it("delivered marks the email delivered", async () => {
    const store = await world();
    await handleResendEvent({ type: "email.delivered", data: { email_id: "re_app" } }, store);
    expect((await store.recentMessages("p1", 5)).find((m) => m.resendId === "re_app")?.status).toBe("delivered");
  });

  it("a hard bounce suppresses, a soft one doesn't", async () => {
    const soft = await world();
    await handleResendEvent({ type: "email.bounced", data: { email_id: "re_app", bounce: { type: "Temporary", message: "Mailbox full" } } }, soft);
    expect(await soft.isSuppressed("p1", "ana@x.com", "app")).toBe(false);
    const hard = await world();
    await handleResendEvent({ type: "email.bounced", data: { email_id: "re_app", bounce: { type: "Permanent", message: "No such user" } } }, hard);
    const row = (await hard.recentMessages("p1", 5)).find((m) => m.resendId === "re_app");
    expect(row).toMatchObject({ status: "bounced", reason: "No such user" });
    // A hard bounce stops the sign-in emails too (spec 6.7).
    expect(await hard.isSuppressed("p1", "ana@x.com", "auth")).toBe(true);
  });

  it("a complaint suppresses everything; Resend's own suppression counts as a bounce", async () => {
    const store = await world();
    await handleResendEvent({ type: "email.complained", data: { email_id: "re_auth" } }, store);
    expect(await store.isSuppressed("p1", "ana@x.com", "auth")).toBe(true);
    expect((await store.listSuppressions("p1"))[0]).toMatchObject({ address: "ana@x.com", reason: "complained" });
    const other = await world();
    await handleResendEvent({ type: "email.suppressed", data: { email_id: "re_app" } }, other);
    expect((await other.listSuppressions("p1"))[0]).toMatchObject({ reason: "bounced" });
  });

  it("an unknown email or another event changes nothing and doesn't throw", async () => {
    const store = await world();
    await handleResendEvent({ type: "email.bounced", data: { email_id: "re_otro", bounce: { type: "Permanent" } } }, store);
    await handleResendEvent({ type: "email.opened", data: { email_id: "re_app" } }, store);
    expect(await store.listSuppressions("p1")).toEqual([]);
    expect((await store.recentMessages("p1", 5)).every((m) => m.status === "sent")).toBe(true);
  });
});
