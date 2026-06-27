import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

// Set VAPID env vars before the module loads (vi.hoisted runs before imports)
vi.hoisted(() => {
  process.env.VAPID_PUBLIC_KEY = "BFakePublicKeyForTestingOnly12345678901234567890123456789012";
  process.env.VAPID_PRIVATE_KEY = "fake-private-key-for-testing-only";
  process.env.VAPID_SUBJECT = "mailto:test@test.invalid";
});

// Mock web-push so no real FCM calls are made
vi.mock("web-push", () => ({
  default: {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(),
  },
}));

import webpush from "web-push";
import { sendPushToUser, webPushChannel } from "@/lib/notifications/channels/webpush";

const UID = "test-webpush-u-" + Math.random().toString(36).slice(2);
const EP_OK = "https://push.example.com/ok-" + Math.random().toString(36).slice(2);
const EP_410 = "https://push.example.com/410-" + Math.random().toString(36).slice(2);
const EP_503 = "https://push.example.com/503-" + Math.random().toString(36).slice(2);

const mockSend = () => vi.mocked(webpush.sendNotification);

beforeAll(async () => {
  await db.insert(schema.users).values({
    id: UID,
    email: `${UID}@test.invalid`,
    name: "WebPush Test",
  }).onConflictDoNothing();
});

afterAll(async () => {
  await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, UID));
  await db.delete(schema.users).where(eq(schema.users.id, UID));
});

async function seedSub(endpoint: string) {
  await db.insert(schema.pushSubscriptions).values({
    endpoint,
    userId: UID,
    p256dh: "fake-p256dh-" + endpoint.slice(-6),
    auth: "fake-auth-" + endpoint.slice(-6),
  }).onConflictDoNothing();
}

async function cleanSubs() {
  await db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, UID));
  mockSend().mockReset();
}

describe("sendPushToUser", () => {
  it("success path: counts sent + bumps lastUsedAt", async () => {
    await cleanSubs();
    await seedSub(EP_OK);
    mockSend().mockResolvedValueOnce({} as never);

    const result = await sendPushToUser(UID, { title: "Hey", body: "msg" });
    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(mockSend()).toHaveBeenCalledOnce();

    // lastUsedAt should be set
    const rows = await db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, EP_OK));
    expect(rows[0]?.lastUsedAt).not.toBeNull();
  });

  it("410: deletes the row, does not count as sent or failed", async () => {
    await cleanSubs();
    await seedSub(EP_OK);
    await seedSub(EP_410);

    mockSend().mockImplementation(async (sub) => {
      if ((sub as { endpoint: string }).endpoint === EP_410) throw { statusCode: 410 };
      return {} as never;
    });

    const result = await sendPushToUser(UID, { title: "Hi" });
    expect(result.sent).toBe(1);
    expect(result.failed).toBe(0);

    // EP_410 row must be gone
    const gone = await db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, EP_410));
    expect(gone).toHaveLength(0);

    // EP_OK row must still be there
    const still = await db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, EP_OK));
    expect(still).toHaveLength(1);
  });

  it("503: counts as failed, does NOT delete row", async () => {
    await cleanSubs();
    await seedSub(EP_503);
    mockSend().mockRejectedValueOnce({ statusCode: 503 });

    const result = await sendPushToUser(UID, { title: "Hi" });
    expect(result).toEqual({ sent: 0, failed: 1 });

    // Row must still be there
    const rows = await db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpoint, EP_503));
    expect(rows).toHaveLength(1);
  });

  it("no subscriptions: returns {sent:0, failed:0}", async () => {
    await cleanSubs();
    const result = await sendPushToUser(UID, { title: "Hi" });
    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(mockSend()).not.toHaveBeenCalled();
  });
});

describe("webPushChannel", () => {
  it("id is 'webpush'", () => {
    expect(webPushChannel.id).toBe("webpush");
  });

  it("isEnabled reflects webPushEnabled pref", () => {
    expect(webPushChannel.isEnabled({ webPushEnabled: true, emailEnabled: false, quietFrom: null, quietUntil: null, timezone: "UTC" })).toBe(true);
    expect(webPushChannel.isEnabled({ webPushEnabled: false, emailEnabled: true, quietFrom: null, quietUntil: null, timezone: "UTC" })).toBe(false);
  });

  it("send returns 'sent' when at least one delivery succeeded", async () => {
    await cleanSubs();
    await seedSub(EP_OK);
    mockSend().mockResolvedValueOnce({} as never);

    const result = await webPushChannel.send({
      type: "chat_message",
      projectId: "proj-1",
      conversationId: "conv-1",
      recipientUserId: UID,
      senderName: "Alice",
      preview: "Hello",
    });
    expect(result).toBe("sent");
    expect(mockSend()).toHaveBeenCalledWith(
      expect.objectContaining({ endpoint: EP_OK }),
      expect.stringContaining("/inbox?conv=conv-1"),
    );
  });

  it("send returns 'skipped' when no subscriptions", async () => {
    await cleanSubs();
    const result = await webPushChannel.send({
      type: "chat_message",
      projectId: "p",
      conversationId: "c",
      recipientUserId: UID,
      senderName: "Bob",
      preview: "Hey",
    });
    expect(result).toBe("skipped");
  });

  it("send throws a retryable error when all fail (503)", async () => {
    await cleanSubs();
    await seedSub(EP_503);
    mockSend().mockRejectedValueOnce({ statusCode: 503 });

    await expect(
      webPushChannel.send({
        type: "chat_message",
        projectId: "p",
        conversationId: "c",
        recipientUserId: UID,
        senderName: "Bob",
        preview: "Hey",
      }),
    ).rejects.toThrow();
  });
});
