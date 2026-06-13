// Broadcast caps — v1 DECISION (user-approved 2026-06-12): broadcasts SHARE
// the members monthly email budget (free 300 / pro 3000 emails per rolling
// 30 days). One budget is simpler to reason about and to display, and
// magic-link login volume is tiny next to a campaign, so contention is
// theoretical. To split into a separate budget later, point these two
// exports at a new key + caps — a one-line change in the send route.

import type { LimitWindow, Plan } from "@/lib/limits";
import { memberEmailCapWindows, siteEmailCapKey } from "@/lib/members/limits";
import { db, schema } from "@/lib/db";

/** The rolling-month email windows a broadcast charges against. */
export function broadcastCapWindows(plan: Plan): LimitWindow[] {
  return memberEmailCapWindows(plan);
}

/** The cap key broadcasts charge against — the SHARED per-site email budget. */
export function broadcastEmailCapKey(projectId: string): string {
  return siteEmailCapKey(projectId);
}

/** Charge N emails against the monthly budget. checkAndConsume inserts exactly
 *  one rateLimitEvents row per call (no count param), so a broadcast of N
 *  records N rows in a single bulk insert — keeping the shared budget honest
 *  (one row per actual email, same as each magic-link login). Called AFTER the
 *  all-or-nothing pre-flight passes, so it never partially charges a blocked
 *  send. Chunked to stay well under Postgres' parameter ceiling. */
export async function recordEmailCapUnits(
  projectId: string,
  count: number,
): Promise<void> {
  if (count <= 0) return;
  const key = broadcastEmailCapKey(projectId);
  const values = Array.from({ length: count }, () => ({ key }));
  for (let i = 0; i < values.length; i += 1000) {
    await db.insert(schema.rateLimitEvents).values(values.slice(i, i + 1000));
  }
}
