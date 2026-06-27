import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, sql as rawSql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { NotificationEvent } from "@/lib/notifications/types";
// ── Hoisted mocks ─────────────────────────────────────────────────────────────
// Must be hoisted so vi.mock factories can reference them.

const { mockWebPushSend, mockEmailSend, mockIsOnline } = vi.hoisted(() => ({
  mockWebPushSend: vi.fn(),
  mockEmailSend: vi.fn(),
  mockIsOnline: vi.fn(() => false),
}));

vi.mock("@/lib/notifications/channels/index", () => ({
  CHANNELS: [
    { id: "webpush" as const, isEnabled: () => true, send: mockWebPushSend },
    { id: "email" as const, isEnabled: () => true, send: mockEmailSend },
  ],
}));

vi.mock("@/lib/chat/hub", () => ({
  hub: { isProjectStaffOnline: mockIsOnline },
}));

vi.mock("@/lib/chat/agents", () => ({
  listAgentUserIds: vi.fn(async () => []),
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { scheduleNotification, runJob, drainPending, withinQuietHours, loadPrefs } from "./dispatch";

// ── Test fixtures ─────────────────────────────────────────────────────────────

const UID = "test-dispatch-u-" + Math.random().toString(36).slice(2, 9);

const testEvent: NotificationEvent = {
  type: "chat_message",
  projectId: "test-dispatch-proj",
  conversationId: "test-dispatch-conv",
  recipientUserId: UID,
  senderName: "Alice",
  preview: "Hello from tests!",
};

// ── Lifecycle ─────────────────────────────────────────────────────────────────

beforeAll(async () => {
  await db
    .insert(schema.users)
    .values({ id: UID, email: `${UID}@test.invalid`, name: "Dispatch Test" })
    .onConflictDoNothing();
});

afterAll(async () => {
  await db.execute(rawSql`DELETE FROM "notificationDeliveries" WHERE "userId" = ${UID}`);
  await db.execute(rawSql`DELETE FROM "notificationJobs" WHERE payload->>'recipientUserId' = ${UID}`);
  await db.delete(schema.notificationPreferences).where(eq(schema.notificationPreferences.userId, UID));
  await db.delete(schema.users).where(eq(schema.users.id, UID));
});

beforeEach(() => {
  mockWebPushSend.mockReset();
  mockEmailSend.mockReset();
  mockIsOnline.mockReset();
  mockIsOnline.mockReturnValue(false);
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function insertJob(overrides: Partial<{
  id: string;
  attempts: number;
  status: "pending" | "done" | "dead";
  runAfter: Date;
  dedupeKey: string | null;
}> = {}) {
  const id = overrides.id ?? crypto.randomUUID();
  await db.insert(schema.notificationJobs).values({
    id,
    payload: testEvent as unknown as Record<string, unknown>,
    status: overrides.status ?? "pending",
    attempts: overrides.attempts ?? 0,
    runAfter: overrides.runAfter ?? new Date(),
    dedupeKey: overrides.dedupeKey ?? null,
  });
  return id;
}

async function getJob(id: string) {
  const rows = await db
    .select()
    .from(schema.notificationJobs)
    .where(eq(schema.notificationJobs.id, id));
  return rows[0] ?? null;
}

async function getDeliveries(userId = UID) {
  return db
    .select()
    .from(schema.notificationDeliveries)
    .where(eq(schema.notificationDeliveries.userId, userId));
}

// ── withinQuietHours (pure unit tests, no DB) ─────────────────────────────────

describe("withinQuietHours", () => {
  const base = {
    webPushEnabled: true,
    emailEnabled: true,
    quietFrom: null as string | null,
    quietUntil: null as string | null,
    timezone: "UTC",
  };

  it("returns false when no quiet window set", () => {
    expect(withinQuietHours(base, new Date())).toBe(false);
  });

  it("same-day window: true when inside", () => {
    // 14:30 UTC
    const date = new Date("2024-06-15T14:30:00Z");
    expect(withinQuietHours({ ...base, quietFrom: "14:00", quietUntil: "16:00" }, date)).toBe(true);
  });

  it("same-day window: false when before", () => {
    const date = new Date("2024-06-15T13:59:00Z");
    expect(withinQuietHours({ ...base, quietFrom: "14:00", quietUntil: "16:00" }, date)).toBe(false);
  });

  it("same-day window: false when at or after until", () => {
    const date = new Date("2024-06-15T16:00:00Z");
    expect(withinQuietHours({ ...base, quietFrom: "14:00", quietUntil: "16:00" }, date)).toBe(false);
  });

  it("overnight window: true late at night (after from)", () => {
    const date = new Date("2024-06-15T23:30:00Z");
    expect(withinQuietHours({ ...base, quietFrom: "22:00", quietUntil: "08:00" }, date)).toBe(true);
  });

  it("overnight window: true early morning (before until)", () => {
    const date = new Date("2024-06-15T05:00:00Z");
    expect(withinQuietHours({ ...base, quietFrom: "22:00", quietUntil: "08:00" }, date)).toBe(true);
  });

  it("overnight window: false during the day", () => {
    const date = new Date("2024-06-15T12:00:00Z");
    expect(withinQuietHours({ ...base, quietFrom: "22:00", quietUntil: "08:00" }, date)).toBe(false);
  });
});

// ── scheduleNotification ──────────────────────────────────────────────────────

describe("scheduleNotification", () => {
  it("(a) inserts a pending job row", async () => {
    mockWebPushSend.mockResolvedValue("sent");
    mockIsOnline.mockReturnValue(false);

    const key = `insert-${Date.now()}-${Math.random()}`;
    await scheduleNotification(testEvent, key);

    // Poll until the inline fire-and-forget runJob settles (prevents inflight
    // async from contaminating subsequent tests' mock call counts).
    await vi.waitFor(
      async () => {
        const rows = await db
          .select({ status: schema.notificationJobs.status })
          .from(schema.notificationJobs)
          .where(eq(schema.notificationJobs.dedupeKey, key));
        expect(rows[0]?.status).not.toBe("pending");
      },
      { timeout: 8000, interval: 100 },
    );

    const rows = await db
      .select()
      .from(schema.notificationJobs)
      .where(eq(schema.notificationJobs.dedupeKey, key));
    expect(rows).toHaveLength(1);
  });

  it("(a) dedup: same dedupeKey while pending → exactly 1 row in DB", async () => {
    // Test the ON CONFLICT SQL dedup directly, without triggering inline runJob.
    // (scheduleNotification fires void runJob which can race with later tests.)
    const key = `dedup-${Date.now()}-${Math.random()}`;

    // First insert (creates the row)
    await db.execute(rawSql`
      INSERT INTO "notificationJobs" ("id", "payload", "dedupeKey", "status", "attempts", "runAfter", "createdAt", "updatedAt")
      VALUES (
        ${crypto.randomUUID()},
        ${JSON.stringify(testEvent)}::jsonb,
        ${key},
        'pending',
        0,
        now() + interval '1 hour',
        now(),
        now()
      )
    `);

    // Second insert with same key — ON CONFLICT DO UPDATE, not a new row
    await db.execute(rawSql`
      INSERT INTO "notificationJobs" ("id", "payload", "dedupeKey", "status", "attempts", "runAfter", "createdAt", "updatedAt")
      VALUES (
        ${crypto.randomUUID()},
        ${JSON.stringify({ ...testEvent, preview: "updated" })}::jsonb,
        ${key},
        'pending',
        0,
        now() + interval '1 hour',
        now(),
        now()
      )
      ON CONFLICT ("dedupeKey") WHERE status = 'pending' AND "dedupeKey" IS NOT NULL
      DO UPDATE SET "payload" = EXCLUDED."payload", "updatedAt" = now()
    `);

    const rows = await db
      .select()
      .from(schema.notificationJobs)
      .where(eq(schema.notificationJobs.dedupeKey, key));

    expect(rows).toHaveLength(1);
    // Payload should reflect the second call's content (was updated)
    expect((rows[0]?.payload as Record<string, unknown>)?.preview).toBe("updated");

    // Cleanup (job is still pending with far-future runAfter)
    await db.execute(rawSql`DELETE FROM "notificationJobs" WHERE "dedupeKey" = ${key}`);
  });
});

// ── runJob ────────────────────────────────────────────────────────────────────

describe("runJob", () => {
  it("(b) presence online → job done + 'skipped' delivery, no channel.send called", async () => {
    mockIsOnline.mockReturnValue(true);

    const id = await insertJob();
    await runJob(id);

    const job = await getJob(id);
    expect(job?.status).toBe("done");
    expect(mockWebPushSend).not.toHaveBeenCalled();
    expect(mockEmailSend).not.toHaveBeenCalled();

    const deliveries = await getDeliveries();
    expect(deliveries.some((d) => d.status === "skipped" && d.channel === "presence")).toBe(true);
  });

  it("no-op when job is already done (0-row claim)", async () => {
    mockWebPushSend.mockResolvedValue("sent");

    const id = await insertJob({ status: "done" });
    await runJob(id); // should immediately return (0 rows from UPDATE)

    // No sends, no delivery rows (nothing was attempted)
    expect(mockWebPushSend).not.toHaveBeenCalled();
  });

  it("(c) channel throw → job stays pending, attempts incremented, runAfter in future", async () => {
    mockIsOnline.mockReturnValue(false);
    mockWebPushSend.mockRejectedValue(new Error("transient push failure"));
    mockEmailSend.mockRejectedValue(new Error("transient email failure"));

    const id = await insertJob({ attempts: 0 });
    const before = Date.now();
    await runJob(id);

    const job = await getJob(id);
    expect(job?.status).toBe("pending");
    expect(job?.attempts).toBe(1);
    expect(job?.runAfter.getTime()).toBeGreaterThan(before);
  });

  it("(c) attempts >= 5 → status dead + dlq delivery row", async () => {
    mockIsOnline.mockReturnValue(false);
    mockWebPushSend.mockRejectedValue(new Error("still failing"));
    mockEmailSend.mockRejectedValue(new Error("still failing"));

    // Insert with attempts=4; after atomic claim it becomes 5 → dead
    const id = await insertJob({ attempts: 4 });
    await runJob(id);

    const job = await getJob(id);
    expect(job?.status).toBe("dead");

    const deliveries = await getDeliveries();
    expect(deliveries.some((d) => d.status === "dlq" && d.channel === "dlq")).toBe(true);
  });

  it("(d) push 'sent' → email is skipped (no double-notify)", async () => {
    mockIsOnline.mockReturnValue(false);
    mockWebPushSend.mockResolvedValue("sent");

    const id = await insertJob();
    await runJob(id);

    expect(mockEmailSend).not.toHaveBeenCalled();

    const job = await getJob(id);
    expect(job?.status).toBe("done");

    const deliveries = await getDeliveries();
    expect(deliveries.some((d) => d.channel === "email" && d.status === "skipped")).toBe(true);
    expect(deliveries.some((d) => d.channel === "webpush" && d.status === "sent")).toBe(true);
  });

  it("(e) push 'skipped' (no subs) → email is attempted", async () => {
    mockIsOnline.mockReturnValue(false);
    mockWebPushSend.mockResolvedValue("skipped");
    mockEmailSend.mockResolvedValue("sent");

    const id = await insertJob();
    await runJob(id);

    expect(mockEmailSend).toHaveBeenCalledOnce();

    const job = await getJob(id);
    expect(job?.status).toBe("done");
  });

  it("(e) push throws + email 'sent' → job done (notify once, no retry)", async () => {
    mockIsOnline.mockReturnValue(false);
    mockWebPushSend.mockRejectedValue(new Error("push transient error"));
    mockEmailSend.mockResolvedValue("sent");

    const id = await insertJob();
    await runJob(id);

    expect(mockEmailSend).toHaveBeenCalledOnce();

    // Email delivered → the owner was notified once. Even though push threw, the
    // job is DONE: retrying would re-send the email (duplicate/spam). lastError
    // is also cleared on the done path.
    const job = await getJob(id);
    expect(job?.status).toBe("done");
    expect(job?.lastError).toBeNull();
  });

  it("(e) no double-send: re-running a delivered job is a 0-row claim (no extra sends/deliveries)", async () => {
    mockIsOnline.mockReturnValue(false);
    mockWebPushSend.mockRejectedValue(new Error("push transient error"));
    mockEmailSend.mockResolvedValue("sent");

    const id = await insertJob();
    await runJob(id);
    expect((await getJob(id))?.status).toBe("done");

    const sendsBefore = mockWebPushSend.mock.calls.length + mockEmailSend.mock.calls.length;
    const deliveriesBefore = (await getDeliveries()).length;

    // Second run: the atomic claim matches no 'pending' row → 0 rows → no work.
    await runJob(id);

    const sendsAfter = mockWebPushSend.mock.calls.length + mockEmailSend.mock.calls.length;
    const deliveriesAfter = (await getDeliveries()).length;

    expect(sendsAfter).toBe(sendsBefore); // no second send of any channel
    expect(deliveriesAfter).toBe(deliveriesBefore); // no extra delivery rows
    expect((await getJob(id))?.status).toBe("done");
  });

  it("(e) push throws AND email throws → nothing delivered → retry (pending, attempts++)", async () => {
    mockIsOnline.mockReturnValue(false);
    mockWebPushSend.mockRejectedValue(new Error("push transient error"));
    mockEmailSend.mockRejectedValue(new Error("email transient error"));

    const id = await insertJob({ attempts: 0 });
    await runJob(id);

    // No channel delivered → genuine failure → retry path stays covered.
    const job = await getJob(id);
    expect(job?.status).toBe("pending");
    expect(job?.attempts).toBe(1);
  });

  it("quiet hours → job stays pending with runAfter bumped, no channels called", async () => {
    mockIsOnline.mockReturnValue(false);

    // Overnight window 23:59→23:58 covers ~24h (only the minute 23:58 UTC is outside).
    // Using overnight (from > until) ensures the check passes regardless of hour.
    await db
      .insert(schema.notificationPreferences)
      .values({
        userId: UID,
        webPushEnabled: true,
        emailEnabled: true,
        quietFrom: "23:59",
        quietUntil: "23:58",
        timezone: "UTC",
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.notificationPreferences.userId,
        set: { quietFrom: "23:59", quietUntil: "23:58", timezone: "UTC" },
      });

    // Verify prefs landed correctly
    const prefs = await loadPrefs(UID);
    expect(prefs.quietFrom).toBe("23:59");
    expect(prefs.quietUntil).toBe("23:58");
    // Sanity-check our own function agrees we're in quiet hours right now
    expect(withinQuietHours(prefs, new Date())).toBe(true);

    const before = Date.now();
    const id = await insertJob({ runAfter: new Date(), attempts: 0 });

    // Clear any calls from previous tests' inflight async runJobs
    mockWebPushSend.mockClear();
    mockEmailSend.mockClear();

    await runJob(id);

    const job = await getJob(id);
    expect(job?.status).toBe("pending");
    expect(job?.runAfter.getTime()).toBeGreaterThan(before);
    // Deferring for quiet hours must not burn a real attempt (Minor 2).
    expect(job?.attempts).toBe(0);
    expect(mockWebPushSend).not.toHaveBeenCalled();
    expect(mockEmailSend).not.toHaveBeenCalled();

    // Cleanup prefs
    await db
      .delete(schema.notificationPreferences)
      .where(eq(schema.notificationPreferences.userId, UID));
  });

  it("both channels succeed → job done + deliveries logged", async () => {
    mockIsOnline.mockReturnValue(false);
    mockWebPushSend.mockResolvedValue("sent");
    // email should be skipped (push sent), but we track that via delivery log
    const id = await insertJob();
    await runJob(id);

    const job = await getJob(id);
    expect(job?.status).toBe("done");

    const deliveries = await getDeliveries();
    expect(deliveries.length).toBeGreaterThanOrEqual(2);
  });
});

// ── drainPending ──────────────────────────────────────────────────────────────

describe("drainPending", () => {
  it("(f) picks up a stale pending job (runAfter in the past) and processes it", async () => {
    mockIsOnline.mockReturnValue(false);
    mockWebPushSend.mockResolvedValue("sent");

    const id = await insertJob({ runAfter: new Date(0) }); // epoch → definitely past

    const count = await drainPending(50);
    expect(count).toBeGreaterThanOrEqual(1);

    const job = await getJob(id);
    expect(job?.status).toBe("done");
  });

  it("does not pick up jobs with runAfter in the future", async () => {
    mockWebPushSend.mockResolvedValue("sent");

    const id = await insertJob({ runAfter: new Date(Date.now() + 3_600_000) });

    // drainPending should NOT process this job
    await drainPending(50);

    const job = await getJob(id);
    // still pending (not processed)
    expect(job?.status).toBe("pending");

    // Cleanup
    await db.delete(schema.notificationJobs).where(eq(schema.notificationJobs.id, id));
  });
});
