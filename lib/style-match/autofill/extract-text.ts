// Free-text description → JSON extraction via Gemini Flash. The owner types a
// plain-language description of their business; we structure it into the same
// ExtractedBusinessData the autofill pipeline fills a template with. Unlike the
// image extractor (strictly "only what's visible"), this MAY phrase a tagline,
// pitch, hero keyword and CTA from the description — but never invents facts
// (no fake prices, testimonials, or claims the user didn't make).

import { callModel } from "./model-call";
import {
  ExtractedBusinessDataSchema,
  type ExtractedBusinessData,
} from "./types";

// El modelo lo elige la política de `model-policy` a partir de la
// `operation` que pasa `callModel`. Nombrarlo aquí sería una constante muerta
// que además mentiría sobre quién corre.
const MAX_TOKENS = 4_000;

const SYSTEM_PROMPT = `You turn a short, plain-language description of a business (written by its non-technical owner) into structured data for a landing-page template.

You return STRICT JSON only — no preamble, no markdown fences.

The JSON shape is:
{
  "business_name": string | null,
  "industry": string | null,
  "tagline_es": string | null,
  "tagline_en": string | null,
  "pitch": string | null,
  "hero_keyword": string | null,
  "features": [{ "title": string, "desc": string }],
  "pricing": [{ "name": string, "price": string | null, "period": string | null, "features": string[] }],
  "testimonials": [{ "name": string, "role": string | null, "company": string | null, "quote": string }],
  "cta_primary": string | null,
  "cta_secondary": string | null,
  "faq_questions": [{ "q": string, "a": string }],
  "language_detected": string | null
}

RULES:
1. Write everything in the SAME language the user wrote in. Detect it and set "language_detected" ("es", "en", "pt", etc.). Fill "tagline_es" only if that language is Spanish, "tagline_en" only if English; leave the other null.
2. Extract "business_name" and "industry" if stated; otherwise null.
3. You MAY craft these FROM the description (this is desired): "tagline" (one short punchy line), "pitch" (1-2 sentences on what they do), "hero_keyword" (the single most important word/theme), and "cta_primary" (a natural call to action like "Order on WhatsApp" / "Book a call" / "Pide ahora"). Stay grounded in what the user actually said — capture their meaning, don't add facts they didn't mention.
4. NEVER invent specifics the user didn't give: no made-up prices, testimonials, FAQs, stats, or feature claims. Leave "pricing", "testimonials" and "faq_questions" as []. Leave "features" as [] UNLESS the user clearly listed concrete offerings/services — then turn those into features (title 2-5 words, desc 10-25 words), grounded in their words.

Return the JSON object and nothing else.`;

export interface ExtractTextInput {
  description: string;
  modelId?: string;
  signal?: AbortSignal;
}

export interface ExtractTextOk {
  ok: true;
  data: ExtractedBusinessData;
  raw: string;
  usage?: { inputTokens: number; outputTokens: number };
  durationMs: number;
}

export interface ExtractTextErr {
  ok: false;
  error: {
    kind: "missing-key" | "api" | "parse" | "schema" | "aborted" | "no-business-info";
    message: string;
  };
  raw?: string;
  usage?: { inputTokens: number; outputTokens: number };
  durationMs: number;
}

export type ExtractTextResult = ExtractTextOk | ExtractTextErr;

function tryExtractJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through */
  }
  const fenceStripped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "");
  try {
    return JSON.parse(fenceStripped);
  } catch {
    /* fall through */
  }
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {
      return null;
    }
  }
  return null;
}

export async function extractFromText(
  input: ExtractTextInput,
): Promise<ExtractTextResult> {
  const t0 = Date.now();
  // Extraer datos de negocio de una descripción es TEXTO: lo hace DeepSeek, con
  // la credencial de Fireworks. Gemini se queda para los píxeles.

  const description = input.description.trim();
  const r = await callModel({
    system: SYSTEM_PROMPT,
    user: `Business description:

${description}

Return the structured JSON only.`,
    operation: "simple_extraction",
    requestId: "autofill-extract-text",
    maxOutputTokens: MAX_TOKENS,
    temperature: 0.4,
    jsonObject: true,
    ...(input.signal ? { signal: input.signal } : {}),
  });
  if (!r.ok) {
    return {
      ok: false,
      error: { kind: r.kind, message: r.message },
      durationMs: Date.now() - t0,
    };
  }
  const raw = r.raw;
  const usage = r.usage;

  const parsed = tryExtractJson(raw);
  if (parsed === null) {
    return {
      ok: false,
      error: { kind: "parse", message: "Could not parse JSON from Gemini output" },
      raw,
      usage,
      durationMs: Date.now() - t0,
    };
  }
  const validated = ExtractedBusinessDataSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      ok: false,
      error: {
        kind: "schema",
        message: `Schema mismatch: ${validated.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join(".")}: ${i.message}`)
          .join(" | ")}`,
      },
      raw,
      usage,
      durationMs: Date.now() - t0,
    };
  }

  // If the description was too vague to yield anything usable, reject with a
  // friendly nudge instead of filling the template with nulls.
  const d = validated.data;
  const isEmpty =
    !d.business_name &&
    !d.tagline_es &&
    !d.tagline_en &&
    !d.pitch &&
    !d.industry &&
    !d.cta_primary &&
    !d.cta_secondary &&
    d.features.length === 0;
  if (isEmpty) {
    return {
      ok: false,
      error: {
        kind: "no-business-info",
        message:
          "No pudimos entender la descripción. Contanos qué es tu negocio y qué ofrecés (ej: \"Taquería en Monterrey, tacos al pastor desde 1989, pedidos por WhatsApp\").",
      },
      raw,
      usage,
      durationMs: Date.now() - t0,
    };
  }

  return {
    ok: true,
    data: validated.data,
    raw,
    usage,
    durationMs: Date.now() - t0,
  };
}
