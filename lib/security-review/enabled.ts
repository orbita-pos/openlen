// lib/security-review/enabled.ts — the kill switch and the money limits of the
// security review at publish (spec local 2026-10-15-security-review-design, 4.7).

import { CENTICREDITOS_POR_CREDITO, USD_PER_CREDIT } from "@/lib/credits-client";

type Env = Readonly<Record<string, string | undefined>>;

/** `OPENLEN_SECURITY_REVIEW=0` turns the whole review off, the rules too: the way
 *  out if a rule blocks wrongly in production. */
export function securityReviewEnabled(env: Env = process.env): boolean {
  return env.OPENLEN_SECURITY_REVIEW !== "0";
}

export const DEFAULT_DAILY_USD = 5;

/** So that nobody spends everyone's budget by changing one letter and reopening the dialog. */
export const MODEL_REVIEWS_PER_PROJECT_PER_DAY = 20;

/** What OpenLen spends a UTC day on reviews with the model, in centicredits. */
export function dailyBudgetCentiCredits(env: Env = process.env): number {
  const raw = env.OPENLEN_SECURITY_REVIEW_DAILY_USD?.trim();
  const usd = raw ? Number(raw) : DEFAULT_DAILY_USD;
  const valid = Number.isFinite(usd) && usd >= 0 ? usd : DEFAULT_DAILY_USD;
  return Math.round((valid / USD_PER_CREDIT) * CENTICREDITOS_POR_CREDITO);
}
