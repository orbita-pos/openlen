// Durable notification dispatcher — schedule, claim, fan-out, retry, DLQ.
// No persistent DB connection: every query uses the shared Drizzle neon-http
// handle (stateless per-request). No pg-boss / Redis.

import { sql, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { hub } from "@/lib/chat/hub";
import { listAgentUserIds } from "@/lib/chat/agents";
import { CHANNELS } from "@/lib/notifications/channels/index";
import type { NotificationEvent, NotificationPrefs } from "./types";

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_PREFS: NotificationPrefs = {
  webPushEnabled: true,
  emailEnabled: true,
  quietFrom: null,
  quietUntil: null,
  timezone: "America/Lima",
};

// ── Internal helpers ──────────────────────────────────────────────────────────

export async function loadPrefs(userId: string): Promise<NotificationPrefs> {
  const rows = await db
    .select()
    .from(schema.notificationPreferences)
    .where(eq(schema.notificationPreferences.userId, userId))
    .limit(1);

  if (rows.length === 0) return { ...DEFAULT_PREFS };

  const row = rows[0];
  return {
    webPushEnabled: row.webPushEnabled,
    emailEnabled: row.emailEnabled,
    quietFrom: row.quietFrom ?? null,
    quietUntil: row.quietUntil ?? null,
    timezone: row.timezone ?? "America/Lima",
  };
}

// Returns true when `now` falls inside the user's configured quiet window.
// null window = never quiet. Supports overnight ranges (e.g. 22:00 → 08:00).
export function withinQuietHours(prefs: NotificationPrefs, now: Date): boolean {
  if (!prefs.quietFrom || !prefs.quietUntil) return false;

  const tz = prefs.timezone || "America/Lima";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const h = (parts.find((p) => p.type === "hour")?.value ?? "00").padStart(2, "0");
  const m = (parts.find((p) => p.type === "minute")?.value ?? "00").padStart(2, "0");
  const current = `${h}:${m}`;

  const { quietFrom, quietUntil } = prefs;

  if (quietFrom <= quietUntil) {
    // Same-day window e.g. 09:00 → 17:00
    return current >= quietFrom && current < quietUntil;
  }
  // Overnight window e.g. 22:00 → 08:00
  return current >= quietFrom || current < quietUntil;
}

// Minutes from `now` until the end of the quiet window, used to set runAfter.
function minutesUntilEndOfQuiet(prefs: NotificationPrefs, now: Date): number {
  if (!prefs.quietUntil) return 15;

  const tz = prefs.timezone || "America/Lima";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);

  const h = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
  const m = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
  const currentMins = h * 60 + m;

  const [uh = 0, um = 0] = prefs.quietUntil.split(":").map(Number);
  const untilMins = uh * 60 + um;

  if (untilMins > currentMins) return untilMins - currentMins + 1;
  // Overnight: until is on the next calendar day
  return 24 * 60 - currentMins + untilMins + 1;
}

// Exponential-ish backoff in minutes: [1, 5, 15, 30, 60].
function backoff(attempts: number): number {
  return ([1, 5, 15, 30, 60] as const)[attempts - 1] ?? 60;
}

