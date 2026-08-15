import type { SafeCreativeCandidate } from "./creative-baseline";
import type { CreativeSessionResult } from "./deepseek-creative-session";

export interface AdvisoryReviewInput {
  readonly requestId: string;
  readonly brief: string;
  readonly candidate: SafeCreativeCandidate;
}

export interface AdvisoryReviewDeps {
  readonly render: (html: string) => Promise<{ mobileOverflow: boolean; invalidGeometry: boolean } | null>;
  readonly review: (input: { html: string; brief: string }) => Promise<{ ok: true; accepted: boolean; issues: readonly string[] } | { ok: false }>;
  readonly repair: (input: { requestId: string; brief: string; issueSummary: string; maxTurns: 1 }) => Promise<CreativeSessionResult>;
}

export interface AdvisoryReviewResult {
  readonly candidate: SafeCreativeCandidate;
  readonly reviewed: boolean;
  readonly repaired: boolean;
}

/** Qwen advises; deterministic checks decide. Every branch here returns a
 * candidate — an advisory reviewer must never be able to cost a safe page. */
export async function runAdvisoryVisualReview(
  input: AdvisoryReviewInput,
  deps: AdvisoryReviewDeps,
): Promise<AdvisoryReviewResult> {
  const unchanged = { candidate: input.candidate, reviewed: false, repaired: false };

  let baseline: { mobileOverflow: boolean; invalidGeometry: boolean } | null;
  try { baseline = await deps.render(input.candidate.html); } catch { return unchanged; }
  if (!baseline) return unchanged;

  let verdict: Awaited<ReturnType<AdvisoryReviewDeps["review"]>>;
  try { verdict = await deps.review({ html: input.candidate.html, brief: input.brief }); } catch { return unchanged; }
  if (!verdict.ok || typeof verdict.accepted !== "boolean" || !Array.isArray(verdict.issues)) return unchanged;
  if (verdict.accepted) return { candidate: input.candidate, reviewed: true, repaired: false };

  const reviewed = { candidate: input.candidate, reviewed: true, repaired: false };
  let repair: CreativeSessionResult;
  try {
    repair = await deps.repair({
      requestId: input.requestId,
      brief: input.brief,
      issueSummary: verdict.issues.slice(0, 6).join("; ").slice(0, 600),
      maxTurns: 1,
    });
  } catch { return reviewed; }
  if (!repair.changed) return reviewed;

  // The repaired page must clear the same deterministic bar as the one it
  // replaces, or the previous last-known-good stands.
  let after: { mobileOverflow: boolean; invalidGeometry: boolean } | null;
  try { after = await deps.render(repair.candidate.html); } catch { return reviewed; }
  if (!after || after.mobileOverflow || after.invalidGeometry) return reviewed;

  return { candidate: repair.candidate, reviewed: true, repaired: true };
}
