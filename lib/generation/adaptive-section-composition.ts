import { parse } from "node-html-parser";
import { z } from "zod";

import { AdaptivePageDesignProgramSchema, type AdaptivePageDesignProgram } from "./adaptive-design-contracts";
import { canonicalJsonSha256, sha256 } from "./content-hash";
import { ExpressiveSectionProgramSchema, SectionDecisionProvenanceSchema, type ExpressiveNode, type ExpressiveSectionProgram, type SectionDecisionProvenance } from "./expressive-section-contracts";
import { compileExpressiveSection } from "./expressive-section-compiler";
import type { GlmSectionProgramProvider, GlmSectionProgramProviderResult } from "./glm-section-program-provider";
import type { GlmVisualRepairDelta } from "./glm-visual-repair";
import {
  ADAPTIVE_SECTION_COMPOSITION_MANIFEST_VERSION,
  AdaptiveSectionCompositionManifestSchema,
  SectionPlanSchema,
  SectionPlanRowSchema,
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
const ADAPTIVE_SECTION_REPAIR_HANDOFF_VERSION = "adaptive-section-repair-handoff/1.0" as const;
const REPAIR_COPY_KEY = /^[a-z][a-z0-9_.-]{0,79}$/;
const REPAIR_SECTION_ID = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const REPAIR_CONTENT_HASH = /^[a-f0-9]{12}$/;
const REPAIR_SHA256 = /^sha256:[a-f0-9]{64}$/;

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

/**
 * Page-local compiler output for Task 4 programs. Unlike catalog-derived
 * sections it intentionally carries no template provenance: a generated AST
 * must not impersonate an extracted template band.
 */
export interface AdaptiveCompiledSection {
  readonly id: string;
  readonly html: string;
  readonly type: SectionType;
  readonly contentHash: string;
  readonly structuralFingerprint: string;
}

export type AdaptiveSectionCompileResult =
  | { readonly ok: true; readonly section: AdaptiveCompiledSection }
  | { readonly ok: false; readonly code: string };

export interface AdaptiveSectionCompositionDeps {
  readonly provider: GlmSectionProgramProvider;
  readonly fetchText: (storageUrl: string) => Promise<string | null>;
  readonly fetchFragments: typeof fetchVerifiedSectionFragments;
  readonly compileDerived: (draft: AdaptiveDerivedSectionDraft) => Promise<AdaptiveSectionCompileResult>;
  readonly validateSemantics: (section: AdaptiveCompiledSection, row: SectionPlanRow) => Promise<boolean> | boolean;
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
  /** Delivers each paid GLM trace immediately after the provider returns, so
   * callers can flush failure telemetry without waiting for composition. */
  readonly onProviderTelemetry?: (telemetry: RedactedProviderTelemetry) => void;
  /** Runs once after every GLM program has been prepared and before any
   * compiler/render gate. The returned binder makes resolved asset refs part
   * of the bytes that are compiled, gated, assembled, and repaired. */
  readonly beforeCompile?: (input: {
    readonly plan: SectionPlan;
    readonly design: AdaptivePageDesignProgram;
    readonly usedAssetSlots: readonly number[];
  }) => Promise<
    | { readonly ok: true; readonly bind: (html: string, usedAssetSlots: readonly number[]) => { readonly ok: true; readonly html: string } | { readonly ok: false } }
    | { readonly ok: false; readonly code?: string }
  >;
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

interface PreparedRow {
  readonly row: SectionPlanRow;
  readonly decision: AdaptivePageDesignProgram["decisions"][number];
  readonly assetSlots: readonly { readonly slotIndex: number; readonly mediaType: AdaptivePageDesignProgram["imageSlots"][number]["mediaType"] }[];
  readonly donor: NonNullable<ReturnType<typeof sourceForDecision>> | null;
  readonly verified: VerifiedSectionFragment | null;
  readonly provenance: SectionDecisionProvenance;
  readonly generatedProgram: ExpressiveSectionProgram | null;
}

function collectProgramAssetSlots(program: ExpressiveSectionProgram): number[] {
  const slots: number[] = [];
  const visit = (node: ExpressiveNode) => {
    if (node.kind === "layout") node.children.forEach(visit);
    else if (node.kind === "media") slots.push(node.slotIndex);
  };
  visit(program.root);
  return slots;
}

const RepairHandoffEntryBase = {
  ordinal: z.number().int().min(0).max(31),
  role: SectionPlanRowSchema.shape.requestedRole,
  provenance: SectionDecisionProvenanceSchema,
  allowedCopyKeys: z.array(z.string().regex(REPAIR_COPY_KEY)).max(64),
  allowedAssetSlots: z.array(z.number().int().min(0).max(11)).max(12),
  compiledFragmentId: z.string().regex(REPAIR_SECTION_ID),
  compiledContentHash: z.string().regex(REPAIR_CONTENT_HASH),
  compiledFragmentHash: z.string().regex(REPAIR_SHA256),
  structuralFingerprint: z.string().regex(REPAIR_SHA256),
};
const GeneratedRepairHandoffEntrySchema = z.object({
  ...RepairHandoffEntryBase,
  action: z.enum(["rebuild", "generate"]),
  programId: z.string().regex(REPAIR_SECTION_ID),
  programHash: z.string().regex(REPAIR_SHA256),
  program: ExpressiveSectionProgramSchema,
}).strict().superRefine((value, ctx) => {
  if (value.provenance.action !== value.action || value.program.role !== value.role) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "program action and role must match the repair entry" });
  }
  if (new Set(value.allowedCopyKeys).size !== value.allowedCopyKeys.length || new Set(value.allowedAssetSlots).size !== value.allowedAssetSlots.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "repair allowlists must be unique" });
  }
});
const ReuseRepairHandoffEntrySchema = z.object({
  ...RepairHandoffEntryBase,
  action: z.literal("reuse"),
  programId: z.null(),
  programHash: z.null(),
  program: z.null(),
}).strict().superRefine((value, ctx) => {
  if (value.provenance.action !== "reuse" || value.allowedCopyKeys.length !== 0 || value.allowedAssetSlots.length !== 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "reuse has explicit donor provenance and no program" });
  }
});
export const AdaptiveSectionRepairHandoffSchema = z.object({
  schemaVersion: z.literal(ADAPTIVE_SECTION_REPAIR_HANDOFF_VERSION),
  entries: z.array(z.union([GeneratedRepairHandoffEntrySchema, ReuseRepairHandoffEntrySchema])).min(1).max(32),
}).strict().superRefine((value, ctx) => {
  value.entries.forEach((entry, index) => {
    if (entry.ordinal !== index) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["entries", index, "ordinal"], message: "repair entries must preserve page order" });
  });
});
export type AdaptiveSectionRepairHandoff = z.infer<typeof AdaptiveSectionRepairHandoffSchema>;

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
      /** Internal only: structured Task 5 repair input; never serialize this with public manifests. */
      readonly handoff: AdaptiveSectionRepairHandoff;
      /** Private request-local seam: no provider calls, only bounded recompilation and gates. */
      readonly applyDelta: (delta: GlmVisualRepairDelta) => Promise<AdaptiveSectionDeltaResult>;
    }
  | {
      readonly ok: false;
      readonly status: "fallback";
      readonly reasonCode: Exclude<SectionCompositionResultCode, "composed">;
      readonly manifest: AdaptiveSectionCompositionManifest;
      readonly telemetry: readonly RedactedProviderTelemetry[];
    };