async function logDelivery(args: {
  userId: string;
  channel: string;
  status: "sent" | "failed" | "skipped" | "dlq";
  eventType: string;
  conversationId?: string | null;
  detail?: string | null;
}): Promise<void> {
  await db.insert(schema.notificationDeliveries).values({
    id: crypto.randomUUID(),
    userId: args.userId,
    channel: args.channel,
    status: args.status,
    eventType: args.eventType,
    conversationId: args.conversationId ?? null,
    detail: args.detail ?? null,
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Persist a notification job and fire an inline best-effort send.
 *
 * If `dedupeKey` is provided and a pending job with that key already exists,
 * the existing row is updated in place (ON CONFLICT on the partial unique index)
 * rather than inserting a duplicate. Drizzle's `onConflictDoUpdate` can't target
 * a partial index with `targetWhere`, so we use a raw execute here.
 */
export async function scheduleNotification(
  event: NotificationEvent,
  dedupeKey?: string,
): Promise<void> {
  const id = crypto.randomUUID();
  const dk = dedupeKey ?? null;
  const payload = event as unknown as Record<string, unknown>;

  const result = await db.execute(sql`
    INSERT INTO "notificationJobs" (
      "id", "payload", "dedupeKey", "status", "attempts", "runAfter", "createdAt", "updatedAt"
    ) VALUES (
      ${id},
      ${JSON.stringify(payload)}::jsonb,
      ${dk},
      'pending',
      0,
      now(),
      now(),
      now()
    )
    ON CONFLICT ("dedupeKey") WHERE status = 'pending' AND "dedupeKey" IS NOT NULL
    DO UPDATE SET
      "payload"    = EXCLUDED."payload",
      "updatedAt"  = now()
    RETURNING "id"
  `);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (result as any).rows as Array<{ id: string }>;
  const jobId = rows[0]?.id;

  if (jobId) {
    // Best-effort inline send. Never awaited — failures are silently caught
    // and the cron drainer is the authoritative safety net.
    void runJob(jobId).catch(() => {});
  }
}

/**
 * Claim and process a single notification job.
 *
 * The UPDATE → RETURNING is the atomic claim: two concurrent workers calling
 * runJob with the same id race on this UPDATE; exactly one wins (gets 1 row
 * back) and the other returns immediately (gets 0 rows).
 */
export async function runJob(jobId: string): Promise<void> {
  const claim = await db.execute(sql`
    UPDATE "notificationJobs"
    SET "attempts" = "attempts" + 1,
        "updatedAt" = now()
    WHERE "id" = ${jobId} AND "status" = 'pending'
    RETURNING "id", "attempts", "payload"
  `);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const claimRows = (claim as any).rows as Array<{
    id: string;
    attempts: number;
    payload: Record<string, unknown>;
  }>;

  if (claimRows.length === 0) return; // already claimed, done, or dead

  const { attempts, payload } = claimRows[0];
  const event = payload as unknown as NotificationEvent;

  // 1. Presence re-check — if staff is live on the Desk, skip silently
  const agentIds = await listAgentUserIds(event.projectId);
  if (hub.isProjectStaffOnline(event.projectId, event.recipientUserId, agentIds)) {
    await db
      .update(schema.notificationJobs)
      .set({ status: "done", updatedAt: new Date() })
      .where(eq(schema.notificationJobs.id, jobId));
    await logDelivery({
      userId: event.recipientUserId,
      channel: "presence",
      status: "skipped",
      eventType: event.type,
      conversationId: event.conversationId,
      detail: "staff online",
    });
    return;
  }

  // 2. Load preferences + quiet-hours gate
  const prefs = await loadPrefs(event.recipientUserId);
  const now = new Date();

  if (withinQuietHours(prefs, now)) {
    const delayMins = minutesUntilEndOfQuiet(prefs, now);
    await db
      .update(schema.notificationJobs)
      .set({ runAfter: new Date(now.getTime() + delayMins * 60_000), updatedAt: now })
      .where(eq(schema.notificationJobs.id, jobId));
    return;
  }

  // 3. Channel dispatch — push-first policy:
  //    • Try web push first.
  //    • If push returns 'sent'  → skip email (avoid double-notify).
  //    • If push returns 'skipped' (no subscriptions) or throws → fall through to email.
  //    A channel throw = transient failure → retry; a 'skipped' return = clean skip.

  let retryNeeded = false;
  let lastError: string | null = null;

  const webpushCh = CHANNELS.find((c) => c.id === "webpush");
  const emailCh = CHANNELS.find((c) => c.id === "email");

  // Step A: web push
  let webpushResult: "sent" | "skipped" | "failed" | "error" | null = null;

  if (webpushCh && prefs.webPushEnabled) {
    try {
      const r = await webpushCh.send(event);
      webpushResult = r;
      await logDelivery({
        userId: event.recipientUserId,
        channel: "webpush",
        status: r,
        eventType: event.type,
        conversationId: event.conversationId,
      });
    } catch (err) {
      webpushResult = "error";
      retryNeeded = true;
      lastError = (err as Error)?.message ?? String(err);
      await logDelivery({
        userId: event.recipientUserId,
        channel: "webpush",
        status: "failed",
        eventType: event.type,
        conversationId: event.conversationId,
        detail: lastError,
      });
    }
  }

  // Step B: email — gate on whether push already sent
  if (emailCh && prefs.emailEnabled) {
    if (webpushResult === "sent") {
      // Push delivered: log email as intentionally skipped (no double-notify)
      await logDelivery({
        userId: event.recipientUserId,
        channel: "email",
        status: "skipped",
        eventType: event.type,
        conversationId: event.conversationId,
        detail: "push succeeded",
      });
    } else {
      // Push was not sent (skipped / threw / not attempted) → try email
      try {
        const r = await emailCh.send(event);
        await logDelivery({
          userId: event.recipientUserId,
          channel: "email",
          status: r,
          eventType: event.type,
          conversationId: event.conversationId,
        });
      } catch (err) {
        retryNeeded = true;
        const msg = (err as Error)?.message ?? String(err);
        if (!lastError) lastError = msg;
        await logDelivery({
          userId: event.recipientUserId,
          channel: "email",
          status: "failed",
          eventType: event.type,
          conversationId: event.conversationId,
          detail: msg,
        });
      }
    }
  }

  // 4. Final outcome
  if (!retryNeeded) {
    await db
      .update(schema.notificationJobs)
      .set({ status: "done", updatedAt: new Date() })
      .where(eq(schema.notificationJobs.id, jobId));
    return;
  }

  if (attempts >= 5) {
    // Dead-letter after max attempts
    await db
      .update(schema.notificationJobs)
      .set({ status: "dead", lastError, updatedAt: new Date() })
      .where(eq(schema.notificationJobs.id, jobId));
    await logDelivery({
      userId: event.recipientUserId,
      channel: "dlq",
      status: "dlq",
      eventType: event.type,
      conversationId: event.conversationId,
      detail: lastError ?? "max attempts reached",
    });
  } else {
    // Retry with exponential backoff
    const backoffMs = backoff(attempts) * 60_000;
    await db
      .update(schema.notificationJobs)
      .set({
        status: "pending",
        runAfter: new Date(Date.now() + backoffMs),
        lastError,
        updatedAt: new Date(),
      })
      .where(eq(schema.notificationJobs.id, jobId));
  }
}

/**
 * Drain all overdue pending jobs, up to `limit`.
 *
 * Uses `FOR UPDATE SKIP LOCKED` so concurrent drain processes (e.g. two
 * systemd timer firings overlapping) don't double-process the same job.
 * The atomic UPDATE claim inside `runJob` is the definitive race protection;
 * SKIP LOCKED is an efficiency optimisation on top.
 */
export async function drainPending(limit = 25): Promise<number> {
  const result = await db.execute(sql`
    SELECT "id" FROM "notificationJobs"
    WHERE  "status" = 'pending'
    AND    "runAfter" <= now()
    ORDER  BY "runAfter"
    LIMIT  ${limit}
    FOR UPDATE SKIP LOCKED
  `);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (result as any).rows as Array<{ id: string }>;

  for (const { id } of rows) {
    await runJob(id);
  }

  return rows.length;
}
