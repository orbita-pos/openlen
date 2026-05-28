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

/** Map the picked model to its provider config. Default is Gemini 3.5 Flash —
 *  launched at Google I/O 2026, beats 3.1 Pro on coding benches at lower cost
 *  ($9/M output vs $10/M for 2.5 Pro). Pro tier upgrades to 3.1 Pro Preview
 *  for deeper reasoning (1M context, 2M for 3.1). Both ship ~35% higher coding
 *  accuracy vs the 2.5 line per Google + community frontend benchmarks. */
export function resolveAIProvider(model: string | undefined): AIProvider {
  if (model === "gemini-pro") {
    return {
      url: GEMINI_URL,
      key: process.env.GEMINI_API_KEY,
      model: "gemini-3.1-pro-preview",
      rate: "gemini-pro",
      label: "Gemini 3.1 Pro",
    };
  }
  return {
    url: GEMINI_URL,
    key: process.env.GEMINI_API_KEY,
    model: "gemini-3.5-flash",
    rate: "gemini-flash",
    label: "Gemini 3.5 Flash",
  };
}
