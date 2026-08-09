import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { coerceBusinessData } from "@/lib/style-match/autofill/types";
import { createPilotBudgetGuard } from "@/lib/generation/visual-engine-pilot-budget";
import { parsePilotRateCardFromEnv } from "@/lib/generation/model-cost";
import { buildSectionCompositionInventory } from "@/lib/generation/section-inventory";
import { canonicalJsonSha256 } from "@/lib/generation/visual-engine-2a-eval";
import { VISUAL_ENGINE_2B_CASES, type VisualEngine2BCase } from "@/lib/generation/visual-engine-2b-cohort";
import {
  verifyVisualEngine2BQualification,
  type VisualEngine2BQualificationManifest,
} from "@/lib/generation/visual-engine-2b-qualification";
import { visualEngine2BQualificationPath } from "./visual-engine-2b-qualify";
import type { SectionRecord } from "@/lib/sections/store";

const execFileAsync = promisify(execFile);
export const VISUAL_ENGINE_2B_AUTHORIZATION = "AUTHORIZED_2B_SMOKE_ONCE";

export interface VisualEngine2BEvalDeps {
  mode: string | undefined;
  authorization: string | undefined;
  budgetMicromxn: string | undefined;
  perCaseMaximumMicromxn: number;
  rateCardReady: boolean;
  getQuota(): Promise<{ limit: number; used: number; existingRuns: number }>;
  getCommitSha(): Promise<string>;
  readQualification(path: string): Promise<unknown>;
  loadPublishedSections(): Promise<readonly SectionRecord[]>;
  runCase(row: VisualEngine2BCase, records: readonly SectionRecord[]): Promise<"composed" | "unsupported_section_role">;
  log(line: string): void;
}

export type VisualEngine2BEvalResult =
  | { ok: true; cases: 15; supported: 13; typedFallback: 2 }
  | { ok: false; code: string };

export function parseVisualEngine2BBudgetMicromxn(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0 || parsed > 20_000_000) {
    throw new Error("OPENLEN_VISUAL_ENGINE_2B_PILOT_BUDGET_MICROMXN must be an integer from 1 to 20000000");
  }
  return parsed;
}

export function visualEngine2BEnvironmentReady(env: Readonly<Record<string, string | undefined>>): boolean {
  try {
    const budget = parseVisualEngine2BBudgetMicromxn(env.OPENLEN_VISUAL_ENGINE_2B_PILOT_BUDGET_MICROMXN);
    const perCase = Number(env.OPENLEN_VISUAL_ENGINE_2B_CASE_MAX_MICROMXN ?? 1_000_000);
    parsePilotRateCardFromEnv(env);
    return env.OPENLEN_VISUAL_ENGINE === "shadow"
      && env.OPENLEN_VISUAL_ENGINE_2B_AUTHORIZATION === VISUAL_ENGINE_2B_AUTHORIZATION
      && Number.isSafeInteger(perCase) && perCase > 0 && perCase * 13 <= budget;
  } catch {
    return false;
  }
}

function manifest(value: unknown): VisualEngine2BQualificationManifest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return row.schemaVersion === "visual-engine-2b-qualification/1.0"
    && typeof row.manifestSha256 === "string"
    && Array.isArray(row.caseIds)
    && Array.isArray(row.rows)
    && row.counts !== null && typeof row.counts === "object"
    ? value as VisualEngine2BQualificationManifest : null;
}

function quotaReady(value: { limit: number; used: number; existingRuns: number }): boolean {
  return value.limit === 15 && value.used === 0 && value.existingRuns === 0;
}

export async function runVisualEngine2BEvalCli(
  deps: VisualEngine2BEvalDeps,
  cwd = process.cwd(),
): Promise<VisualEngine2BEvalResult> {
  let result: VisualEngine2BEvalResult;
  try {
    const budget = parseVisualEngine2BBudgetMicromxn(deps.budgetMicromxn);
    if (deps.mode !== "shadow" || deps.authorization !== VISUAL_ENGINE_2B_AUTHORIZATION || !deps.rateCardReady) {
      result = { ok: false, code: "invalid_environment" };
    } else if (!Number.isSafeInteger(deps.perCaseMaximumMicromxn) || deps.perCaseMaximumMicromxn <= 0
      || deps.perCaseMaximumMicromxn * 13 > budget) {
      result = { ok: false, code: "budget_preflight_failed" };
    } else if (!quotaReady(await deps.getQuota())) {
      result = { ok: false, code: "invalid_quota" };
    } else {
      const commitSha = await deps.getCommitSha();
      const saved = manifest(await deps.readQualification(visualEngine2BQualificationPath(cwd)));
      const records = await deps.loadPublishedSections();
      const inventoryHash = buildSectionCompositionInventory(records).hash;
      if (!saved || !verifyVisualEngine2BQualification(saved, { commitSha, inventoryHash })) {
        result = { ok: false, code: "qualification_stale" };
      } else if (await deps.getCommitSha() !== commitSha || !quotaReady(await deps.getQuota())) {
        result = { ok: false, code: "preflight_stale" };
      } else {
        const guard = createPilotBudgetGuard(budget);
        for (const row of VISUAL_ENGINE_2B_CASES) {
          const lease = row.expectedFallback ? null : guard.acquire("creative", deps.perCaseMaximumMicromxn);
          if (!row.expectedFallback && !lease) throw new Error("budget exhausted");
          const code = await deps.runCase(row, records);
          const expected = row.expectedFallback ?? "composed";
          if (code !== expected) throw new Error("case result mismatch");
          lease?.settle();
        }
        result = { ok: true, cases: 15, supported: 13, typedFallback: 2 };
      }
    }
  } catch {
    result = { ok: false, code: "evaluation_failed" };
  }
  deps.log(JSON.stringify(result.ok
    ? { event: "visual_engine_2b_eval", ok: true, cases: result.cases, supported: result.supported, typedFallback: result.typedFallback }
    : { event: "visual_engine_2b_eval", ok: false, code: result.code }));
  return result;
}

