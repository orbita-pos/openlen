import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import type { GenerationRoute } from "./contracts";
import type { VisualEngineMode } from "./visual-engine-mode";

export type VisualEnginePilotPhase = "2a" | "2b" | "2c";
export type PilotRunStatus = "started" | "adapted" | "fallback" | "failed" | "abandoned";
export type PilotReasonCode =
  | "provider_timeout"
  | "provider_error"
  | "invalid_provider_response"
  | "model_incompatible"
  | "css_policy_violation"
  | "contrast_violation"
  | "required_asset_unavailable"
  | "sanitization_failed"
  | "structural_invariant_failed"
  | "technical_render_failed"
  | "internal_error";
export type PilotComparisonVerdict = "candidate" | "baseline" | "tie" | "invalid";

export interface PilotSqlExecutor {
  execute(query: SQL): Promise<unknown>;
}

export interface ReserveVisualEnginePilotRunInput {
  phase: VisualEnginePilotPhase;
  mode: Exclude<VisualEngineMode, "off">;
  route: Extract<GenerationRoute, "template_skeleton" | "section_composition">;
  templateId: string;
}

export type PilotReservationResult =
  | { ok: true; id: string; ordinal: number }
  | { ok: false; code: "pilot_quota_exhausted" };

export interface CompleteVisualEnginePilotRunOutcome {
  status: Exclude<PilotRunStatus, "started" | "abandoned">;
  reasonCode?: PilotReasonCode;
  promptVersion?: string;
  contractVersion?: string;
  policyVersion?: string;
  taxonomyVersion?: string;
  modelVersion?: string;
  rateCardVersion?: string;
  inputTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
  cachedTokens?: number;
  productionEquivalentCostMicromxn?: number;
  observedPilotCostMicromxn?: number;
  durationMs?: number;
  criticVisualQualityScore?: number;
  criticBriefAdherenceScore?: number;
  criticFallback?: boolean;
  structuralFingerprintBefore?: string;
  structuralFingerprintAfter?: string;
  candidatePersisted?: boolean;
  structuralInvariantPassed?: boolean;
}

export interface VisualEnginePilotStoreDeps extends PilotSqlExecutor {
  createId?: () => string;
}

function defaultDeps(): VisualEnginePilotStoreDeps {
  return { execute: (query) => db.execute(query), createId: () => crypto.randomUUID() };
}

function rows(result: unknown): Record<string, unknown>[] {
  if (Array.isArray(result)) return result as Record<string, unknown>[];
  if (result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)) return result.rows as Record<string, unknown>[];
  return [];
}

function rowCount(result: unknown): number {
  if (result && typeof result === "object" && "rowCount" in result && typeof result.rowCount === "number") return result.rowCount;
  return rows(result).length;
}

async function executeRedacted(deps: PilotSqlExecutor, query: SQL): Promise<unknown> {
  try {
    return await deps.execute(query);
  } catch {
    // Database drivers may include values or SQL in their error text. The
    // telemetry boundary must never surface that detail to an API caller.
    throw new Error("Visual Engine pilot telemetry unavailable");
  }
}

/** Atomically spends one unit and creates its started row in the same statement. */
export async function reserveVisualEnginePilotRun(
  input: ReserveVisualEnginePilotRunInput,
  deps: VisualEnginePilotStoreDeps = defaultDeps(),
): Promise<PilotReservationResult> {
  const id = (deps.createId ?? (() => crypto.randomUUID()))();
  const result = await executeRedacted(deps, sql`
    WITH reserved AS (
      UPDATE "visualEnginePilotBudgets"
      SET "used" = "used" + 1, "updatedAt" = now()
      WHERE "phase" = ${input.phase} AND "used" < "limit"
      RETURNING "used"
    )
    INSERT INTO "visualEnginePilotRuns" ("id", "phase", "ordinal", "mode", "route", "templateId", "status")
    SELECT ${id}, ${input.phase}, "used", ${input.mode}, ${input.route}, ${input.templateId}, 'started'
    FROM reserved
    RETURNING "id", "ordinal"
  `);
  const row = rows(result)[0];
  if (!row || typeof row.id !== "string" || !Number.isInteger(Number(row.ordinal))) return { ok: false, code: "pilot_quota_exhausted" };
  return { ok: true, id: row.id, ordinal: Number(row.ordinal) };
}

