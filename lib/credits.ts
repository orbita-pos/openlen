import { eq, sql as sqlOp } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Plan } from "@/lib/limits";

// ─────────────────────────────────────────────────────────────────────────────
// Credit accounting for AI operations.
//
// Every AI call (page generation, chat edit, autofill) debits credits. One
// credit ≈ $0.01 of raw model cost — the charge is computed from the real
// token volume, so a big page costs more credits than a small one. The plan
// PRICE embeds the markup: Pro is $20/mo for 1000 credits (~$10 of raw cost),
// so even a maxed-out Pro user leaves ~50% margin; a free user is capped at
// 100 credits (~$1).
//
// v1 is a monthly RESET (no rollover): the first balance read after 30 days
// sets the balance back to the plan allotment. Rollover-with-expiry would
// need a per-grant ledger — deferred to v2.
// ─────────────────────────────────────────────────────────────────────────────

/** Monthly credit allotment per plan. */
export const CREDITS_BY_PLAN: Record<Plan, number> = {
  free: 100,
  pro: 1000,
};

/** Flat charge for an autofill / style-match run. Cheap + occasional, so it
 *  isn't token-metered like generate / chat. */
export const AUTOFILL_CREDIT_COST = 5;

/** One credit = this much raw model cost, in USD. */
const USD_PER_CREDIT = 0.01;

/** Rough chars-per-token (code/HTML is dense). Only used by the
 *  estimateCredits fallback — the real path counts exact tokens. */
const CHARS_PER_TOKEN = 3;

// Real provider pricing in USD per 1M tokens. Credits are billed from the
// EXACT token usage the provider reports (creditsForUsage), so these are
// honest per-token prices — verify them against the providers' pricing pages.
// The /generate and /ai-design routes log the real token counts per call:
// if a known-cost run doesn't line up, adjust the numbers here.
// Gemini 2.5 pricing per 1M tokens (verify against ai.google.dev/pricing).
const RATES = {
  "gemini-pro": { input: 1.25, output: 10 },
  "gemini-flash": { input: 0.3, output: 2.5 },
} as const;

const REFILL_MS = 30 * 24 * 60 * 60 * 1000;

export interface CreditState {
  plan: Plan;
  balance: number;
  /** The plan's monthly allotment. */
  allotment: number;
}

/**
 * Read the user's credit balance, lazily resetting it to the plan allotment
 * when a month has elapsed (or on the very first read of a fresh account).
 * Returns the post-refill state.
 */
export async function getCreditState(userId: string): Promise<CreditState> {
  const rows = await db
    .select({
      plan: schema.users.plan,
      credits: schema.users.credits,
      refreshedAt: schema.users.creditsRefreshedAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);
  const row = rows[0];
  const plan: Plan = row?.plan === "pro" ? "pro" : "free";
  const allotment = CREDITS_BY_PLAN[plan];
  if (!row) return { plan, balance: 0, allotment };

  const stale =
    row.refreshedAt === null ||
    Date.now() - row.refreshedAt.getTime() >= REFILL_MS;
  if (stale) {
    await db
      .update(schema.users)
      .set({ credits: allotment, creditsRefreshedAt: new Date() })
      .where(eq(schema.users.id, userId));
    return { plan, balance: allotment, allotment };
  }
  return { plan, balance: row.credits, allotment };
}

/**
 * Debit credits, clamped at zero. The pre-call check only guarantees ≥1
 * credit (the real cost isn't known until the call finishes), so a single
 * operation can legitimately spend a balance down to 0.
 */
export async function debitCredits(
  userId: string,
  amount: number,
): Promise<void> {
  if (amount <= 0) return;
  await db
    .update(schema.users)
    .set({ credits: sqlOp`GREATEST(0, ${schema.users.credits} - ${amount})` })
    .where(eq(schema.users.id, userId));
}

/** Token usage as reported by an OpenAI-compatible streaming API. */
export interface TokenUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
}

/**
 * Exact credit charge from the token usage the provider reports — no
 * chars→tokens estimation. This is the real billing path. Rounded up, min 1.
 */
export function creditsForUsage(
  promptTokens: number,
  completionTokens: number,
  model: keyof typeof RATES = "gemini-pro",
): number {
  const rate = RATES[model];
  const usd =
    (promptTokens * rate.input + completionTokens * rate.output) / 1_000_000;
  return Math.max(1, Math.ceil(usd / USD_PER_CREDIT));
}

/**
 * Fallback charge for when the provider omits a usage report — estimates
 * token counts from text length, then prices them via creditsForUsage. With
 * stream usage enabled this should rarely run.
 */
export function estimateCredits(
  inputChars: number,
  outputChars: number,
  model: keyof typeof RATES = "gemini-pro",
): number {
  return creditsForUsage(
    Math.round(inputChars / CHARS_PER_TOKEN),
    Math.round(outputChars / CHARS_PER_TOKEN),
    model,
  );
}
