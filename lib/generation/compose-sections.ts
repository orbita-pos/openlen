import { parse } from "node-html-parser";

import {
  adaptTemplateSkeleton,
  type SkeletonAdaptationResult,
} from "./adapt-skeleton";
import type { CreativeDirection } from "./creative-contracts";
import type { GenerationRoute, IntentAnalysis } from "./contracts";
import {
  SECTION_COMPOSITION_MANIFEST_VERSION,
  SectionCompositionManifestSchema,
  SectionCompositionResultCodeSchema,
  type SectionCompositionManifest,
  type SectionCompositionResultCode,
} from "./section-composition-contracts";
import {
  buildSectionCompositionInventory,
  fetchVerifiedSectionFragments,
  resolveSectionPlan,
  SectionCompositionSelectionError,
  type SectionCompositionInventory,
  type SectionSelectionRow,
} from "./section-inventory";
import { planSectionComposition } from "./section-plan";
import { canonicalJsonSha256, sha256 } from "./visual-engine-2a-eval";
import type { PilotReasonCode } from "./visual-engine-pilot-store";
import { fillAssembled, hasFillableCopy, type FillAssembledResult } from "@/lib/assemble/fill";
import { normalizeBornCanonical } from "@/lib/normalize";
import {
  assembleDocument,
  SectionRoleMarkerError,
  type AssembleTheme,
  type SectionFragment,
} from "@/lib/sections/assemble";
import type { SectionRecord } from "@/lib/sections/store";
import type { ExtractedBusinessData } from "@/lib/style-match/autofill/types";

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
}

export type SectionCompositionResult =
  | {
      ok: true;
      status: "composed";
      html: string;
      creativeDirection: CreativeDirection;
      manifest: SectionCompositionManifest;
      adaptation: Omit<Extract<SkeletonAdaptationResult, { ok: true }>, "html" | "creativeDirection">;
    }
  | {
      ok: false;
      status: "fallback";
      reasonCode: Exclude<SectionCompositionResultCode, "composed">;
      manifest: SectionCompositionManifest;
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
): Extract<SectionCompositionResult, { ok: false }> {
  return {
    ok: false,
    status: "fallback",
    reasonCode,
    manifest: manifest(input, reasonCode, inventory, selection),
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
    const availableTypes = new Set(inventory.entries
      .filter((entry) => !entry.needsJs)
      .map((entry) => entry.type));
    const planning = (deps.planSections ?? planSectionComposition)({
      intent: input.intent,
      intentHash: input.intentHash,
      inventoryHash: inventory.hash,
      availableTypes,
    });
    if (!planning.ok) return failure(input, planning.code, inventory);

    selection = (deps.resolvePlan ?? resolveSectionPlan)(planning.plan, inventory, null);
    const fetched = await (deps.fetchFragments ?? fetchVerifiedSectionFragments)(
      selection,
      inventory,
      { fetchText: deps.fetchText ?? defaultFetchText },
    );
    if (!fetched.ok) return failure(input, fetched.code, inventory, selection);

    const stitched = (deps.assembleDocument ?? assembleDocument)(
      fetched.fragments as SectionFragment[],
      COMPOSITION_BASE_THEME,
    );
    const fill: FillAssembledResult = await (deps.fillAssembled ?? fillAssembled)(
      stitched,
      input.copy,
      { onStage: input.onStage },
    );
    if ((fill.leaksAfter ?? 0) > 0 || (!fill.filled && hasFillableCopy(input.copy))) {
      return failure(input, "inherited_copy_leak", inventory, selection);
    }

    const normalized = (deps.normalizeBornCanonical ?? normalizeBornCanonical)(fill.html);
    const adapted = await (deps.adaptTemplateSkeleton ?? adaptTemplateSkeleton)({
      html: normalized,
      templateId: `composition:${inventory.hash}`,
      intent: input.intent,
      templateMetadata: metadataFromIntent(input.intent),
      brand: input.brand,
    });
    if (!adapted.ok) {
      return failure(
        input,
        mapCompositionAdaptationReason(adapted.reasonCode),
        inventory,
        selection,
      );
    }
    if (!rolesRemainExact(adapted.html, selection)) {
      return failure(input, "section_role_coverage_failed", inventory, selection);
    }

    const { html: _html, creativeDirection, ...adaptation } = adapted;
    return {
      ok: true,
      status: "composed",
      html: adapted.html,
      creativeDirection,
      manifest: manifest(input, "composed", inventory, selection, creativeDirection, adapted.html),
      adaptation,
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
