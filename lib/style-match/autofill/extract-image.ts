// Image → JSON extraction via Gemini Flash. Reads an image (screenshot,
// photo of a menu, product photo, brochure scan, etc.) and returns
// structured business data the autofill pipeline can use to fill a
// template. Never invents — only extracts what's visible.

import { callModel } from "./model-call";
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

// El modelo lo elige la política de `model-policy` a partir de la
// `operation` que pasa `callModel`. Nombrarlo aquí sería una constante muerta
// que además mentiría sobre quién corre.
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
  // Sin comprobación de credencial: el transporte de Fireworks usa la suya y
  // falla con un error de API si falta. `missing-key` se conserva en el tipo
  // porque otros caminos de este módulo aún pueden devolverlo.

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

  // Leer datos de negocio de una IMAGEN es MIRAR: lo hace Qwen, el papel con
  // visión de la política. Al razonador nunca se le manda una imagen, y Gemini
  // se queda para generar píxeles, no para leerlos.
  const mime = input.mime ?? "image/jpeg";
  const r = await callModel({
    system: SYSTEM_PROMPT,
    user: "Extract structured business data from this image. Return JSON only.",
    images: [{ mimeType: mime, dataBase64: input.image.toString("base64") }],
    operation: "candidate_scouting",
    requestId: "autofill-extract-image",
    maxOutputTokens: MAX_TOKENS,
    temperature: 0.2,
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
