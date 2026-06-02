// The assembler's "cheap brain": one Gemini Flash structured call that turns a
// brief into a RECIPE — a page theme + an ordered list of section types + the
// INVENTED brief-specific copy. Mirrors the autofill extract-text.ts transport
// (direct generateContent fetch, responseMimeType:json, thinkingBudget:0) but
// with the OPPOSITE stance on copy: extract-text refuses to invent facts; a demo
// landing must invent believable ones (product name, metrics, FAQ, fictional
// testimonials), like the bespoke generate prompt's BRIEF EXPANSION step.
//
// Theme colours/fonts are CHOSEN here (the model is good at palettes); the
// server then derives the rest (deriveContractColors) and the bind makes every
// section wear this one theme. Variants are left null → select.ts picks them.

import { z } from "zod";
import { SECTION_TYPES, type SectionType } from "../sections/types";
import {
  LenientBusinessDataSchema,
  type ExtractedBusinessData,
} from "../style-match/autofill/types";
import type { AssembleTheme } from "../sections/assemble";
import type { SectionMode } from "../sections/types";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_MODEL_ID =
  process.env.ASSEMBLE_RECIPE_MODEL || process.env.STYLE_MATCH_TEXT_MODEL || "gemini-2.5-flash";
const MAX_TOKENS = 8_000;

// Fonts the model may pick from → their CSS stack + the Google-Fonts <link> the
// assembled page must load (the bind points every section at the theme font, so
// only these need loading). Names are what the model emits.
const FONT_CATALOG: Record<string, { stack: string; href: string }> = {
  Inter: { stack: "'Inter', sans-serif", href: "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" },
  Geist: { stack: "'Geist', sans-serif", href: "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap" },
  Manrope: { stack: "'Manrope', sans-serif", href: "https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" },
  "Space Grotesk": { stack: "'Space Grotesk', sans-serif", href: "https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&display=swap" },
  Sora: { stack: "'Sora', sans-serif", href: "https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700&display=swap" },
  "Hanken Grotesk": { stack: "'Hanken Grotesk', sans-serif", href: "https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&display=swap" },
  Fraunces: { stack: "'Fraunces', serif", href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600;9..144,700&display=swap" },
  "Instrument Serif": { stack: "'Instrument Serif', serif", href: "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&display=swap" },
};
const FONT_NAMES = Object.keys(FONT_CATALOG);

function resolveFont(name: string): { stack: string; href: string } {
  const hit = FONT_NAMES.find((n) => n.toLowerCase() === name.trim().toLowerCase());
  return FONT_CATALOG[hit ?? "Inter"];
}

const HEX = z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "must be a #hex colour");

const RecipeThemeSchema = z.object({
  mode: z.enum(["light", "dark", "cream"]),
  bg: HEX,
  surface: HEX,
  fg: HEX,
  border: HEX,
  accent: HEX,
  fontDisplay: z.string(),
  fontBody: z.string(),
  radius: z.string().optional(),
  rScale: z.union([z.string(), z.number()]).optional(),
});

export const RecipeSchema = z.object({
  theme: RecipeThemeSchema,
  sections: z
    .array(
      z.object({
        type: z.enum(SECTION_TYPES as unknown as [string, ...string[]]),
        variant: z.string().nullable().optional(),
      }),
    )
    .min(3),
  copy: LenientBusinessDataSchema,
});

export type Recipe = z.infer<typeof RecipeSchema>;

/** Pure: turn the model's chosen theme into the AssembleTheme the stitcher needs
 *  (resolve font names → CSS stacks + the Google-Fonts links to load). */
export function recipeToTheme(t: Recipe["theme"]): AssembleTheme {
  const display = resolveFont(t.fontDisplay);
  const body = resolveFont(t.fontBody);
  return {
    base: { bg: t.bg, surface: t.surface, fg: t.fg, border: t.border, accent: t.accent },
    mode: t.mode as SectionMode,
    fontDisplay: display.stack,
    fontBody: body.stack,
    radius: t.radius ?? "10px",
    rScale: t.rScale != null ? String(t.rScale) : "1",
    fontLinks: Array.from(new Set([display.href, body.href])),
  };
}

