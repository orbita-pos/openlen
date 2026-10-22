// lib/project-email/limits.ts — WHAT EACH PAID PLAN SENDS (spec local
// 2026-10-22-email-integration, 0.4, approved by Jesús on 22/10). The allowance
// is per account and calendar month; past it each email costs credits; the
// hourly caps are Lovable's for its Pro, Business and Enterprise. The free plan
// sends nothing from its own domain. Pure.

import type { PaidPlan } from "@/lib/plan";

export const EMAIL_LIMITS: Readonly<Record<PaidPlan, { readonly includedPerMonth: number; readonly perHourApp: number; readonly perHourAuth: number }>> = {
  pro: { includedPerMonth: 1_000, perHourApp: 100, perHourAuth: 500 },
  max: { includedPerMonth: 3_000, perHourApp: 300, perHourAuth: 3_000 },
  ultra: { includedPerMonth: 10_000, perHourApp: 1_000, perHourAuth: 10_000 },
};

/** 150 credits per 1,000 emails past the allowance. */
export const EXTRA_CENTICREDITS_PER_EMAIL = 15;

/** What Resend charges per email past its plan (22/10): the margins test in lib/credits.test.ts reads it. */
export const RESEND_COST_USD_PER_EMAIL = 0.0009;

/** "YYYY-MM" of the calendar month in UTC. */
export function monthOf(d: Date): string {
  return d.toISOString().slice(0, 7);
}
