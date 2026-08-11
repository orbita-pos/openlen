import { VISUAL_ENGINE_2C_CASES, type VisualEngine2CCaseClass } from "./visual-engine-2c-cohort";
import type { PilotReasonCode } from "./visual-engine-pilot-store";

export type VisualEngine2COutcomeCode =
  | "visual_healthy_keep"
  | "visual_repair_accepted"
  | "visual_nonrepairable"
  | "visual_not_improved";

export interface VisualEngine2CClassifiedOutcome {
  status: "adapted" | "fallback";
  reasonCode: PilotReasonCode;
  structuralInvariantPassed: boolean | undefined;
}

const TECHNICAL_RESULT_REASONS = {
  initial_render_failed: "technical_render_failed",
  final_render_failed: "technical_render_failed",
  technical_render_failed: "technical_render_failed",
  initial_critic_failed: "provider_error",
  final_critic_failed: "provider_error",
  repair_provider_failed: "provider_error",
  timeout: "provider_timeout",
  inventory_failed: "invalid_inventory",
  compile_failed: "css_policy_violation",
  asset_failed: "required_asset_unavailable",
  sanitization_failed: "sanitization_failed",
  structural_invariant_failed: "structural_invariant_failed",
  internal_error: "internal_error",
} as const satisfies Record<string, PilotReasonCode>;

export function classifyVisualEngine2CTraceResult(accepted: boolean, resultCode: string): VisualEngine2CClassifiedOutcome {
  if (accepted && resultCode === "accepted") return { status: "adapted", reasonCode: "visual_repair_accepted", structuralInvariantPassed: true };
  if (!accepted && resultCode === "healthy_keep") return { status: "adapted", reasonCode: "visual_healthy_keep", structuralInvariantPassed: undefined };
  if (!accepted && resultCode === "nonrepairable") return { status: "fallback", reasonCode: "visual_nonrepairable", structuralInvariantPassed: undefined };
  if (!accepted && resultCode === "not_improved") return { status: "fallback", reasonCode: "visual_not_improved", structuralInvariantPassed: undefined };
  const reasonCode = TECHNICAL_RESULT_REASONS[resultCode as keyof typeof TECHNICAL_RESULT_REASONS] ?? "internal_error";
  return { status: "fallback", reasonCode, structuralInvariantPassed: resultCode === "structural_invariant_failed" ? false : undefined };
}

export interface VisualEngine2CSmokeGuardInput {
  mode: string | undefined; authorization: string | undefined;
  commitSha: string; qualificationCommitSha: string; qualificationValid: boolean;
  quota: { limit: number; used: number; existingRuns: number };
  rateCardComplete: boolean; budgetMicromxn: number;
}
export type VisualEngine2CSmokeGuardResult = { ok: true } | { ok: false; code: string };

export function validateVisualEngine2CSmokeGuard(input: VisualEngine2CSmokeGuardInput): VisualEngine2CSmokeGuardResult {
  if (input.mode !== "shadow") return { ok: false, code: "mode_closed" };
  if (input.authorization !== "AUTHORIZED_2C_SMOKE_ONCE") return { ok: false, code: "authorization_closed" };
  if (!input.qualificationValid || input.commitSha !== input.qualificationCommitSha) return { ok: false, code: "qualification_stale" };
  if (input.quota.limit !== 150 || input.quota.used !== 0 || input.quota.existingRuns !== 0) return { ok: false, code: "quota_closed" };
  if (!input.rateCardComplete) return { ok: false, code: "rate_card_missing" };
  if (!Number.isSafeInteger(input.budgetMicromxn) || input.budgetMicromxn < 1 || input.budgetMicromxn > 30_000_000) return { ok: false, code: "budget_invalid" };
  return { ok: true };
}

export interface VisualEngine2CSmokeDeps {
  currentHead: () => Promise<string>;
  currentQuota: () => Promise<{ limit: number; used: number; existingRuns: number }>;
  reserve: (index: number) => Promise<{ ok: true; id: string; ordinal: number } | { ok: false }>;
  evaluate: (
    index: number,
    reservation: { ok: true; id: string; ordinal: number },
    lease: { providerCallCeiling: number; costMicromxnCeiling: number },
  ) => Promise<{ providerCalls: number; costMicromxn: number; status: "adapted" | "fallback" | "failed"; reasonCode: PilotReasonCode; structuralInvariantPassed?: boolean }>;
  complete: (id: string, result: { providerCalls: number; costMicromxn: number; status: "adapted" | "fallback" | "failed"; reasonCode: PilotReasonCode; structuralInvariantPassed?: boolean }) => Promise<void>;
}

