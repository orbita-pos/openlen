import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  loadVisualEngine2AReviewSource,
  resumeVisualEngine2AReviewSession,
  type SemanticComparisonVerdict,
  type VisualEngine2AReviewSession,
} from "@/lib/generation/visual-engine-2a-review-session";
import { VISUAL_ENGINE_2C_CASES } from "@/lib/generation/visual-engine-2c-cohort";
import { scoreVisualEngine2CPilot, validateVisualEngine2CReviewCoverage } from "@/lib/generation/visual-engine-2c-eval";

const root = join(process.cwd(), "scratch", "visual-engine-2c");

function rows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  return value && typeof value === "object" && "rows" in value && Array.isArray(value.rows)
    ? value.rows as Record<string, unknown>[] : [];
}

function verdict(value: unknown): SemanticComparisonVerdict {
  return value === "candidate" || value === "baseline" || value === "tie" ? value : "invalid";
}

async function main() {
  const budgetMicromxn = Number(process.env.OPENLEN_VISUAL_ENGINE_2C_PILOT_BUDGET_MICROMXN);
  if (!Number.isSafeInteger(budgetMicromxn) || budgetMicromxn < 1 || budgetMicromxn > 30_000_000) throw new Error("Invalid 2C pilot budget");
  const source = await loadVisualEngine2AReviewSource(join(root, "evidence"));
  const storedSession = JSON.parse(await readFile(join(root, "review-session.json"), "utf8")) as VisualEngine2AReviewSession;
  const session = resumeVisualEngine2AReviewSession(storedSession, source.sourceSha, source.rows);
  if (session.completedAt === null) throw new Error("Review is incomplete");
  const result = await db.execute(sql`
    SELECT "id", "ordinal", "status", "comparisonVerdict", "acceptedForbiddenSignalCount",
      "productionEquivalentCostMicromxn", "structuralInvariantPassed"
    FROM "visualEnginePilotRuns" WHERE "phase" = '2c' ORDER BY "ordinal"
  `);
  const ledger = rows(result);
  const reviewRuns = ledger.map((row) => {
    const ordinal = Number(row.ordinal); const cohort = VISUAL_ENGINE_2C_CASES[ordinal - 1];
    return { pilotRunId: typeof row.id === "string" ? row.id : "", ordinal, acceptedRepair: cohort?.class === "repairable" && row.status === "adapted" };
  });
  validateVisualEngine2CReviewCoverage(source.rows, reviewRuns);
  const sourceByComparison = new Map(source.rows.map((row) => [row.comparisonId, row.pilotRunId]));
  const ledgerById = new Map(ledger.map((row) => [row.id, row]));
  const decisions = session.decisions.map((decision) => {
    const runId = sourceByComparison.get(decision.comparisonId); const row = ledgerById.get(runId);
    if (!row || verdict(row.comparisonVerdict) !== decision.verdict) throw new Error("Review decision mismatch");
    return decision.verdict;
  });
  const scoreRows = ledger.map((row, index) => {
    const cohort = VISUAL_ENGINE_2C_CASES[index];
    const statusMatches = cohort?.class === "healthy_keep" ? row.status === "adapted"
      : cohort?.class === "repairable" ? row.status === "adapted" : row.status === "fallback";
    const structuralViolation = row.structuralInvariantPassed === false;
    const forbidden = Number(row.acceptedForbiddenSignalCount ?? 0) > 0;
    return {
      acceptedRepair: cohort?.class === "repairable" && row.status === "adapted",
      healthyReplacement: false,
      technicalFailure: !cohort || !statusMatches,
      allowlistViolation: structuralViolation,
      structureViolation: structuralViolation,
      copyViolation: false,
      roleViolation: structuralViolation,
      navigationViolation: structuralViolation,
      identityViolation: forbidden,
      costMicromxn: typeof row.productionEquivalentCostMicromxn === "number" ? row.productionEquivalentCostMicromxn : null,
    };
  });
  const score = scoreVisualEngine2CPilot(scoreRows, decisions, { budgetMicromxn });
  console.log(JSON.stringify({ event: "visual_engine_2c_scorecard", ...score }));
  if (!score.passed) process.exitCode = 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => { console.error("Visual Engine 2C scorecard failed (details redacted)."); process.exitCode = 1; });
}
