import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import type { SafeSelectionResult } from "@/lib/generation/safe-selection";
import type { PilotRateCardConfig } from "@/lib/generation/model-cost";
import { calculateModelCostMicros, parsePilotRateCardFromEnv } from "@/lib/generation/model-cost";
import { createPilotBudgetGuard, type PilotBudgetGuard } from "@/lib/generation/visual-engine-pilot-budget";
import { VISUAL_ENGINE_2A_PILOT_CASES } from "@/lib/generation/visual-engine-2a-cohort";
import { buildVisualEngine2ASmokeRows, type QualifiedPilotRow, type VisualEngine2APoolRow } from "@/lib/generation/visual-engine-2a-eval";
import { runVisualEngine2ALiveCanary } from "@/lib/generation/visual-engine-2a-live-canary";
import {
  verifyVisualEngine2AQualification,
  type VisualEngine2AQualificationManifest,
} from "@/lib/generation/visual-engine-2a-qualification";

const execFileAsync = promisify(execFile);

export interface VisualEngine2AEvalCliDependencies {
  mode: string | undefined;
  modelId: string;
  rateCard: PilotRateCardConfig;
  budgetGuard: PilotBudgetGuard;
  intentMaximumCostMicromxn: number;
  getQuota(): Promise<{ limit: number; used: number; existingRuns: number }>;
  getCommitSha(): Promise<string>;
  readQualification(path: string): Promise<unknown>;
  recomputeQualification(commitSha: string): Promise<VisualEngine2AQualificationManifest>;
  select(row: VisualEngine2APoolRow): Promise<SafeSelectionResult>;
  betweenIntentRequests?: () => Promise<void>;
  writeJsonAtomic(path: string, value: unknown): Promise<unknown>;
  generateEvidence(eligible: readonly QualifiedPilotRow[]): Promise<{ started: number; evidence: number; budgetExhausted?: true }>;
  log(line: string): void;
}

export type VisualEngine2AEvalCliResult =
  | {
      ok: true;
      summary: { started: number; evidence: number };
      reportSha256: string;
    }
  | {
      ok: false;
      code: string;
      reportSha256?: string;
    };

function qualificationPath(cwd: string): string {
  return join(cwd, "scratch", "visual-engine-2a", "qualification.json");
}

function liveCanaryPath(cwd: string): string {
  return join(cwd, "scratch", "visual-engine-2a", "live-canary.json");
}

function isCommitSha(value: string): boolean {
  return /^[0-9a-f]{40}$/i.test(value);
}

function isQualificationManifest(value: unknown): value is VisualEngine2AQualificationManifest {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && (value as Record<string, unknown>).schemaVersion === "visual-engine-2a-qualification/1.0"
    && typeof (value as Record<string, unknown>).manifestSha256 === "string";
}

function rateCardIsComplete(rateCard: PilotRateCardConfig): boolean {
  try {
    calculateModelCostMicros({
      intent: { inputTokens: 0, cachedTokens: 0, outputTokens: 0, thinkingTokens: 0 },
    }, rateCard, rateCard.mxnPerUsd);
    return true;
  } catch {
    return false;
  }
}

export function parseVisualEngine2APilotBudgetMicromxn(value: string | undefined): number {
  const budget = Number(value);
  if (!Number.isSafeInteger(budget) || budget <= 0 || budget > 30_000_000) {
    throw new Error("OPENLEN_VISUAL_ENGINE_PILOT_BUDGET_MICROMXN must be an integer from 1 to 30000000");
  }
  return budget;
}

function quotaFailureCode(quota: {
  limit: number;
  used: number;
  existingRuns: number;
}): "invalid_quota" | "existing_runs" | null {
  if (quota.limit !== 75 || quota.used !== 0) return "invalid_quota";
  if (quota.existingRuns !== 0) return "existing_runs";
  return null;
}

function currentQualification(
  manifest: VisualEngine2AQualificationManifest,
): Omit<VisualEngine2AQualificationManifest, "manifestSha256"> {
  const { manifestSha256: _manifestSha256, ...current } = manifest;
  return current;
}

export async function loadVisualEngine2APublishedCatalog<T extends { status: string }>(
  listTemplates: (options: { status: "published" }) => Promise<readonly T[]>,
): Promise<readonly T[]> {
  const catalog = await listTemplates({ status: "published" });
  return catalog.filter((template) => template.status === "published");
}

