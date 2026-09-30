import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { ChatMessageEvent, LenTurnoEvent } from "@/lib/notifications/types";

// CADA CANAL, POR TIPO DE EVENTO. Nació como `live-event.test.ts` para probar
// que los dos canales ramificaban por `event.type` cuando llegó el segundo
// tipo, `live_sheet_broken` (datos vivos). Datos vivos se retiró en Len 2.1
// (2026-09-30) y con él ese tipo; quedan los controles del chat y el tipo de
// Len 2.1, `len_turno`, que es sólo push.

// ── Env (same posture as webpush.test.ts — required before the module loads) ──
// RESEND_API_KEY makes lib/email.ts build a live Resend client at module load
// (`const client = apiKey ? new Resend(apiKey) : null`); we mock the `resend`
// package BENEATH the real helper so the REAL sendChatNotificationEmail runs
// and hits the mocked transport (not a stub of the helper itself) — proving it
// propagates a Resend rejection for retry.
vi.hoisted(() => {
  process.env.VAPID_PUBLIC_KEY = "BFakePublicKeyForTestingOnly12345678901234567890123456789012";
  process.env.VAPID_PRIVATE_KEY = "fake-private-key-for-testing-only";
  process.env.VAPID_SUBJECT = "mailto:test@test.invalid";
  process.env.RESEND_API_KEY = "re_test_fake_key_for_canales";
});

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(async () => ({})),
  },
}));

const { mockEmailsSend } = vi.hoisted(() => ({
  mockEmailsSend: vi.fn(async (_payload: Record<string, unknown>) => ({
    data: { id: "test-email-id" },
    error: null,
  })),
}));

vi.mock("resend", () => ({
  Resend: vi.fn(() => ({
    emails: { send: mockEmailsSend },
    batch: { send: vi.fn() },
  })),
}));

import webpush from "web-push";
import { webPushChannel } from "@/lib/notifications/channels/webpush";
import { emailChannel } from "@/lib/notifications/channels/email";

const mockSendNotification = () => vi.mocked(webpush.sendNotification);

const UID = "test-canales-u-" + Math.random().toString(36).slice(2, 9);
const EP = "https://push.example.com/canales-" + Math.random().toString(36).slice(2);

beforeAll(async () => {
  await db
    .insert(schema.users)
    .values({ id: UID, email: `${UID}@test.invalid`, name: "Canales Test" })
    .onConflictDoNothing();
  await db
    .insert(schema.pushSubscriptions)
    .values({ endpoint: EP, userId: UID, p256dh: "fake-p256dh", auth: "fake-auth" })
    .onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, UID));
  await db.delete(schema.users).where(eq(schema.users.id, UID));
});

beforeEach(() => {
  mockSendNotification().mockClear();
  mockSendNotification().mockResolvedValue({} as never);
  mockEmailsSend.mockReset();
  mockEmailsSend.mockResolvedValue({ data: { id: "test-email-id" }, error: null });
});

const chatEvent: ChatMessageEvent = {
  type: "chat_message",
  projectId: "proj-1",
  conversationId: "conv-123",
  recipientUserId: UID,
  senderName: "Alice",
  preview: "Hello there",
};

const lenEvent: LenTurnoEvent = {
  type: "len_turno",
  projectId: "proj-2",
  recipientUserId: UID,
  preview: "Listo: cambié el titular.",
  pregunta: false,
};

describe("webPushChannel.send — por tipo", () => {
  it("chat_message builds /inbox?conv=<id>", async () => {
    await webPushChannel.send(chatEvent);
    const [, body] = mockSendNotification().mock.calls[0] as unknown as [unknown, string];
    const payload = JSON.parse(body) as { title?: string; url?: string };
    expect(payload.title).toBe("Alice");
    expect(payload.url).toBe("/inbox?conv=conv-123");
    expect(payload.url).not.toContain("undefined");
  });

});

// The REAL sendChatNotificationEmail runs (no helper stub) with the Resend
// transport mocked beneath, so a transport rejection is proven to propagate
// for retry.
describe("emailChannel.send — por tipo (real helper, transport mocked)", () => {
  it("chat_message routes to the chat email (subject 'New message')", async () => {
    await expect(emailChannel.send(chatEvent)).resolves.toBe("sent");
    expect(mockEmailsSend).toHaveBeenCalledOnce();
    const payload = mockEmailsSend.mock.calls[0]?.[0] as { subject?: string; text?: string };
    expect(payload.subject).toContain("New message");
    // Chat body still carries the sender name + preview, byte-identical behavior.
    expect(payload.text).toContain("Alice");
    expect(payload.text).toContain("Hello there");
  });

  it("a Resend rejection on the chat path propagates (so the job retries)", async () => {
    mockEmailsSend.mockRejectedValueOnce(new Error("resend transport down"));
    await expect(emailChannel.send(chatEvent)).rejects.toThrow("resend transport down");
  });

  // Len 2.1: el aviso de turno terminado es SÓLO push.
  it("len_turno no manda correo", async () => {
    await expect(emailChannel.send(lenEvent)).resolves.toBe("skipped");
    expect(mockEmailsSend).not.toHaveBeenCalled();
  });
});
