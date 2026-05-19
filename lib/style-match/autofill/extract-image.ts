// Image → JSON extraction via Gemini Flash. Reads an image (screenshot,
// photo of a menu, product photo, brochure scan, etc.) and returns
// structured business data the autofill pipeline can use to fill a
// template. Never invents — only extracts what's visible.

import {
  getCachedExtraction,
  hashImage,
  setCachedExtraction,
} from "./cache";
import {
  ExtractedBusinessDataSchema,
  type ExtractedBusinessData,
  type ImageMime,
} from "./types";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL_ID =
  process.env.STYLE_MATCH_VISION_MODEL || "gemini-2.5-flash";
const MAX_TOKENS = 4_000;

const SYSTEM_PROMPT = `You analyze an image (screenshot of a website, product photo, menu, business card, brochure, etc.) and extract structured business data for use in a landing page template.

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

CRITICAL RULES:
1. ONLY include information that's actually visible in the image. NEVER invent.
2. If a field has no visible data, set it to null (or empty array for the arrays).
3. Detect the primary language of the visible text and set "language_detected" ("es", "en", "pt", etc).
4. "tagline_es" only filled if Spanish text is visible; "tagline_en" only if English. Don't translate — only extract what's there.
5. "pitch" = a 1-2 sentence summary that captures what the business does, derived from the visible content (you CAN paraphrase to fit the format, but stay factually grounded in what's visible).
6. "hero_keyword" = the single most prominent emphasized word in the hero / largest text — often visually highlighted (color, underline, bold).
7. For "features": extract from visible feature sections, "what we do" sections, product highlights. Each title 2-5 words, desc 15-30 words.
8. For "pricing": only include if a pricing section is clearly visible. Don't guess.
9. For "testimonials": only include if quotes with author attribution are visible.
10. CTAs: extract from visible button text ("Get started" / "Try it free" / "Pide ahora" etc).

Return the JSON object and nothing else.`;

export interface ExtractImageInput {
  image: Buffer;
  mime?: ImageMime;
  modelId?: string;
  signal?: AbortSignal;
}

export interface ExtractImageOk {
  ok: true;
  data: ExtractedBusinessData;
  raw: string;
  usage?: { inputTokens: number; outputTokens: number };
  durationMs: number;
}

export interface ExtractImageErr {
  ok: false;
  error: {
    kind:
      | "missing-key"
      | "api"
      | "parse"
      | "schema"
      | "aborted"
      | "no-business-info";
    message: string;
  };
  raw?: string;
  usage?: { inputTokens: number; outputTokens: number };
  durationMs: number;
}

export type ExtractImageResult = ExtractImageOk | ExtractImageErr;

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

export async function extractFromImage(
  input: ExtractImageInput,
): Promise<ExtractImageResult> {
  const t0 = Date.now();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error: {
        kind: "missing-key",
        message: "GEMINI_API_KEY not set. Get one at https://aistudio.google.com/",
      },
      durationMs: Date.now() - t0,
    };
  }

  // Cache check — same image bytes = same extraction (assumed deterministic
  // enough at temperature 0.2). Saves ~$0.0003 and 2s per repeat call.
  const imageHash = hashImage(input.image);
  const cached = getCachedExtraction(imageHash);
  if (cached) {
    return {
      ok: true,
      data: cached,
      raw: "(cached)",
      durationMs: Date.now() - t0,
    };
  }

  const mime = input.mime ?? "image/jpeg";
  const modelId = input.modelId ?? DEFAULT_MODEL_ID;
  const url = `${GEMINI_BASE}/${modelId}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      {
        role: "user",
        parts: [
          { inline_data: { mime_type: mime, data: input.image.toString("base64") } },
          { text: "Extract structured business data from this image. Return JSON only." },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: MAX_TOKENS,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: input.signal,
    });
  } catch (err) {
    if (input.signal?.aborted) {
      return {
        ok: false,
        error: { kind: "aborted", message: "Request aborted" },
        durationMs: Date.now() - t0,
      };
    }
    return {
      ok: false,
      error: {
        kind: "api",
        message: err instanceof Error ? err.message : String(err),
      },
      durationMs: Date.now() - t0,
    };
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return {
      ok: false,
      error: { kind: "api", message: `Gemini ${res.status}: ${text.slice(0, 400)}` },
      durationMs: Date.now() - t0,
    };
  }

  const payload = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const raw =
    payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ??
    "";
  const usage = payload.usageMetadata
    ? {
        inputTokens: payload.usageMetadata.promptTokenCount ?? 0,
        outputTokens: payload.usageMetadata.candidatesTokenCount ?? 0,
      }
    : undefined;

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

  // Sanity check: did Gemini extract ANYTHING meaningful? If the user uploaded
  // a selfie / meme / abstract art / pure photograph with no business
  // content, every field comes back null/empty. Reject with a friendly
  // error so the UI can tell the user to try a different image.
  const d = validated.data;
  const isEmpty =
    !d.business_name &&
    !d.tagline_es &&
    !d.tagline_en &&
    !d.pitch &&
    !d.industry &&
    !d.cta_primary &&
    !d.cta_secondary &&
    d.features.length === 0 &&
    d.pricing.length === 0 &&
    d.testimonials.length === 0 &&
    d.faq_questions.length === 0;
  if (isEmpty) {
    return {
      ok: false,
      error: {
        kind: "no-business-info",
        message:
          "No encontramos info de negocio en esa imagen. Probá con una captura de tu sitio actual, foto del menú, brochure, o tarjeta de presentación.",
      },
      raw,
      usage,
      durationMs: Date.now() - t0,
    };
  }

  setCachedExtraction(imageHash, validated.data);
  return {
    ok: true,
    data: validated.data,
    raw,
    usage,
    durationMs: Date.now() - t0,
  };
}
