import type { ModelTokenUsage } from "@/lib/generation/model-cost";
import type { VisualEngineProjectMetadata } from "@/lib/projects/types";

export const AI_HYBRID_POLICY_VERSION = "ai-hybrid-policy/1.0" as const;

export type AiCreationStage =
  | "intent"
  | "copy"
  | "sections"
  | "composition"
  | "delivery_gate"
  | "visual_quality";

export type AiCreationReasonCode =
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
      route: "section_composition";
      templateId: null;
      title: string;
      html: string;
      visualEngine: Extract<VisualEngineProjectMetadata, { route: "section_composition" }>;
      copyUsage?: ModelTokenUsage;
      filled: boolean;
      appliedOps: number;
    }
  | {
      ok: false;
      stage: AiCreationStage;
      reasonCode: AiCreationReasonCode;
      retryable: boolean;
    };
