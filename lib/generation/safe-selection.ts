import type { TemplateRecord } from "@/lib/templates/store";

import {
  analyzeIntent,
  INTENT_PROMPT_VERSION,
} from "./analyze-intent";
import type { IntentAnalysis, GenerationDecision } from "./contracts";
import { DECISION_POLICY_VERSION, decideGenerationRoute } from "./decide-route";
import { rankTemplates, type ScoredTemplate } from "./score-template";

export type SafeSelectionResult =
  | {
      ok: true;
      intent: IntentAnalysis;
      decision: GenerationDecision;
      ranked: ScoredTemplate[];
      promptVersion: typeof INTENT_PROMPT_VERSION;
      policyVersion: typeof DECISION_POLICY_VERSION;
      modelId: string;
      usage?: { inputTokens: number; outputTokens: number };
      durationMs: number;
    }
  | {
      ok: false;
      errorKind: string;
      durationMs: number;
    };

export interface SafeSelectionOptions {
  analyzeIntentImpl?: typeof analyzeIntent;
  now?: () => number;
}

function elapsedMilliseconds(started: number, now: () => number): number {
  const elapsed = now() - started;
  return Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0;
}

export async function selectGenerationRoute(
  brief: string,
  templates: readonly Pick<TemplateRecord, "id" | "visualMetadata">[],
  options: SafeSelectionOptions = {},
): Promise<SafeSelectionResult> {
  const now = options.now ?? Date.now;
  const started = now();
  const elapsed = () => elapsedMilliseconds(started, now);

  try {
    const analyze = options.analyzeIntentImpl ?? analyzeIntent;
    const result = await analyze(brief);
    if (!result.ok) return { ok: false, errorKind: result.error.kind, durationMs: elapsed() };

    const ranked = rankTemplates(result.intent, templates);
    return {
      ok: true,
      intent: result.intent,
      decision: decideGenerationRoute(ranked),
      ranked,
      promptVersion: result.promptVersion,
      policyVersion: DECISION_POLICY_VERSION,
      modelId: result.modelId,
      usage: result.usage,
      durationMs: elapsed(),
    };
  } catch {
    return { ok: false, errorKind: "unexpected_error", durationMs: elapsed() };
  }
}
