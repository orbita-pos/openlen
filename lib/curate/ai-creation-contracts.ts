import type { ModelTokenUsage } from "@/lib/generation/model-cost";
import type { VisualEngineProjectMetadata } from "@/lib/projects/types";

export const AI_HYBRID_POLICY_VERSION = "ai-hybrid-policy/1.0" as const;

/** The safe, sealed candidate shared by baseline construction and later creative passes. */
export interface SafeCreativeCandidate {
  readonly html: string;
  readonly title: string;
  readonly visualEngine: Extract<VisualEngineProjectMetadata, { route: "section_composition" }>;
  readonly filled: boolean;
  readonly appliedOps: number;
  readonly source: "baseline" | "deepseek" | "deepseek_repair";
}

export type AiCreationStage =
  | "intent"
  | "copy"
  | "sections"
  | "baseline"
  | "creative_document"
  | "composition"
  | "delivery_gate"
  | "visual_quality";

export type AiCreationReasonCode =
  | "baseline_invalid"
  | "intent_analysis_failed"
  | "copy_generation_failed"
  | "section_inventory_unavailable"
  | "section_plan_failed"
  | "section_fragment_unavailable"
  | "composition_failed"
  | "inherited_copy_leak"
  | "creative_direction_failed"
  | "asset_resolution_failed"
  | "semantic_gate_failed"
  | "visual_quality_failed";

export type AiCreationDeliveryReasonCode =
  | AiCreationReasonCode
  | "creation_disabled"
  | "persistence_failed";

export type AiCreationResult =
  | {
      ok: true;
      route: "section_composition" | "creative_document";
      templateId: null;
      title: string;
      html: string;
      visualEngine: Extract<VisualEngineProjectMetadata, { route: "section_composition" | "creative_document" }>;
      copyUsage?: ModelTokenUsage;
      generatedSectionUsage?: ModelTokenUsage;
      generatedSectionCount?: number;
      filled: boolean;
      appliedOps: number;
      /** Ephemeral success acknowledgement; excluded from persistence and SSE. */
      finalizeFableTelemetry?: () => Promise<void>;
      /** Ephemeral post-generation failure acknowledgement for persistence/debit. */
      failFableTelemetry?: (stage: "delivery", reasonCode: string) => Promise<void>;
    }
  | {
      ok: false;
      stage: AiCreationStage;
      reasonCode: AiCreationReasonCode;
      retryable: boolean;
    };
