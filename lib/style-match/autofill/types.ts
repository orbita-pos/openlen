// Shared types for the autofill feature — image → JSON → fill flow.
// Both the CLI smoke tests and the production API route use these.

import { z } from "zod";

export const ExtractedBusinessDataSchema = z.object({
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

export type ExtractedBusinessData = z.infer<typeof ExtractedBusinessDataSchema>;

// ── lenient (invent-mode) variant ────────────────────────────────────────────
// The strict schema requires every key PRESENT (nullable ≠ optional). That's
// right for extraction, but a model that INVENTS copy (recipe / curation) may
// legitimately omit a field (e.g. tagline_es when writing in English). This
// variant coerces a partial/omitted object into a full ExtractedBusinessData
// (nullable strings → null, arrays → [], partial inner objects patched) and
// then validates. Use it when parsing an invent-copy model response.

function asStr(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function asStrOrNull(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function asArr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

export function coerceBusinessData(raw: unknown): ExtractedBusinessData {
  const r = asObj(raw);
  return {
    business_name: asStrOrNull(r.business_name),
    industry: asStrOrNull(r.industry),
    tagline_es: asStrOrNull(r.tagline_es),
    tagline_en: asStrOrNull(r.tagline_en),
    pitch: asStrOrNull(r.pitch),
    hero_keyword: asStrOrNull(r.hero_keyword),
    features: asArr(r.features).map((f) => ({ title: asStr(asObj(f).title), desc: asStr(asObj(f).desc) })),
    pricing: asArr(r.pricing).map((p) => {
      const o = asObj(p);
      return { name: asStr(o.name), price: asStrOrNull(o.price), period: asStrOrNull(o.period), features: asArr(o.features).map(asStr) };
    }),
    testimonials: asArr(r.testimonials).map((t) => {
      const o = asObj(t);
      return { name: asStr(o.name), role: asStrOrNull(o.role), company: asStrOrNull(o.company), quote: asStr(o.quote) };
    }),
    cta_primary: asStrOrNull(r.cta_primary),
    cta_secondary: asStrOrNull(r.cta_secondary),
    faq_questions: asArr(r.faq_questions).map((q) => {
      const o = asObj(q);
      return { q: asStr(o.q), a: asStr(o.a) };
    }),
    language_detected: asStrOrNull(r.language_detected),
  };
}

/** Invent-mode copy schema: tolerates omitted fields, always yields a full
 *  ExtractedBusinessData. */
export const LenientBusinessDataSchema = z.preprocess(coerceBusinessData, ExtractedBusinessDataSchema);

export type ImageMime = "image/jpeg" | "image/png";
