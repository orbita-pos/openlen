// lib/project-email/check-job.ts — THE DOMAINS' TIMER (spec local
// 2026-10-22-email-integration, 6.1 and 6.7), run every 15 minutes by
// openlen-email-domains.timer: the domains still waiting for their DNS (and the
// ones that stopped answering) are checked every run, the ready ones once a day,
// one at a time with a pause (Resend's rate limit), at most 200 a run; and the
// sending log keeps 30 days. Pure apart from its deps.

import type { EmailStore } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const KEEP_MESSAGES_MS = 30 * DAY_MS;
const MAX_PER_RUN = 200;
export const PAUSE_BETWEEN_MS = 1_100;

export interface CheckJobDeps {
  store: EmailStore;
  /** checkDomain with the real deps. */
  check(projectId: string): Promise<unknown>;
  now(): Date;
  pause(ms: number): Promise<void>;
}

export async function runEmailDomainsCheck(d: CheckJobDeps): Promise<{ checked: number; failed: number; deleted: number }> {
  const now = d.now().getTime();
  const due = (await d.store.domainsToCheck())
    .filter((r) => r.status !== "ready" || !r.lastCheckedAt || now - r.lastCheckedAt.getTime() >= DAY_MS)
    .slice(0, MAX_PER_RUN);
  let checked = 0;
  let failed = 0;
  for (const [i, row] of due.entries()) {
    if (i > 0) await d.pause(PAUSE_BETWEEN_MS);
    try {
      await d.check(row.projectId);
      checked += 1;
    } catch (e) {
      failed += 1;
      console.warn("[email] domain check failed", row.projectId, row.domain, e);
    }
  }
  const deleted = await d.store.deleteMessagesBefore(new Date(now - KEEP_MESSAGES_MS));
  return { checked, failed, deleted };
}
