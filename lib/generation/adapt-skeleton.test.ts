import { describe, expect, it, vi } from "vitest";

import { compileSkeletonIdentity } from "@/lib/generation/creative-compiler";
import {
  CreativeDirectionSchema,
  SkeletonAdaptationPlanSchema,
  type CreativeDirection,
  type SkeletonAdaptationFailureCode,
  type SkeletonAdaptationPlan,
} from "@/lib/generation/creative-contracts";
import { IntentAnalysisSchema } from "@/lib/generation/contracts";
import {
  CREATIVE_PROMPT_VERSION,
  type GenerateCreativeDirectionResult,
} from "@/lib/generation/generate-creative-direction";
import { resolveSkeletonAssets } from "@/lib/generation/skeleton-assets";
import { buildSkeletonInventory, SkeletonInventoryError } from "@/lib/generation/skeleton-inventory";
import { fingerprintStructure } from "@/lib/generation/structural-fingerprint";
import type { CuratedImage } from "@/lib/imagery/manifest";
import {
  adaptTemplateSkeleton,
  type AdaptTemplateSkeletonDeps,
  type AdaptTemplateSkeletonInput,
} from "@/lib/generation/adapt-skeleton";

const HTML = `<!doctype html><html lang="en"><head><title>Coloring</title></head><body><main><section class="hero"><a href="/start" class="cta">Start</a><img src="/abstract.jpg" alt="Abstract artwork"></section><section><article class="card">One</article><article class="card">Two</article></section></main></body></html>`;

const DIRECTION: CreativeDirection = CreativeDirectionSchema.parse({
  schemaVersion: "creative-direction/1.0",
  mode: "cream",
  visualArchetype: "illustrated_creative_play",
  emotionalTone: ["playful", "friendly"],
  palette: {
    background: "#FFF8E8",
    surface: "#FFFFFF",
    surfaceAlt: "#F5E6C8",
    foreground: "#302A24",
    foregroundMuted: "#6B625A",
    accent: "#7C3AED",
    accentInk: "#FFFFFF",
    border: "#D8C7AB",
  },
  typography: { display: "rounded_playful", body: "friendly_high_legibility", mono: null, scale: "balanced" },
  geometry: { radius: "soft", radiusScale: 1, spacingScale: 1, density: "low_medium" },
  imagery: { strategy: "illustration_first", artDirection: "hand_drawn", subjects: ["animals"], avoid: ["photorealism"] },
  iconography: { style: "rounded_outline", strokeWeight: "medium", cornerStyle: "round" },
  componentTreatment: { cards: "soft_bordered", buttons: "rounded_filled", navigation: "simple", sections: "airy" },
  requiredVisualSignals: ["playful"],
  forbiddenVisualSignals: ["corporate"],
});

const PLAN: SkeletonAdaptationPlan = SkeletonAdaptationPlanSchema.parse({
  schemaVersion: "skeleton-adaptation-plan/1.0",
  tokens: { "--ol-bg": "#FFF8E8", "--ol-accent": "#7C3AED" },
  cssOverride: [{ hookId: "hero", declarations: { "background-color": "#FFF8E8", color: "#302A24" } }],
  assets: [{ slotIndex: 0, action: "replace", mediaType: "illustration", query: "animal coloring crayons", alt: "Friendly animals ready to color", required: true }],
});

const IMAGES: CuratedImage[] = [{
  id: "coloring-crayons",
  promptNum: 1,
  style: "hand-drawn-illustration",
  family: ["education"],
  alt: "Pastel crayons beside animal coloring pages",
  src: { hero: "/crayons-hero.jpg", tablet: "/crayons-tablet.jpg", thumb: "/crayons-thumb.jpg" },
}];

const INPUT: AdaptTemplateSkeletonInput = {
  html: HTML,
  templateId: "color-base",
  intent: IntentAnalysisSchema.parse({
    schemaVersion: "intent-analysis/1.0",
    language: "en",
    functional: { siteType: "coloring_pages", requiredSections: ["hero"], primaryActions: ["download"], contentModel: "printables" },
    audience: { primary: "parents", ageRange: "children", secondary: ["teachers"] },
    domains: ["education"],
    emotionalGoals: ["playful"],
    requiredVisualSignals: ["friendly"],
    forbiddenVisualSignals: ["corporate"],
    explicitConstraints: [],
    ambiguities: [],
    confidence: 0.9,
  }),
  templateMetadata: {
    domains: ["education"],
    audiences: ["parents"],
    visualSignals: ["friendly"],
    negativeTags: ["corporate"],
    themeability: "high",
  },
  brand: { accent: null },
};

