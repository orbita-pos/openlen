import { parse } from "node-html-parser";

import { AdaptivePageDesignProgramSchema, type AdaptivePageDesignProgram } from "./adaptive-design-contracts";
import { canonicalJsonSha256, sha256 } from "./content-hash";
import type { CompileDerivedSectionResult, CompiledDerivedSection } from "./derived-section-compiler";
import type { SectionDecisionProvenance } from "./expressive-section-contracts";
import { generateExpressiveMissingSection } from "./generate-missing-section";
import type { GlmSectionProgramProvider, GlmSectionProgramProviderResult } from "./glm-section-program-provider";
import {
  ADAPTIVE_SECTION_COMPOSITION_MANIFEST_VERSION,
  AdaptiveSectionCompositionManifestSchema,
  SectionPlanSchema,
  type AdaptiveSectionCompositionManifest,
  type SectionCompositionResultCode,
  type SectionPlan,
  type SectionPlanRow,
} from "./section-composition-contracts";
import {
  fetchVerifiedSectionFragments,
  hasAdaptiveSectionOriginality,
  type SectionCompositionInventory,
  type VerifiedSectionFragment,
} from "./section-inventory";
import type { VisualScoutSuccess } from "./visual-candidate-scout";
import type { SectionFragment } from "@/lib/sections/assemble";
import type { SectionType } from "@/lib/sections/types";

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/;

export interface AdaptiveSectionCompositionInput {
  readonly requestId: string;
  readonly plan: SectionPlan;
  readonly design: AdaptivePageDesignProgram;
  readonly scout: VisualScoutSuccess;
  readonly inventory: SectionCompositionInventory;
  readonly copy: Readonly<Record<string, string>>;
}

export interface AdaptiveDerivedSectionDraft {
  readonly action: "reuse" | "rebuild" | "generate";
  readonly ordinal: number;
  readonly id: string;
  readonly html: string;
  readonly rootTag: "nav" | "header" | "section" | "footer";
  readonly role: SectionPlanRow["requestedRole"];
  readonly componentType: SectionType;
  readonly provenance: SectionDecisionProvenance;
}

export interface AdaptiveSectionCompositionDeps {
  readonly provider: GlmSectionProgramProvider;
  readonly fetchText: (storageUrl: string) => Promise<string | null>;
  readonly fetchFragments: typeof fetchVerifiedSectionFragments;
  readonly compileDerived: (draft: AdaptiveDerivedSectionDraft) => Promise<CompileDerivedSectionResult>;
  readonly validateSemantics: (section: CompiledDerivedSection, row: SectionPlanRow) => Promise<boolean> | boolean;
  readonly validateAssets: (html: string, row: SectionPlanRow) => Promise<boolean> | boolean;
  readonly validateRender: (html: string, row: SectionPlanRow) => Promise<{
    readonly ok: boolean;
    readonly desktopVisible?: boolean;
    readonly mobileVisible?: boolean;
    readonly mobileOverflow?: boolean;
  }>;
  readonly sanitize: (html: string) => { readonly html: string | null };
  readonly assemble: (fragments: SectionFragment[]) => string;
  readonly seal: (html: string) => { readonly html: string; readonly sealed: boolean };
}

interface CompletedRow {
  readonly action: "reuse" | "rebuild" | "generate";
  readonly role: SectionPlanRow["requestedRole"];
  readonly candidateId: string | null;
  readonly sourceTemplateId: string | null;
  readonly sourceBandOrdinal: number | null;
  readonly contentHash: string;
  readonly structuralFingerprint: string;
  readonly programHash: string | null;
  readonly fragment: SectionFragment;
}

interface RedactedProviderTelemetry {
  readonly promptVersion: "glm-section-program-prompt/1.0";
  readonly modelId: string | null;
  readonly usage?: { readonly inputTokens: number; readonly cachedTokens: number; readonly outputTokens: number; readonly thinkingTokens: number };
  readonly durationMs: number;
  readonly attempts: 0 | 1 | 2;
}

export type AdaptiveSectionCompositionResult =
  | {
      readonly ok: true;
      readonly status: "composed";
      readonly html: string;
      readonly manifest: AdaptiveSectionCompositionManifest;
      readonly telemetry: readonly RedactedProviderTelemetry[];
    }
  | {
      readonly ok: false;
      readonly status: "fallback";
      readonly reasonCode: Exclude<SectionCompositionResultCode, "composed">;
      readonly manifest: AdaptiveSectionCompositionManifest;
      readonly telemetry?: RedactedProviderTelemetry;
    };

