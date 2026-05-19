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

export type ImageMime = "image/jpeg" | "image/png";
