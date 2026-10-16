// lib/security-review/ledger.ts — what a security review cost, in the spend
// ledger (lib/credit-ledger.ts, spec local 2026-10-16-credit-ledger).
//
// OpenLen pays for the review (OPENLEN_SECURITY_REVIEW_DAILY_USD), so the row
// moves no credits: it is a `recordUncharged` row in the project owner's name,
// with the review's tokens and real cost. Apart from real.ts so it can be tested
// without Len's brain.

import { recordUncharged } from "@/lib/credits";
import { modelIdForRole, roleForOperation } from "@/lib/generation/model-policy";

export async function recordReviewCost(o: {
  ownerId: string;
  projectId: string;
  usage: { inputTokens: number; cachedTokens: number; outputTokens: number };
  costCentiCredits: number;
}): Promise<void> {
  if (o.usage.inputTokens + o.usage.outputTokens <= 0) return;
  await recordUncharged(o.ownerId, {
    surface: "security_review",
    outcome: "ok",
    projectId: o.projectId,
    listCenticredits: o.costCentiCredits,
    uses: [
      {
        provider: "fireworks",
        model: modelIdForRole(roleForOperation("security_review")),
        inputTokens: o.usage.inputTokens,
        cachedTokens: o.usage.cachedTokens,
        outputTokens: o.usage.outputTokens,
        at: new Date(),
      },
    ],
  });
}
