// lib/app-ai/models.ts — THE TWO MODEL ALIASES an app can ask for (spec local
// 2026-10-15, 4.3). An app names an alias, never a provider model id: the
// policy table (lib/generation/model-policy.ts) decides which model and effort
// each alias runs, so a retired model is a one-line change and no app breaks.

import type { ModelOperation } from "@/lib/generation/model-policy";

export type AppAiModel = "openlen-fast" | "openlen-smart";

export interface AppAiModelSpec {
  readonly id: AppAiModel;
  readonly operation: Extract<ModelOperation, "app_ai_fast" | "app_ai_smart">;
  /** `max_tokens` when the request doesn't say. Thinking counts as output. */
  readonly defaultMaxTokens: number;
}

export const APP_AI_MODELS: readonly AppAiModelSpec[] = [
  { id: "openlen-fast", operation: "app_ai_fast", defaultMaxTokens: 2_048 },
  { id: "openlen-smart", operation: "app_ai_smart", defaultMaxTokens: 8_192 },
];

/** The most a request may ask for, whatever the alias. */
export const MAX_TOKENS_CEILING = 16_384;

export function appAiModel(id: string): AppAiModelSpec | null {
  return APP_AI_MODELS.find((m) => m.id === id) ?? null;
}
