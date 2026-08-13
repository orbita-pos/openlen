import type { CompileDerivedSectionResult } from "./derived-section-compiler";
import { compileDerivedSection } from "./derived-section-compiler";
import { sha256 } from "./content-hash";
import { renderVisualQualityViewports } from "@/lib/ai/visual-quality-renderer";
import type { CreativeDirection } from "./creative-contracts";
import type { IntentAnalysis } from "./contracts";
import type { ExtractedBusinessData } from "@/lib/style-match/autofill/types";
import { TemplateVisualMetadataSchema } from "@/lib/templates/visual-metadata";
import {
  renderGeneratedSectionDraft,
  validateGeneratedSectionReferences,
  type GeneratedSectionDraft,
} from "./generated-section-contracts";
import type {
  GeneratedSectionSpecProvider,
  GeneratedSectionSpecRequest,
  GeneratedSectionSpecUsage,
} from "./gemini-section-spec-provider";
import type { SectionPlanRow } from "./section-composition-contracts";
import type { SectionCompositionInventoryEntry } from "./section-inventory";
import { profileDerivedSectionSemantics } from "./section-variant-semantics";
import { compileExpressiveSection, type ExpressiveSectionDraft } from "./expressive-section-compiler";
import { SectionDecisionProvenanceSchema, type SectionDecisionProvenance } from "./expressive-section-contracts";
import { GlmSectionProgramRequestSchema, type GlmSectionProgramProvider, type GlmSectionProgramRequest, type GlmSectionProgramProviderResult } from "./glm-section-program-provider";

export type GenerateExpressiveMissingSectionResult =
  | { readonly ok: true; readonly draft: ExpressiveSectionDraft; readonly provider: Extract<GlmSectionProgramProviderResult, { ok: true }> }
  | Extract<GlmSectionProgramProviderResult, { ok: false }>
  | { readonly ok: false; readonly code: "invalid_input" }
  | { readonly ok: false; readonly code: "compile_failed"; readonly compileCode: "invalid_program" | "copy_key_not_allowed" | "asset_slot_not_allowed" | "invalid_provenance" | "donor_reconstruction"; readonly provider: Extract<GlmSectionProgramProviderResult, { ok: true }> };

type GenerateExpressiveRequest = Extract<GlmSectionProgramRequest, { readonly mode: "generate" }>;
type RebuildExpressiveRequest = Extract<GlmSectionProgramRequest, { readonly mode: "rebuild" }>;
type GenerateExpressiveProvenance = Extract<SectionDecisionProvenance, { readonly action: "generate" }>;
type RebuildExpressiveProvenance = Extract<SectionDecisionProvenance, { readonly action: "rebuild" }>;

export type GenerateExpressiveMissingSectionInput =
  | { readonly request: GenerateExpressiveRequest; readonly copy: Readonly<Record<string, string>>; readonly provenance: GenerateExpressiveProvenance }
  | { readonly request: RebuildExpressiveRequest; readonly copy: Readonly<Record<string, string>>; readonly provenance: RebuildExpressiveProvenance };

export async function generateExpressiveMissingSection(
  input: GenerateExpressiveMissingSectionInput,
  deps: { readonly provider: GlmSectionProgramProvider },
): Promise<GenerateExpressiveMissingSectionResult> {
  const request = GlmSectionProgramRequestSchema.safeParse(input.request);
  const provenance = SectionDecisionProvenanceSchema.safeParse(input.provenance);
  if (!request.success || !provenance.success || request.data.mode !== provenance.data.action) return { ok: false, code: "invalid_input" };
  const result = await deps.provider.generate(request.data);
  if (!result.ok) return result;
  const compiled = compileExpressiveSection({
    program: result.program,
    allowedCopyKeys: request.data.copyKeys,
    allowedAssetSlots: request.data.assetSlots.map((slot) => slot.slotIndex),
    copy: input.copy,
    provenance: provenance.data,
  });
  if (!compiled.ok) return { ok: false, code: "compile_failed", compileCode: compiled.code, provider: result };
  return { ok: true, draft: compiled.draft, provider: result };
}