export async function runVisualEngine2CSmoke(guard: VisualEngine2CSmokeGuardInput, deps: VisualEngine2CSmokeDeps) {
  const initial = validateVisualEngine2CSmokeGuard(guard); if (!initial.ok) return initial;
  const [head, quota] = await Promise.all([deps.currentHead(), deps.currentQuota()]);
  const fresh = validateVisualEngine2CSmokeGuard({ ...guard, commitSha: head, quota }); if (!fresh.ok) return fresh;
  let providerCalls = 0; let totalCostMicromxn = 0; let reservations = 0;
  const conservativeRowCostMicromxn = Math.floor(guard.budgetMicromxn / 15);
  for (let index = 0; index < 15; index += 1) {
    const lease = {
      providerCallCeiling: VISUAL_ENGINE_2C_CASES[index]!.expectedCallCeiling,
      costMicromxnCeiling: conservativeRowCostMicromxn,
    };
    if (providerCalls + lease.providerCallCeiling > 33 || totalCostMicromxn + lease.costMicromxnCeiling > guard.budgetMicromxn) {
      return { ok: false as const, code: "budget_exceeded", reservations, providerCalls, totalCostMicromxn };
    }
    const reservation = await deps.reserve(index); if (!reservation.ok) return { ok: false as const, code: "reservation_failed", reservations, providerCalls, totalCostMicromxn };
    reservations += 1;
    let evaluated: Awaited<ReturnType<VisualEngine2CSmokeDeps["evaluate"]>>;
    try {
      evaluated = await deps.evaluate(index, reservation, lease);
      if (!Number.isSafeInteger(evaluated.providerCalls) || evaluated.providerCalls < 0
        || !Number.isSafeInteger(evaluated.costMicromxn) || evaluated.costMicromxn < 0
        || !["adapted", "fallback", "failed"].includes(evaluated.status)) throw new Error("invalid scalar evaluation");
    } catch {
      evaluated = {
        providerCalls: lease.providerCallCeiling,
        costMicromxn: lease.costMicromxnCeiling,
        status: "failed",
        reasonCode: "internal_error",
      };
    }
    providerCalls += evaluated.providerCalls; totalCostMicromxn += evaluated.costMicromxn;
    await deps.complete(reservation.id, evaluated);
    if (providerCalls > 33 || totalCostMicromxn > guard.budgetMicromxn) return { ok: false as const, code: "budget_exceeded", reservations, providerCalls, totalCostMicromxn };
  }
  return { ok: true as const, reservations, providerCalls, totalCostMicromxn };
}

export interface VisualEngine2CReviewSourceRow { comparisonId: string; pilotRunId: string }
export interface VisualEngine2CReviewRun { pilotRunId: string; ordinal: number; acceptedRepair: boolean }

export function validateVisualEngine2CReviewCoverage(
  source: readonly VisualEngine2CReviewSourceRow[],
  runs: readonly VisualEngine2CReviewRun[],
): void {
  if (runs.length !== 15) throw new Error("review ledger must contain exactly 15 runs");
  const ids = new Set<string>();
  const ordinals = new Set<number>();
  for (const run of runs) {
    if (!run.pilotRunId || ids.has(run.pilotRunId)) throw new Error("duplicate review ledger run ID");
    if (!Number.isInteger(run.ordinal) || run.ordinal < 1 || run.ordinal > 15 || ordinals.has(run.ordinal)) {
      throw new Error("review ledger ordinals must be unique and contiguous from 1 through 15");
    }
    ids.add(run.pilotRunId); ordinals.add(run.ordinal);
  }
  for (let ordinal = 1; ordinal <= 15; ordinal += 1) if (!ordinals.has(ordinal)) throw new Error("review ledger ordinal gap");
  const accepted = new Set(runs.filter((run) => run.acceptedRepair).map((run) => run.pilotRunId));
  if (source.some((row) => !accepted.has(row.pilotRunId))) throw new Error("review evidence must contain accepted repairs only");
  if (source.length !== accepted.size) throw new Error("review evidence coverage mismatch");
  const evidence = new Set<string>();
  const comparisons = new Set<string>();
  for (const row of source) {
    if (!row.comparisonId || comparisons.has(row.comparisonId) || evidence.has(row.pilotRunId)) throw new Error("duplicate review evidence");
    comparisons.add(row.comparisonId); evidence.add(row.pilotRunId);
  }
  for (const runId of accepted) if (!evidence.has(runId)) throw new Error("review evidence coverage mismatch");
}