export type AdaptiveSectionDeltaResult =
  | {
      readonly ok: true;
      readonly html: string;
      readonly manifest: AdaptiveSectionCompositionManifest;
      readonly handoff: AdaptiveSectionRepairHandoff;
    }
  | { readonly ok: false };

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
  telemetry: readonly RedactedProviderTelemetry[] = [],
): Extract<AdaptiveSectionCompositionResult, { ok: false }> {
  return {
    ok: false,
    status: "fallback",
    reasonCode,
    manifest: manifest(rows, reasonCode, null),
    telemetry: Object.freeze(telemetry.map((row) => Object.freeze({ ...row }))),
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
  const fail = (reasonCode: Exclude<SectionCompositionResultCode, "composed">) => failure(completed, reasonCode, telemetry);
  if (!validInput(input)) return fail("model_incompatible");
  const handoffEntries: unknown[] = [];

  try {
    const preparedRows: PreparedRow[] = [];
    for (const row of input.plan.rows) {
      const decision = input.design.decisions[row.ordinal];
      const assetSlots = input.design.imageSlots
        .filter((slot) => slot.ordinal === row.ordinal)
        .map((slot) => ({ slotIndex: slot.slotIndex, mediaType: slot.mediaType }));
      let donor: ReturnType<typeof sourceForDecision> = null;
      let verified: VerifiedSectionFragment | null = null;
      if (decision.action !== "generate") {
        donor = sourceForDecision(input, row, decision.candidateId!);
        if (!donor) return fail("section_inventory_stale");
        const fetched = await fetchChosenFragment(input, deps, row, decision.candidateId!);
        if (!fetched.ok) return fail(fetched.code);
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

      let generatedProgram: ExpressiveSectionProgram | null = null;
      if (decision.action === "reuse") {
        const tag = fragmentRootTag(verified!);
        if (!tag) return fail("section_fragment_invalid");
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
        const providerResult = await deps.provider.generate(request);
        const providerTrace = providerTelemetry(providerResult);
        if (providerTrace) {
          telemetry.push(providerTrace);
          deps.onProviderTelemetry?.(providerTrace);
        }
        if (!providerResult.ok) return fail(providerFailureCode(providerResult.code));
        generatedProgram = providerResult.program;
      }
      preparedRows.push({ row, decision, assetSlots, donor, verified, provenance, generatedProgram });
    }

    const usedAssetSlots = [...new Set(preparedRows.flatMap((prepared) => prepared.generatedProgram
      ? collectProgramAssetSlots(prepared.generatedProgram)
      : []))].sort((left, right) => left - right);
    const binding = deps.beforeCompile
      ? await deps.beforeCompile({ plan: input.plan, design: input.design, usedAssetSlots })
      : null;
    if (binding && !binding.ok) return fail("required_asset_unavailable");

    for (const prepared of preparedRows) {
      const { row, decision, assetSlots, donor, verified, provenance, generatedProgram } = prepared;
      let draft: AdaptiveDerivedSectionDraft;
      let programHash: string | null = null;
      let normalizedStructuralFingerprint: string | null = null;
      if (decision.action === "reuse") {
        const tag = fragmentRootTag(verified!);
        if (!tag) return fail("section_fragment_invalid");
        draft = {
          action: "reuse", ordinal: row.ordinal, id: verified!.slug, html: verified!.html, rootTag: tag,
          role: row.requestedRole, componentType: row.componentType, provenance,
        };
      } else {
        const compiledExpressive = compileExpressiveSection({
          program: generatedProgram!,
          allowedCopyKeys: Object.keys(input.copy),
          allowedAssetSlots: assetSlots.map((slot) => slot.slotIndex),
          copy: input.copy,
          provenance,
        });
        if (!compiledExpressive.ok) return fail(compiledExpressive.code === "donor_reconstruction" ? "section_originality_failed" : "invalid_provider_response");
        const expressive = compiledExpressive.draft;
        const slotsInProgram = collectProgramAssetSlots(generatedProgram!);
        const bound = binding?.ok ? binding.bind(expressive.html, slotsInProgram) : { ok: true as const, html: expressive.html };
        if (!bound.ok) return fail("required_asset_unavailable");
        programHash = expressive.programHash;
        normalizedStructuralFingerprint = expressive.structuralFingerprint;
        draft = {
          action: decision.action,
          ordinal: row.ordinal,
          id: expressive.id,
          html: bound.html,
          rootTag: expressive.rootTag,
          role: row.requestedRole,
          componentType: row.componentType,
          provenance,
        };
      }

      const derived = await deps.compileDerived(draft);
      if (!derived.ok || derived.section.type !== row.componentType || contentHash(derived.section.html) !== derived.section.contentHash) {
        return fail("model_incompatible");
      }
      const section = derived.section;
      if (decision.action === "reuse" && (section.id !== verified!.slug || section.html !== verified!.html || section.contentHash !== donor!.entry.contentHash)) {
        return fail("section_fragment_stale");
      }
      if (decision.action === "rebuild"
        && (section.contentHash === donor!.entry.contentHash
          || normalizedStructuralFingerprint === donor!.entry.structuralFingerprint
          || section.structuralFingerprint === donor!.entry.structuralFingerprint)) {
        return fail("section_originality_failed");
      }
      if (!(await deps.validateSemantics(section, row))) return fail("section_semantic_coverage_failed");
      if (!(await deps.validateAssets(section.html, row))) return fail("required_asset_unavailable");
      const rendered = await deps.validateRender(section.html, row);
      if (!rendered.ok || !rendered.desktopVisible || !rendered.mobileVisible || rendered.mobileOverflow) return fail("technical_render_failed");
      const sanitized = deps.sanitize(section.html);
      if (!sanitized.html || sanitized.html !== section.html) return fail("sanitization_failed");

      completed.push({
        action: decision.action,
        role: row.requestedRole,
        candidateId: decision.candidateId,
        sourceTemplateId: decision.action === "generate" ? null : donor!.entry.sourceTemplateId,
        sourceBandOrdinal: decision.action === "generate" ? null : donor!.entry.sourceBandOrdinal,
        contentHash: section.contentHash,
        structuralFingerprint: normalizedStructuralFingerprint ?? section.structuralFingerprint,
        programHash,
        fragment: { slug: section.id, type: section.type, requestedRole: row.requestedRole, html: sanitized.html },
      });
      handoffEntries.push(decision.action === "reuse" ? {
        ordinal: row.ordinal,
        action: "reuse",
        role: row.requestedRole,
        provenance,
        allowedCopyKeys: [],
        allowedAssetSlots: [],
        compiledFragmentId: section.id,
        compiledContentHash: section.contentHash,
        compiledFragmentHash: sha256(section.html),
        structuralFingerprint: section.structuralFingerprint,
        programId: null,
        programHash: null,
        program: null,
      } : {
        ordinal: row.ordinal,
        action: decision.action,
        role: row.requestedRole,
        provenance,
        allowedCopyKeys: Object.keys(input.copy),
        allowedAssetSlots: assetSlots.map((slot) => slot.slotIndex),
        compiledFragmentId: section.id,
        compiledContentHash: section.contentHash,
        compiledFragmentHash: sha256(section.html),
        structuralFingerprint: normalizedStructuralFingerprint ?? section.structuralFingerprint,
        programId: draft.id,
        programHash: programHash!,
        program: generatedProgram!,
      });
    }

    if (!hasAdaptiveSectionOriginality({
      actions: completed.map((row) => row.action),
      finalStructuralFingerprints: completed.map((row) => row.structuralFingerprint),
      finalProgramHashes: completed.map((row) => row.programHash),
      sourceTemplateIds: completed.map((row) => row.sourceTemplateId),
      sourceBandOrdinals: completed.map((row) => row.sourceBandOrdinal),
    })) return fail("section_originality_failed");

    const assembled = deps.assemble(completed.map((row) => row.fragment));
    const sanitized = deps.sanitize(assembled);
    if (!sanitized.html) return fail("sanitization_failed");
    const sealed = deps.seal(sanitized.html);
    if (!sealed.sealed) return fail("sanitization_failed");
    let currentRows = completed.slice();
    let currentHandoff = AdaptiveSectionRepairHandoffSchema.parse({
      schemaVersion: ADAPTIVE_SECTION_REPAIR_HANDOFF_VERSION,
      entries: handoffEntries,
    });
    const applyDelta = async (delta: GlmVisualRepairDelta): Promise<AdaptiveSectionDeltaResult> => {
      if (delta?.schemaVersion !== "glm-visual-repair-delta/1.0"
        || !Array.isArray(delta.changes)
        || delta.changes.length < 1
        || delta.changes.length > 32
        || new Set(delta.changes.map((change) => change.programId)).size !== delta.changes.length) return { ok: false };
      const entriesById = new Map(currentHandoff.entries.flatMap((entry) => entry.programId ? [[entry.programId, entry] as const] : []));
      if (delta.changes.some((change) => !entriesById.has(change.programId))) return { ok: false };

      const nextRows = currentRows.slice();
      const nextEntries = currentHandoff.entries.slice();
      try {
        for (const change of delta.changes) {
          const entry = entriesById.get(change.programId)!;
          const row = input.plan.rows[entry.ordinal];
          const program = change.program as ExpressiveSectionProgram;
          if (!entry.programId || !entry.program || !row || program.role !== entry.role) return { ok: false };
          const expressive = compileExpressiveSection({
            program,
            allowedCopyKeys: entry.allowedCopyKeys,
            allowedAssetSlots: entry.allowedAssetSlots,
            copy: input.copy,
            provenance: entry.provenance,
          });
          if (!expressive.ok) return { ok: false };
          const repairedSlots = collectProgramAssetSlots(program);
          const rebound = binding?.ok ? binding.bind(expressive.draft.html, repairedSlots) : { ok: true as const, html: expressive.draft.html };
          if (!rebound.ok) return { ok: false };
          const draft: AdaptiveDerivedSectionDraft = {
            action: entry.action,
            ordinal: entry.ordinal,
            id: expressive.draft.id,
            html: rebound.html,
            rootTag: expressive.draft.rootTag,
            role: entry.role,
            componentType: row.componentType,
            provenance: entry.provenance,
          };
          const derived = await deps.compileDerived(draft);
          if (!derived.ok
            || derived.section.type !== row.componentType
            || contentHash(derived.section.html) !== derived.section.contentHash
            || (entry.action === "rebuild" && (
              derived.section.contentHash === entry.provenance.sourceContentHash
              || expressive.draft.structuralFingerprint === entry.provenance.sourceStructuralFingerprint
              || derived.section.structuralFingerprint === entry.provenance.sourceStructuralFingerprint
            ))) return { ok: false };
          if (!(await deps.validateSemantics(derived.section, row))) return { ok: false };
          if (!(await deps.validateAssets(derived.section.html, row))) return { ok: false };
          const rendered = await deps.validateRender(derived.section.html, row);
          if (!rendered.ok || !rendered.desktopVisible || !rendered.mobileVisible || rendered.mobileOverflow) return { ok: false };
          const sanitizedSection = deps.sanitize(derived.section.html);
          if (!sanitizedSection.html || sanitizedSection.html !== derived.section.html) return { ok: false };
          nextRows[entry.ordinal] = {
            ...nextRows[entry.ordinal],
            contentHash: derived.section.contentHash,
            structuralFingerprint: expressive.draft.structuralFingerprint,
            programHash: expressive.draft.programHash,
            fragment: { slug: derived.section.id, type: derived.section.type, requestedRole: row.requestedRole, html: sanitizedSection.html },
          };
          nextEntries[entry.ordinal] = {
            ...entry,
            compiledFragmentId: derived.section.id,
            compiledContentHash: derived.section.contentHash,
            compiledFragmentHash: sha256(derived.section.html),
            structuralFingerprint: expressive.draft.structuralFingerprint,
            programHash: expressive.draft.programHash,
            program: program as never,
          };
        }
        if (!hasAdaptiveSectionOriginality({
          actions: nextRows.map((row) => row.action),
          finalStructuralFingerprints: nextRows.map((row) => row.structuralFingerprint),
          finalProgramHashes: nextRows.map((row) => row.programHash),
          sourceTemplateIds: nextRows.map((row) => row.sourceTemplateId),
          sourceBandOrdinals: nextRows.map((row) => row.sourceBandOrdinal),
        })) return { ok: false };
        const assembledDelta = deps.assemble(nextRows.map((row) => row.fragment));
        const sanitizedDelta = deps.sanitize(assembledDelta);
        if (!sanitizedDelta.html) return { ok: false };
        const sealedDelta = deps.seal(sanitizedDelta.html);
        if (!sealedDelta.sealed) return { ok: false };
        const handoff = AdaptiveSectionRepairHandoffSchema.parse({
          schemaVersion: ADAPTIVE_SECTION_REPAIR_HANDOFF_VERSION,
          entries: nextEntries,
        });
        currentRows = nextRows;
        currentHandoff = handoff;
        return { ok: true, html: sealedDelta.html, manifest: manifest(nextRows, "composed", sealedDelta.html), handoff };
      } catch {
        return { ok: false };
      }
    };
    return {
      ok: true,
      status: "composed",
      html: sealed.html,
      manifest: manifest(completed, "composed", sealed.html),
      telemetry: Object.freeze(telemetry.map((row) => Object.freeze({ ...row }))),
      handoff: currentHandoff,
      applyDelta,
    };
  } catch {
    return fail("internal_error");
  }
}