export const RECIPE_SYSTEM_PROMPT = `You are the page planner for OpenLen, a landing-page builder that ASSEMBLES a page from a library of pre-built section components. Given a brief, you output a RECIPE as STRICT JSON (no markdown, no prose).

Shape:
{
  "theme": {
    "mode": "light" | "dark" | "cream",
    "bg": "#hex", "surface": "#hex", "fg": "#hex", "border": "#hex", "accent": "#hex",
    "fontDisplay": <font name>, "fontBody": <font name>,
    "radius": "10px", "rScale": 1
  },
  "sections": [ { "type": <section type>, "variant": null }, ... ],
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

THEME RULES:
- Choose ONE coherent, accessible palette that fits the brief's industry and mood. bg/surface/fg must give legible contrast (dark mode = dark bg + light fg; light/cream = light bg + dark fg). One accent only.
- "fontDisplay" and "fontBody" MUST be chosen from EXACTLY this list: ${FONT_NAMES.join(", ")}. A serif display (Fraunces / Instrument Serif) reads editorial; sans (Inter / Geist / Manrope / Space Grotesk / Sora / Hanken Grotesk) reads modern/SaaS. They may be the same font.
- "radius": tight "4px"–"8px" for technical/SaaS, "12px"–"16px" for friendly, "0px" for bold/brutalist. "rScale" usually 1.

SECTIONS RULES:
- Output an ORDERED list of 6–8 sections TOTAL forming a FOCUSED landing page. ALWAYS start with "navbar", then "hero", and end with "footer". Choose 3–5 more types in between that best fit the brief.
- Favor a TIGHT, well-flowing page over a long one — do NOT include every possible type. A kitchen-sink page reads worse; quality and rhythm beat length.
- "type" MUST be one of: ${SECTION_TYPES.join(", ")}.
- Always set "variant": null (the server selects the best-matching variant).

COPY RULES (the opposite of a data-extraction task — you DO invent):
- INVENT a believable, specific, on-brand demo: a product/company name, a punchy tagline, a 1–2 sentence pitch, a hero_keyword, 3–6 concrete features, realistic pricing tiers IF the brief implies a paid product, 2–3 testimonials with fictional but plausible names/roles/companies, and 3–5 FAQ Q&As. Write natural CTAs.
- Be specific and confident (real metrics, real-sounding brand names) — this is a demo page, not a client's verified data. Avoid generic filler ("Lorem ipsum", "Your tagline here", "Feature one").
- Write everything in the brief's language; set "language_detected".

Return ONLY the JSON object.`;

export interface BuildRecipeOk {
  ok: true;
  recipe: Recipe;
  theme: AssembleTheme;
  sections: { type: SectionType; variant: string | null }[];
  copy: ExtractedBusinessData;
  raw: string;
  usage?: { inputTokens: number; outputTokens: number };
  durationMs: number;
}
export interface BuildRecipeErr {
  ok: false;
  error: { kind: "missing-key" | "api" | "parse" | "schema" | "aborted"; message: string };
  raw?: string;
  durationMs: number;
}
export type BuildRecipeResult = BuildRecipeOk | BuildRecipeErr;

function tryExtractJson(raw: string): unknown | null {
  const t = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
  try {
    return JSON.parse(t);
  } catch {
    const first = t.indexOf("{");
    const last = t.lastIndexOf("}");
    if (first >= 0 && last > first) {
      try {
        return JSON.parse(t.slice(first, last + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export async function buildRecipe(
  brief: string,
  opts?: { modelId?: string; signal?: AbortSignal; now?: number },
): Promise<BuildRecipeResult> {
  const t0 = opts?.now ?? Date.now();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { ok: false, error: { kind: "missing-key", message: "GEMINI_API_KEY not set" }, durationMs: 0 };
  }
  const modelId = opts?.modelId ?? DEFAULT_MODEL_ID;
  const url = `${GEMINI_BASE}/${modelId}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    systemInstruction: { parts: [{ text: RECIPE_SYSTEM_PROMPT }] },
    contents: [{ role: "user", parts: [{ text: `Brief:\n\n${brief.trim()}\n\nReturn the recipe JSON only.` }] }],
    generationConfig: {
      temperature: 0.7,
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
      signal: opts?.signal,
    });
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
  if (parsed === null) {
    return { ok: false, error: { kind: "parse", message: "could not parse JSON from model output" }, raw, durationMs: dur(t0, opts) };
  }
  const validated = RecipeSchema.safeParse(parsed);
  if (!validated.success) {
    return {
      ok: false,
      error: {
        kind: "schema",
        message: validated.error.issues.slice(0, 4).map((i) => `${i.path.join(".")}: ${i.message}`).join(" | "),
      },
      raw,
      durationMs: dur(t0, opts),
    };
  }

  const recipe = validated.data;
  return {
    ok: true,
    recipe,
    theme: recipeToTheme(recipe.theme),
    sections: recipe.sections.map((s) => ({ type: s.type as SectionType, variant: s.variant ?? null })),
    copy: recipe.copy,
    raw,
    usage,
    durationMs: dur(t0, opts),
  };
}

function dur(t0: number, opts?: { now?: number }): number {
  return (opts?.now ?? Date.now()) - t0;
}
