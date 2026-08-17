import { parse } from "node-html-parser";

import {
  adaptTemplateSkeleton,
  type SkeletonAdaptationResult,
} from "./adapt-skeleton";
import type { CreativeDirection } from "./creative-contracts";
import type { GenerationRoute, IntentAnalysis } from "./contracts";
import {
  SECTION_COMPOSITION_MANIFEST_VERSION,
  hasOriginalSectionProvenance,
  SectionCompositionManifestSchema,
  SectionCompositionResultCodeSchema,
  type SectionCompositionManifest,
  type SectionCompositionResultCode,
} from "./section-composition-contracts";
import {
  buildSectionCompositionInventory,
  extendSectionCompositionInventoryWithGenerated,
  fetchVerifiedSectionFragments,
  resolveSectionPlan,
  SectionCompositionSelectionError,
  type SectionCompositionInventory,
  type SectionSelectionRow,
} from "./section-inventory";
import type { GenerateMissingSectionResult } from "./generate-missing-section";
import { planSectionComposition } from "./section-plan";
import { canonicalJsonSha256, sha256 } from "./content-hash";
import type { PilotReasonCode } from "./visual-engine-pilot-store";
import type { AssetPipelineMode } from "./asset-pipeline-mode";
import type { AssetResolutionTrace } from "./asset-contracts";
import { fillAssembled, hasFillableCopy, type FillAssembledResult } from "@/lib/assemble/fill";
import { normalizeBornCanonical } from "@/lib/normalize";
import {
  assembleDocument,
  SectionRoleMarkerError,
  type AssembleTheme,
  type SectionFragment,
} from "@/lib/sections/assemble";
import type { SectionRecord } from "@/lib/sections/store";
import { SECTION_TYPES } from "@/lib/sections/types";
import type { ExtractedBusinessData } from "@/lib/style-match/autofill/types";
import { ensureCompositionMobileSafety } from "./composition-mobile-safety";
import { buildDeterministicCreativeDirection } from "./deterministic-creative-direction";
import { assembleThemeFor } from "./direction-theme";

export { composeAdaptiveSections } from "./adaptive-section-composition";
export type {
  AdaptiveSectionCompositionDeps,
  AdaptiveSectionCompositionInput,
  AdaptiveSectionCompositionResult,
} from "./adaptive-section-composition";

export const COMPOSITION_BASE_THEME: AssembleTheme = Object.freeze({
  base: Object.freeze({
    bg: "#ffffff",
    surface: "#f7f7f5",
    fg: "#171717",
    border: "#deded9",
    accent: "#52525b",
  }),
  mode: "light",
  fontDisplay: "ui-sans-serif, system-ui, sans-serif",
  fontBody: "ui-sans-serif, system-ui, sans-serif",
  radius: "10px",
});

export interface ComposeSectionCandidateInput {
  route: GenerationRoute;
  projectId?: string;
  assetMode?: AssetPipelineMode;
  assetTraceSink?: (trace: AssetResolutionTrace) => void;
  intent: IntentAnalysis;
  intentHash: string;
  records: readonly SectionRecord[];
  copy: ExtractedBusinessData;
  brand: { accent: string | null };
  onStage?: (stage: string) => void;
}

export interface ComposeSectionCandidateDeps {
  buildInventory?: typeof buildSectionCompositionInventory;
  planSections?: typeof planSectionComposition;
  resolvePlan?: typeof resolveSectionPlan;
  fetchFragments?: typeof fetchVerifiedSectionFragments;
  fetchText?: (storageUrl: string) => Promise<string | null>;
  assembleDocument?: typeof assembleDocument;
  fillAssembled?: typeof fillAssembled;
  normalizeBornCanonical?: typeof normalizeBornCanonical;
  adaptTemplateSkeleton?: typeof adaptTemplateSkeleton;
  /** Last gate before the first paid composition call (fill). */
  beforeCreative?: () => Promise<boolean>;
  generateMissing?: (input: {
    row: import("./section-composition-contracts").SectionPlanRow;
    intent: IntentAnalysis;
    direction: CreativeDirection;
    copy: ExtractedBusinessData;
  }) => Promise<GenerateMissingSectionResult>;
}

