import type { FilledBlock, Intent, Plan } from "./types";
import type { StepContext } from "./_shared";
import { fillBlock } from "./fill";
import type { GateViolation } from "@/lib/gates/types";

// ─────────────────────────────────────────────────────────────────────────────
// Refine — targeted block re-fill driven by gate violations.
//
// Called by the orchestrator when `runAllGates` returns critical violations.
// We group violations by `blockIndex` and re-run the fill step for each
// affected block, appending the violation context as `emphasis` so the
// model knows what to fix. Blocks without violations are left untouched.
//
// Why not refine the whole page? Most violations are local: a banned phrase
// in one CTA, a missing image alt in one feature row. Re-filling 6 blocks
// when 1 needs work wastes ~5× the fill budget and risks regressing blocks
// that were already good.
// ─────────────────────────────────────────────────────────────────────────────

export interface RefineArgs {
  violations: GateViolation[];
  plan: Plan;
  filledBlocks: FilledBlock[];
  intent: Intent;
  /** Attempt number (1-based) — surfaced in witness records / progress. */
  attempt: number;
}

export interface RefineResult {
  filledBlocks: FilledBlock[];
  /** Indices of blocks that were re-filled this pass. */
  refinedBlockIndices: number[];
  /** Violations that had no blockIndex and couldn't be targeted — caller
   *  may still ship-with-warnings on these. */
  unattributedViolationCount: number;
}

export async function refineBlocks(
  ctx: StepContext,
  args: RefineArgs,
): Promise<RefineResult> {
  const violationsByBlock = groupByBlock(args.violations);

  const newFilledBlocks = [...args.filledBlocks];
  const refinedBlockIndices: number[] = [];

  // Re-fill targeted blocks sequentially. Parallel would be faster but each
  // refill burns ~$0.0002 and we cap the loop at MAX_REFINE_ATTEMPTS=2
  // total — so worst-case is 6 blocks × 2 attempts = 12 calls. Sequential
  // makes the witness file easier to read and keeps token rate-limit headroom.
  for (const [blockIndex, blockViolations] of violationsByBlock.entries()) {
    const entry = args.plan.blockSequence[blockIndex];
    if (!entry) continue;

    const emphasis = buildEmphasisFromViolations(
      blockViolations,
      entry.emphasis,
    );

    try {
      const refilled = await fillBlock(ctx, {
        blockId: entry.blockId,
        index: blockIndex,
        intent: args.intent,
        plan: args.plan,
        purpose: entry.purpose,
        emphasis,
      });
      newFilledBlocks[blockIndex] = refilled;
      refinedBlockIndices.push(blockIndex);
    } catch (err) {
      // Refine attempt failed — keep original. The pipeline will report
      // qualityGrade: needs_review when the gate still fails.
      console.warn(
        `[refine] block ${blockIndex} (${entry.blockId}) re-fill failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  const unattributed = args.violations.filter(
    (v) => v.blockIndex === undefined,
  ).length;

  return {
    filledBlocks: newFilledBlocks,
    refinedBlockIndices,
    unattributedViolationCount: unattributed,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function groupByBlock(
  violations: GateViolation[],
): Map<number, GateViolation[]> {
  const out = new Map<number, GateViolation[]>();
  for (const v of violations) {
    if (v.blockIndex === undefined) continue;
    const arr = out.get(v.blockIndex) ?? [];
    arr.push(v);
    out.set(v.blockIndex, arr);
  }
  return out;
}

function buildEmphasisFromViolations(
  violations: GateViolation[],
  originalEmphasis: string | undefined,
): string {
  const issues = violations
    .map((v) => {
      const suggestion = v.suggestion ? ` — Fix: ${v.suggestion}` : "";
      return `- [${v.gate}/${v.code}] ${v.message}${suggestion}`;
    })
    .join("\n");
  const header = "Previous fill had these issues that MUST be fixed:";
  if (originalEmphasis) {
    return `${originalEmphasis}\n\n${header}\n${issues}`;
  }
  return `${header}\n${issues}`;
}
