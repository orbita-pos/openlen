import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { listTemplates } from "@/lib/templates/store";
import { SELECTOR_CASES } from "@/lib/generation/selector-cases";
import { SELECTOR_HOLDOUT_CASES } from "@/lib/generation/selector-holdout-cases";
import { selectGenerationRoute } from "@/lib/generation/safe-selection";
import { pickTemplate, type TemplateCatalogItem } from "@/lib/curate/pick-template";
import { fillAndNormalizeCuratedTemplate, finalizeCuratedDocument } from "@/lib/curate/build-curated-document";
import { normalizeProfileData } from "@/lib/business-profiles/normalize";
import { adaptTemplateSkeleton } from "@/lib/generation/adapt-skeleton";
import { critiqueGeneratedPage } from "@/lib/ai/vision-critique";
import { renderHtmlToInlineImage } from "@/lib/ai/inline-image";
import { TAXONOMY_COMPATIBILITY_VERSION } from "@/lib/generation/taxonomy-compatibility";
import { reserveVisualEnginePilotRun, completeVisualEnginePilotRun } from "@/lib/generation/visual-engine-pilot-store";
import { calculateModelCostMicros, parsePilotRateCardFromEnv } from "@/lib/generation/model-cost";
import { writeJsonAtomic } from "@/lib/fs/write-json-atomic";
import {
  generateVisualEngine2AEvidence,
  prepareVisualEngine2ABuilds,
  preflightVisualEngine2A,
  type PilotAdaptationResult,
  type VisualEngine2APoolRow,
} from "@/lib/generation/visual-engine-2a-eval";

type RichSelection = Extract<Awaited<ReturnType<typeof selectGenerationRoute>>, { ok: true }>;

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function environment() {
  if (process.env.OPENLEN_VISUAL_ENGINE !== "shadow") {
    throw new Error("OPENLEN_VISUAL_ENGINE must be exactly shadow; skeleton/off are refused");
  }
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_URL) throw new Error("Database configuration is required");
  required("GEMINI_API_KEY");
  return parsePilotRateCardFromEnv(process.env);
}

function resultRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  return value && typeof value === "object" && "rows" in value && Array.isArray(value.rows)
    ? value.rows as Record<string, unknown>[] : [];
}

async function validateQuota() {
  const result = await db.execute(sql`SELECT "phase", "limit", "used" FROM "visualEnginePilotBudgets" ORDER BY "phase"`);
  const rows = resultRows(result);
  const expected = new Map([["2a", [75, 0]], ["2b", [75, 0]], ["2c", [150, 0]]]);
  if (rows.length !== 3 || rows.some((row) => {
    const value = expected.get(String(row.phase));
    return !value || Number(row.limit) !== value[0] || Number(row.used) !== value[1];
  })) throw new Error("Pilot quota state is inconsistent; refusing all work");
}

function key(row: Pick<VisualEngine2APoolRow, "caseId" | "scenarioId">) { return `${row.caseId}/${row.scenarioId}`; }