export type SectionCompositionResult =
  | {
      ok: true;
      status: "composed";
      html: string;
      creativeDirection: CreativeDirection;
      manifest: SectionCompositionManifest;
      fill: Pick<FillAssembledResult, "filled" | "appliedOps" | "usage" | "durationMs" | "leaksBefore" | "leaksAfter">;
      adaptation: Omit<Extract<SkeletonAdaptationResult, { ok: true }>, "html" | "creativeDirection">;
      generatedSectionCount?: number;
      generatedSectionUsage?: { inputTokens: number; outputTokens: number; thinkingTokens: number; cachedTokens: number };
    }
  | {
      ok: false;
      status: "fallback";
      reasonCode: Exclude<SectionCompositionResultCode, "composed">;
      manifest: SectionCompositionManifest;
      telemetry?: {
        promptVersion: string | null;
        modelId: string | null;
        usage?: Extract<SkeletonAdaptationResult, { ok: false }>["usage"];
        durationMs: number;
      };
    };

const FAILURE_CODES = new Set<SectionCompositionResultCode>(
  SectionCompositionResultCodeSchema.options,
);

export function mapCompositionAdaptationReason(
  reason: PilotReasonCode,
): Exclude<SectionCompositionResultCode, "composed"> {
  if (reason === "asset_slot_unavailable") {
    return "required_asset_unavailable";
  }
  if (
    reason === "cannot_remove_forbidden_signal" ||
    reason === "cannot_add_required_signal" ||
    reason === "hook_property_not_allowed" ||
    reason === "insufficient_style_hooks" ||
    reason === "invalid_html" ||
    reason === "invalid_inventory"
  ) {
    return "model_incompatible";
  }
  if (reason === "structural_invariant_failed") {
    return "section_role_coverage_failed";
  }
  return FAILURE_CODES.has(reason as SectionCompositionResultCode)
    ? reason as Exclude<SectionCompositionResultCode, "composed">
    : "internal_error";
}

function manifest(
  input: ComposeSectionCandidateInput,
  resultCode: SectionCompositionResultCode,
  inventory?: SectionCompositionInventory,
  selection: readonly SectionSelectionRow[] = [],
  direction: CreativeDirection | null = null,
  outputHtml: string | null = null,
): SectionCompositionManifest {
  return SectionCompositionManifestSchema.parse({
    schemaVersion: SECTION_COMPOSITION_MANIFEST_VERSION,
    intentHash: input.intentHash,
    creativeDirectionHash: canonicalJsonSha256(direction),
    inventoryHash: inventory?.hash ?? canonicalJsonSha256([]),
    orderedRoles: selection.map((row) => row.requestedRole),
    selectedSectionIds: selection.map((row) => row.sectionId),
    selectedContentHashes: selection.map((row) => row.contentHash),
    selectedSourceKinds: selection.map((row) => row.sourceKind),
    selectedSourceTemplateIds: selection.map((row) => row.sourceTemplateId),
    selectedSourceBandOrdinals: selection.map((row) => row.sourceBandOrdinal),
    selectedStructuralFingerprints: selection.map((row) => row.structuralFingerprint),
    compatibilityRuleIds: selection.map((row) => row.compatibilityRuleId),
    outputHash: outputHtml === null ? null : sha256(outputHtml),
    resultCode,
  });
}

function failure(
  input: ComposeSectionCandidateInput,
  reasonCode: Exclude<SectionCompositionResultCode, "composed">,
  inventory?: SectionCompositionInventory,
  selection: readonly SectionSelectionRow[] = [],
  telemetry?: Extract<SectionCompositionResult, { ok: false }>["telemetry"],
): Extract<SectionCompositionResult, { ok: false }> {
  return {
    ok: false,
    status: "fallback",
    reasonCode,
    manifest: manifest(input, reasonCode, inventory, selection),
    ...(telemetry ? { telemetry } : {}),
  };
}

async function defaultFetchText(storageUrl: string): Promise<string | null> {
  const response = await fetch(storageUrl, { cache: "no-store" });
  return response.ok ? response.text() : null;
}

function rolesRemainExact(html: string, selection: readonly SectionSelectionRow[]): boolean {
  const actual = parse(html)
    .querySelectorAll("[data-openlen-role]")
    .map((node) => node.getAttribute("data-openlen-role"));
  return actual.length === selection.length &&
    actual.every((role, index) => role === selection[index].requestedRole);
}

function selectionRemainsOriginal(selection: readonly SectionSelectionRow[]): boolean {
  return hasOriginalSectionProvenance({
    contentHashes: selection.map((row) => row.contentHash),
    sourceKinds: selection.map((row) => row.sourceKind),
    sourceTemplateIds: selection.map((row) => row.sourceTemplateId),
    sourceBandOrdinals: selection.map((row) => row.sourceBandOrdinal),
    structuralFingerprints: selection.map((row) => row.structuralFingerprint),
  });
}

