import { z } from "zod";

import type { FireworksJsonClient } from "@/lib/ai/fireworks-client";
import { IntentAnalysisSchema, type IntentAnalysis } from "@/lib/generation/contracts";
import { reasoningEffortFor } from "@/lib/generation/fable-model-policy";
import type { ModelTokenUsage } from "@/lib/generation/model-cost";
import {
  CANONICAL_PRIMARY_AUDIENCES,
  CANONICAL_SECTION_ROLES,
  CANONICAL_SITE_TYPES,
} from "@/lib/generation/structural-taxonomy";
import { LenientBusinessDataSchema, type ExtractedBusinessData } from "@/lib/style-match/autofill/types";

export const FABLE_INTENT_PROMPT_VERSION = "fable-intent-prompt/1.0" as const;
export const FABLE_COPY_PROMPT_VERSION = "fable-page-copy-prompt/1.0" as const;

export type FableIntentResult =
  | { readonly ok: true; readonly intent: IntentAnalysis; readonly modelId: string; readonly promptVersion: string; readonly usage?: ModelTokenUsage; readonly durationMs: number; readonly attempts?: 1 | 2 }
  | { readonly ok: false; readonly code: string; readonly modelId: string; readonly usage?: ModelTokenUsage; readonly durationMs: number; readonly attempts: 0 | 1 | 2 };

export type FableCopyResult =
  | { readonly ok: true; readonly copy: ExtractedBusinessData; readonly modelId: string; readonly promptVersion: string; readonly usage?: ModelTokenUsage; readonly durationMs: number; readonly attempts?: 1 | 2 }
  | { readonly ok: false; readonly code: string; readonly modelId: string; readonly usage?: ModelTokenUsage; readonly durationMs: number; readonly attempts: 0 | 1 | 2 };

export interface FableInputAdapters {
  analyzeIntent(brief: string, requestId: string): Promise<FableIntentResult>;
  generatePageCopy(brief: string, requestId: string): Promise<FableCopyResult>;
}

const PageCopyResponseSchema = z.object({
  schemaVersion: z.literal("page-copy/1.0"),
  copy: LenientBusinessDataSchema,
}).strict();
interface PageCopyResponse { readonly schemaVersion: "page-copy/1.0"; readonly copy: ExtractedBusinessData }

const CanonicalIntentAnalysisSchema: z.ZodType<IntentAnalysis> = IntentAnalysisSchema.extend({
  functional: IntentAnalysisSchema.shape.functional.extend({
    siteType: z.enum(CANONICAL_SITE_TYPES),
    requiredSections: z.array(z.enum(CANONICAL_SECTION_ROLES)).max(24),
  }),
  audience: IntentAnalysisSchema.shape.audience.extend({
    primary: z.enum(CANONICAL_PRIMARY_AUDIENCES),
  }),
}).transform((value): IntentAnalysis => ({
  ...value,
  functional: {
    ...value.functional,
    requiredSections: [...new Set(value.functional.requiredSections)],
  },
}));

const INTENT_SYSTEM_PROMPT = [
  "Return only intent-analysis/1.0 strict JSON. Classify the actual product using lowercase taxonomy.",
  `functional.siteType must be one of: ${CANONICAL_SITE_TYPES.join(", ")}.`,
  `functional.requiredSections must use only: ${CANONICAL_SECTION_ROLES.join(", ")}.`,
  `audience.primary must be one of: ${CANONICAL_PRIMARY_AUDIENCES.join(", ")}.`,
  "Keep required sections ordered and unique. Include audience, domains, visible required and forbidden signals.",
  "Never return HTML, CSS, JS, URLs, prompts, or prose.",
].join(" ");

function validBrief(brief: string): boolean {
  return typeof brief === "string" && brief.trim().length >= 10 && brief.length <= 4000;
}

/**
 * The only textual AI boundary in Create with AI.  It deliberately uses the
 * Task 2 Fireworks client (DeepSeek reasoner role), never Gemini text APIs.
 */
export function createFableInputAdapters(options: { readonly client: FireworksJsonClient }): FableInputAdapters {
  return {
    async analyzeIntent(brief, requestId) {
      if (!validBrief(brief)) return { ok: false, code: "invalid_input", modelId: "accounts/fireworks/models/deepseek-v4-flash", durationMs: 0, attempts: 0 };
      const result = await options.client.request<IntentAnalysis>({
        role: "reasoner",
        reasoningEffort: reasoningEffortFor("reasoner", "simple_extraction"),
        requestId: `${requestId}.intent`,
        maxOutputTokens: 4096,
        responseSchema: CanonicalIntentAnalysisSchema,
        messages: [
          { role: "system", content: INTENT_SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify({ schemaVersion: "fable-intent-input/1.0", brief: brief.trim() }) },
        ],
      });
      if (!result.ok) return result;
      return { ok: true, intent: result.value, modelId: result.modelId, promptVersion: FABLE_INTENT_PROMPT_VERSION, usage: result.usage, durationMs: result.durationMs, attempts: result.attempts };
    },
    async generatePageCopy(brief, requestId) {
      if (!validBrief(brief)) return { ok: false, code: "invalid_input", modelId: "accounts/fireworks/models/deepseek-v4-flash", durationMs: 0, attempts: 0 };
      const result = await options.client.request<PageCopyResponse>({
        role: "reasoner",
        reasoningEffort: reasoningEffortFor("reasoner", "copy"),
        requestId: `${requestId}.copy`,
        maxOutputTokens: 8192,
        responseSchema: PageCopyResponseSchema as z.ZodType<PageCopyResponse>,
        messages: [
          { role: "system", content: "Return only page-copy/1.0 strict JSON. Invent concise, specific customer-facing copy in the brief language. The copy object may contain business name, pitch, hero keyword, features, FAQs, testimonials and calls to action. Never return HTML, CSS, JS, URLs, prompts, explanations, or instructions." },
          { role: "user", content: JSON.stringify({ schemaVersion: "fable-page-copy-input/1.0", brief: brief.trim() }) },
        ],
      });
      if (!result.ok) return result;
      return { ok: true, copy: result.value.copy, modelId: result.modelId, promptVersion: FABLE_COPY_PROMPT_VERSION, usage: result.usage, durationMs: result.durationMs, attempts: result.attempts };
    },
  };
}
