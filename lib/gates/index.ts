import { runA11yGate } from "./a11y";
import { runConversionGate } from "./conversion";
import { runMobileGate } from "./mobile";
import { runSeoGate } from "./seo";
import { runSecurityGate } from "./security";
import { runPerformanceGate } from "./performance";
import { disposeBrowser } from "./_browser";
import type {
  GateContext,
  GateId,
  GateResult,
  GatesAggregateResult,
} from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Gate runner.
//
// Runs all six gates in parallel via `Promise.allSettled` so a single
// crashing gate doesn't take the rest down — its failure surfaces as a
// warning-severity record on the aggregate result.
//
// Wall-clock cost: dominated by puppeteer (a11y + mobile each launch ~1s
// browser cold; we share one browser via _browser.ts to halve that). The
// other four are cheerio/regex and complete in <50ms.
// ─────────────────────────────────────────────────────────────────────────────

export type { GateContext, GateResult, GatesAggregateResult, GateId } from "./types";
export type { GateViolation, Severity, QualityGrade } from "./types";
export { GATE_IDS, GateIdSchema, SeveritySchema, QualityGradeSchema } from "./types";
export { disposeBrowser } from "./_browser";

export interface RunAllGatesOptions {
  /** Per-gate callback fired as soon as each gate completes (success or fail). */
  onGateComplete?: (result: GateResult) => void;
}

/** Order matches the gate runner's parallel index so callers can deserialize
 *  Promise.allSettled results back into the byGate record. */
const GATE_ORDER: GateId[] = [
  "a11y",
  "conversion",
  "mobile",
  "seo",
  "security",
  "performance",
];

export async function runAllGates(
  ctx: GateContext,
  options: RunAllGatesOptions = {},
): Promise<GatesAggregateResult> {
  const start = Date.now();

  const runners: Array<Promise<GateResult>> = [
    wrap("a11y", () => runA11yGate(ctx), options),
    wrap("conversion", () => runConversionGate(ctx), options),
    wrap("mobile", () => runMobileGate(ctx), options),
    wrap("seo", () => runSeoGate(ctx), options),
    wrap("security", () => runSecurityGate(ctx), options),
    wrap("performance", () => runPerformanceGate(ctx), options),
  ];

  const settled = await Promise.allSettled(runners);

  // Build byGate result. Even after the wrap() above's try/catch, a settled
  // rejection here is a defensive net for unexpected throws inside the
  // callback itself. We never let one gate's failure abort aggregation.
  const byGate = {} as Record<GateId, GateResult>;
  for (let i = 0; i < settled.length; i++) {
    const gateId = GATE_ORDER[i];
    const settle = settled[i];
    if (settle.status === "fulfilled") {
      byGate[gateId] = settle.value;
    } else {
      byGate[gateId] = {
        gate: gateId,
        passed: false,
        violations: [
          {
            gate: gateId,
            severity: "warning",
            code: "gate-runtime-error",
            message: `Gate threw: ${stringifyReason(settle.reason)}`,
          },
        ],
        durationMs: 0,
        cost: 0,
      };
    }
  }

  const allViolations = Object.values(byGate).flatMap((g) => g.violations);
  const criticalViolations = allViolations.filter(
    (v) => v.severity === "critical",
  );

  return {
    passed: criticalViolations.length === 0,
    criticalViolations,
    allViolations,
    byGate,
    totalCost: Object.values(byGate).reduce((sum, g) => sum + g.cost, 0),
    totalDurationMs: Date.now() - start,
  };
}

async function wrap(
  gate: GateId,
  fn: () => Promise<GateResult>,
  options: RunAllGatesOptions,
): Promise<GateResult> {
  try {
    const r = await fn();
    options.onGateComplete?.(r);
    return r;
  } catch (err) {
    const failed: GateResult = {
      gate,
      passed: false,
      violations: [
        {
          gate,
          severity: "warning",
          code: "gate-runtime-error",
          message: `Gate threw: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      durationMs: 0,
      cost: 0,
    };
    options.onGateComplete?.(failed);
    return failed;
  }
}

function stringifyReason(r: unknown): string {
  if (r instanceof Error) return r.message;
  if (typeof r === "string") return r;
  try {
    return JSON.stringify(r).slice(0, 200);
  } catch {
    return String(r);
  }
}

// Re-export for convenience — orchestrator dispose path calls this after the
// gate loop so the next generation gets a fresh browser instance.
export async function disposeGateResources(): Promise<void> {
  await disposeBrowser();
}
