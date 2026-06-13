// Broadcast caps — v1 DECISION (user-approved 2026-06-12): broadcasts SHARE
// the members monthly email budget (free 300 / pro 3000 emails per rolling
// 30 days). One budget is simpler to reason about and to display, and
// magic-link login volume is tiny next to a campaign, so contention is
// theoretical. To split into a separate budget later, point these two
// exports at a new key + caps — a one-line change in the send route.

import type { LimitWindow, Plan } from "@/lib/limits";
import { memberEmailCapWindows, siteEmailCapKey } from "@/lib/members/limits";

/** The rolling-month email windows a broadcast charges against. */
export function broadcastCapWindows(plan: Plan): LimitWindow[] {
  return memberEmailCapWindows(plan);
}

/** The cap key broadcasts charge against — the SHARED per-site email budget. */
export function broadcastEmailCapKey(projectId: string): string {
  return siteEmailCapKey(projectId);
}
