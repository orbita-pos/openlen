import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { z } from "zod";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL_ID = process.env.STYLE_MATCH_VISION_MODEL || "gemini-2.5-flash";
const MAX_TOKENS = 4_000;

const ExtractedDataSchema = z.object({
  business_name: z.string().nullable(),
  industry: z.string().nullable(),
  tagline_es: z.string().nullable(),
  tagline_en: z.string().nullable(),
  pitch: z.string().nullable(),
  hero_keyword: z.string().nullable(),
  features: z
    .array(z.object({ title: z.string(), desc: z.string() }))
    .default([]),
  pricing: z
    .array(
      z.object({
        name: z.string(),
        price: z.string().nullable(),
        period: z.string().nullable(),
        features: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  testimonials: z
    .array(
      z.object({
        name: z.string(),
        role: z.string().nullable(),
        company: z.string().nullable(),
        quote: z.string(),
      }),
    )
    .default([]),
  cta_primary: z.string().nullable(),
  cta_secondary: z.string().nullable(),
  faq_questions: z
    .array(z.object({ q: z.string(), a: z.string() }))
    .default([]),
  language_detected: z.string().nullable(),
});

type ExtractedData = z.infer<typeof ExtractedDataSchema>;

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

function bufferToDataUrl(buf: Buffer, mime: string): string {
  return `data:${mime};base64,${buf.toString("base64")}`;
}

function tryExtractJson(raw: string): unknown | null {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch { /* fall through */ }
  const fenceStripped = trimmed
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "");
  try {
    return JSON.parse(fenceStripped);
  } catch { /* fall through */ }
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

async function extractFromImage(
  screenshot: Buffer,
  mime: "image/jpeg" | "image/png" = "image/jpeg",
): Promise<{ data?: ExtractedData; raw?: string; error?: string; usage?: { inputTokens: number; outputTokens: number }; durationMs: number }> {
  const apiKey = process.env.GEMINI_API_KEY;
  const t0 = Date.now();
  if (!apiKey) {
    return { error: "GEMINI_API_KEY not set in .env.local", durationMs: Date.now() - t0 };
  }

  const url = `${GEMINI_BASE}/${MODEL_ID}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [
      {
        role: "user",
        parts: [
          { inline_data: { mime_type: mime, data: screenshot.toString("base64") } },
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

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { error: `Gemini ${res.status}: ${text.slice(0, 400)}`, durationMs: Date.now() - t0 };
  }
  const payload = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const raw = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const usage = payload.usageMetadata
    ? {
        inputTokens: payload.usageMetadata.promptTokenCount ?? 0,
        outputTokens: payload.usageMetadata.candidatesTokenCount ?? 0,
      }
    : undefined;

  const parsed = tryExtractJson(raw);
  if (parsed === null) {
    return { raw, error: "Could not parse JSON from Gemini output", usage, durationMs: Date.now() - t0 };
  }
  const validated = ExtractedDataSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      raw,
      error: `Schema mismatch: ${validated.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join(" | ")}`,
      usage,
      durationMs: Date.now() - t0,
    };
  }
  return { data: validated.data, raw, usage, durationMs: Date.now() - t0 };
}

async function main() {
  const imagePath = process.argv[2];
  if (!imagePath) {
    console.error("Usage: tsx scripts/test-image-extract.ts <path-to-image>");
    console.error("Example: tsx scripts/test-image-extract.ts .style-match-test/stripe-com.jpg");
    process.exit(1);
  }
  if (!existsSync(imagePath)) {
    console.error(`Image not found: ${imagePath}`);
    process.exit(1);
  }
  const screenshot = readFileSync(imagePath);
  const mime: "image/jpeg" | "image/png" = imagePath.toLowerCase().endsWith(".png")
    ? "image/png"
    : "image/jpeg";

  console.log(`\n[test-image-extract] Reading: ${imagePath}`);
  console.log(`  size: ${(screenshot.byteLength / 1024).toFixed(1)} KB`);
  console.log(`  model: ${MODEL_ID}`);
  console.log(`  calling Gemini vision (thinking disabled)...`);

  const result = await extractFromImage(screenshot, mime);
  console.log(`  returned in ${(result.durationMs / 1000).toFixed(1)}s`);
  if (result.usage) {
    console.log(`  tokens: in=${result.usage.inputTokens}, out=${result.usage.outputTokens}`);
  }

  if (result.error) {
    console.log(`\n❌ ${result.error}`);
    if (result.raw) console.log(`\nRaw:\n${result.raw.slice(0, 2000)}`);
    process.exit(1);
  }
  if (!result.data) {
    console.log(`\n❌ No data returned`);
    process.exit(1);
  }

  const data = result.data;
  console.log(`\n=== EXTRACTED DATA ===\n`);
  console.log(`Business:   ${data.business_name ?? "—"}`);
  console.log(`Industry:   ${data.industry ?? "—"}`);
  console.log(`Language:   ${data.language_detected ?? "—"}`);
  if (data.tagline_en) console.log(`Tagline EN: ${data.tagline_en}`);
  if (data.tagline_es) console.log(`Tagline ES: ${data.tagline_es}`);
  if (data.pitch) console.log(`Pitch:      ${data.pitch}`);
  if (data.hero_keyword) console.log(`Hero word:  ${data.hero_keyword}`);
  if (data.cta_primary) console.log(`CTA 1:      ${data.cta_primary}`);
  if (data.cta_secondary) console.log(`CTA 2:      ${data.cta_secondary}`);

  console.log(`\nFeatures (${data.features.length}):`);
  for (const f of data.features.slice(0, 6)) {
    console.log(`  • ${f.title}`);
    console.log(`    ${f.desc.slice(0, 80)}${f.desc.length > 80 ? "…" : ""}`);
  }

  if (data.pricing.length) {
    console.log(`\nPricing (${data.pricing.length}):`);
    for (const p of data.pricing) {
      console.log(`  • ${p.name} ${p.price ?? ""} ${p.period ?? ""}`);
      for (const f of p.features.slice(0, 3)) console.log(`    - ${f}`);
    }
  }

  if (data.testimonials.length) {
    console.log(`\nTestimonials (${data.testimonials.length}):`);
    for (const t of data.testimonials.slice(0, 3)) {
      console.log(`  • ${t.name} — ${t.role ?? ""} ${t.company ? "@ " + t.company : ""}`);
      console.log(`    "${t.quote.slice(0, 80)}${t.quote.length > 80 ? "…" : ""}"`);
    }
  }

  if (data.faq_questions.length) {
    console.log(`\nFAQ (${data.faq_questions.length}):`);
    for (const f of data.faq_questions.slice(0, 4)) console.log(`  • ${f.q}`);
  }

  const dir = join(".style-match-test", "fill");
  mkdirSync(dir, { recursive: true });
  const slug = basename(imagePath, extname(imagePath));
  const outPath = join(dir, `${slug}.extracted.json`);
  writeFileSync(outPath, JSON.stringify(data, null, 2));
  console.log(`\n✓ Saved: ${outPath}\n`);
}

main().catch((err) => {
  console.error("\nUnhandled:", err);
  process.exit(1);
});
