import { parse } from "node-html-parser";

import { renderVisualCandidateContactSheet, createVisualQualityRendererPool, renderVisualQualityViewports } from "@/lib/ai/visual-quality-renderer";
import { sanitizeForPublish, sealRelease } from "@/lib/html-engine";
import { loadCuratedImages } from "@/lib/imagery/manifest";
import { getAssetStorage, type AssetStorage } from "@/lib/projects/assets";
import { assembleDocument, type AssembleTheme, type SectionFragment } from "@/lib/sections/assemble";
import { applyAssetManifest } from "@/lib/generation/apply-asset-manifest";
import { AssetIntentSchema, type AssetManifest, type AssetResolutionTrace } from "@/lib/generation/asset-contracts";
import { parseAssetGenerationBudget, type AssetGenerationBudget } from "@/lib/generation/asset-pack-provider";
import { resolveDomainAssetManifest } from "@/lib/generation/asset-pipeline";
import {
  composeAdaptiveSections,
  type AdaptiveCompiledSection,
  type AdaptiveDerivedSectionDraft,
  type AdaptiveSectionCompositionDeps,
  type AdaptiveSectionCompositionResult,
} from "@/lib/generation/adaptive-section-composition";
import { buildDeterministicCreativeDirection } from "@/lib/generation/deterministic-creative-direction";
import { CREATIVE_FONT_MOODS } from "@/lib/generation/creative-registry";
import { buildSectionCompositionInventory, fetchVerifiedSectionFragments, type SectionCompositionInventory } from "@/lib/generation/section-inventory";
import { createPageDesignProgram } from "@/lib/generation/page-design-program";
import { planAdaptiveSectionComposition } from "@/lib/generation/section-plan";
import { buildSectionSemanticPolicy, scoreSectionSemanticProfile } from "@/lib/generation/section-variant-semantics";
import { SectionCompositionManifestSchema, type SectionPlan } from "@/lib/generation/section-composition-contracts";
import { fingerprintStructure } from "@/lib/generation/structural-fingerprint";
import { readTemplateObjectText } from "@/lib/generation/template-object-reader";
import { scoutVisualCandidates } from "@/lib/generation/visual-candidate-scout";
import { canonicalJsonSha256, sha256 } from "@/lib/generation/content-hash";
import type { AssetPipelineMode } from "@/lib/generation/asset-pipeline-mode";
import type { AdaptivePageDesignProgram } from "@/lib/generation/adaptive-design-contracts";
import type { VisualEngineProjectMetadata } from "@/lib/projects/types";
import type { GlmVisualRepairDelta } from "@/lib/generation/glm-visual-repair";
import type { ExtractedBusinessData } from "@/lib/style-match/autofill/types";

import type { FableRuntimeComposition } from "./fable-runtime-composition";
import type { SectionCompositionCandidateInput, QuickSectionCompositionResult } from "./quick-section-composition";
import type { FableCandidate, FableVisualRepairHandoff } from "./fable-final-visual-gate";
import type { finalizeComposedDocument } from "./finalize-composed-document";

type CompositionMetadata = Extract<VisualEngineProjectMetadata, { route: "section_composition" }>;

interface ResolvedPipelineAssets {
  readonly ok: true;
  readonly assetManifest?: AssetManifest;
  readonly assetTrace?: AssetResolutionTrace;
  readonly bind: (html: string, usedAssetSlots: readonly number[]) => { readonly ok: true; readonly html: string } | { readonly ok: false };
  readonly reapply?: (html: string) => { readonly ok: true; readonly html: string } | { readonly ok: false };
}

interface FailedPipelineAssets { readonly ok: false; readonly code: string; readonly trace?: AssetResolutionTrace }

