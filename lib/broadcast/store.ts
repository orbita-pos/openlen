// Broadcast storage — campaigns + recipient snapshots + per-site suppression.
//
// Mirrors lib/members/store.ts (per-project rows, callers verify ownership,
// emails normalized lowercase). The send state machine lives here as an
// ATOMIC claim (conditional UPDATE) so a double-click or a concurrent retry
// can't run the same broadcast twice.

import crypto from "node:crypto";
import { and, desc, eq, lt, or } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export type BroadcastStatus = "draft" | "sending" | "sent" | "failed";

export interface BroadcastRow {
  id: string;
  projectId: string;
  subject: string;
  body: string;
  status: BroadcastStatus;
  audienceCount: number | null;
  sentCount: number | null;
  failedCount: number | null;
  failureReason: string | null;
  sentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// A 'sending' row older than this is treated as a crashed send and may be
// reclaimed for a retry (no queue → this is the crash-recovery story).
export const SENDING_STALE_MS = 5 * 60 * 1000;

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

const BROADCAST_COLUMNS = {
  id: schema.broadcasts.id,
  projectId: schema.broadcasts.projectId,
  subject: schema.broadcasts.subject,
  body: schema.broadcasts.body,
  status: schema.broadcasts.status,
  audienceCount: schema.broadcasts.audienceCount,
  sentCount: schema.broadcasts.sentCount,
  failedCount: schema.broadcasts.failedCount,
  failureReason: schema.broadcasts.failureReason,
  sentAt: schema.broadcasts.sentAt,
  createdAt: schema.broadcasts.createdAt,
  updatedAt: schema.broadcasts.updatedAt,
} as const;

export async function createBroadcast(
  projectId: string,
  input: { subject: string; body: string },
): Promise<BroadcastRow> {
  const rows = await db
    .insert(schema.broadcasts)
    .values({ projectId, subject: input.subject, body: input.body })
    .returning(BROADCAST_COLUMNS);
  return rows[0];
}

/** Owner-scoped fetch — projectId is part of the match so a foreign broadcast
 *  id can't be read across projects. */
export async function getBroadcast(
  projectId: string,
  broadcastId: string,
): Promise<BroadcastRow | null> {
  const rows = await db
    .select(BROADCAST_COLUMNS)
    .from(schema.broadcasts)
    .where(
      and(
        eq(schema.broadcasts.id, broadcastId),
        eq(schema.broadcasts.projectId, projectId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export async function listBroadcasts(projectId: string): Promise<BroadcastRow[]> {
  return db
    .select(BROADCAST_COLUMNS)
    .from(schema.broadcasts)
    .where(eq(schema.broadcasts.projectId, projectId))
    .orderBy(desc(schema.broadcasts.createdAt))
    .limit(200);
}

/** Edit subject/body — only while still a draft. Returns null if not found,
 *  not owned, or no longer editable (already sending/sent). */
export async function updateBroadcastDraft(
  projectId: string,
  broadcastId: string,
  patch: { subject?: string; body?: string },
): Promise<BroadcastRow | null> {
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.subject !== undefined) set.subject = patch.subject;
  if (patch.body !== undefined) set.body = patch.body;
  const rows = await db
    .update(schema.broadcasts)
    .set(set)
    .where(
      and(
        eq(schema.broadcasts.id, broadcastId),
        eq(schema.broadcasts.projectId, projectId),
        eq(schema.broadcasts.status, "draft"),
      ),
    )
    .returning(BROADCAST_COLUMNS);
  return rows[0] ?? null;
}

/** Delete — refused while a send is in flight (status 'sending'). */
export async function deleteBroadcast(
  projectId: string,
  broadcastId: string,
): Promise<boolean> {
  const rows = await db
    .delete(schema.broadcasts)
    .where(
      and(
        eq(schema.broadcasts.id, broadcastId),
        eq(schema.broadcasts.projectId, projectId),
        or(
          eq(schema.broadcasts.status, "draft"),
          eq(schema.broadcasts.status, "sent"),
          eq(schema.broadcasts.status, "failed"),
        ),
      ),
    )
    .returning({ id: schema.broadcasts.id });
  return rows.length > 0;
}

/** Atomically claim a broadcast for sending. Succeeds (flips to 'sending')
 *  ONLY from draft, failed (retry), or a STALE 'sending' (crash recovery);
 *  a fresh 'sending' or a 'sent' row returns false so the route can answer
 *  409 / idempotent-replay. This single conditional UPDATE is the whole
 *  concurrency guard — no lock table needed. */
export async function claimBroadcastForSending(
  broadcastId: string,
  audienceCount: number,
): Promise<boolean> {
  const staleBefore = new Date(Date.now() - SENDING_STALE_MS);
  const rows = await db
    .update(schema.broadcasts)
    .set({ status: "sending", audienceCount, updatedAt: new Date() })
    .where(
      and(
        eq(schema.broadcasts.id, broadcastId),
        or(
          eq(schema.broadcasts.status, "draft"),
          eq(schema.broadcasts.status, "failed"),
          and(
            eq(schema.broadcasts.status, "sending"),
            lt(schema.broadcasts.updatedAt, staleBefore),
          ),
        ),
      ),
    )
    .returning({ id: schema.broadcasts.id });
  return rows.length > 0;
}

export async function markBroadcastSent(
  broadcastId: string,
  counts: { sentCount: number; failedCount: number },
): Promise<void> {
  await db
    .update(schema.broadcasts)
    .set({
      status: "sent",
      sentCount: counts.sentCount,
      failedCount: counts.failedCount,
      sentAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.broadcasts.id, broadcastId));
}

export async function markBroadcastFailed(
  broadcastId: string,
  reason: string,
): Promise<void> {
  await db
    .update(schema.broadcasts)
    .set({
      status: "failed",
      failureReason: reason.slice(0, 500),
      updatedAt: new Date(),
    })
    .where(eq(schema.broadcasts.id, broadcastId));
}

/** Snapshot who actually received the send (accepted) or bounced at send time
 *  (failed). Best-effort — a snapshot write must never fail the delivery it
 *  describes. */
export async function recordRecipients(
  broadcastId: string,
  recipients: Array<{
    memberId: string | null;
    email: string;
    status: "accepted" | "failed";
  }>,
): Promise<void> {
  if (recipients.length === 0) return;
  await db
    .insert(schema.broadcastRecipients)
    .values(
      recipients.map((r) => ({
        broadcastId,
        memberId: r.memberId,
        email: normalizeEmail(r.email),
        status: r.status,
      })),
    )
    .catch(() => {});
}

// ─── Suppression list ────────────────────────────────────────────────────────

/** Idempotent add (unique index on project+email swallows duplicates). */
export async function addSuppression(
  projectId: string,
  email: string,
  reason: "unsubscribed" | "bounced" | "complained" = "unsubscribed",
): Promise<void> {
  await db
    .insert(schema.emailSuppressions)
    .values({ projectId, email: normalizeEmail(email), reason })
    .onConflictDoNothing();
}

/** Every suppressed email for a project, normalized — fed into audience
 *  resolution as an exclusion Set. */
export async function listSuppressedEmails(projectId: string): Promise<string[]> {
  const rows = await db
    .select({ email: schema.emailSuppressions.email })
    .from(schema.emailSuppressions)
    .where(eq(schema.emailSuppressions.projectId, projectId));
  return rows.map((r) => r.email);
}

export async function isSuppressed(
  projectId: string,
  email: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.emailSuppressions.id })
    .from(schema.emailSuppressions)
    .where(
      and(
        eq(schema.emailSuppressions.projectId, projectId),
        eq(schema.emailSuppressions.email, normalizeEmail(email)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** Owner removes a suppression (re-subscribe on the member's behalf). */
export async function removeSuppression(
  projectId: string,
  email: string,
): Promise<boolean> {
  const rows = await db
    .delete(schema.emailSuppressions)
    .where(
      and(
        eq(schema.emailSuppressions.projectId, projectId),
        eq(schema.emailSuppressions.email, normalizeEmail(email)),
      ),
    )
    .returning({ id: schema.emailSuppressions.id });
  return rows.length > 0;
}
