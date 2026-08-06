import type { TemplateRecord } from "@/lib/templates/store";

import { analyzeIntent, INTENT_PROMPT_VERSION } from "./analyze-intent";
import {
  DECISION_POLICY_VERSION,
  decideGenerationRoute,
} from "./decide-route";
import type { ScoredTemplate } from "./score-template";
import { selectGenerationRoute } from "./safe-selection";

export type SafeTemplatePickerMode = "off" | "shadow";

export function safeTemplatePickerMode(
  raw = process.env.OPENLEN_SAFE_TEMPLATE_PICKER,
): SafeTemplatePickerMode {
  return raw === "shadow" ? "shadow" : "off";
}

export type SafeSelectionShadowLog =
  | {
      status: "ok";
      schemaVersion: "safe-selection-shadow/1.0";
      promptVersion: typeof INTENT_PROMPT_VERSION;
      policyVersion: typeof DECISION_POLICY_VERSION;
      modelId: string;
      decision: ReturnType<typeof decideGenerationRoute>;
      topCandidates: ScoredTemplate[];
      usage?: { inputTokens: number; outputTokens: number };
      durationMs: number;
    }
  | {
      status: "error";
      schemaVersion: "safe-selection-shadow/1.0";
      errorKind: string;
      durationMs: number;
    };

export interface ShadowSelectionOptions {
  mode?: SafeTemplatePickerMode;
  analyzeIntentImpl?: typeof analyzeIntent;
  now?: () => number;
}

export type SafeSelectionShadowComparison = SafeSelectionShadowLog & {
  currentTemplateId: string;
  agreesWithCurrent: boolean;
};

export function compareShadowWithCurrent(
  shadow: SafeSelectionShadowLog,
  currentTemplateId: string,
): SafeSelectionShadowComparison {
  return {
    ...shadow,
    currentTemplateId,
    agreesWithCurrent: shadow.status === "ok"
      && shadow.decision.templateId === currentTemplateId,
  };
}

type ShadowLogger = (label: string, payload: string) => void;

export async function logShadowComparisonWhenReady(
  shadowPromise: Promise<SafeSelectionShadowLog | null>,
  currentTemplateId: string,
  logger: ShadowLogger = console.info,
): Promise<void> {
  try {
    const shadow = await shadowPromise;
    if (!shadow) return;
    logger(
      "[safe-template-shadow]",
      JSON.stringify(compareShadowWithCurrent(shadow, currentTemplateId)),
    );
  } catch {
    // Shadow telemetry must never fail or delay the delivery path.
  }
}

export async function runShadowSelection(
  brief: string,
  templates: readonly Pick<TemplateRecord, "id" | "visualMetadata">[],
  options: ShadowSelectionOptions = {},
): Promise<SafeSelectionShadowLog | null> {
  const mode = safeTemplatePickerMode(options.mode);
  if (mode === "off") return null;

  const result = await selectGenerationRoute(brief, templates, {
    analyzeIntentImpl: options.analyzeIntentImpl ?? analyzeIntent,
    now: options.now,
  });
  if (!result.ok) {
    return {
      status: "error",
      schemaVersion: "safe-selection-shadow/1.0",
      errorKind: result.errorKind,
      durationMs: result.durationMs,
    };
  }
  return {
    status: "ok",
    schemaVersion: "safe-selection-shadow/1.0",
    promptVersion: result.promptVersion,
    policyVersion: result.policyVersion,
    modelId: result.modelId,
    decision: result.decision,
    topCandidates: result.ranked.slice(0, 5),
    usage: result.usage,
    durationMs: result.durationMs,
  };
}
