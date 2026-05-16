import type { CostBreakdown, PipelineStep } from "@/lib/orchestrator/types";

// ─────────────────────────────────────────────────────────────────────────────
// Budget tracker.
//
// Accumulates per-step USD spend and surfaces a `CostBreakdown` matching the
// `LandingPage.cost` schema. When `maxBudget` is set, calls to `guard()`
// throw `BudgetExceededError` if adding the projected next-step cost would
// blow the cap. Pipeline code is expected to call `guard()` before kicking
// off expensive parallel batches (fill + images) so we fail fast.
// ─────────────────────────────────────────────────────────────────────────────

export class BudgetExceededError extends Error {
  constructor(
    public readonly spent: number,
    public readonly projected: number,
    public readonly cap: number,
  ) {
    super(
      `Budget exceeded: spent $${spent.toFixed(4)} + projected $${projected.toFixed(4)} > cap $${cap.toFixed(2)}`,
    );
    this.name = "BudgetExceededError";
  }
}

type CategoryKey = keyof Omit<CostBreakdown, "total">;

const STEP_TO_CATEGORY: Record<PipelineStep, CategoryKey> = {
  classify: "classify",
  plan: "plan",
  fill: "fill",
  image_hero: "images",
  image_decorative: "images",
  assemble: "assemble",
};

export interface Budget {
  readonly cap?: number;
  add(step: PipelineStep, costUsd: number): void;
  guard(projectedNextCost?: number): void;
  total(): number;
  breakdown(): CostBreakdown;
}

export function createBudget(opts: { cap?: number } = {}): Budget {
  const categories: Record<CategoryKey, number> = {
    classify: 0,
    plan: 0,
    fill: 0,
    images: 0,
    assemble: 0,
  };
  let total = 0;
  const cap = opts.cap;

  return {
    cap,
    add(step: PipelineStep, costUsd: number): void {
      const cat = STEP_TO_CATEGORY[step];
      categories[cat] += costUsd;
      total += costUsd;
    },
    guard(projectedNextCost = 0): void {
      if (cap === undefined) return;
      if (total + projectedNextCost > cap) {
        throw new BudgetExceededError(total, projectedNextCost, cap);
      }
    },
    total(): number {
      return total;
    },
    breakdown(): CostBreakdown {
      return {
        total,
        classify: categories.classify,
        plan: categories.plan,
        fill: categories.fill,
        images: categories.images,
        assemble: categories.assemble,
      };
    },
  };
}