export interface GeneratedSectionCandidate extends SectionCompositionInventoryEntry {
  html: string;
  specHash: string;
}

export interface GenerateMissingSectionInput {
  row: SectionPlanRow;
  request: Omit<GeneratedSectionSpecRequest, "role">;
  copy: Readonly<Record<string, string>>;
}

export interface GenerateMissingSectionDeps {
  provider: GeneratedSectionSpecProvider;
  compileGenerated(draft: GeneratedSectionDraft): Promise<CompileDerivedSectionResult>;
}

export type GenerateMissingSectionResult =
  | {
      ok: true;
      candidate: GeneratedSectionCandidate;
      modelId: string;
      promptVersion: "generated-section-spec-prompt/1.0";
      usage?: GeneratedSectionSpecUsage;
      durationMs: number;
    }
  | { ok: false; code: "provider_timeout" | "provider_error" | "invalid_provider_response" | "model_incompatible"; modelId?: string; usage?: GeneratedSectionSpecUsage; durationMs?: number };

function providerFailure(code: "missing_key" | "timeout" | "http" | "provider" | "invalid_json" | "schema" | "future_version"):
  Extract<GenerateMissingSectionResult, { ok: false }>["code"] {
  if (code === "timeout") return "provider_timeout";
  if (code === "invalid_json" || code === "schema" || code === "future_version") return "invalid_provider_response";
  return "provider_error";
}

export async function generateMissingSection(
  input: GenerateMissingSectionInput,
  deps: GenerateMissingSectionDeps,
): Promise<GenerateMissingSectionResult> {
  const result = await deps.provider.generate({ ...input.request, role: input.row.requestedRole });
  if (!result.ok) return { ok: false, code: providerFailure(result.code), modelId: result.modelId, ...(result.usage ? { usage: result.usage } : {}), durationMs: result.durationMs };
  if (result.spec.role !== input.row.requestedRole || !validateGeneratedSectionReferences(result.spec, {
    copyKeys: input.request.copyKeys,
    assetSlots: input.request.assetSlots.map((slot) => slot.slotIndex),
  })) return { ok: false, code: "invalid_provider_response", modelId: result.modelId, ...(result.usage ? { usage: result.usage } : {}), durationMs: result.durationMs };

  const draft = renderGeneratedSectionDraft(result.spec, input.copy, input.row.componentType);
  const compiled = await deps.compileGenerated(draft);
  if (!compiled.ok || compiled.section.type !== input.row.componentType) {
    return { ok: false, code: "model_incompatible", modelId: result.modelId, ...(result.usage ? { usage: result.usage } : {}), durationMs: result.durationMs };
  }
  const section = compiled.section;
  return {
    ok: true,
    candidate: {
      id: section.id,
      html: section.html,
      type: section.type,
      mode: section.mode,
      contentHash: section.contentHash,
      radiusBucket: "unknown",
      density: input.request.direction.density === "airy" ? "low" : input.request.direction.density === "dense" ? "high" : "medium",
      needsJs: section.needsJs,
      assetCapability: section.hasPlaceholders ? "replaceable" : "none",
      semanticProfile: profileDerivedSectionSemantics(section.semantics),
      sourceKind: "generated",
      sourceTemplateId: null,
      sourceBandOrdinal: null,
      structuralFingerprint: section.provenance.structuralFingerprint,
      derivedSemantics: section.semantics,
      specHash: draft.specHash,
    },
    modelId: result.modelId,
    promptVersion: result.promptVersion,
    ...(result.usage ? { usage: result.usage } : {}),
    durationMs: result.durationMs,
  };
}

