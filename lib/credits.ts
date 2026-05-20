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

/** Flat charge for an autofill / style-match run (Gemini read + Kimi fill).
 *  Cheap + occasional, so it isn't token-metered like generate / chat. */
export const AUTOFILL_CREDIT_COST = 5;

/** One credit = this much raw model cost, in USD. */
const USD_PER_CREDIT = 0.01;

/** Rough chars-per-token, for estimating token volume from text length. */
const CHARS_PER_TOKEN = 3.5;

// Model pricing in USD per 1M tokens. VERIFY against the providers' pricing
// pages — the credit charge is computed straight from these. Calibration:
// a from-scratch page generation should land near 14 credits (~$0.14).
const RATES = {
  kimi: { input: 0.6, output: 2.5 },
  gemini: { input: 1.25, output: 5.0 },
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

/**
 * Credit charge for a token-metered call, estimated from input + output text
 * length (chars → tokens → cost → credits). Rounded up, minimum 1.
 */
export function estimateCredits(
  inputChars: number,
  outputChars: number,
  model: keyof typeof RATES = "kimi",
): number {
  const rate = RATES[model];
  const inputTokens = inputChars / CHARS_PER_TOKEN;
  const outputTokens = outputChars / CHARS_PER_TOKEN;
  const usd =
    (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000;
  return Math.max(1, Math.ceil(usd / USD_PER_CREDIT));
}