async function finalQualificationGate(
  deps: VisualEngine2AEvalCliDependencies,
  commitSha: string,
  qualification: VisualEngine2AQualificationManifest,
): Promise<"qualification_stale" | "invalid_quota" | "existing_runs" | null> {
  if (await deps.getCommitSha() !== commitSha) return "qualification_stale";
  const recomputed = await deps.recomputeQualification(commitSha);
  if (recomputed.commitSha !== commitSha) return "qualification_stale";
  if (await deps.getCommitSha() !== commitSha) return "qualification_stale";
  if (!verifyVisualEngine2AQualification({
    manifest: qualification,
    current: currentQualification(recomputed),
  }).ok) return "qualification_stale";
  return quotaFailureCode(await deps.getQuota());
}

export async function runVisualEngine2AEvalCli(
  deps: VisualEngine2AEvalCliDependencies,
  cwd = process.cwd(),
): Promise<VisualEngine2AEvalCliResult> {
  let terminal: VisualEngine2AEvalCliResult;
  try {
    if (deps.mode !== "shadow" || !rateCardIsComplete(deps.rateCard)) {
      terminal = { ok: false, code: "invalid_environment" };
    } else {
      const initialQuota = await deps.getQuota();
      const initialQuotaFailure = quotaFailureCode(initialQuota);
      if (initialQuotaFailure) {
        terminal = { ok: false, code: initialQuotaFailure };
      } else {
        const commitSha = await deps.getCommitSha();
        if (!isCommitSha(commitSha)) throw new Error("invalid commit");
        const qualificationValue = await deps.readQualification(qualificationPath(cwd));
        if (!isQualificationManifest(qualificationValue)) {
          terminal = { ok: false, code: "qualification_stale" };
        } else {
          const recomputed = await deps.recomputeQualification(commitSha);
          if (recomputed.commitSha !== commitSha) throw new Error("commit changed");
          const verifiedCommitSha = await deps.getCommitSha();
          if (verifiedCommitSha !== commitSha) throw new Error("commit changed");
          const quota = await deps.getQuota();
          const quotaFailure = quotaFailureCode(quota);
          if (quotaFailure) {
            terminal = { ok: false, code: quotaFailure };
          } else {
            const liveCanary = await runVisualEngine2ALiveCanary({
              cases: VISUAL_ENGINE_2A_PILOT_CASES,
              qualification: qualificationValue,
              currentQualification: currentQualification(recomputed),
              quota,
              modelId: deps.modelId,
              rateCard: deps.rateCard,
              mxnPerUsd: deps.rateCard.mxnPerUsd,
              betweenRequests: deps.betweenIntentRequests,
              select: async (row) => {
                const lease = deps.budgetGuard.acquire("intent", deps.intentMaximumCostMicromxn);
                if (!lease) return { ok: false, errorKind: "budget_exhausted", durationMs: 0 };
                const result = await deps.select(row);
                const actualCost = result.usage
                  ? calculateModelCostMicros({ intent: result.usage }, deps.rateCard, deps.rateCard.mxnPerUsd)
                    .observedPilotCostMicromxn
                  : undefined;
                lease.settle(actualCost);
                return result;
              },
            });
            await deps.writeJsonAtomic(liveCanaryPath(cwd), liveCanary.report);
            if (deps.budgetGuard.snapshot().exhausted) {
              terminal = {
                ok: false,
                code: "budget_exhausted",
                reportSha256: liveCanary.report.reportSha256,
              };
            } else if (!liveCanary.ok) {
              terminal = {
                ok: false,
                code: liveCanary.code,
                reportSha256: liveCanary.report.reportSha256,
              };
            } else {
              const finalFailure = await finalQualificationGate(deps, commitSha, qualificationValue);
              if (finalFailure) {
                terminal = {
                  ok: false,
                  code: finalFailure,
                  reportSha256: liveCanary.report.reportSha256,
                };
              } else {
                const summary = await deps.generateEvidence(buildVisualEngine2ASmokeRows(liveCanary.eligible));
                terminal = summary.budgetExhausted
                  ? { ok: false, code: "budget_exhausted", reportSha256: liveCanary.report.reportSha256 }
                  : { ok: true, summary, reportSha256: liveCanary.report.reportSha256 };
              }
            }
          }
        }
      }
    }
  } catch {
    terminal = { ok: false, code: "evaluation_failed" };
  }

  deps.log(JSON.stringify(terminal.ok
    ? {
        event: "visual_engine_2a_eval",
        ok: true,
        started: terminal.summary.started,
        evidence: terminal.summary.evidence,
        reportSha256: terminal.reportSha256,
        budget: deps.budgetGuard.snapshot(),
      }
    : {
        event: "visual_engine_2a_eval",
        ok: false,
        code: terminal.code,
        ...(terminal.reportSha256 ? { reportSha256: terminal.reportSha256 } : {}),
        ...(terminal.code === "budget_exhausted" ? { budget: deps.budgetGuard.snapshot() } : {}),
      }));
  return terminal;
}