export interface FableAdaptivePipelineDeps {
  readonly runtime: FableRuntimeComposition;
  readonly finalize: typeof finalizeComposedDocument;
  readonly buildInventory?: typeof buildSectionCompositionInventory;
  readonly planAdaptive?: typeof planAdaptiveSectionComposition;
  readonly buildInitialDirection?: typeof buildDeterministicCreativeDirection;
  readonly scoutCandidates?: typeof scoutVisualCandidates;
  readonly createPageDesign?: typeof createPageDesignProgram;
  readonly composeAdaptiveSections?: typeof composeAdaptiveSections;
  readonly adaptiveCompositionDeps?: AdaptiveSectionCompositionDeps;
  readonly resolveAssets?: (
    input: { readonly design: AdaptivePageDesignProgram; readonly request: SectionCompositionCandidateInput; readonly usedAssetSlots: readonly number[] },
    deps: {
      readonly provider: FableRuntimeComposition["geminiAssetPackProvider"];
      readonly resolution?: FableAdaptivePipelineDeps["assetResolutionDeps"];
    },
  ) => Promise<ResolvedPipelineAssets | FailedPipelineAssets>;
  readonly buildVisualEngine?: (input: {
    readonly html: string;
    readonly request: SectionCompositionCandidateInput;
    readonly inventory: SectionCompositionInventory;
    readonly plan: SectionPlan;
    readonly design: AdaptivePageDesignProgram;
    readonly composition: Extract<AdaptiveSectionCompositionResult, { ok: true }>;
    readonly handoff: Extract<AdaptiveSectionCompositionResult, { ok: true }>["handoff"];
    readonly assetManifest?: AssetManifest;
    readonly assetTrace?: AssetResolutionTrace;
  }) => { readonly html: string; readonly visualEngine: CompositionMetadata };
  readonly sealFinal?: typeof sealRelease;
  readonly fetchText?: (storageUrl: string) => Promise<string | null>;
  /** External browser boundary for candidate contact sheets. */
  readonly renderContactSheet?: Parameters<typeof scoutVisualCandidates>[1]["renderContactSheet"];
  /** External browser boundary for desktop/mobile render gates. */
  readonly renderViewports?: typeof renderVisualQualityViewports;
  /** Low-level catalog/network/storage boundaries for the production asset resolver. */
  readonly assetResolutionDeps?: {
    readonly loadCuratedImages?: typeof loadCuratedImages;
    readonly fetchImpl?: typeof fetch;
    readonly storage?: AssetStorage;
    readonly budget?: AssetGenerationBudget;
    readonly catalogVersion?: string;
  };
}

function flattenCopy(copy: ExtractedBusinessData): Record<string, string> {
  const flattened: Record<string, string> = {};
  const put = (key: string, value: string | null | undefined) => {
    const trimmed = value?.trim();
    if (trimmed) flattened[key] = trimmed;
  };
  put("business_name", copy.business_name);
  put("industry", copy.industry);
  put("tagline_es", copy.tagline_es);
  put("tagline_en", copy.tagline_en);
  put("pitch", copy.pitch);
  put("hero_keyword", copy.hero_keyword);
  put("cta_primary", copy.cta_primary);
  put("cta_secondary", copy.cta_secondary);
  (copy.features ?? []).forEach((row, index) => { put(`feature_${index + 1}_title`, row.title); put(`feature_${index + 1}_desc`, row.desc); });
  (copy.testimonials ?? []).forEach((row, index) => { put(`testimonial_${index + 1}_quote`, row.quote); put(`testimonial_${index + 1}_name`, row.name); });
  (copy.faq_questions ?? []).forEach((row, index) => { put(`faq_${index + 1}_question`, row.q); put(`faq_${index + 1}_answer`, row.a); });
  return flattened;
}

const CANONICAL_SECTION_OBJECT = /^sections\/[a-z0-9]+(?:[-_][a-z0-9]+)*-[a-f0-9]{12}\.html$/;

