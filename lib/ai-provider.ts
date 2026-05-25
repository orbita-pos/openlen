// Provider routing for the AI surfaces — page generation (/api/generate) and
// chat redesign (/api/templates/ai-design). Both tiers run on Google's
// OpenAI-compatible endpoint, so the SSE parsing is identical and the only
// thing that varies is the model id + per-token rate.

export type AIModel = "gemini-pro" | "gemini-flash";

export interface AIProvider {
  url: string;
  key: string | undefined;
  /** Provider-side model id. */
  model: string;
  /** Credit-rate key — see RATES in lib/credits.ts. */
  rate: AIModel;
  /** Human label for logs + error messages. */
  label: string;
}

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

/** Map the picked model to its provider config. Default is Gemini 2.5 Pro —
 *  Linear-tier landing-page quality at a sane cost. Flash is the faster,
 *  cheaper alternative when speed beats polish. */
export function resolveAIProvider(model: string | undefined): AIProvider {
  if (model === "gemini-flash") {
    return {
      url: GEMINI_URL,
      key: process.env.GEMINI_API_KEY,
      model: "gemini-2.5-flash",
      rate: "gemini-flash",
      label: "Gemini 2.5 Flash",
    };
  }
  return {
    url: GEMINI_URL,
    key: process.env.GEMINI_API_KEY,
    model: "gemini-2.5-pro",
    rate: "gemini-pro",
    label: "Gemini 2.5 Pro",
  };
}