async function main() {
  const env = environment();
  await validateQuota();
  const templates = await listTemplates({ status: "published" });
  const rich = new Map<string, RichSelection>();
  const preflight = await preflightVisualEngine2A({
    cases: [...SELECTOR_CASES, ...SELECTOR_HOLDOUT_CASES],
    templates,
    select: async (brief, rows, row) => {
      const result = await selectGenerationRoute(brief, rows as typeof templates);
      if (!result.ok) return { ok: false as const, errorKind: result.errorKind };
      rich.set(key(row), result);
      return { ok: true as const, route: result.decision.route, templateId: result.decision.templateId ?? "" };
    },
  });
  console.log(JSON.stringify({ event: "visual_engine_2a_preflight", ...preflight.counts }));
  if (!preflight.ok) process.exitCode = 2;
  if (!preflight.ok) return;

  const catalog: TemplateCatalogItem[] = templates.map(({ id, name, family, mode, pitch, description }) => ({ id, name, family, mode, pitch, description }));
  const prepared = new Map<string, Promise<{
    normalizedHtml: string; baselineHtml: string; profile: ReturnType<typeof normalizeProfileData>;
    duplicateShadowCandidateFill?: { inputTokens: number; outputTokens: number; cachedTokens: number; thinkingTokens: number };
  }>>();
  const prepare = (row: VisualEngine2APoolRow & { templateId: string }) => {
    const id = key(row);
    const existing = prepared.get(id); if (existing) return existing;
    const value = (async () => {
      const pick = await pickTemplate(row.brief, catalog);
      if (!pick.ok) throw new Error("Quick copy generation failed");
      const profile = normalizeProfileData({
        ...pick.copy,
        brand: { logoUrl: null, accent: row.scenarioId === "saved-brand-accent" ? "#E85D9E" : null },
        links: [], photos: [],
      });
      const builds = await prepareVisualEngine2ABuilds({
        rankedTemplateIds: pick.templateIds,
        safeTemplateId: row.templateId,
        copy: pick.copy,
        fill: (templateId, copy) => fillAndNormalizeCuratedTemplate({ templateId, copy }),
      });
      if (!builds.baselineBuild.ok || !builds.candidateBuild.ok) throw new Error("Template unavailable");
      const baseline = finalizeCuratedDocument({ normalizedHtml: builds.baselineBuild.normalizedHtml, profileData: profile, title: pick.copy.business_name ?? row.caseId, brandRecolor: true });
      if (!baseline.ok) throw new Error("Baseline finalization failed");
      return {
        normalizedHtml: builds.candidateBuild.normalizedHtml, baselineHtml: baseline.html, profile,
        duplicateShadowCandidateFill: builds.candidateBuild.usage ? {
          inputTokens: builds.candidateBuild.usage.inputTokens, outputTokens: builds.candidateBuild.usage.outputTokens,
          cachedTokens: 0, thinkingTokens: 0,
        } : undefined,
      };
    })();
    prepared.set(id, value); return value;
  };
  const evidenceRoot = join(process.cwd(), "scratch", "visual-engine-2a");
  const summary = await generateVisualEngine2AEvidence({
    eligible: preflight.eligible,
    rateCardVersion: env.version,
    calculateCosts: (creative, critic, duplicateShadowCandidateFill) => calculateModelCostMicros({
      creative, critic, duplicateShadowCandidateFill,
    }, env, env.mxnPerUsd),
    deps: {
      reserve: (row) => reserveVisualEnginePilotRun({ phase: "2a", mode: "shadow", route: "template_skeleton", templateId: row.templateId }),
      baseline: async (row) => {
        const value = await prepare(row);
        return { html: value.baselineHtml, duplicateShadowCandidateFill: value.duplicateShadowCandidateFill };
      },
      adapt: async (row): Promise<PilotAdaptationResult> => {
        const selection = rich.get(key(row)); if (!selection) throw new Error("Missing preflight selection");
        const template = templates.find((item) => item.id === row.templateId); if (!template?.visualMetadata) throw new Error("Missing reviewed metadata");
        const base = await prepare(row);
        const result = await adaptTemplateSkeleton({
          html: base.normalizedHtml, templateId: row.templateId, intent: selection.intent,
          templateMetadata: template.visualMetadata, brand: { accent: base.profile.brand?.accent ?? null },
        });
        if (!result.ok) return { ok: false, reasonCode: result.reasonCode, usage: result.usage ?? undefined, durationMs: result.durationMs };
        const finalized = finalizeCuratedDocument({ normalizedHtml: result.html, profileData: base.profile, title: row.caseId, brandRecolor: false });
        if (!finalized.ok) return { ok: false, reasonCode: "sanitization_failed", usage: result.usage, durationMs: result.durationMs };
        return {
          ok: true, html: finalized.html, usage: result.usage, durationMs: result.durationMs,
          structuralFingerprintBefore: result.structuralFingerprintBefore,
          structuralFingerprintAfter: result.structuralFingerprintAfter,
          promptVersion: result.promptVersion, contractVersion: result.creativeDirectionVersion,
          policyVersion: selection.policyVersion, taxonomyVersion: TAXONOMY_COMPATIBILITY_VERSION,
          modelVersion: result.modelId,
        };
      },
      critique: (row, html) => critiqueGeneratedPage({ brief: row.brief, html, model: process.env.OPENLEN_VISUAL_ENGINE_CRITIC_MODEL ?? "gemini-2.5-flash" }),
      render: async (html) => {
        const rendered = await renderHtmlToInlineImage(html, { maxBytes: 8 * 1024 * 1024 });
        return rendered ? Buffer.from(rendered.dataBase64, "base64") : null;
      },
      writeEvidence: async (hash, files, manifest) => {
        const directory = join(evidenceRoot, hash); await mkdir(directory, { recursive: true });
        await Promise.all(Object.entries(files).map(([name, bytes]) => writeFile(join(directory, `${name}.jpg`), bytes)));
        await writeJsonAtomic(join(directory, "manifest.json"), manifest);
      },
      complete: completeVisualEnginePilotRun,
    },
  });
  console.log(JSON.stringify({ event: "visual_engine_2a_complete", ...summary }));
}

main().catch(() => { console.error("Visual Engine 2A evaluation failed (details redacted)."); process.exitCode = 1; });
