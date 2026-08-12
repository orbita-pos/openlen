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
import type { AssetManifest, AssetResolutionTrace } from "@/lib/generation/asset-contracts";
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

const ASSET_MANIFEST = { schemaVersion: "asset-manifest/1.0", manifestId: `sha256:${"a".repeat(64)}` } as AssetManifest;
const ASSET_TRACE: AssetResolutionTrace = {
  schemaVersion: "asset-resolution-trace/1.0", manifestId: `sha256:${"a".repeat(64)}`,
  consistencyGroupCount: 1, curatedCount: 1, generatedCount: 0, abstractCount: 0,
  placeholderCount: 0, requiredUnresolvedCount: 0, rejectionCounts: {}, provider: null,
  modelId: null, promptSha256: [], estimatedCostMicromxn: 0, durationMs: 1, resultCode: "resolved",
};
const ASSET_FAILURE_TRACE: AssetResolutionTrace = {
  ...ASSET_TRACE, manifestId: null, consistencyGroupCount: 0, curatedCount: 0,
  requiredUnresolvedCount: 1, resultCode: "required_asset_unavailable",
};
const PAID_ASSET_TRACE: AssetResolutionTrace = {
  ...ASSET_FAILURE_TRACE,
  provider: "gemini",
  modelId: "gemini-image-test",
  promptSha256: [`sha256:${"b".repeat(64)}`],
  usage: { inputTokens: 31, outputTokens: 7, cachedTokens: 3, thinkingTokens: 2 },
  estimatedCostMicromxn: 456,
  durationMs: 19,
  resultCode: "provider_timeout",
};

