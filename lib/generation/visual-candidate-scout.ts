import type { InlineImage } from "@/lib/ai-gateway";

import type { FireworksJsonClient } from "../ai/fireworks-client";
import type { FireworksJsonResult } from "../ai/fireworks-contracts";
import type { VisualCandidateContactSheetFragment } from "../ai/visual-quality-renderer";
import { createCandidateScoutResponseSchema, type CandidateDecision } from "./adaptive-design-contracts";
import type { CreativeDirection } from "./creative-contracts";
import type { IntentAnalysis } from "./contracts";
import { reasoningEffortFor } from "./fable-model-policy";
import {
  fetchVerifiedSectionFragments,
  retrieveAdaptiveSectionCandidates,
  type SectionCompositionInventory,
} from "./section-inventory";
import type { SectionPlan } from "./section-composition-contracts";
import type { CanonicalSectionRole } from "./structural-taxonomy";
import type { SectionType } from "@/lib/sections/types";

export interface VisualScoutCandidate {
  readonly candidateId: string;
  readonly ordinal: number;
  readonly requestedRole: CanonicalSectionRole;
  readonly componentType: SectionType;
  readonly sourceKind: "manual" | "template_derived" | "generated";
  readonly sourceTemplateId: string | null;
  readonly sourceBandOrdinal: number | null;
  readonly structuralFingerprint: string;
  readonly traits: readonly string[];
}

type ProviderFailure = Extract<FireworksJsonResult<never>, { ok: false }>;

export interface VisualScoutSuccess {
  readonly ok: true;
  readonly requiredRoles: readonly CanonicalSectionRole[];
  readonly candidates: readonly VisualScoutCandidate[];
  readonly decisions: readonly CandidateDecision[];
  readonly modelId: string;
  readonly usage: NonNullable<Extract<FireworksJsonResult<unknown>, { ok: true }>["usage"]>;
  readonly durationMs: number;
  readonly attempts: 1 | 2;
}

export type VisualScoutResult = VisualScoutSuccess | ProviderFailure | {
  readonly ok: false;
  readonly code: "invalid_input" | "section_fragment_unavailable" | "section_fragment_stale" | "section_fragment_invalid" | "section_inventory_stale" | "contact_sheet_failed";
};

export interface VisualCandidateScoutInput {
  readonly plan: SectionPlan;
  readonly inventory: SectionCompositionInventory;
  readonly intent: IntentAnalysis;
  readonly direction: CreativeDirection;
  readonly requestId: string;
}

export interface VisualCandidateScoutDependencies {
  readonly client: FireworksJsonClient;
  readonly fetchText: (storageUrl: string) => Promise<string | null>;
  readonly renderContactSheet: (fragments: readonly VisualCandidateContactSheetFragment[]) => Promise<InlineImage | null>;
}

const REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,111}$/;
const MAX_CONTACT_SHEET_BYTES = 1024 * 1024;

function validContactSheet(image: InlineImage): boolean {
  if (image.mimeType !== "image/jpeg" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.dataBase64)) return false;
  const bytes = Buffer.from(image.dataBase64, "base64");
  return bytes.length > 0 && bytes.length <= MAX_CONTACT_SHEET_BYTES && bytes.toString("base64") === image.dataBase64;
}

function publicCandidate(candidate: ReturnType<typeof retrieveAdaptiveSectionCandidates>[number]): VisualScoutCandidate {
  return {
    candidateId: candidate.candidateId,
    ordinal: candidate.ordinal,
    requestedRole: candidate.requestedRole,
    componentType: candidate.componentType,
    sourceKind: candidate.sourceKind,
    sourceTemplateId: candidate.sourceTemplateId,
    sourceBandOrdinal: candidate.sourceBandOrdinal,
    structuralFingerprint: candidate.structuralFingerprint,
    traits: candidate.traits,
  };
}

function syntheticIntent(intent: IntentAnalysis) {
  return {
    language: intent.language,
    siteType: intent.functional.siteType,
    requiredSections: intent.functional.requiredSections,
    primaryActions: intent.functional.primaryActions,
    contentModel: intent.functional.contentModel,
    audience: { primary: intent.audience.primary, ageRange: intent.audience.ageRange, secondary: intent.audience.secondary },
    domains: intent.domains,
    emotionalGoals: intent.emotionalGoals,
    requiredVisualSignals: intent.requiredVisualSignals,
    forbiddenVisualSignals: intent.forbiddenVisualSignals,
  };
}

export async function scoutVisualCandidates(
  input: VisualCandidateScoutInput,
  deps: VisualCandidateScoutDependencies,
): Promise<VisualScoutResult> {
  if (!REQUEST_ID.test(input.requestId) || input.plan.rows.length === 0) return { ok: false, code: "invalid_input" };
  let retrieved;
  try {
    retrieved = retrieveAdaptiveSectionCandidates(input.plan, input.inventory, { intent: input.intent, direction: input.direction });
  } catch {
    return { ok: false, code: "section_inventory_stale" };
  }
  const fetched = await fetchVerifiedSectionFragments(retrieved, input.inventory, { fetchText: deps.fetchText });
  if (!fetched.ok) return { ok: false, code: fetched.code };
  const candidateById = new Map(retrieved.map((candidate) => [candidate.candidateId, candidate]));
  const contactSheet = await deps.renderContactSheet(fetched.fragments.map((fragment) => {
    const candidate = candidateById.get(fragment.slug)!;
    return {
      candidateId: candidate.candidateId,
      ordinal: candidate.ordinal,
      role: candidate.requestedRole,
      html: fragment.html,
    };
  }));
  if (!contactSheet || !validContactSheet(contactSheet)) return { ok: false, code: "contact_sheet_failed" };

  const candidates = retrieved.map(publicCandidate);
  const requiredRoles = input.plan.rows.map((row) => row.requestedRole);
  const responseSchema = createCandidateScoutResponseSchema({
    requiredRoles,
    retrievedCandidates: candidates.map((candidate) => ({ candidateId: candidate.candidateId, ordinal: candidate.ordinal, role: candidate.requestedRole })),
  });
  const result = await deps.client.request({
    role: "visual_critic",
    reasoningEffort: reasoningEffortFor("visual_critic", "candidate_scouting"),
    requestId: `${input.requestId}.scout`,
    maxOutputTokens: 4096,
    responseSchema,
    messages: [
      {
        role: "system",
        content: "Classify every required role exactly once as reuse, rebuild, or generate. Return only the strict schema. Observations must use supplied taxonomy slugs; never propose executable markup, styles, scripts, selectors, URLs, or copy values. Catalog reuse is optional and all-generate is valid.",
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: JSON.stringify({
              schemaVersion: "adaptive-scout-input/1.0",
              intent: syntheticIntent(input.intent),
              creativeRequirements: input.direction,
              roles: input.plan.rows.map((row) => ({ ordinal: row.ordinal, role: row.requestedRole })),
              candidates: candidates.map((candidate) => ({ candidateId: candidate.candidateId, ordinal: candidate.ordinal, role: candidate.requestedRole })),
            }),
          },
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${contactSheet.dataBase64}` } },
        ],
      },
    ],
  });
  if (!result.ok) return result;
  return {
    ok: true,
    requiredRoles: Object.freeze([...requiredRoles]),
    candidates,
    decisions: result.value.decisions,
    modelId: result.modelId,
    usage: result.usage,
    durationMs: result.durationMs,
    attempts: result.attempts,
  };
}
