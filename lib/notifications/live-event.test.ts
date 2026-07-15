import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { ChatMessageEvent, LiveSheetBrokenEvent } from "@/lib/notifications/types";

// Discriminated-union coverage: today NotificationEvent only had `chat_message`
// and both channels read event.conversationId/senderName/preview unconditionally.
// A `live_sheet_broken` event would have produced an empty/undefined push and a
// TypeError in email. These tests prove both channels branch by event.type.

// ── Env (same posture as webpush.test.ts — required before the module loads) ──
// RESEND_API_KEY makes lib/email.ts build a live Resend client at module load
// (`const client = apiKey ? new Resend(apiKey) : null`); we mock the `resend`
// package BENEATH the real helpers so the REAL sendLiveSheetBrokenEmail /
// sendChatNotificationEmail run and hit the mocked transport (not a stub of the
// helper itself) — proving the new helper builds HTML without a TypeError and
// propagates a Resend rejection for retry.
vi.hoisted(() => {
  process.env.VAPID_PUBLIC_KEY = "BFakePublicKeyForTestingOnly12345678901234567890123456789012";
  process.env.VAPID_PRIVATE_KEY = "fake-private-key-for-testing-only";
  process.env.VAPID_SUBJECT = "mailto:test@test.invalid";
  process.env.RESEND_API_KEY = "re_test_fake_key_for_live_event";
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

const UID = "test-live-event-u-" + Math.random().toString(36).slice(2, 9);
const EP = "https://push.example.com/live-event-" + Math.random().toString(36).slice(2);

beforeAll(async () => {
  await db
    .insert(schema.users)
    .values({ id: UID, email: `${UID}@test.invalid`, name: "Live Event Test" })
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

const liveEvent: LiveSheetBrokenEvent = {
  type: "live_sheet_broken",
  projectId: "proj-2",
  recipientUserId: UID,
  sheetUrl: "https://sheets.example/1",
  missingCount: 3,
};

describe("webPushChannel.send — live_sheet_broken", () => {
  it("control: chat_message still builds /inbox?conv=<id> (unbroken)", async () => {
    await webPushChannel.send(chatEvent);
    const [, body] = mockSendNotification().mock.calls[0] as unknown as [unknown, string];
    const payload = JSON.parse(body) as { title?: string; url?: string };
    expect(payload.title).toBe("Alice");
    expect(payload.url).toBe("/inbox?conv=conv-123");
    expect(payload.url).not.toContain("undefined");
  });

  it("builds a payload with a defined title and a url with no literal 'undefined'", async () => {
    await webPushChannel.send(liveEvent);
    const [, body] = mockSendNotification().mock.calls[0] as unknown as [unknown, string];
    const payload = JSON.parse(body) as { title?: string; body?: string; url?: string };
    expect(payload.title).toBeDefined();
    expect(payload.title).not.toBe("");
    expect(payload.url).toBeDefined();
    expect(payload.url).not.toContain("undefined");
    expect(payload.url).toBe("/new?project=proj-2");
  });

  it("negative control (documents the pre-fix bug): unbranched access would have produced conv=undefined", () => {
    // Before the union + branch, webpush.ts read event.conversationId
    // unconditionally — live_sheet_broken has no conversationId, so that
    // literal template produced this exact string.
    const brokenUrl = "/inbox?conv=" + (liveEvent as unknown as { conversationId?: string }).conversationId;
    expect(brokenUrl).toBe("/inbox?conv=undefined");
  });
});

// These tests run the REAL sendLiveSheetBrokenEmail / sendChatNotificationEmail
// (no helper stub) with the Resend transport mocked beneath — so the actual
// HTML builder executes and any TypeError on a live_sheet_broken shape would
// surface, and a transport rejection is proven to propagate for retry.
describe("emailChannel.send — live_sheet_broken (real helper, transport mocked)", () => {
  it("success: real helper builds HTML without a TypeError and hits Resend with a sane subject/to/html", async () => {
    await expect(emailChannel.send(liveEvent)).resolves.toBe("sent");

    expect(mockEmailsSend).toHaveBeenCalledOnce();
    const payload = mockEmailsSend.mock.calls[0]?.[0] as {
      to?: string;
      subject?: string;
      html?: string;
      text?: string;
    };
    expect(payload.to).toBe(`${UID}@test.invalid`);
    // Live-sheet subject — proves the live branch ran, not the chat one.
    expect(payload.subject).toContain("Tu Sheet dejó de leerse");
    expect(payload.subject).not.toContain("New message");
    // HTML built without throwing; carries the editor link, no literal "undefined".
    expect(payload.html).toBeDefined();
    expect(payload.html).toContain("/new?project=proj-2");
    expect(payload.html).not.toContain("undefined");
    // missingCount=3 rendered into the copy.
    expect(payload.html).toContain("3 datos de tu Sheet");
  });

  it("success: missingCount=0 renders the 'conservó el último valor' copy (no TypeError)", async () => {
    await expect(emailChannel.send({ ...liveEvent, missingCount: 0 })).resolves.toBe("sent");
    const payload = mockEmailsSend.mock.calls[0]?.[0] as { html?: string; text?: string };
    expect(payload.html).toContain("conservó el último valor");
  });

  it("error: a Resend rejection propagates out of send (so the job retries)", async () => {
    mockEmailsSend.mockRejectedValueOnce(new Error("resend transport down"));
    await expect(emailChannel.send(liveEvent)).rejects.toThrow("resend transport down");
  });

  it("control: chat_message still routes to the chat email (subject 'New message'), unbroken", async () => {
    await expect(emailChannel.send(chatEvent)).resolves.toBe("sent");
    expect(mockEmailsSend).toHaveBeenCalledOnce();
    const payload = mockEmailsSend.mock.calls[0]?.[0] as { subject?: string; text?: string };
    expect(payload.subject).toContain("New message");
    expect(payload.subject).not.toContain("Tu Sheet");
    // Chat body still carries the sender name + preview, byte-identical behavior.
    expect(payload.text).toContain("Alice");
    expect(payload.text).toContain("Hello there");
  });

  it("control error: a Resend rejection on the chat path also propagates (retry parity)", async () => {
    mockEmailsSend.mockRejectedValueOnce(new Error("resend transport down"));
    await expect(emailChannel.send(chatEvent)).rejects.toThrow("resend transport down");
  });
});