function providerFailure(kind: "timeout" | "schema"): GenerateCreativeDirectionResult {
  return {
    ok: false,
    error: { kind, message: "raw provider detail must not escape" },
    promptVersion: CREATIVE_PROMPT_VERSION,
    modelId: "test-model",
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
  it("keeps the exact legacy result and resolver path when assets are off", async () => {
    const legacy = baseDeps();
    const legacyResult = await adaptTemplateSkeleton(INPUT, legacy);
    const resolveDomainAssets = vi.fn();
    const applyManifest = vi.fn();
    const off = baseDeps();
    const onAssetTrace = vi.fn();
    off.resolveDomainAssets = resolveDomainAssets;
    off.applyAssetManifest = applyManifest;
    off.onAssetTrace = onAssetTrace;

    const offResult = await adaptTemplateSkeleton({
      ...INPUT,
      assetContext: { mode: "off", projectId: "project-1" },
    }, off);

    expect(offResult).toEqual(legacyResult);
    expect(resolveDomainAssets).not.toHaveBeenCalled();
    expect(applyManifest).not.toHaveBeenCalled();
    expect(onAssetTrace).not.toHaveBeenCalled();
  });

  it("runs intent, manifest, and apply before sanitize for curated candidates", async () => {
    const order: string[] = [];
    const onAssetTrace = vi.fn();
    const deps = baseDeps();
    deps.buildAssetIntents = () => { order.push("intent"); return [{ slotIndex: 0 }] as never; };
    deps.resolveDomainAssets = async (input) => {
      order.push(`manifest:${input.mode}:${input.projectId}`);
      return { ok: true, manifest: ASSET_MANIFEST, trace: ASSET_TRACE };
    };
    deps.applyAssetManifest = (input) => {
      order.push("apply");
      return { ok: true, html: input.html, manifest: ASSET_MANIFEST };
    };
    deps.sanitize = (html) => { order.push("sanitize"); return { html }; };
    deps.fingerprint = (html, options) => { order.push("fingerprint"); return fingerprintStructure(html, options); };
    deps.technicalRender = async () => { order.push("render"); return true; };
    deps.onAssetTrace = onAssetTrace;

    const result = await adaptTemplateSkeleton({
      ...INPUT,
      assetContext: { mode: "curated", projectId: "project-1" },
    }, deps);

    expect(result).toMatchObject({ ok: true, assetManifest: ASSET_MANIFEST, assetTrace: ASSET_TRACE });
    expect(onAssetTrace).toHaveBeenCalledTimes(1);
    expect(onAssetTrace).toHaveBeenCalledWith(ASSET_TRACE);
    expect(order).toEqual(["sanitize", "intent", "manifest:curated:project-1", "apply", "sanitize", "fingerprint", "render"]);
  });

  it("passes only the asset-plan subset to the strict intent boundary", async () => {
    const resolveDomainAssets = vi.fn(async () => ({
      ok: false as const,
      code: "required_asset_unavailable" as const,
      slotIndex: 0,
      trace: ASSET_FAILURE_TRACE,
    }));
    const deps = baseDeps();
    deps.resolveDomainAssets = resolveDomainAssets;

    const result = await adaptTemplateSkeleton({
      ...INPUT,
      assetContext: { mode: "curated", projectId: "project-1" },
    }, deps);

    expect(result).toMatchObject({ ok: false, reasonCode: "required_asset_unavailable" });
    expect(resolveDomainAssets).toHaveBeenCalledTimes(1);
    expect(resolveDomainAssets).toHaveBeenCalledWith(
      expect.objectContaining({
        intents: [expect.objectContaining({ slotIndex: 0, mediaType: "illustration", required: true })],
      }),
      expect.anything(),
    );
  });

  it("forces shadow through curated-only resolution and delivers the exact legacy result", async () => {
    const legacyResult = await adaptTemplateSkeleton(INPUT, baseDeps());
    const provider = { capabilities: vi.fn(), createPack: vi.fn() };
    const storage = { put: vi.fn() };
    const resolveDomainAssets = vi.fn(async (input) => {
      expect(input.mode).toBe("curated");
      return { ok: false as const, code: "required_asset_unavailable" as const, trace: ASSET_FAILURE_TRACE };
    });
    const onAssetTrace = vi.fn();
    const deps = baseDeps();
    deps.buildAssetIntents = () => [{ slotIndex: 0 }] as never;
    deps.resolveDomainAssets = resolveDomainAssets;
    deps.onAssetTrace = onAssetTrace;
    deps.assetPipelineDeps = { loadCuratedImages: async () => [], catalogVersion: "test", fetchImpl: vi.fn(), provider, storage, budget: { version: "test", maxCostMicromxn: 1, estimatedImageCostMicromxn: 1 } };

    const result = await adaptTemplateSkeleton({
      ...INPUT,
      assetContext: { mode: "shadow", projectId: "project-1" },
    }, deps);

    expect(result).toEqual(legacyResult);
    expect(resolveDomainAssets).toHaveBeenCalledTimes(1);
    expect(onAssetTrace).toHaveBeenCalledTimes(1);
    expect(onAssetTrace).toHaveBeenCalledWith(ASSET_FAILURE_TRACE);
    expect(provider.createPack).not.toHaveBeenCalled();
    expect(storage.put).not.toHaveBeenCalled();
  });

  it("emits the parsed redacted trace for a successful shadow manifest attempt", async () => {
    const onAssetTrace = vi.fn();
    const deps = baseDeps();
    deps.buildAssetIntents = () => [{ slotIndex: 0 }] as never;
    deps.resolveDomainAssets = async () => ({ ok: true, manifest: ASSET_MANIFEST, trace: ASSET_TRACE });
    deps.onAssetTrace = onAssetTrace;
    const result = await adaptTemplateSkeleton({ ...INPUT, assetContext: { mode: "shadow", projectId: "project-1" } }, deps);
    expect(result).toMatchObject({ ok: true });
    expect(onAssetTrace).toHaveBeenCalledTimes(1);
    expect(onAssetTrace).toHaveBeenCalledWith(ASSET_TRACE);
  });

  it("maps manifest or apply failure to a typed fallback without candidate HTML", async () => {
    const deps = baseDeps();
    deps.buildAssetIntents = () => [{ slotIndex: 0 }] as never;
    deps.resolveDomainAssets = async () => ({ ok: false, code: "required_asset_unavailable", slotIndex: 0, trace: ASSET_TRACE });
    const result = await adaptTemplateSkeleton({ ...INPUT, assetContext: { mode: "curated", projectId: "project-1" } }, deps);
    expect(result).toMatchObject({ ok: false, reasonCode: "required_asset_unavailable" });
    expect(result).not.toHaveProperty("html");
    expect(result).not.toHaveProperty("assetManifest");
  });

  it.each([
    ["provider", "provider_error", "provider_timeout"],
    ["validation", "invalid_asset", "invalid_provider_output"],
    ["storage", "storage_error", "storage_failure"],
  ] as const)("emits paid hybrid %s failure telemetry exactly once", async (_name, code, resultCode) => {
    const onAssetTrace = vi.fn();
    const trace = { ...PAID_ASSET_TRACE, resultCode };
    const deps = baseDeps();
    deps.buildAssetIntents = () => [{ slotIndex: 0 }] as never;
    deps.resolveDomainAssets = async () => ({ ok: false, code, trace } as never);
    deps.onAssetTrace = onAssetTrace;

    const result = await adaptTemplateSkeleton({
      ...INPUT,
      assetContext: { mode: "hybrid", projectId: "project-1" },
    }, deps);

    expect(result).toMatchObject({ ok: false });
    expect(onAssetTrace).toHaveBeenCalledTimes(1);
    expect(onAssetTrace).toHaveBeenCalledWith(trace);
    expect(JSON.stringify(onAssetTrace.mock.calls)).not.toMatch(/html|prompt(?!Sha256)|raw|private/i);
  });

  it.each(["sanitize", "render"] as const)("retains a paid hybrid trace when downstream %s rejects the candidate", async (stage) => {
    const onAssetTrace = vi.fn();
    const trace = { ...PAID_ASSET_TRACE, manifestId: ASSET_MANIFEST.manifestId, requiredUnresolvedCount: 0, resultCode: "resolved" as const };
    const deps = baseDeps();
    deps.buildAssetIntents = () => [{ slotIndex: 0 }] as never;
    deps.resolveDomainAssets = async () => ({ ok: true, manifest: ASSET_MANIFEST, trace });
    deps.applyAssetManifest = (input) => ({ ok: true, html: input.html, manifest: ASSET_MANIFEST });
    deps.onAssetTrace = onAssetTrace;
    if (stage === "sanitize") {
      let sanitizeCalls = 0;
      deps.sanitize = (html) => ({ html: ++sanitizeCalls === 1 ? html : null });
    }
    if (stage === "render") deps.technicalRender = async () => false;

    const result = await adaptTemplateSkeleton({
      ...INPUT,
      assetContext: { mode: "hybrid", projectId: "project-1" },
    }, deps);

    expect(result).toMatchObject({ ok: false, reasonCode: stage === "sanitize" ? "sanitization_failed" : "technical_render_failed" });
    expect(onAssetTrace).toHaveBeenCalledTimes(1);
    expect(onAssetTrace).toHaveBeenCalledWith(trace);
    expect(result).not.toHaveProperty("assetManifest");
    expect(result).not.toHaveProperty("assetTrace");
  });
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
    expect(order).toEqual(["sanitize", "inventory", "creative", "compile", "assets", "sanitize", "fingerprint", "render"]);
  });

  it("establishes sanitized markup as the structural baseline before creative compilation", async () => {
    const unsafeInput = {
      ...INPUT,
      html: INPUT.html.replace('class="cta"', 'class="cta" onclick="private()"'),
    };
    const deps = baseDeps();
    deps.sanitize = (html) => ({ html: html.replace(/\s+onclick="[^"]*"/g, "") });

    const result = await adaptTemplateSkeleton(unsafeInput, deps);

    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, status: "adapted" });
    if (!result.ok) return;
    expect(result.html).not.toContain("onclick");
    expect(result.structuralFingerprintAfter).toBe(result.structuralFingerprintBefore);
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
    { name: "required asset miss", reasonCode: "required_asset_unavailable", providerCalls: 1, change: (deps) => { deps.resolveAssets = async () => ({ ok: false, code: "required_asset_unavailable", slotIndex: 0 }); } },
    { name: "unreplaceable asset slot", reasonCode: "asset_slot_unavailable", providerCalls: 1, change: (deps) => { deps.resolveAssets = async () => ({ ok: false, code: "asset_slot_unavailable", slotIndex: 0 }); } },
    { name: "sanitizer rejection", reasonCode: "sanitization_failed", providerCalls: 1, change: (deps) => {
      let sanitizeCalls = 0;
      deps.sanitize = (html) => ({ html: ++sanitizeCalls === 1 ? html : null });
    } },
    { name: "technical render failure", reasonCode: "technical_render_failed", providerCalls: 1, change: (deps) => { deps.technicalRender = async () => false; } },
    { name: "structural mismatch", reasonCode: "structural_invariant_failed", providerCalls: 1, change: (deps) => {
      let sanitizeCalls = 0;
      deps.sanitize = (html) => ({ html: ++sanitizeCalls === 1 ? html : html.replace("<body>", '<body data-unexpected="true">') });
    } },
    { name: "unexpected exception", reasonCode: "internal_error", providerCalls: 1, change: (deps) => { deps.compileIdentity = () => { throw new Error("provider payload secret"); }; } },
  ];

  it.each(fallbackCases)("falls back atomically on $name", async ({ reasonCode, providerCalls, change }) => {
    const deps = baseDeps();
    change(deps);

    const result = await adaptTemplateSkeleton(INPUT, deps);

    expect(result).toMatchObject({ ok: false, status: "fallback", reasonCode });
    expect(result).not.toHaveProperty("html");
    if (providerCalls === 0 || reasonCode === "provider_timeout") expect(result).not.toHaveProperty("usage");
    expect(deps.generateCreativeDirection).toHaveBeenCalledTimes(providerCalls);
  });

  it.each([
    "cannot_remove_forbidden_signal",
    "cannot_add_required_signal",
    "asset_slot_unavailable",
    "hook_property_not_allowed",
  ] as const satisfies readonly SkeletonAdaptationFailureCode[])(
    "uses a deterministic visual direction when the model reports %s",
    async (reasonCode) => {
      const deps = baseDeps();
      deps.generateCreativeDirection = vi.fn().mockResolvedValue({
        ...READY,
        response: {
          schemaVersion: "skeleton-creative-response/1.0",
          status: "incompatible",
          reasonCode,
        },
      });

      const result = await adaptTemplateSkeleton(INPUT, deps);

      expect(result, JSON.stringify(result)).toMatchObject({
        ok: true,
        status: "adapted",
        usage: READY.ok ? READY.usage : undefined,
      });
      expect(deps.generateCreativeDirection).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["timeout", "schema"] as const)(
    "uses deterministic visual direction when the creative provider returns %s",
    async (kind) => {
      const deps = baseDeps();
      deps.generateCreativeDirection = vi.fn().mockResolvedValue(providerFailure(kind));

      const result = await adaptTemplateSkeleton(INPUT, deps);

      expect(result, JSON.stringify(result)).toMatchObject({ ok: true, status: "adapted" });
      expect(deps.generateCreativeDirection).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["css_policy_violation", "contrast_violation"] as const)(
    "discards a ready model plan that fails %s and recompiles deterministically",
    async (code) => {
      const deps = baseDeps();
      let compileCalls = 0;
      deps.compileIdentity = (input) => {
        compileCalls += 1;
        return compileCalls === 1
          ? { ok: false, code, message: "unsafe model plan" }
          : compileSkeletonIdentity(input);
      };

      const result = await adaptTemplateSkeleton(INPUT, deps);

      expect(result, JSON.stringify(result)).toMatchObject({ ok: true, status: "adapted" });
      expect(compileCalls).toBe(2);
    },
  );

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
    expect(deps.sanitize).toHaveBeenCalledTimes(1);
    expect(deps.technicalRender).not.toHaveBeenCalled();
  });
});