const READY: GenerateCreativeDirectionResult = {
  ok: true,
  response: {
    schemaVersion: "skeleton-creative-response/1.0",
    status: "ready",
    creativeDirection: DIRECTION,
    adaptationPlan: PLAN,
  },
  promptVersion: CREATIVE_PROMPT_VERSION,
  modelId: "test-model",
  usage: { inputTokens: 100, outputTokens: 50, thinkingTokens: 10, cachedTokens: 0 },
  durationMs: 25,
};

function providerFailure(kind: "timeout" | "schema"): GenerateCreativeDirectionResult {
  return {
    ok: false,
    error: { kind, message: "raw provider detail must not escape" },
    promptVersion: CREATIVE_PROMPT_VERSION,
    modelId: "test-model",
    usage: null,
    durationMs: 25,
  };
}

function baseDeps(): AdaptTemplateSkeletonDeps {
  return {
    generateCreativeDirection: vi.fn().mockResolvedValue(READY),
    loadCuratedImages: async () => IMAGES,
    sanitize: (html) => ({ html }),
    technicalRender: async () => true,
  };
}

describe("adaptTemplateSkeleton", () => {
  it("runs one bounded creative call and returns only a fully validated adaptation", async () => {
    const original = structuredClone(INPUT);
    const deps = baseDeps();

    const result = await adaptTemplateSkeleton(INPUT, deps);

    expect(result).toMatchObject({
      ok: true,
      status: "adapted",
      creativeDirectionVersion: "creative-direction/1.0",
      planVersion: "skeleton-adaptation-plan/1.0",
      creativeDirection: DIRECTION,
      promptVersion: CREATIVE_PROMPT_VERSION,
      modelId: "test-model",
      usage: READY.ok ? READY.usage : null,
      durationMs: 25,
    });
    expect(deps.generateCreativeDirection).toHaveBeenCalledTimes(1);
    expect(INPUT).toEqual(original);
    if (!result.ok) return;
    expect(result.structuralFingerprintAfter).toBe(result.structuralFingerprintBefore);
    expect(result.html).toContain('data-openlen-visual-engine="creative-direction/1.0"');
    expect(result.html).toContain('/crayons-hero.jpg');
  });

  it("executes compile, asset, sanitize, fingerprint, and render gates in order", async () => {
    const order: string[] = [];
    const deps: AdaptTemplateSkeletonDeps = {
      buildInventory: (html, templateId) => { order.push("inventory"); return buildSkeletonInventory(html, templateId); },
      generateCreativeDirection: async () => { order.push("creative"); return READY; },
      compileIdentity: (input) => { order.push("compile"); return compileSkeletonIdentity(input); },
      resolveAssets: async (input, assetDeps) => { order.push("assets"); return resolveSkeletonAssets(input, assetDeps); },
      loadCuratedImages: async () => IMAGES,
      sanitize: (html) => { order.push("sanitize"); return { html }; },
      fingerprint: (html, options) => { order.push("fingerprint"); return fingerprintStructure(html, options); },
      technicalRender: async () => { order.push("render"); return true; },
    };

    await expect(adaptTemplateSkeleton(INPUT, deps)).resolves.toMatchObject({ ok: true });
    expect(order).toEqual(["inventory", "creative", "compile", "assets", "sanitize", "fingerprint", "render"]);
  });

  const fallbackCases: Array<{
    name: string;
    reasonCode: string;
    providerCalls: number;
    change: (deps: AdaptTemplateSkeletonDeps) => void;
  }> = [
    ...(["insufficient_style_hooks", "invalid_html", "invalid_inventory"] as const).map((code) => ({
      name: `typed inventory error ${code}`,
      reasonCode: code,
      providerCalls: 0,
      change: (deps: AdaptTemplateSkeletonDeps) => { deps.buildInventory = () => { throw new SkeletonInventoryError(code, "safe inventory error"); }; },
    })),
    { name: "provider timeout", reasonCode: "provider_timeout", providerCalls: 1, change: (deps) => { deps.generateCreativeDirection = vi.fn().mockResolvedValue(providerFailure("timeout")); } },
    { name: "invalid provider response", reasonCode: "invalid_provider_response", providerCalls: 1, change: (deps) => { deps.generateCreativeDirection = vi.fn().mockResolvedValue(providerFailure("schema")); } },
    ...(["cannot_remove_forbidden_signal", "cannot_add_required_signal", "asset_slot_unavailable", "hook_property_not_allowed"] as const satisfies readonly SkeletonAdaptationFailureCode[]).map((reasonCode) => ({
      name: `model incompatibility ${reasonCode}`,
      reasonCode,
      providerCalls: 1,
      change: (deps: AdaptTemplateSkeletonDeps) => { deps.generateCreativeDirection = vi.fn().mockResolvedValue({ ...READY, response: { schemaVersion: "skeleton-creative-response/1.0", status: "incompatible", reasonCode } }); },
    })),
    { name: "CSS policy violation", reasonCode: "css_policy_violation", providerCalls: 1, change: (deps) => { deps.compileIdentity = () => ({ ok: false, code: "css_policy_violation", message: "unsafe CSS" }); } },
    { name: "contrast violation", reasonCode: "contrast_violation", providerCalls: 1, change: (deps) => { deps.compileIdentity = () => ({ ok: false, code: "contrast_violation", message: "low contrast" }); } },
    { name: "required asset miss", reasonCode: "required_asset_unavailable", providerCalls: 1, change: (deps) => { deps.resolveAssets = async () => ({ ok: false, code: "required_asset_unavailable", slotIndex: 0 }); } },
    { name: "sanitizer rejection", reasonCode: "sanitization_failed", providerCalls: 1, change: (deps) => { deps.sanitize = () => ({ html: null }); } },
    { name: "technical render failure", reasonCode: "technical_render_failed", providerCalls: 1, change: (deps) => { deps.technicalRender = async () => false; } },
    { name: "structural mismatch", reasonCode: "structural_invariant_failed", providerCalls: 1, change: (deps) => { deps.sanitize = (html) => ({ html: html.replace("<body>", '<body data-unexpected="true">') }); } },
    { name: "unexpected exception", reasonCode: "internal_error", providerCalls: 1, change: (deps) => { deps.compileIdentity = () => { throw new Error("provider payload secret"); }; } },
  ];

  it.each(fallbackCases)("falls back atomically on $name", async ({ reasonCode, providerCalls, change }) => {
    const deps = baseDeps();
    change(deps);

    const result = await adaptTemplateSkeleton(INPUT, deps);

    expect(result).toMatchObject({ ok: false, status: "fallback", reasonCode });
    expect(result).not.toHaveProperty("html");
    expect(deps.generateCreativeDirection).toHaveBeenCalledTimes(providerCalls);
  });

  it("rejects the entire candidate when an asset resolver mutates an href", async () => {
    const deps = baseDeps();
    deps.resolveAssets = async (input) => ({
      ok: true,
      html: input.html.replace('href="/start"', 'href="/changed"'),
      applied: 0,
      assigned: [],
    });

    const result = await adaptTemplateSkeleton(INPUT, deps);

    expect(result).toEqual(expect.objectContaining({ ok: false, status: "fallback", reasonCode: "structural_invariant_failed" }));
    expect(result).not.toHaveProperty("html");
  });

  it.each([
    { name: "comment lookalike", mutate: (html: string) => html.replace(/<style data-openlen-visual-engine="creative-direction\/1\.0">[\s\S]*?<\/style>/, '<!-- data-openlen-visual-engine="creative-direction/1.0" -->') },
    { name: "text lookalike", mutate: (html: string) => html.replace(/<style data-openlen-visual-engine="creative-direction\/1\.0">[\s\S]*?<\/style>/, '<title>data-openlen-visual-engine="creative-direction/1.0"</title>') },
    { name: "missing marker", mutate: (html: string) => html.replace(/<style data-openlen-visual-engine="creative-direction\/1\.0">[\s\S]*?<\/style>/, "") },
    { name: "duplicate marker", mutate: (html: string) => html.replace(/(<style data-openlen-visual-engine="creative-direction\/1\.0">[\s\S]*?<\/style>)/, "$1$1") },
    { name: "wrong element", mutate: (html: string) => html.replace(/<style data-openlen-visual-engine="creative-direction\/1\.0">[\s\S]*?<\/style>/, '<div data-openlen-visual-engine="creative-direction/1.0"></div>') },
  ])("rejects a $name instead of accepting a marker string", async ({ mutate }) => {
    const deps = baseDeps();
    deps.sanitize = (html) => ({ html: mutate(html) });
    deps.fingerprint = () => buildSkeletonInventory(HTML, "color-base").structuralFingerprint;

    const result = await adaptTemplateSkeleton(INPUT, deps);

    expect(result).toMatchObject({ ok: false, status: "fallback", reasonCode: "structural_invariant_failed" });
    expect(result).not.toHaveProperty("html");
  });

  it("stops after the first failed gate and never makes a second creative call", async () => {
    const deps = baseDeps();
    deps.compileIdentity = () => ({ ok: false, code: "contrast_violation", message: "low contrast" });
    deps.resolveAssets = vi.fn();
    deps.sanitize = vi.fn(() => ({ html: HTML }));
    deps.technicalRender = vi.fn(async () => true);

    await expect(adaptTemplateSkeleton(INPUT, deps)).resolves.toMatchObject({ ok: false, reasonCode: "contrast_violation" });
    expect(deps.generateCreativeDirection).toHaveBeenCalledTimes(1);
    expect(deps.resolveAssets).not.toHaveBeenCalled();
    expect(deps.sanitize).not.toHaveBeenCalled();
    expect(deps.technicalRender).not.toHaveBeenCalled();
  });
});