function manifest(
  rows: readonly CompletedRow[],
  resultCode: SectionCompositionResultCode,
  outputHtml: string | null,
): AdaptiveSectionCompositionManifest {
  return AdaptiveSectionCompositionManifestSchema.parse({
    schemaVersion: ADAPTIVE_SECTION_COMPOSITION_MANIFEST_VERSION,
    actions: rows.map((row) => row.action),
    orderedRoles: rows.map((row) => row.role),
    selectedCandidateIds: rows.map((row) => row.candidateId),
    sourceTemplateIds: rows.map((row) => row.sourceTemplateId),
    sourceBandOrdinals: rows.map((row) => row.sourceBandOrdinal),
    finalContentHashes: rows.map((row) => row.contentHash),
    finalStructuralFingerprints: rows.map((row) => row.structuralFingerprint),
    finalProgramHashes: rows.map((row) => row.programHash),
    outputHash: outputHtml === null ? null : sha256(outputHtml),
    resultCode,
  });
}

function providerTelemetry(result: GlmSectionProgramProviderResult): RedactedProviderTelemetry | undefined {
  if (!("modelId" in result)) return undefined;
  return {
    promptVersion: "glm-section-program-prompt/1.0",
    modelId: result.modelId,
    ...(result.usage ? { usage: result.usage } : {}),
    durationMs: result.durationMs,
    attempts: result.attempts,
  };
}

function failure(
  rows: readonly CompletedRow[],
  reasonCode: Exclude<SectionCompositionResultCode, "composed">,
  telemetry?: RedactedProviderTelemetry,
): Extract<AdaptiveSectionCompositionResult, { ok: false }> {
  return {
    ok: false,
    status: "fallback",
    reasonCode,
    manifest: manifest(rows, reasonCode, null),
    ...(telemetry ? { telemetry } : {}),
  };
}

function providerFailureCode(code: Extract<GlmSectionProgramProviderResult, { ok: false }>["code"]): Exclude<SectionCompositionResultCode, "composed"> {
  if (code === "timeout") return "provider_timeout";
  if (code === "budget_exceeded") return "budget_exceeded";
  if (code === "invalid_input" || code === "invalid_json" || code === "schema") return "invalid_provider_response";
  return "provider_error";
}

function contentHash(html: string): string {
  return sha256(html).replace(/^sha256:/, "").slice(0, 12);
}

function fragmentRootTag(fragment: VerifiedSectionFragment): "nav" | "header" | "section" | "footer" | null {
  try {
    const root = parse(fragment.html).querySelector(`[data-sec="${fragment.slug}"]`);
    const tag = root?.rawTagName.toLowerCase();
    return tag === "nav" || tag === "header" || tag === "section" || tag === "footer" ? tag : null;
  } catch {
    return null;
  }
}

function validInput(input: AdaptiveSectionCompositionInput): boolean {
  const plan = SectionPlanSchema.safeParse(input.plan);
  const design = AdaptivePageDesignProgramSchema.safeParse(input.design);
  if (!REQUEST_ID.test(input.requestId) || !plan.success || !design.success || input.inventory.hash !== input.plan.inventoryHash) return false;
  const roles = input.plan.rows.map((row) => row.requestedRole);
  if (JSON.stringify(roles) !== JSON.stringify(input.design.narrative)
    || JSON.stringify(roles) !== JSON.stringify(input.scout.requiredRoles)
    || JSON.stringify(input.design.decisions) !== JSON.stringify(input.scout.decisions)) return false;
  const copyKeys = Object.keys(input.copy);
  return copyKeys.length <= 64 && new Set(copyKeys).size === copyKeys.length && copyKeys.every((key) => /^[a-z][a-z0-9_.-]{0,79}$/.test(key));
}

function sourceForDecision(
  input: AdaptiveSectionCompositionInput,
  row: SectionPlanRow,
  candidateId: string,
) {
  const candidate = input.scout.candidates.find((item) => item.candidateId === candidateId);
  const entry = input.inventory.entries.find((item) => item.id === candidateId);
  if (!candidate || !entry
    || candidate.ordinal !== row.ordinal
    || candidate.requestedRole !== row.requestedRole
    || candidate.componentType !== row.componentType
    || candidate.sourceKind !== entry.sourceKind
    || candidate.sourceTemplateId !== entry.sourceTemplateId
    || candidate.sourceBandOrdinal !== entry.sourceBandOrdinal
    || candidate.structuralFingerprint !== entry.structuralFingerprint
    || entry.type !== row.componentType
    || entry.needsJs) return null;
  return { candidate, entry };
}