async function gitCommitSha(): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), shell: false });
  return stdout.trim();
}

async function productionDeps(): Promise<VisualEngine2BEvalDeps> {
  const [{ sql }, { db }, { listSections }, { parsePilotRateCardFromEnv, calculateModelCostMicros }] = await Promise.all([
    import("drizzle-orm"),
    import("@/lib/db"),
    import("@/lib/sections/store"),
    import("@/lib/generation/model-cost"),
  ]);
  const records = async () => listSections({ status: "published" });
  let rateCard: ReturnType<typeof parsePilotRateCardFromEnv> | null = null;
  try { rateCard = parsePilotRateCardFromEnv(process.env); } catch { /* closed by rateCardReady */ }
  return {
    mode: process.env.OPENLEN_VISUAL_ENGINE,
    authorization: process.env.OPENLEN_VISUAL_ENGINE_2B_AUTHORIZATION,
    budgetMicromxn: process.env.OPENLEN_VISUAL_ENGINE_2B_PILOT_BUDGET_MICROMXN,
    perCaseMaximumMicromxn: Number(process.env.OPENLEN_VISUAL_ENGINE_2B_CASE_MAX_MICROMXN ?? 1_000_000),
    rateCardReady: rateCard !== null,
    getQuota: async () => {
      const raw = await db.execute(sql`SELECT "limit", "used", (SELECT COUNT(*) FROM "visualEnginePilotRuns" WHERE "phase" = '2b') AS "existingRuns" FROM "visualEnginePilotBudgets" WHERE "phase" = '2b'`);
      const rows = Array.isArray(raw) ? raw as Array<Record<string, unknown>> : raw && typeof raw === "object" && "rows" in raw && Array.isArray(raw.rows) ? raw.rows as Array<Record<string, unknown>> : [];
      return { limit: Number(rows[0]?.limit), used: Number(rows[0]?.used), existingRuns: Number(rows[0]?.existingRuns) };
    },
    getCommitSha: gitCommitSha,
    readQualification: async (path) => JSON.parse(await readFile(path, "utf8")) as unknown,
    loadPublishedSections: records,
    runCase: async (row, sectionRecords) => {
      const [{ launchShadowSectionCompositionCandidate }, { completeVisualEnginePilotRun }] = await Promise.all([
        import("@/lib/curate/quick-section-composition"),
        import("@/lib/generation/visual-engine-pilot-store"),
      ]);
      if (rateCard === null) throw new Error("rate card unavailable");
      const fixedRateCard = rateCard;
      const copy = coerceBusinessData({ business_name: row.id, industry: row.intent.domains[0], pitch: row.brief, tagline_es: row.brief, cta_primary: "Explorar", language_detected: "es" });
      const result = await launchShadowSectionCompositionCandidate({
        mode: "shadow",
        fallbackTemplateId: "pilot-only",
        fallbackTitle: row.id,
        candidateTitle: row.id,
        copy,
        profileData: { ...copy, brand: null, photos: [], links: [] },
        intent: row.intent,
        intentHash: canonicalJsonSha256(row.intent),
        records: sectionRecords,
        policyVersion: "visual-engine-2b-smoke/1.0",
      }, {
        completeVisualEnginePilotRun: async (id, outcome) => {
          const hasUsage = [outcome.inputTokens, outcome.outputTokens, outcome.thinkingTokens, outcome.cachedTokens]
            .every((value) => typeof value === "number");
          const costs = hasUsage
            ? calculateModelCostMicros({
                creative: {
                  inputTokens: outcome.inputTokens!, outputTokens: outcome.outputTokens!,
                  thinkingTokens: outcome.thinkingTokens!, cachedTokens: outcome.cachedTokens!,
                },
                critic: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, cachedTokens: 0 },
              }, fixedRateCard, fixedRateCard.mxnPerUsd)
            : { productionEquivalentCostMicromxn: depsCaseMaximum(), observedPilotCostMicromxn: depsCaseMaximum() };
          await completeVisualEnginePilotRun(id, { ...outcome, ...costs, rateCardVersion: fixedRateCard.version });
        },
      });
      if (result === null) throw new Error("composition execution failed");
      if (result.ok) return "composed";
      if (result.reasonCode === "unsupported_section_role") return "unsupported_section_role";
      throw new Error("composition case failed");
    },
    log: (line) => console.log(line),
  };

  function depsCaseMaximum(): number {
    const value = Number(process.env.OPENLEN_VISUAL_ENGINE_2B_CASE_MAX_MICROMXN ?? 1_000_000);
    return Number.isSafeInteger(value) && value > 0 ? value : 1_000_000;
  }
}

async function main(): Promise<void> {
  if (!visualEngine2BEnvironmentReady(process.env)) {
    console.log(JSON.stringify({ event: "visual_engine_2b_eval", ok: false, code: "invalid_environment" }));
    process.exitCode = 1;
    return;
  }
  const result = await runVisualEngine2BEvalCli(await productionDeps());
  if (!result.ok) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(() => { process.exitCode = 1; });
}
