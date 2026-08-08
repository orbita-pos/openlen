import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  scoreVisualEngine2APilot,
  canonicalJsonSha256,
  validateRollbackEvidence,
  VISUAL_ENGINE_2A_ROLLBACK_FIXTURE,
  type PilotReviewVerdict,
  type VisualEngine2ARollbackEvidence,
} from "@/lib/generation/visual-engine-2a-eval";

function rows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  return value && typeof value === "object" && "rows" in value && Array.isArray(value.rows)
    ? value.rows as Record<string, unknown>[] : [];
}

function verdict(value: unknown): PilotReviewVerdict | null {
  if (value === null || value === undefined) return null;
  return value === "candidate" || value === "baseline" || value === "tie" || value === "invalid" ? value : "invalid";
}

async function main() {
  const rollback = JSON.parse(await readFile(
    join(process.cwd(), "scratch", "visual-engine-2a", "rollback-evidence.json"), "utf8",
  )) as VisualEngine2ARollbackEvidence;
  const expectedFixtureSha = canonicalJsonSha256(VISUAL_ENGINE_2A_ROLLBACK_FIXTURE);
  if (!validateRollbackEvidence(rollback, expectedFixtureSha)) throw new Error("Rollback evidence is missing or invalid");
  const result = await db.execute(sql`
    SELECT "status", "structuralInvariantPassed", "candidatePersisted",
      "comparisonVerdict", "acceptedForbiddenSignalCount", "productionEquivalentCostMicromxn"
    FROM "visualEnginePilotRuns" WHERE "phase" = '2a' ORDER BY "ordinal"
  `);
  const score = scoreVisualEngine2APilot(rows(result).map((row) => ({
    started: true,
    technicalSuccess: row.status === "adapted",
    verdict: verdict(row.comparisonVerdict),
    structuralFailure: row.structuralInvariantPassed === false,
    partialPersistenceFailure: row.candidatePersisted === true,
    acceptedForbiddenSignals: Number(row.acceptedForbiddenSignalCount ?? 0),
    productionEquivalentCostMicromxn: Number(row.productionEquivalentCostMicromxn ?? 0),
  })), { verified: true });
  console.log(JSON.stringify({ event: "visual_engine_2a_scorecard", ...score }));
  if (!score.passed) process.exitCode = 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => { console.error("Visual Engine 2A scorecard failed (details redacted)."); process.exitCode = 1; });
}