export interface VisualEngine2CScoreRow {
  acceptedRepair: boolean; healthyReplacement: boolean; technicalFailure: boolean; allowlistViolation: boolean;
  structureViolation: boolean; copyViolation: boolean; roleViolation: boolean; navigationViolation: boolean; identityViolation: boolean;
  costMicromxn: number | null;
}
export interface VisualEngine2CLedgerScoreInput {
  status: string;
  reasonCode: string | null;
  costMicromxn: unknown;
  structuralInvariantPassed: boolean | null;
  acceptedForbiddenSignalCount: unknown;
}

export function buildVisualEngine2CScoreRow(
  caseClass: VisualEngine2CCaseClass | undefined,
  row: VisualEngine2CLedgerScoreInput,
): VisualEngine2CScoreRow {
  const acceptedRepair = caseClass === "repairable"
    && row.status === "adapted"
    && row.reasonCode === "visual_repair_accepted"
    && row.structuralInvariantPassed === true;
  const healthyReplacement = caseClass === "healthy_keep" && row.reasonCode === "visual_repair_accepted";
  const exactOutcome = caseClass === "healthy_keep"
    ? row.status === "adapted" && row.reasonCode === "visual_healthy_keep"
    : caseClass === "repairable"
      ? acceptedRepair
      : caseClass === "nonrepairable_or_fallback"
        ? row.status === "fallback" && row.reasonCode === "visual_nonrepairable"
        : false;
  const structuralViolation = row.structuralInvariantPassed === false;
  const forbidden = Number(row.acceptedForbiddenSignalCount ?? 0) > 0;
  const costMicromxn = Number.isSafeInteger(row.costMicromxn) && Number(row.costMicromxn) >= 0 ? Number(row.costMicromxn) : null;
  return {
    acceptedRepair,
    healthyReplacement,
    technicalFailure: !exactOutcome,
    allowlistViolation: structuralViolation,
    structureViolation: structuralViolation,
    copyViolation: false,
    roleViolation: structuralViolation,
    navigationViolation: structuralViolation,
    identityViolation: forbidden,
    costMicromxn,
  };
}

export function scoreVisualEngine2CPilot(rows: readonly VisualEngine2CScoreRow[], decisions: readonly ("candidate" | "baseline" | "tie" | "invalid")[], options: { budgetMicromxn: number }) {
  const accepted = rows.filter((row) => row.acceptedRepair).length;
  const reviewed = decisions.filter((decision) => decision !== "invalid").length;
  const preferredOrTied = decisions.filter((decision) => decision === "candidate" || decision === "tie").length;
  const costRows = rows.filter((row) => Number.isSafeInteger(row.costMicromxn) && Number(row.costMicromxn) >= 0);
  const totalCostMicromxn = costRows.reduce((sum, row) => sum + Number(row.costMicromxn), 0);
  const humanPreferredOrTiedRate = accepted === 0 ? 0 : preferredOrTied / accepted;
  const technicalIntegrity = rows.length === 15 && !rows.some((row) => row.technicalFailure || row.allowlistViolation || row.healthyReplacement
    || row.structureViolation || row.copyViolation || row.roleViolation || row.navigationViolation || row.identityViolation);
  const costCoverage = rows.length === 0 ? 0 : costRows.length / rows.length;
  const passed = technicalIntegrity && accepted === 6 && reviewed === accepted && humanPreferredOrTiedRate >= 0.8 && costCoverage === 1 && totalCostMicromxn <= options.budgetMicromxn;
  return { passed, technicalIntegrity, healthyReplacementCount: rows.filter((row) => row.healthyReplacement).length, allowlistViolationCount: rows.filter((row) => row.allowlistViolation).length, humanPreferredOrTiedRate, costCoverage, totalCostMicromxn };
}