function metadataFromIntent(intent: IntentAnalysis) {
  return {
    domains: [...intent.domains],
    audiences: [intent.audience.primary, ...intent.audience.secondary],
    visualSignals: [...intent.requiredVisualSignals],
    negativeTags: [...intent.forbiddenVisualSignals],
    themeability: "high" as const,
  };
}

export async function composeSectionCandidate(
  input: ComposeSectionCandidateInput,
  deps: ComposeSectionCandidateDeps = {},
): Promise<SectionCompositionResult> {
  if (input.route !== "section_composition") return failure(input, "route_ineligible");

  let inventory: SectionCompositionInventory | undefined;
  let selection: SectionSelectionRow[] = [];
  try {
    inventory = (deps.buildInventory ?? buildSectionCompositionInventory)(input.records);
    const availableTypes = deps.generateMissing ? new Set(SECTION_TYPES) : new Set(inventory.entries
      .filter((entry) => !entry.needsJs)
      .map((entry) => entry.type));
    let planning = (deps.planSections ?? planSectionComposition)({
      intent: input.intent,
      intentHash: input.intentHash,
      inventoryHash: inventory.hash,
      availableTypes,
    });
    if (!planning.ok) return failure(input, planning.code, inventory);
    let plan = planning.plan;

    const deterministic = buildDeterministicCreativeDirection(input.intent);
    const generated = [] as Extract<GenerateMissingSectionResult, { ok: true }>["candidate"][];
    const generatedUsage: NonNullable<Extract<GenerateMissingSectionResult, { ok: true }>["usage"]>[] = [];
    const addGenerated = async (row: import("./section-composition-contracts").SectionPlanRow, excludeIds: readonly string[] = []) => {
      if (!deps.generateMissing || generated.length >= 2 || generated.some((candidate) => candidate.type === row.componentType)) return false as const;
      const result = await deps.generateMissing({ row, intent: input.intent, direction: deterministic.direction, copy: input.copy });
      if (!result.ok) return result;
      generated.push(result.candidate);
      if (result.usage) generatedUsage.push(result.usage);
      inventory = extendSectionCompositionInventoryWithGenerated(inventory!, [result.candidate], excludeIds);
      plan = { ...plan, inventoryHash: inventory.hash };
      return true as const;
    };
    let fetched: Awaited<ReturnType<typeof fetchVerifiedSectionFragments>>;
    for (;;) {
      try {
        selection = (deps.resolvePlan ?? resolveSectionPlan)(plan, inventory, {
          intent: input.intent,
          direction: deterministic.direction,
        });
      } catch (error) {
        if (!(error instanceof SectionCompositionSelectionError)
          || !deps.generateMissing
          || !error.row
          || !["section_semantic_coverage_failed", "section_fragment_unavailable"].includes(error.code)
        ) throw error;
        const generatedResult = await addGenerated(error.row);
        if (generatedResult === false) throw error;
        if (generatedResult !== true) return failure(input, generatedResult.code, inventory, selection, generatedResult.durationMs === undefined ? undefined : {
          promptVersion: "generated-section-spec-prompt/1.0",
          modelId: generatedResult.modelId ?? null,
          ...(generatedResult.usage ? { usage: generatedResult.usage } : {}),
          durationMs: generatedResult.durationMs,
        });
        continue;
      }
      if (!selectionRemainsOriginal(selection)) return failure(input, "section_originality_failed", inventory, selection);
      fetched = await (deps.fetchFragments ?? fetchVerifiedSectionFragments)(selection, inventory, { fetchText: deps.fetchText ?? defaultFetchText });
      if (fetched.ok) break;
      const fetchedFailure = fetched as Extract<typeof fetched, { ok: false }>;
      if (fetchedFailure.code !== "section_fragment_unavailable" || fetchedFailure.failedOrdinal === undefined) return failure(input, fetchedFailure.code, inventory, selection);
      const failed = selection.find((row) => row.ordinal === fetchedFailure.failedOrdinal);
      if (!failed) return failure(input, fetchedFailure.code, inventory, selection);
      const generatedResult = await addGenerated(failed, [failed.sectionId]);
      if (generatedResult === false) return failure(input, fetchedFailure.code, inventory, selection);
      if (generatedResult !== true) return failure(input, generatedResult.code, inventory, selection, generatedResult.durationMs === undefined ? undefined : {
        promptVersion: "generated-section-spec-prompt/1.0", modelId: generatedResult.modelId ?? null,
        ...(generatedResult.usage ? { usage: generatedResult.usage } : {}), durationMs: generatedResult.durationMs,
      });
    }

    // The direction decided the palette, the type and the geometry back at
    // line ~250; until 2026-08-16 it was used to plan and generate sections and
    // then dropped here, so every page was assembled on the frozen light
    // default. A dark niche shipped `<html class="light" --ol-bg:#ffffff>` and
    // rendered cream-on-white below the hero.
    const stitched = (deps.assembleDocument ?? assembleDocument)(
      fetched.fragments as SectionFragment[],
      assembleThemeFor(deterministic.direction, input.intent.language),
    );
    if (deps.beforeCreative && !(await deps.beforeCreative())) {
      return failure(input, "internal_error", inventory, selection);
    }
    const fill: FillAssembledResult = await (deps.fillAssembled ?? fillAssembled)(
      stitched,
      input.copy,
      { onStage: input.onStage },
    );
    if ((fill.leaksAfter ?? 0) > 0 || (!fill.filled && hasFillableCopy(input.copy))) {
      return failure(input, "inherited_copy_leak", inventory, selection, fill.usage ? {
        promptVersion: null,
        modelId: null,
        usage: {
          inputTokens: fill.usage.inputTokens,
          outputTokens: fill.usage.outputTokens,
          thinkingTokens: 0,
          cachedTokens: 0,
        },
        durationMs: fill.durationMs,
      } : undefined);
    }

    const normalized = (deps.normalizeBornCanonical ?? normalizeBornCanonical)(fill.html);
    const mobileSafe = ensureCompositionMobileSafety(normalized);
    const adapt = deps.adaptTemplateSkeleton ?? adaptTemplateSkeleton;
    const adaptInput = {
      html: mobileSafe,
      templateId: `composition-${inventory.hash.replace(/^sha256:/, "")}`,
      intent: input.intent,
      templateMetadata: metadataFromIntent(input.intent),
      brand: input.brand,
      ...(input.projectId && input.assetMode ? { assetContext: { mode: input.assetMode, projectId: input.projectId } } : {}),
    };
    const adapted = input.assetTraceSink
      ? await adapt(adaptInput, { onAssetTrace: input.assetTraceSink })
      : await adapt(adaptInput);
    if (!adapted.ok) {
      return failure(
        input,
        mapCompositionAdaptationReason(adapted.reasonCode),
        inventory,
        selection,
        {
          promptVersion: adapted.promptVersion,
          modelId: adapted.modelId,
          ...(adapted.usage ? { usage: adapted.usage } : {}),
          durationMs: adapted.durationMs,
        },
      );
    }
    if (!rolesRemainExact(adapted.html, selection)) {
      return failure(input, "section_role_coverage_failed", inventory, selection);
    }
    if (!selectionRemainsOriginal(selection)) {
      return failure(input, "section_originality_failed", inventory, selection);
    }

    const { html: _html, creativeDirection, ...adaptation } = adapted;
    return {
      ok: true,
      status: "composed",
      html: adapted.html,
      creativeDirection,
      manifest: manifest(input, "composed", inventory, selection, creativeDirection, adapted.html),
      fill: {
        filled: fill.filled,
        appliedOps: fill.appliedOps,
        ...(fill.usage ? { usage: fill.usage } : {}),
        durationMs: fill.durationMs,
        ...(fill.leaksBefore === undefined ? {} : { leaksBefore: fill.leaksBefore }),
        ...(fill.leaksAfter === undefined ? {} : { leaksAfter: fill.leaksAfter }),
      },
      adaptation,
      generatedSectionCount: generated.length,
      ...(generatedUsage.length > 0 ? { generatedSectionUsage: generatedUsage.reduce((sum, row) => ({
        inputTokens: sum.inputTokens + row.inputTokens,
        outputTokens: sum.outputTokens + row.outputTokens,
        thinkingTokens: sum.thinkingTokens + row.thinkingTokens,
        cachedTokens: sum.cachedTokens + row.cachedTokens,
      }), { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, cachedTokens: 0 }) } : {}),
    };
  } catch (error) {
    if (error instanceof SectionCompositionSelectionError) {
      return failure(input, error.code, inventory, selection);
    }
    if (error instanceof SectionRoleMarkerError) {
      return failure(input, "section_role_coverage_failed", inventory, selection);
    }
    return failure(input, "internal_error", inventory, selection);
  }
}