async function fetchChosenFragment(
  input: AdaptiveSectionCompositionInput,
  deps: AdaptiveSectionCompositionDeps,
  row: SectionPlanRow,
  candidateId: string,
): Promise<{ ok: true; fragment: VerifiedSectionFragment } | { ok: false; code: Exclude<SectionCompositionResultCode, "composed"> }> {
  const source = sourceForDecision(input, row, candidateId);
  if (!source) return { ok: false, code: "section_inventory_stale" };
  const fetched = await deps.fetchFragments([{
    ...row,
    inventoryHash: input.inventory.hash,
    sectionId: source.entry.id,
    contentHash: source.entry.contentHash,
  }], input.inventory, { fetchText: deps.fetchText });
  if (!fetched.ok) return { ok: false, code: fetched.code };
  if (fetched.fragments.length !== 1 || fetched.fragments[0].slug !== candidateId) return { ok: false, code: "section_fragment_invalid" };
  return { ok: true, fragment: fetched.fragments[0] };
}

export async function composeAdaptiveSections(
  input: AdaptiveSectionCompositionInput,
  deps: AdaptiveSectionCompositionDeps,
): Promise<AdaptiveSectionCompositionResult> {
  const completed: CompletedRow[] = [];
  const telemetry: RedactedProviderTelemetry[] = [];
  if (!validInput(input)) return failure(completed, "model_incompatible");

  try {
    for (const row of input.plan.rows) {
      const decision = input.design.decisions[row.ordinal];
      const assetSlots = input.design.imageSlots
        .filter((slot) => slot.ordinal === row.ordinal)
        .map((slot) => ({ slotIndex: slot.slotIndex, mediaType: slot.mediaType }));
      let donor: ReturnType<typeof sourceForDecision> = null;
      let verified: VerifiedSectionFragment | null = null;
      if (decision.action !== "generate") {
        donor = sourceForDecision(input, row, decision.candidateId!);
        if (!donor) return failure(completed, "section_inventory_stale");
        const fetched = await fetchChosenFragment(input, deps, row, decision.candidateId!);
        if (!fetched.ok) return failure(completed, fetched.code);
        verified = fetched.fragment;
      }

      const provenance: SectionDecisionProvenance = decision.action === "generate" ? {
        schemaVersion: "section-decision-provenance/1.0",
        action: "generate",
        candidateId: null,
        sourceTemplateId: null,
        sourceBandOrdinal: null,
        sourceContentHash: null,
        sourceStructuralFingerprint: null,
        usefulTraits: decision.usefulTraits,
      } : {
        schemaVersion: "section-decision-provenance/1.0",
        action: decision.action,
        candidateId: decision.candidateId!,
        sourceTemplateId: donor!.entry.sourceTemplateId,
        sourceBandOrdinal: donor!.entry.sourceBandOrdinal,
        sourceContentHash: donor!.entry.contentHash,
        sourceStructuralFingerprint: donor!.entry.structuralFingerprint,
        usefulTraits: decision.usefulTraits,
      };

      let draft: AdaptiveDerivedSectionDraft;
      let programHash: string | null = null;
      let normalizedStructuralFingerprint: string | null = null;
      if (decision.action === "reuse") {
        const tag = fragmentRootTag(verified!);
        if (!tag) return failure(completed, "section_fragment_invalid");
        draft = {
          action: "reuse", ordinal: row.ordinal, id: verified!.slug, html: verified!.html, rootTag: tag,
          role: row.requestedRole, componentType: row.componentType, provenance,
        };
      } else {
        const request = decision.action === "generate" ? {
          mode: "generate",
          requestId: `${input.requestId}.section-${row.ordinal}`,
          ordinal: row.ordinal,
          role: row.requestedRole,
          direction: { rhythm: input.design.rhythm, requiredSignals: input.design.requiredSignals, forbiddenSignals: input.design.forbiddenSignals },
          copyKeys: Object.keys(input.copy),
          assetSlots,
        } as const : {
          mode: "rebuild",
          requestId: `${input.requestId}.section-${row.ordinal}`,
          ordinal: row.ordinal,
          role: row.requestedRole,
          direction: { rhythm: input.design.rhythm, requiredSignals: input.design.requiredSignals, forbiddenSignals: input.design.forbiddenSignals },
          copyKeys: Object.keys(input.copy),
          assetSlots,
          inspiration: {
            candidateId: decision.candidateId!,
            sourceTemplateId: donor!.entry.sourceTemplateId,
            sourceBandOrdinal: donor!.entry.sourceBandOrdinal,
            sourceContentHash: donor!.entry.contentHash,
            sourceStructuralFingerprint: donor!.entry.structuralFingerprint,
            usefulTraits: decision.usefulTraits,
            verifiedFragmentHtml: verified!.html,
          },
        } as const;
        const generated = await generateExpressiveMissingSection({ request, copy: input.copy, provenance }, { provider: deps.provider });
        if (!generated.ok) {
          if (generated.code === "compile_failed") return failure(completed, generated.compileCode === "donor_reconstruction" ? "section_originality_failed" : "invalid_provider_response");
          return failure(completed, providerFailureCode(generated.code), providerTelemetry(generated));
        }
        const providerResult = generated.provider;
        const providerTrace = providerTelemetry(providerResult);
        if (providerTrace) telemetry.push(providerTrace);
        const expressive = generated.draft;
        programHash = expressive.programHash;
        normalizedStructuralFingerprint = expressive.structuralFingerprint;
        draft = {
          action: decision.action,
          ordinal: row.ordinal,
          id: expressive.id,
          html: expressive.html,
          rootTag: expressive.rootTag,
          role: row.requestedRole,
          componentType: row.componentType,
          provenance,
        };
      }

      const derived = await deps.compileDerived(draft);
      if (!derived.ok || derived.section.type !== row.componentType || contentHash(derived.section.html) !== derived.section.contentHash) {
        return failure(completed, "model_incompatible");
      }
      const section = derived.section;
      if (decision.action === "reuse" && (section.id !== verified!.slug || section.html !== verified!.html || section.contentHash !== donor!.entry.contentHash)) {
        return failure(completed, "section_fragment_stale");
      }
      if (decision.action === "rebuild"
        && (section.contentHash === donor!.entry.contentHash
          || normalizedStructuralFingerprint === donor!.entry.structuralFingerprint
          || section.provenance.structuralFingerprint === donor!.entry.structuralFingerprint)) {
        return failure(completed, "section_originality_failed");
      }
      if (!(await deps.validateSemantics(section, row))) return failure(completed, "section_semantic_coverage_failed");
      if (!(await deps.validateAssets(section.html, row))) return failure(completed, "required_asset_unavailable");
      const rendered = await deps.validateRender(section.html, row);
      if (!rendered.ok || !rendered.desktopVisible || !rendered.mobileVisible || rendered.mobileOverflow) return failure(completed, "technical_render_failed");
      const sanitized = deps.sanitize(section.html);
      if (!sanitized.html || sanitized.html !== section.html) return failure(completed, "sanitization_failed");

      completed.push({
        action: decision.action,
        role: row.requestedRole,
        candidateId: decision.candidateId,
        sourceTemplateId: decision.action === "generate" ? null : donor!.entry.sourceTemplateId,
        sourceBandOrdinal: decision.action === "generate" ? null : donor!.entry.sourceBandOrdinal,
        contentHash: section.contentHash,
        structuralFingerprint: normalizedStructuralFingerprint ?? section.provenance.structuralFingerprint,
        programHash,
        fragment: { slug: section.id, type: section.type, requestedRole: row.requestedRole, html: sanitized.html },
      });
    }

    if (!hasAdaptiveSectionOriginality({
      actions: completed.map((row) => row.action),
      finalStructuralFingerprints: completed.map((row) => row.structuralFingerprint),
      finalProgramHashes: completed.map((row) => row.programHash),
      sourceTemplateIds: completed.map((row) => row.sourceTemplateId),
      sourceBandOrdinals: completed.map((row) => row.sourceBandOrdinal),
    })) return failure(completed, "section_originality_failed");

    const assembled = deps.assemble(completed.map((row) => row.fragment));
    const sanitized = deps.sanitize(assembled);
    if (!sanitized.html) return failure(completed, "sanitization_failed");
    const sealed = deps.seal(sanitized.html);
    if (!sealed.sealed) return failure(completed, "sanitization_failed");
    return {
      ok: true,
      status: "composed",
      html: sealed.html,
      manifest: manifest(completed, "composed", sealed.html),
      telemetry: Object.freeze(telemetry.map((row) => Object.freeze({ ...row }))),
    };
  } catch {
    return failure(completed, "internal_error");
  }
}
