import { assessFinalVisualCandidate } from "@/lib/ai/qwen-visual-critic";
import { renderVisualQualityViewports } from "@/lib/ai/visual-quality-renderer";
import { AI_HYBRID_NICHE_CASES } from "@/lib/generation/ai-hybrid-niche-cohort";
import { sha256 } from "@/lib/generation/content-hash";
import { createPageGenerationBudget, parseFablePageBudgetConfigFromEnv } from "@/lib/generation/page-generation-budget";
import { listSections } from "@/lib/sections/store";
import { coerceBusinessData } from "@/lib/style-match/autofill/types";
import type { BusinessProfileData } from "@/lib/business-profiles/types";

import { createFableRuntimeComposition } from "./fable-runtime-composition";
import { runAiCreation } from "./run-ai-creation";
import type { CreativeSandboxPageOutcome, CreativeSandboxProbeOutcome, CreativeSandboxProvider } from "@/scripts/creative-sandbox-canary";

/** A page with two obvious viewport facts, so the vision probe measures the
 * transport and the verdict shape rather than a real design. */
const PROBE_PAGE = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sonda</title></head><body style="margin:0;font-family:system-ui"><header style="padding:48px 24px;background:#101014;color:#fff"><h1 style="font-size:44px;margin:0">Taller de relojes</h1><p style="opacity:.75">Restauración mecánica</p></header><section style="padding:32px 24px"><h2>Servicios</h2><p>Ajuste, limpieza y pulido.</p></section></body></html>';

function counters(started: number): { durationMs: number } {
  return { durationMs: Math.max(0, Date.now() - started) };
}

/**
 * One isolated capability probe against one live provider. It buys the smallest
 * real answer that proves the transport, the model id and the usage accounting,
 * and it never retries.
 */
export async function runCreativeSandboxProbe(
  provider: CreativeSandboxProvider,
): Promise<CreativeSandboxProbeOutcome> {
  const budget = createPageGenerationBudget(parseFablePageBudgetConfigFromEnv());
  const runtime = createFableRuntimeComposition({ pageBudget: budget });
  const started = Date.now();

  if (provider === "deepseek-tool") {
    const turn = await runtime.fireworksToolClient.turn({
      requestId: `canary.deepseek-tool-${sha256(PROBE_PAGE).slice(0, 12)}`,
      maxOutputTokens: 2_000,
      messages: [
        { role: "system", content: "You improve landing pages through tools. Inspect the canvas before changing anything." },
        { role: "user", content: "Inspect the page, then stop." },
      ],
    });
    return {
      ok: turn.ok,
      resultCode: turn.ok ? (turn.calls.length > 0 ? "tool_call" : "text_only") : turn.code,
      modelId: turn.modelId,
      costMicromxn: budget.snapshot().actualMicromxn,
      ...counters(started),
      attempts: "attempts" in turn && typeof turn.attempts === "number" ? turn.attempts : 1,
      providerCategory: !turn.ok && "providerCategory" in turn ? turn.providerCategory ?? null : null,
    };
  }

  const rendered = await renderVisualQualityViewports(PROBE_PAGE);
  if (!rendered) {
    return { ok: false, resultCode: "render_failed", modelId: "none", costMicromxn: 0, ...counters(started), attempts: 0, providerCategory: null };
  }
  const assessed = await assessFinalVisualCandidate({
    requestId: `canary.qwen-vision-${sha256(PROBE_PAGE).slice(0, 12)}`,
    screenshots: { desktop: rendered.desktop, mobile: rendered.mobile },
    deterministic: {
      mobileOverflow: rendered.mobileOverflow === true,
      weakTypographyHierarchy: rendered.weakTypographyHierarchy === true,
      invalidGeometry: rendered.invalidGeometry === true,
    },
    brief: { niche: "marketing", requiredSignals: [], forbiddenSignals: [] },
  }, { client: runtime.fireworksClient });

  return {
    ok: assessed.ok,
    resultCode: assessed.ok ? assessed.verdict.decision : assessed.code,
    modelId: "modelId" in assessed ? assessed.modelId : "none",
    costMicromxn: budget.snapshot().actualMicromxn,
    ...counters(started),
    attempts: "attempts" in assessed ? assessed.attempts : 1,
    providerCategory: !assessed.ok && "providerCategory" in assessed ? assessed.providerCategory ?? null : null,
  };
}

/**
 * One complete cohort page through the production root: the same budget, the
 * same boundaries, the same delivery gate the route uses.
 */
export async function runCreativeSandboxCanaryPage(caseId: string): Promise<CreativeSandboxPageOutcome> {
  const fixture = AI_HYBRID_NICHE_CASES.find((row) => row.id === caseId);
  const started = Date.now();
  const blank = { mobileOverflow: false, weakTypographyHierarchy: false, invalidGeometry: false };
  if (!fixture) {
    return { ok: false, resultCode: "unknown_case", modelId: "none", costMicromxn: 0, ...counters(started), attempts: 0, providerCategory: null, mutations: 0, images: 0, finalHash: null, deterministic: blank };
  }

  const budget = createPageGenerationBudget(parseFablePageBudgetConfigFromEnv());
  const profile = coerceBusinessData({ business_name: "Canary", pitch: fixture.brief, language_detected: "es" });
  const result = await runAiCreation({
    projectId: crypto.randomUUID(),
    brief: fixture.brief,
    profileData: { ...profile, brand: null, photos: [], links: [] } as unknown as BusinessProfileData,
  }, {
    listSections,
    fableRuntimeOptions: { pageBudget: budget },
  });

  const cost = budget.snapshot().actualMicromxn;
  if (!result.ok) {
    return { ok: false, resultCode: result.reasonCode, modelId: "none", costMicromxn: cost, ...counters(started), attempts: 1, providerCategory: null, mutations: 0, images: 0, finalHash: null, deterministic: blank };
  }

  const rendered = await renderVisualQualityViewports(result.html);
  const images = (result.html.match(/background-image:url\(/g) ?? []).length;
  return {
    ok: true,
    resultCode: "delivered",
    modelId: "none",
    costMicromxn: cost,
    ...counters(started),
    attempts: 1,
    providerCategory: null,
    mutations: result.appliedOps,
    images,
    finalHash: `sha256:${sha256(result.html)}`,
    deterministic: rendered
      ? {
          mobileOverflow: rendered.mobileOverflow === true,
          weakTypographyHierarchy: rendered.weakTypographyHierarchy === true,
          invalidGeometry: rendered.invalidGeometry === true,
        }
      : blank,
  };
}