function boundedCopy(copy: ExtractedBusinessData): Record<string, string> {
  const rows: Array<[string, string]> = [];
  const visit = (value: unknown, path: string): void => {
    if (rows.length >= 32) return;
    if (typeof value === "string" && value.trim()) { rows.push([path, value.slice(0, 500)]); return; }
    if (Array.isArray(value)) value.slice(0, 8).forEach((item, index) => visit(item, `${path}.${index}`));
    else if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) visit(item, path ? `${path}.${key}` : key);
  };
  visit(copy, "");
  return Object.fromEntries(rows.filter(([key]) => /^[a-z][a-z0-9_.-]{0,79}$/.test(key)));
}

function requestDensity(direction: CreativeDirection): "airy" | "balanced" | "dense" {
  if (direction.geometry.density === "low") return "airy";
  if (direction.geometry.density === "high") return "dense";
  return "balanced";
}

export function createDefaultMissingSectionGenerator(provider: GeneratedSectionSpecProvider) {
  return async (input: { row: SectionPlanRow; intent: IntentAnalysis; direction: CreativeDirection; copy: ExtractedBusinessData }): Promise<GenerateMissingSectionResult> => {
    const copy = boundedCopy(input.copy);
    return generateMissingSection({
      row: input.row,
      request: {
        intent: {
          domains: input.intent.domains,
          audiences: [input.intent.audience.primary, ...input.intent.audience.secondary],
          requiredSignals: input.intent.requiredVisualSignals,
          forbiddenSignals: input.intent.forbiddenVisualSignals,
        },
        direction: {
          visualArchetype: input.direction.visualArchetype,
          emotionalTone: input.direction.emotionalTone,
          density: requestDensity(input.direction),
        },
        copyKeys: Object.keys(copy),
        assetSlots: [],
      },
      copy,
    }, {
      provider,
      compileGenerated: async (draft) => compileDerivedSection({
        templateId: "generated-source",
        templateContentHash: sha256(draft.specHash).replace(/^sha256:/, "").slice(0, 12),
        ordinal: input.row.ordinal,
        rootTag: draft.rootTag,
        sourceHtml: draft.html,
        sourceHash: sha256(draft.html),
        sourceIds: [draft.id],
      }, { templateHead: "", metadata: TemplateVisualMetadataSchema.parse({
        schemaVersion: "template-visual-metadata/1.0",
        domains: input.intent.domains,
        audiences: [input.intent.audience.primary, ...input.intent.audience.secondary],
        ageRanges: input.intent.audience.ageRange ? [input.intent.audience.ageRange] : [],
        emotionalRegisters: input.direction.emotionalTone,
        visualArchetypes: [input.direction.visualArchetype],
        visualSignals: [...input.intent.requiredVisualSignals, ...input.direction.requiredVisualSignals],
        layoutTraits: [input.direction.componentTreatment.sections],
        requiredAssetTypes: [input.direction.imagery.strategy],
        negativeTags: [...input.intent.forbiddenVisualSignals, ...input.direction.forbiddenVisualSignals],
        supportedSiteTypes: [input.intent.functional.siteType],
        supportedSectionRoles: [input.row.requestedRole],
        themeability: "high", identityStrength: "high", reviewStatus: "reviewed",
      }), mode: input.direction.mode === "dark" ? "dark" : "light" }, {
        validateAssets: async (html) => !/\b(?:src|poster)\s*=|javascript:|vbscript:|file:/i.test(html),
        validateRender: async ({ html }) => {
          const rendered = await renderVisualQualityViewports(`<!doctype html><html><head></head><body>${html}</body></html>`);
          return rendered ? {
            ok: true as const,
            desktopVisible: rendered.desktop.dataBase64.length > 0,
            mobileVisible: rendered.mobile.dataBase64.length > 0,
            mobileOverflow: rendered.mobileOverflow === true,
            score: 100 - (rendered.weakTypographyHierarchy ? 10 : 0) - (rendered.squareComponentTreatment ? 5 : 0),
          } : { ok: false as const, code: "render_failed" as const };
        },
      }),
    });
  };
}
