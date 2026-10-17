// lib/security-review/ledger.ts — what a security review cost, in the spend
// ledger (lib/credit-ledger.ts, spec local 2026-10-16-credit-ledger).
//
// OpenLen pays for the review (OPENLEN_SECURITY_REVIEW_DAILY_USD), so the row
// moves no credits: it is a `recordUncharged` row in the project owner's name,
// with the review's tokens and real cost. Apart from real.ts so it can be tested
// without Len's brain.

import type { ProviderUse } from "@/lib/agent/brain";
import type { LedgerUse } from "@/lib/credit-ledger";
import { recordUncharged } from "@/lib/credits";
import { modelIdForRole, roleForOperation } from "@/lib/generation/model-policy";

export async function recordReviewCost(o: {
  ownerId: string;
  projectId: string;
  usage: { inputTokens: number; cachedTokens: number; outputTokens: number };
  costCentiCredits: number;
  /** What each of the review's brains says each provider served (`providersUsed()`),
   *  one subagent after another. Absent: the review ran on Fireworks, as in v1. */
  providers?: readonly ProviderUse[];
}): Promise<void> {
  if (o.usage.inputTokens + o.usage.outputTokens <= 0) return;
  await recordUncharged(o.ownerId, {
    surface: "security_review",
    outcome: "ok",
    projectId: o.projectId,
    listCenticredits: o.costCentiCredits,
    uses: reviewUses(o.usage, o.providers ?? []),
  });
}

/** The rule of the agent route (Ruling T5-2 of the second-provider plan): with
 *  ONE provider, its row carries the loop's totals, which also count what the
 *  loop estimated for attempts without usage; with a fallback, one row per
 *  provider, summed across the subagents. */
function reviewUses(usage: { inputTokens: number; cachedTokens: number; outputTokens: number }, rows: readonly ProviderUse[]): LedgerUse[] {
  const at = new Date();
  const byProvider = new Map<string, ProviderUse>();
  for (const r of rows) {
    const seen = byProvider.get(r.provider);
    byProvider.set(
      r.provider,
      seen
        ? {
            ...seen,
            inputTokens: seen.inputTokens + r.inputTokens,
            cachedTokens: seen.cachedTokens + r.cachedTokens,
            outputTokens: seen.outputTokens + r.outputTokens,
            thinkingTokens: seen.thinkingTokens + r.thinkingTokens,
          }
        : { ...r },
    );
  }
  const merged = [...byProvider.values()];
  if (merged.length > 1) {
    return merged.map((r) => ({
      provider: r.provider,
      model: r.model,
      inputTokens: r.inputTokens,
      cachedTokens: r.cachedTokens,
      outputTokens: r.outputTokens,
      reasoningTokens: r.thinkingTokens,
      at,
    }));
  }
  return [
    {
      provider: merged[0]?.provider ?? "fireworks",
      model: merged[0]?.model ?? modelIdForRole(roleForOperation("security_review")),
      inputTokens: usage.inputTokens,
      cachedTokens: usage.cachedTokens,
      outputTokens: usage.outputTokens,
      at,
    },
  ];
}