async function gitCommitSha(): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: process.cwd(),
    shell: false,
  });
  return stdout.trim();
}

async function productionDependencies(): Promise<VisualEngine2AEvalCliDependencies> {
  const [
    { sql },
    { db },
    templateStore,
    { selectGenerationRoute },
    { qualifyVisualEngine2ACohort },
    { buildSkeletonInventory },
    { generateVisualEngine2AEvidence, prepareVisualEngine2ABuilds },
    { normalizeProfileData },
    { pickTemplate },
    { fillAndNormalizeCuratedTemplate, finalizeCuratedDocument },
    { adaptTemplateSkeleton },
    { critiqueGeneratedPage },
    { renderHtmlToInlineImage },
    { TAXONOMY_COMPATIBILITY_VERSION },
    { reserveVisualEnginePilotRun, completeVisualEnginePilotRun },
    { writeJsonAtomic },
  ] = await Promise.all([
    import("drizzle-orm"),
    import("@/lib/db"),
    import("@/lib/templates/store"),
    import("@/lib/generation/safe-selection"),
    import("@/lib/generation/visual-engine-2a-qualification"),
    import("@/lib/generation/skeleton-inventory"),
    import("@/lib/generation/visual-engine-2a-eval"),
    import("@/lib/business-profiles/normalize"),
    import("@/lib/curate/pick-template"),
    import("@/lib/curate/build-curated-document"),
    import("@/lib/generation/adapt-skeleton"),
    import("@/lib/ai/vision-critique"),
    import("@/lib/ai/inline-image"),
    import("@/lib/generation/taxonomy-compatibility"),
    import("@/lib/generation/visual-engine-pilot-store"),
    import("@/lib/fs/write-json-atomic"),
  ]);

  type RichSelection = Extract<Awaited<ReturnType<typeof selectGenerationRoute>>, { ok: true }>;
  type TemplateRecord = Awaited<ReturnType<typeof templateStore.listTemplates>>[number];
  let templates: readonly TemplateRecord[] | null = null;
  const rich = new Map<string, RichSelection>();
  const rowKey = (row: Pick<VisualEngine2APoolRow, "caseId" | "scenarioId">) => `${row.caseId}/${row.scenarioId}`;
  const loadFreshCatalog = async () => loadVisualEngine2APublishedCatalog(
    (options) => templateStore.listTemplates(options),
  );
  const loadCatalog = async () => {
    templates ??= await loadFreshCatalog();
    return templates;
  };
  const rateCard = parsePilotRateCardFromEnv(process.env);
  const budgetLimitMicromxn = parseVisualEngine2APilotBudgetMicromxn(
    process.env.OPENLEN_VISUAL_ENGINE_PILOT_BUDGET_MICROMXN,
  );
  const budgetGuard = createPilotBudgetGuard(budgetLimitMicromxn);

  return {
    mode: process.env.OPENLEN_VISUAL_ENGINE,
    modelId: process.env.OPENLEN_INTENT_MODEL
      ?? process.env.CURATE_PICK_MODEL
      ?? process.env.STYLE_MATCH_TEXT_MODEL
      ?? "gemini-2.5-flash",
    rateCard,
    budgetGuard,
    intentMaximumCostMicromxn: 1_000_000,
    getQuota: async () => {
      const result = await db.execute(sql`
        SELECT "limit", "used",
          (SELECT COUNT(*) FROM "visualEnginePilotRuns" WHERE "phase" = '2a') AS "existingRuns"
        FROM "visualEnginePilotBudgets" WHERE "phase" = '2a'
      `);
      const rows = Array.isArray(result)
        ? result as Array<Record<string, unknown>>
        : result && typeof result === "object" && "rows" in result && Array.isArray(result.rows)
          ? result.rows as Array<Record<string, unknown>>
          : [];
      const row = rows[0];
      return {
        limit: Number(row?.limit ?? Number.NaN),
        used: Number(row?.used ?? Number.NaN),
        existingRuns: Number(row?.existingRuns ?? Number.NaN),
      };
    },
    getCommitSha: gitCommitSha,
    readQualification: async (path) => JSON.parse(await readFile(path, "utf8")) as unknown,
    recomputeQualification: async (commitSha) => {
      const catalog = await loadFreshCatalog();
      templates = catalog;
      const selectionCatalog = catalog.map(({ id, status, visualMetadata }) => ({
        id,
        status,
        visualMetadata,
      }));
      const allowedIds = [...new Set(VISUAL_ENGINE_2A_PILOT_CASES.flatMap((item) => item.allowedSkeletonTemplateIds))];
      const templateMaterials = await Promise.all(allowedIds.map(async (id) => {
        const html = await templateStore.getTemplateHtml(id);
        if (html === null) throw new Error("template unavailable");
        return { id, html, inventory: buildSkeletonInventory(html, id) };
      }));
      const result = qualifyVisualEngine2ACohort({
        cases: VISUAL_ENGINE_2A_PILOT_CASES,
        selectionCatalog,
        templateMaterials,
        commitSha,
      });
      if (!result.ok) throw new Error("qualification recomputation failed");
      return result.manifest;
    },
    select: async (row) => {
      const result = await selectGenerationRoute(row.brief, await loadCatalog());
      if (result.ok) rich.set(row.caseId, result);
      return result;
    },
    betweenIntentRequests: () => new Promise((resolve) => setTimeout(resolve, 6_000)),
    writeJsonAtomic: async (path, value) => {
      await mkdir(dirname(path), { recursive: true });
      return writeJsonAtomic(path, value);
    },
    generateEvidence: async (eligible) => {
      const catalogRows = await loadCatalog();
      const catalog = catalogRows.map(({ id, name, family, mode, pitch, description }) => ({
        id, name, family, mode, pitch, description,
      }));
      const prepared = new Map<string, Promise<{
        normalizedHtml: string;
        baselineHtml: string;
        profile: ReturnType<typeof normalizeProfileData>;
        duplicateShadowCandidateFill?: {
          inputTokens: number;
          outputTokens: number;
          cachedTokens: number;
          thinkingTokens: number;
        };
        budgetCostMicromxn?: number;
      }>>();
      const prepare = (row: QualifiedPilotRow) => {
        const key = rowKey(row);
        const existing = prepared.get(key);
        if (existing) return existing;
        const value = (async () => {
          const pick = await pickTemplate(row.brief, catalog);
          if (!pick.ok) throw new Error("Quick copy generation failed");
          const profile = normalizeProfileData({
            ...pick.copy,
            brand: {
              logoUrl: null,
              accent: row.scenarioId === "saved-brand-accent" ? "#E85D9E" : null,
            },
            links: [],
            photos: [],
          });
          const builds = await prepareVisualEngine2ABuilds({
            rankedTemplateIds: pick.templateIds,
            safeTemplateId: row.templateId,
            copy: pick.copy,
            fill: (templateId, copy) => fillAndNormalizeCuratedTemplate({ templateId, copy }),
          });
          if (!builds.baselineBuild.ok || !builds.candidateBuild.ok) throw new Error("Template unavailable");
          const baseline = finalizeCuratedDocument({
            normalizedHtml: builds.baselineBuild.normalizedHtml,
            profileData: profile,
            title: pick.copy.business_name ?? row.caseId,
            brandRecolor: true,
          });
          if (!baseline.ok) throw new Error("Baseline finalization failed");
          return {
            normalizedHtml: builds.candidateBuild.normalizedHtml,
            baselineHtml: baseline.html,
            profile,
            duplicateShadowCandidateFill: builds.candidateBuild.usage
              ? {
                  inputTokens: builds.candidateBuild.usage.inputTokens,
                  outputTokens: builds.candidateBuild.usage.outputTokens,
                  cachedTokens: 0,
                  thinkingTokens: 0,
                }
              : undefined,
            budgetCostMicromxn: pick.usage && builds.baselineBuild.usage && builds.candidateBuild.usage
              ? [pick.usage, builds.baselineBuild.usage, builds.candidateBuild.usage].reduce((total, usage) =>
                  total + calculateModelCostMicros({
                    intent: {
                      inputTokens: usage.inputTokens,
                      outputTokens: usage.outputTokens,
                      cachedTokens: 0,
                      thinkingTokens: 0,
                    },
                  }, rateCard, rateCard.mxnPerUsd).observedPilotCostMicromxn, 0)
              : undefined,
          };
        })();
        prepared.set(key, value);
        return value;
      };
      const evidenceRoot = join(process.cwd(), "scratch", "visual-engine-2a");
      return generateVisualEngine2AEvidence({
        eligible,
        expectedSize: 15,
        budget: {
          guard: budgetGuard,
          maximumRowCostMicromxn: 8_000_000,
        },
        rateCardVersion: rateCard.version,
        calculateCosts: (creative, critic, duplicateShadowCandidateFill) => calculateModelCostMicros({
          creative,
          critic,
          duplicateShadowCandidateFill,
        }, rateCard, rateCard.mxnPerUsd),
        deps: {
          reserve: (row) => reserveVisualEnginePilotRun({
            phase: "2a",
            mode: "shadow",
            route: "template_skeleton",
            templateId: row.templateId,
          }),
          baseline: async (row) => {
            const value = await prepare(row);
            return {
              html: value.baselineHtml,
              duplicateShadowCandidateFill: value.duplicateShadowCandidateFill,
              budgetCostMicromxn: value.budgetCostMicromxn,
            };
          },
          adapt: async (row) => {
            const selection = rich.get(row.caseId);
            if (!selection) throw new Error("Missing live canary selection");
            const template = catalogRows.find((item) => item.id === row.templateId);
            if (!template?.visualMetadata) throw new Error("Missing reviewed metadata");
            const base = await prepare(row);
            const result = await adaptTemplateSkeleton({
              html: base.normalizedHtml,
              templateId: row.templateId,
              intent: selection.intent,
              templateMetadata: template.visualMetadata,
              brand: { accent: base.profile.brand?.accent ?? null },
            });
            if (!result.ok) {
              return {
                ok: false as const,
                reasonCode: result.reasonCode,
                usage: result.usage ?? undefined,
                durationMs: result.durationMs,
              };
            }
            const finalized = finalizeCuratedDocument({
              normalizedHtml: result.html,
              profileData: base.profile,
              title: row.caseId,
              brandRecolor: false,
            });
            if (!finalized.ok) {
              return {
                ok: false as const,
                reasonCode: "sanitization_failed",
                usage: result.usage,
                durationMs: result.durationMs,
              };
            }
            return {
              ok: true as const,
              html: finalized.html,
              usage: result.usage,
              durationMs: result.durationMs,
              structuralFingerprintBefore: result.structuralFingerprintBefore,
              structuralFingerprintAfter: result.structuralFingerprintAfter,
              promptVersion: result.promptVersion,
              contractVersion: result.creativeDirectionVersion,
              policyVersion: selection.policyVersion,
              taxonomyVersion: TAXONOMY_COMPATIBILITY_VERSION,
              modelVersion: result.modelId,
            };
          },
          critique: (row, html) => critiqueGeneratedPage({
            brief: row.brief,
            html,
            model: process.env.OPENLEN_VISUAL_ENGINE_CRITIC_MODEL ?? "gemini-2.5-flash",
          }),
          render: async (html) => {
            const rendered = await renderHtmlToInlineImage(html, { maxBytes: 8 * 1024 * 1024 });
            return rendered ? Buffer.from(rendered.dataBase64, "base64") : null;
          },
          writeEvidence: async (hash, files, evidenceManifest) => {
            const directory = join(evidenceRoot, hash);
            await mkdir(directory, { recursive: true });
            await Promise.all(Object.entries(files).map(([name, bytes]) => writeFile(
              join(directory, `${name}.jpg`),
              bytes,
            )));
            await writeJsonAtomic(join(directory, "manifest.json"), evidenceManifest);
          },
          complete: completeVisualEnginePilotRun,
        },
      });
    },
    log: (line) => console.log(line),
  };
}

async function main(): Promise<void> {
  try {
    const result = await runVisualEngine2AEvalCli(await productionDependencies());
    if (!result.ok) process.exitCode = 2;
  } catch {
    console.log(JSON.stringify({ event: "visual_engine_2a_eval", ok: false, code: "dependency_construction_failed" }));
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  void main();
}
