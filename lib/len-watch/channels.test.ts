// The `len_watch` notice through the three channels. The texts arrive already written (in the
// owner's language) in the event; each channel only carries them.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LenWatchEvent } from "@/lib/notifications/types";

vi.hoisted(() => {
  process.env.VAPID_PUBLIC_KEY = "BFakePublicKeyForTestingOnly12345678901234567890123456789012";
  process.env.VAPID_PRIVATE_KEY = "fake-private-key-for-testing-only";
  process.env.VAPID_SUBJECT = "mailto:test@test.invalid";
});

vi.mock("web-push", () => ({ default: { setVapidDetails: vi.fn(), sendNotification: vi.fn(async () => ({})) } }));

const { sendLenWatchEmail } = vi.hoisted(() => ({ sendLenWatchEmail: vi.fn(async () => undefined) }));
vi.mock("@/lib/email", async (orig) => ({ ...(await orig<typeof import("@/lib/email")>()), sendLenWatchEmail }));

vi.mock("@/lib/db", async () => {
  const s = await import("@/lib/db/schema");
  const chain = { from: () => chain, where: () => chain, limit: async () => [{ email: "owner@x.test", title: "Holi" }] };
  return { schema: s, db: { select: () => chain } };
});

const { emailChannel } = await import("@/lib/notifications/channels/email");
const { lenWatchPush, urlDelChat } = await import("@/lib/notifications/channels/webpush");
const { mensajeFcm } = await import("@/lib/notifications/channels/fcm-transporte");

const EVENT: LenWatchEvent = {
  type: "len_watch",
  projectId: "p1",
  recipientUserId: "u1",
  incidentId: "i1",
  phase: "fixing",
  title: "Holi no carga",
  body: "Len ya está en ello.",
  emailSubject: "Holi no carga: Len ya está en ello",
  emailText: "Abrimos https://holi.openlen.app …",
};

beforeEach(() => sendLenWatchEmail.mockClear());

describe("the len_watch notice", () => {
  it("goes by email with its own subject and text", async () => {
    expect(await emailChannel.send(EVENT)).toBe("sent");
    expect(sendLenWatchEmail).toHaveBeenCalledWith({ to: "owner@x.test", subject: EVENT.emailSubject, text: EVENT.emailText });
  });

  it("goes to the browser and opens the project's chat", () => {
    expect(lenWatchPush(EVENT)).toEqual({ title: EVENT.title, body: EVENT.body, url: urlDelChat("p1") });
  });

  it("goes to the phone with its title and body", () => {
    const m = mensajeFcm(EVENT, "tok").message;
    expect(m.notification).toEqual({ title: EVENT.title, body: EVENT.body });
    expect(m.data).toMatchObject({ type: "len_watch", projectId: "p1" });
  });
});