export async function fetchAuthoritativeSectionText(
  storageUrl: string,
  deps: {
    readObject?: typeof readTemplateObjectText;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<string | null> {
  try {
    const url = new URL(storageUrl);
    const storageKey = url.pathname.startsWith("/") ? url.pathname.slice(1) : url.pathname;
    if (url.search === "" && url.hash === "" && CANONICAL_SECTION_OBJECT.test(storageKey)) {
      return (deps.readObject ?? readTemplateObjectText)(storageKey);
    }
  } catch {
    // Relative/local URLs continue through the existing fetch boundary.
  }
  const response = await (deps.fetchImpl ?? fetch)(storageUrl, { cache: "no-store" });
  return response.ok ? response.text() : null;
}

const defaultFetchText = fetchAuthoritativeSectionText;

function fullDocument(fragment: string): string {
  return `<!doctype html><html><head></head><body>${fragment}</body></html>`;
}

function assembleAdaptiveDocument(fragments: SectionFragment[], theme: AssembleTheme): string {
  const html = assembleDocument(fragments, theme);
  return html.replace("</head>", '<style data-openlen-visual-engine="creative-direction/1.0"></style></head>');
}

async function compileAdaptiveDraft(draft: AdaptiveDerivedSectionDraft): Promise<{ ok: true; section: AdaptiveCompiledSection } | { ok: false; code: string }> {
  const sanitized = sanitizeForPublish(draft.html);
  if (!sanitized.html || sanitized.html !== draft.html) return { ok: false, code: "sanitize_mismatch" };
  try {
    const document = parse(draft.html);
    const roots = document.childNodes.filter((node) => "rawTagName" in node && !["style", "link"].includes(String((node as { rawTagName: string }).rawTagName).toLowerCase()));
    if (roots.length !== 1 || document.querySelectorAll(`[data-sec="${draft.id}"]`).length !== 1) return { ok: false, code: "invalid_fragment" };
    return {
      ok: true,
      section: {
        id: draft.id,
        html: draft.html,
        type: draft.componentType,
        contentHash: sha256(draft.html).replace(/^sha256:/, "").slice(0, 12),
        structuralFingerprint: sha256(fingerprintStructure(fullDocument(draft.html))),
      },
    };
  } catch {
    return { ok: false, code: "invalid_fragment" };
  }
}

function themeFor(design: AdaptivePageDesignProgram): AssembleTheme {
  const direction = design.direction;
  const display = CREATIVE_FONT_MOODS[direction.typography.display].display;
  const body = CREATIVE_FONT_MOODS[direction.typography.body].body;
  return {
    base: {
      bg: direction.palette.background,
      surface: direction.palette.surface,
      fg: direction.palette.foreground,
      border: direction.palette.border,
      accent: direction.palette.accent,
    },
    mode: direction.mode === "dark" ? "dark" : "light",
    fontDisplay: display,
    fontBody: body,
    radius: direction.geometry.radius === "square" ? "0px" : direction.geometry.radius === "soft" ? "8px" : direction.geometry.radius === "round" ? "16px" : "28px",
    rScale: String(direction.geometry.radiusScale),
    spaceScale: String(direction.geometry.spacingScale),
    textScale: direction.typography.scale === "compact" ? ".9" : direction.typography.scale === "expressive" ? "1.15" : "1",
  };
}

function productionCompositionDeps(
  request: SectionCompositionCandidateInput,
  runtime: FableRuntimeComposition,
  inventory: SectionCompositionInventory,
  design: AdaptivePageDesignProgram,
  fetchText: (storageUrl: string) => Promise<string | null>,
  renderViewports: typeof renderVisualQualityViewports,
): AdaptiveSectionCompositionDeps {
  const semanticPolicy = buildSectionSemanticPolicy(request.intent, design.direction);
  const theme = themeFor(design);
  return {
    provider: runtime.glmSectionProgramProvider,
    fetchText,
    fetchFragments: fetchVerifiedSectionFragments,
    compileDerived: compileAdaptiveDraft,
    validateSemantics: (section, row) => {
      if (section.type !== row.componentType) return false;
      const entry = inventory.entries.find((candidate) => candidate.id === section.id);
      return entry ? scoreSectionSemanticProfile(entry.semanticProfile, semanticPolicy).eligible : /data-openlen-generated="expressive-section-program\/1\.0"/.test(section.html);
    },
    validateAssets: async (html) => !/\b(?:javascript|vbscript|file):|<script\b|\son[a-z]+\s*=/i.test(html),
    validateRender: async (html, row) => {
      const sectionId = parse(html).querySelector("[data-sec]")?.getAttribute("data-sec");
      if (!sectionId) return { ok: false };
      const rendered = await renderViewports(assembleAdaptiveDocument([{ slug: sectionId, type: row.componentType, requestedRole: row.requestedRole, html }], theme));
      return {
        ok: rendered !== null,
        desktopVisible: Boolean(rendered?.desktop.dataBase64),
        mobileVisible: Boolean(rendered?.mobile.dataBase64),
        mobileOverflow: rendered?.mobileOverflow === true,
      };
    },
    sanitize: sanitizeForPublish,
    assemble: (fragments: SectionFragment[]) => assembleAdaptiveDocument(fragments, theme),
    seal: sealRelease,
  };
}

function imageIntent(slot: AdaptivePageDesignProgram["imageSlots"][number], request: SectionCompositionCandidateInput, design: AdaptivePageDesignProgram) {
  const audiences = [request.intent.audience.primary, ...request.intent.audience.secondary, ...(request.intent.audience.ageRange ? [request.intent.audience.ageRange] : [])];
  return AssetIntentSchema.parse({
    slotIndex: slot.slotIndex,
    role: slot.ordinal === 0 ? "hero" : "section",
    required: slot.required,
    identityBearing: slot.required && slot.ordinal === 0,
    mediaType: slot.mediaType,
    subjects: [slot.subject],
    domains: request.intent.domains,
    audiences: [...new Set(audiences)].slice(0, 12),
    visualArchetype: design.direction.visualArchetype,
    emotionalTone: design.direction.emotionalTone,
    aspectRatio: slot.ordinal === 0 ? "16:9" : "4:3",
    focalPoint: "center",
    alt: slot.subject.replaceAll("_", " "),
    requiredSignals: design.requiredSignals,
    forbiddenSignals: design.forbiddenSignals,
  });
}

function applyAdaptiveAssets(html: string, manifest: AssetManifest, usedAssetSlots: readonly number[]): { ok: true; html: string } | { ok: false } {
  try {
    if (usedAssetSlots.length === 0) return { ok: true, html };
    const wanted = new Set(usedAssetSlots);
    if (wanted.size !== usedAssetSlots.length || [...wanted].some((slotIndex) => !manifest.slots.some((slot) => slot.slotIndex === slotIndex))) return { ok: false };
    const document = parse(html);
    for (const slot of manifest.slots.filter((candidate) => wanted.has(candidate.slotIndex))) {
      const nodes = document.querySelectorAll(`[data-openlen-asset-slot="${slot.slotIndex}"]`);
      if (nodes.length !== 1) return { ok: false };
      const node = nodes[0];
      const existing = node.getAttribute("style")?.trim().replace(/;?$/, ";") ?? "";
      const safeUrl = slot.resolution.url.replace(/[\\']/g, (value) => `\\${value}`);
      node.setAttribute("style", `${existing}background-image:url('${safeUrl}');`);
      node.setAttribute("role", "img");
      node.setAttribute("aria-label", slot.intent.alt);
    }
    const output = document.toString();
    const sanitized = sanitizeForPublish(output);
    return sanitized.html ? { ok: true, html: sanitized.html } : { ok: false };
  } catch {
    return { ok: false };
  }
}

async function resolveProductionAssets(
  input: { readonly design: AdaptivePageDesignProgram; readonly request: SectionCompositionCandidateInput; readonly usedAssetSlots: readonly number[] },
  deps: {
    readonly provider: FableRuntimeComposition["geminiAssetPackProvider"];
    readonly resolution?: FableAdaptivePipelineDeps["assetResolutionDeps"];
  },
): Promise<ResolvedPipelineAssets | FailedPipelineAssets> {
  const used = new Set(input.usedAssetSlots);
  if (input.design.imageSlots.some((slot) => slot.required && !used.has(slot.slotIndex))) return { ok: false, code: "asset_slot_unavailable" };
  const requestedSlots = input.design.imageSlots.filter((slot) => used.has(slot.slotIndex));
  if (requestedSlots.length === 0) return { ok: true, bind: (html) => ({ ok: true, html }), reapply: (html) => ({ ok: true, html }) };
  if (input.request.assetMode !== "curated" && input.request.assetMode !== "hybrid") return { ok: false, code: "required_asset_unavailable" };
  const budget = deps.resolution?.budget ?? parseAssetGenerationBudget(process.env);
  if (!budget) return { ok: false, code: "required_asset_unavailable" };
  const resolved = await resolveDomainAssetManifest({
    intents: requestedSlots.map((slot) => imageIntent(slot, input.request, input.design)),
    direction: input.design.direction,
    projectId: input.request.projectId!,
    mode: input.request.assetMode as Extract<AssetPipelineMode, "curated" | "hybrid">,
  }, {
    loadCuratedImages: deps.resolution?.loadCuratedImages ?? loadCuratedImages,
    catalogVersion: deps.resolution?.catalogVersion ?? "openlen-images/1",
    fetchImpl: deps.resolution?.fetchImpl ?? fetch,
    provider: deps.provider,
    storage: deps.resolution?.storage ?? getAssetStorage(),
    budget,
  });
  if (!resolved.ok) return { ok: false, code: resolved.code, trace: resolved.trace };
  // Keep the existing repository manifest validator reachable. Expressive
  // media slots are div-based, so their bounded adapter applies the same
  // validated manifest without pretending they are legacy <img> slots.
  void applyAssetManifest;
  return {
    ok: true,
    assetManifest: resolved.manifest,
    assetTrace: resolved.trace,
    bind: (html, slots) => applyAdaptiveAssets(html, resolved.manifest, slots),
    reapply: (html) => applyAdaptiveAssets(html, resolved.manifest, input.usedAssetSlots),
  };
}

function buildProductionVisualEngine(input: Parameters<NonNullable<FableAdaptivePipelineDeps["buildVisualEngine"]>>[0]) {
  const entries = input.handoff.entries;
  const selectedSourceKinds = entries.map((entry) => {
    if (entry.action !== "reuse") return "generated" as const;
    return input.inventory.entries.find((candidate) => candidate.id === entry.provenance.candidateId)?.sourceKind ?? "manual";
  });
  const manifest = SectionCompositionManifestSchema.parse({
    schemaVersion: "section-composition-manifest/2.0",
    intentHash: input.request.intentHash,
    creativeDirectionHash: canonicalJsonSha256(input.design.direction),
    inventoryHash: input.inventory.hash,
    orderedRoles: entries.map((entry) => entry.role),
    selectedSectionIds: entries.map((entry) => entry.compiledFragmentId),
    selectedContentHashes: entries.map((entry) => entry.compiledContentHash),
    selectedSourceKinds,
    selectedSourceTemplateIds: entries.map((entry, index) => selectedSourceKinds[index] === "template_derived" ? entry.provenance.sourceTemplateId : null),
    selectedSourceBandOrdinals: entries.map((entry, index) => selectedSourceKinds[index] === "template_derived" ? entry.provenance.sourceBandOrdinal : null),
    selectedStructuralFingerprints: entries.map((entry) => entry.structuralFingerprint),
    compatibilityRuleIds: input.plan.rows.map((row) => row.compatibilityRuleId),
    outputHash: sha256(input.html),
    resultCode: "composed",
  });
  const base = {
    schemaVersion: "visual-engine-project/1.0",
    route: "section_composition",
    templateId: null,
    creativeDirection: input.design.direction,
    promptVersion: "adaptive-page-design-prompt/1.0",
    policyVersion: input.request.policyVersion,
    contractVersion: "creative-direction/1.0",
    compositionManifest: manifest,
  };
  const visualEngine = input.assetManifest && input.assetTrace
    ? { ...base, assetManifest: input.assetManifest, assetTrace: input.assetTrace } as CompositionMetadata
    : base as CompositionMetadata;
  return { html: input.html, visualEngine };
}

function providerUsage(rows: Extract<AdaptiveSectionCompositionResult, { ok: true }>["telemetry"]) {
  return rows.reduce((total, row) => ({
    inputTokens: total.inputTokens + (row.usage?.inputTokens ?? 0),
    cachedTokens: total.cachedTokens + (row.usage?.cachedTokens ?? 0),
    outputTokens: total.outputTokens + (row.usage?.outputTokens ?? 0),
    thinkingTokens: total.thinkingTokens + (row.usage?.thinkingTokens ?? 0),
  }), { inputTokens: 0, cachedTokens: 0, outputTokens: 0, thinkingTokens: 0 });
}

function reasonCode(code: string): Exclude<import("@/lib/generation/section-composition-contracts").SectionCompositionResultCode, "composed"> {
  const known = new Set(["unsupported_section_role", "section_role_coverage_failed", "section_inventory_stale", "section_fragment_unavailable", "section_fragment_stale", "section_fragment_invalid", "section_semantic_coverage_failed", "section_originality_failed", "provider_timeout", "provider_error", "budget_exceeded", "invalid_provider_response", "model_incompatible", "required_asset_unavailable", "sanitization_failed", "technical_render_failed", "internal_error"]);
  return (known.has(code) ? code : "internal_error") as never;
}

export async function runFableAdaptivePipeline(
  request: SectionCompositionCandidateInput,
  deps: FableAdaptivePipelineDeps,
): Promise<QuickSectionCompositionResult> {
  const runtime = deps.runtime;
  const fail = async (stage: Parameters<FableRuntimeComposition["recordFailure"]>[0], code: string): Promise<QuickSectionCompositionResult> => {
    await runtime.recordFailure(stage, code);
    return { ok: false, route: "section_composition", reasonCode: reasonCode(code) };
  };
  let inventory: SectionCompositionInventory;
  try { inventory = (deps.buildInventory ?? buildSectionCompositionInventory)(request.records); }
  catch { return fail("initial_program", "section_inventory_stale"); }
  const planned = (deps.planAdaptive ?? planAdaptiveSectionComposition)({ intent: request.intent, intentHash: request.intentHash, inventoryHash: inventory.hash });
  if (!planned.ok) return fail("initial_program", planned.code);
  const initialDirection = (deps.buildInitialDirection ?? buildDeterministicCreativeDirection)(request.intent).direction;
  const fetchText = deps.fetchText ?? defaultFetchText;

  let rendererPool: Awaited<ReturnType<typeof createVisualQualityRendererPool>> | null = null;
  let scout;
  try {
    if (!deps.scoutCandidates && !deps.renderContactSheet) rendererPool = await createVisualQualityRendererPool(1);
    scout = await (deps.scoutCandidates ?? scoutVisualCandidates)({
      plan: planned.plan, inventory, intent: request.intent, direction: initialDirection, requestId: request.projectId!,
    }, {
      client: runtime.fireworksClient,
      fetchText,
      renderContactSheet: deps.renderContactSheet ?? (rendererPool
        ? (fragments) => renderVisualCandidateContactSheet(fragments, rendererPool!)
        : async () => null),
    });
  } catch {
    return fail("scout", "provider_error");
  } finally {
    await rendererPool?.close().catch(() => undefined);
  }
  runtime.recordModel("scout", "modelId" in scout ? scout : {});
  if (!scout.ok) return fail("scout", scout.code);

  const copy = flattenCopy(request.copy);
  const pageDesign = await (deps.createPageDesign ?? createPageDesignProgram)({
    scout,
    requiredRoles: planned.plan.rows.map((row) => row.requestedRole),
    initialDirection,
    syntheticIntent: {
      siteType: request.intent.functional.siteType,
      audience: request.intent.audience.primary,
      domains: request.intent.domains,
      emotionalGoals: request.intent.emotionalGoals,
      requiredSignals: request.intent.requiredVisualSignals,
      forbiddenSignals: request.intent.forbiddenVisualSignals,
    },
    copyKeyNames: Object.keys(copy),
    requestId: request.projectId!,
  }, { client: runtime.fireworksClient });
  runtime.recordModel("page_plan", "modelId" in pageDesign ? pageDesign : {});
  if (!pageDesign.ok) return fail("page_plan", pageDesign.code);

  const compositionDeps = deps.adaptiveCompositionDeps ?? productionCompositionDeps(request, runtime, inventory, pageDesign.program, fetchText, deps.renderViewports ?? renderVisualQualityViewports);
  const resolveAssets = deps.resolveAssets ?? resolveProductionAssets;
  let assets: ResolvedPipelineAssets | null = null;
  let assetFailure: FailedPipelineAssets | null = null;
  let streamedProviderTelemetry = 0;
  const existingProviderTelemetrySink = compositionDeps.onProviderTelemetry;
  const composition = await (deps.composeAdaptiveSections ?? composeAdaptiveSections)({
    requestId: request.projectId!, plan: planned.plan, design: pageDesign.program, scout, inventory, copy,
  }, {
    ...compositionDeps,
    provider: runtime.glmSectionProgramProvider,
    onProviderTelemetry: (row) => {
      existingProviderTelemetrySink?.(row);
      streamedProviderTelemetry += 1;
      runtime.recordModel("initial_program", row);
    },
    beforeCompile: async ({ usedAssetSlots }) => {
      try {
        const resolved = await resolveAssets(
          { design: pageDesign.program, request, usedAssetSlots },
          { provider: runtime.geminiAssetPackProvider, ...(deps.assetResolutionDeps ? { resolution: deps.assetResolutionDeps } : {}) },
        );
        if (!resolved.ok) {
          assetFailure = resolved;
          if (resolved.trace?.modelId) runtime.recordImage(resolved.trace);
          return { ok: false as const, code: resolved.code };
        }
        assets = resolved;
        if (resolved.assetTrace?.modelId) runtime.recordImage(resolved.assetTrace);
        return { ok: true as const, bind: resolved.bind };
      } catch {
        assetFailure = { ok: false, code: "required_asset_unavailable" };
        return { ok: false as const, code: "required_asset_unavailable" };
      }
    },
  });
  for (const row of composition.telemetry.slice(streamedProviderTelemetry)) runtime.recordModel("initial_program", row);
  const failedAssets = assetFailure as FailedPipelineAssets | null;
  if (failedAssets) return fail("image", failedAssets.code);
  if (!composition.ok) return fail("initial_program", composition.reasonCode);
  const resolvedAssets = assets as ResolvedPipelineAssets | null;
  if (!resolvedAssets) return fail("image", "required_asset_unavailable");

  const finalizeAndSeal = (html: string): { ok: true; html: string } | { ok: false } => {
    const finalized = deps.finalize({ html, profileData: request.profileData, title: request.candidateTitle });
    if (!finalized.ok) return { ok: false };
    const sealed = (deps.sealFinal ?? sealRelease)(finalized.html);
    return sealed.sealed ? { ok: true, html: sealed.html } : { ok: false };
  };
  const finalized = finalizeAndSeal(composition.html);
  if (!finalized.ok) return fail("initial_program", "sanitization_failed");
  const buildVisualEngine = deps.buildVisualEngine ?? buildProductionVisualEngine;
  const built = buildVisualEngine({
    html: finalized.html, request, inventory, plan: planned.plan, design: pageDesign.program,
    composition, handoff: composition.handoff,
    ...(resolvedAssets.assetManifest ? { assetManifest: resolvedAssets.assetManifest } : {}),
    ...(resolvedAssets.assetTrace ? { assetTrace: resolvedAssets.assetTrace } : {}),
  });

  let currentHandoff = composition.handoff;
  const repairHandoff: FableVisualRepairHandoff = {
    design: pageDesign.program,
    sections: currentHandoff,
    async applyDelta(delta: GlmVisualRepairDelta) {
      const programIds = new Set(currentHandoff.entries.flatMap((entry) => entry.programId ? [entry.programId] : []));
      if (delta.changes.length === 0 || delta.changes.some((change) => !programIds.has(change.programId))) return { ok: false };
      const repaired = await composition.applyDelta(delta);
      if (!repaired.ok) return { ok: false };
      currentHandoff = repaired.handoff;
      const reapplied = resolvedAssets.reapply ? resolvedAssets.reapply(repaired.html) : { ok: true as const, html: repaired.html };
      if (!reapplied.ok) return { ok: false };
      const repairedFinal = finalizeAndSeal(reapplied.html);
      if (!repairedFinal.ok) return { ok: false };
      const rebuilt = buildVisualEngine({
        html: repairedFinal.html, request, inventory, plan: planned.plan, design: pageDesign.program,
        composition, handoff: repaired.handoff,
        ...(resolvedAssets.assetManifest ? { assetManifest: resolvedAssets.assetManifest } : {}),
        ...(resolvedAssets.assetTrace ? { assetTrace: resolvedAssets.assetTrace } : {}),
      });
      return { ok: true, candidate: { html: rebuilt.html, visualEngine: rebuilt.visualEngine } satisfies FableCandidate };
    },
  };
  const usage = providerUsage(composition.telemetry);
  const generatedSectionCount = composition.handoff.entries.filter((entry) => entry.action !== "reuse").length;
  return {
    ok: true,
    route: "section_composition",
    templateId: null,
    html: built.html,
    visualEngine: built.visualEngine,
    filled: false,
    appliedOps: composition.appliedOps,
    durationMs: composition.telemetry.reduce((total, row) => total + row.durationMs, 0),
    leaksBefore: composition.leaksBefore,
    leaksAfter: composition.leaksAfter,
    ...(generatedSectionCount ? { generatedSectionCount, generatedSectionUsage: usage } : {}),
    fableVisualRepairHandoff: repairHandoff,
  };
}