/** Writes a fixed scalar allowlist; it never accepts or serializes project content. */
export async function completeVisualEnginePilotRun(
  id: string,
  outcome: CompleteVisualEnginePilotRunOutcome,
  deps: PilotSqlExecutor = defaultDeps(),
): Promise<void> {
  await executeRedacted(deps, sql`
    UPDATE "visualEnginePilotRuns" SET
      "status" = ${outcome.status}, "reasonCode" = ${outcome.reasonCode ?? null},
      "promptVersion" = ${outcome.promptVersion ?? null}, "contractVersion" = ${outcome.contractVersion ?? null},
      "policyVersion" = ${outcome.policyVersion ?? null}, "taxonomyVersion" = ${outcome.taxonomyVersion ?? null},
      "modelVersion" = ${outcome.modelVersion ?? null}, "rateCardVersion" = ${outcome.rateCardVersion ?? null},
      "inputTokens" = ${outcome.inputTokens ?? null}, "outputTokens" = ${outcome.outputTokens ?? null},
      "thinkingTokens" = ${outcome.thinkingTokens ?? null}, "cachedTokens" = ${outcome.cachedTokens ?? null},
      "productionEquivalentCostMicromxn" = ${outcome.productionEquivalentCostMicromxn ?? null},
      "observedPilotCostMicromxn" = ${outcome.observedPilotCostMicromxn ?? null}, "durationMs" = ${outcome.durationMs ?? null},
      "criticVisualQualityScore" = ${outcome.criticVisualQualityScore ?? null},
      "criticBriefAdherenceScore" = ${outcome.criticBriefAdherenceScore ?? null},
      "criticFallback" = ${outcome.criticFallback ?? null},
      "structuralFingerprintBefore" = ${outcome.structuralFingerprintBefore ?? null},
      "structuralFingerprintAfter" = ${outcome.structuralFingerprintAfter ?? null},
      "candidatePersisted" = ${outcome.candidatePersisted ?? false},
      "structuralInvariantPassed" = ${outcome.structuralInvariantPassed ?? null}, "completedAt" = now()
    WHERE "id" = ${id}
  `);
}

export async function recordVisualEnginePilotComparison(
  id: string,
  comparison: { verdict: PilotComparisonVerdict; acceptedForbiddenSignalCount: number },
  deps: PilotSqlExecutor = defaultDeps(),
): Promise<void> {
  if (!Number.isInteger(comparison.acceptedForbiddenSignalCount) || comparison.acceptedForbiddenSignalCount < 0) {
    throw new Error("acceptedForbiddenSignalCount must be a nonnegative integer");
  }
  await executeRedacted(deps, sql`
    UPDATE "visualEnginePilotRuns"
    SET "comparisonVerdict" = ${comparison.verdict}, "acceptedForbiddenSignalCount" = ${comparison.acceptedForbiddenSignalCount}
    WHERE "id" = ${id}
  `);
}

/** Marks interrupted starts without decrementing the irreversible pilot budget. */
export async function markStaleVisualEnginePilotRuns(
  now: Date,
  deps: PilotSqlExecutor = defaultDeps(),
): Promise<number> {
  const staleBefore = new Date(now.getTime() - 60 * 60 * 1000);
  const result = await executeRedacted(deps, sql`
    UPDATE "visualEnginePilotRuns"
    SET "status" = 'abandoned', "completedAt" = ${now}
    WHERE "status" = 'started' AND "createdAt" < ${staleBefore}
  `);
  return rowCount(result);
}
