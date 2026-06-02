// Curation's "cheap brain": one Gemini Flash call that, given a brief + the
// template catalog, picks the ONE whole template that best fits AND invents the
// brief-specific copy. No stitching, no theme, no bind — a curated template is
// already a coherent, centred, rhythmic page; we only swap its copy. Same
// generateContent transport + INVENT-copy stance as lib/assemble/recipe.ts.

import { z } from "zod";
import {
  LenientBusinessDataSchema,
  type ExtractedBusinessData,
} from "../style-match/autofill/types";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL_ID =
  process.env.CURATE_PICK_MODEL || process.env.STYLE_MATCH_TEXT_MODEL || "gemini-2.5-flash";
const MAX_TOKENS = 6_000;

/** The fields of a template the picker reasons over (subset of TemplateRecord). */
export interface TemplateCatalogItem {
  id: string;
  name: string;
  family: string;
  mode: string;
  pitch: string;
  description?: string;
}

export const PickSchema = z.object({
  templateId: z.string(),
  copy: LenientBusinessDataSchema,
});
export type Pick = z.infer<typeof PickSchema>;

export function buildCatalog(items: TemplateCatalogItem[]): string {
  return items
    .map((t) => `${t.id} · ${t.name} · family=${t.family} · mode=${t.mode} · ${t.pitch}`)
    .join("\n");
}

export function pickSystemPrompt(catalog: string): string {
  return `You are the page planner for OpenLen. Given a brief, you (1) pick the ONE template from the catalog below that best fits the brief, and (2) invent the brief-specific copy. Output STRICT JSON only — no markdown, no prose.

Shape:
{
  "templateId": "<an id copied EXACTLY from the catalog>",
  "copy": {
    "business_name": string|null, "industry": string|null,
    "tagline_es": string|null, "tagline_en": string|null,
    "pitch": string|null, "hero_keyword": string|null,
    "features": [{"title": string, "desc": string}],
    "pricing": [{"name": string, "price": string|null, "period": string|null, "features": string[]}],
    "testimonials": [{"name": string, "role": string|null, "company": string|null, "quote": string}],
    "cta_primary": string|null, "cta_secondary": string|null,
    "faq_questions": [{"q": string, "a": string}],
    "language_detected": string|null
  }
}

PICK RULES:
- "templateId" MUST be one of the ids listed below, copied EXACTLY. Choose by fit: industry/mood/audience match, and the right mode (dark = technical/SaaS/bold; light/cream = warm/editorial/consumer).
- Prefer a template whose structure naturally suits the brief (a SaaS template for a dev tool, an editorial template for a studio, a warm template for food/hospitality).

COPY RULES (you DO invent — this is a demo page, not verified client data):
- Invent a believable, specific, on-brand demo: product/company name, a punchy tagline, a 1–2 sentence pitch, a hero_keyword, 3–6 concrete features, realistic pricing tiers if the brief implies a paid product, 2–3 testimonials with fictional plausible names, 3–5 FAQ Q&As, natural CTAs.
- Be specific and confident (real-sounding metrics/brands). Avoid generic filler ("Lorem ipsum", "Your tagline here"). Write in the brief's language; set "language_detected".

CATALOG (id · name · family · mode · pitch):
${catalog}

Return ONLY the JSON object.`;
}

export interface PickTemplateOk {
  ok: true;
  templateId: string;
  copy: ExtractedBusinessData;
  raw: string;
  usage?: { inputTokens: number; outputTokens: number };
  durationMs: number;
}
export interface PickTemplateErr {
  ok: false;
  error: { kind: "missing-key" | "api" | "parse" | "schema" | "unknown-template" | "empty-catalog" | "aborted"; message: string };
  raw?: string;
  durationMs: number;
}
export type PickTemplateResult = PickTemplateOk | PickTemplateErr;

function tryExtractJson(raw: string): unknown | null {
  const t = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(t.slice(a, b + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function pickTemplate(
  brief: string,
  catalog: TemplateCatalogItem[],
  opts?: { modelId?: string; signal?: AbortSignal; now?: number },
): Promise<PickTemplateResult> {
  const t0 = opts?.now ?? Date.now();
  if (catalog.length === 0) {
    return { ok: false, error: { kind: "empty-catalog", message: "no published templates to pick from" }, durationMs: 0 };
  }
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, error: { kind: "missing-key", message: "GEMINI_API_KEY not set" }, durationMs: 0 };

  const modelId = opts?.modelId ?? DEFAULT_MODEL_ID;
  const url = `${GEMINI_BASE}/${modelId}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    systemInstruction: { parts: [{ text: pickSystemPrompt(buildCatalog(catalog)) }] },
    contents: [{ role: "user", parts: [{ text: `Brief:\n\n${brief.trim()}\n\nReturn the pick JSON only.` }] }],
    generationConfig: {
      temperature: 0.6,
      maxOutputTokens: MAX_TOKENS,
      responseMimeType: "application/json",
      thinkingConfig: { thinkingBudget: 0 },
    },
  };

  let res: Response;
  try {
    res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: opts?.signal });
  } catch (err) {
    if (opts?.signal?.aborted) return { ok: false, error: { kind: "aborted", message: "aborted" }, durationMs: dur(t0, opts) };
    return { ok: false, error: { kind: "api", message: err instanceof Error ? err.message : String(err) }, durationMs: dur(t0, opts) };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: { kind: "api", message: `Gemini ${res.status}: ${text.slice(0, 400)}` }, durationMs: dur(t0, opts) };
  }

  const payload = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  };
  const raw = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const usage = payload.usageMetadata
    ? { inputTokens: payload.usageMetadata.promptTokenCount ?? 0, outputTokens: payload.usageMetadata.candidatesTokenCount ?? 0 }
    : undefined;

  const parsed = tryExtractJson(raw);
  if (parsed === null) return { ok: false, error: { kind: "parse", message: "could not parse JSON" }, raw, durationMs: dur(t0, opts) };
  const validated = PickSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      ok: false,
      error: { kind: "schema", message: validated.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join(" | ") },
      raw,
      durationMs: dur(t0, opts),
    };
  }
  const ids = new Set(catalog.map((c) => c.id));
  if (!ids.has(validated.data.templateId)) {
    return { ok: false, error: { kind: "unknown-template", message: `model picked "${validated.data.templateId}" which is not in the catalog` }, raw, durationMs: dur(t0, opts) };
  }

  return { ok: true, templateId: validated.data.templateId, copy: validated.data.copy, raw, usage, durationMs: dur(t0, opts) };
}

function dur(t0: number, opts?: { now?: number }): number {
  return (opts?.now ?? Date.now()) - t0;
}
