// lib/security-review/budget.ts — WHETHER A REVIEW MAY USE THE MODEL TODAY: the
// global daily dollars (OpenLen pays) and the per-project count, both over the
// UTC day. A review still running isn't counted yet (its cost lands when it
// finishes), so what is in flight can pass the cap by a few cents.

import { dailyBudgetCentiCredits, MODEL_REVIEWS_PER_PROJECT_PER_DAY } from "./enabled";
import type { SecurityReviewStore } from "./store";

const DAY_MS = 86_400_000;

export function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export type BudgetVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: "daily" | "project" };

export async function checkBudget(
  store: SecurityReviewStore,
  projectId: string,
  now: Date,
  env: Readonly<Record<string, string | undefined>>,
): Promise<BudgetVerdict> {
  const from = utcDayStart(now);
  const u = await store.usageBetween(projectId, from, new Date(from.getTime() + DAY_MS));
  if (u.spentCentiCredits >= dailyBudgetCentiCredits(env)) return { ok: false, reason: "daily" };
  if (u.projectModelRuns >= MODEL_REVIEWS_PER_PROJECT_PER_DAY) return { ok: false, reason: "project" };
  return { ok: true };
}
