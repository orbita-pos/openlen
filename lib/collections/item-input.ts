// Validation for a collection item + the collection config — shared by the
// owner create/update routes. Bounds keep a malformed item from bloating the
// baked page; ctaUrl/imageUrl are scheme-allow-listed here AND escaped at bake.

import { z } from "zod";

export const PRESETS = ["products", "menu", "listings", "events", "team", "portfolio"] as const;

// Link-out target for a CTA: http(s), mailto, tel, site-relative, or on-page
// anchor. Anything else (javascript:, data:, vbscript:) is rejected here — and
// the bake escapes the value into the href regardless (defense in depth).
const safeHref = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => /^(https?:\/\/|mailto:|tel:|\/(?!\/)|#)/i.test(v), {
    message: "unsupported or unsafe link",
  });

// Image source: an https URL or a site-relative path (the asset picker emits
// /uploads/… or /assets/… and R2 https URLs).
const imageSrc = z
  .string()
  .trim()
  .max(2000)
  .refine((v) => /^(https?:\/\/|\/(?!\/))/i.test(v), {
    message: "image must be an https URL or a site path",
  });

export const itemInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  subtitle: z.string().trim().max(160).nullish(),
  description: z.string().trim().max(2000).nullish(),
  imageUrl: imageSrc.nullish(),
  priceDisplay: z.string().trim().max(80).nullish(), // informational — never charged
  badge: z.string().trim().max(24).nullish(),
  ctaLabel: z.string().trim().max(40).nullish(),
  ctaUrl: safeHref.nullish(),
  tags: z.array(z.string().trim().min(1).max(24)).max(8).optional(),
  attrs: z.record(z.string().max(60), z.string().max(500)).optional(),
  status: z.enum(["published", "archived"]).optional(),
  sortOrder: z.number().int().min(0).max(9999).optional(),
});

export type ItemInputParsed = z.infer<typeof itemInputSchema>;

/** Create requires the full object; updates patch a subset. */
export const itemUpdateSchema = itemInputSchema.partial();

/** The collection-level config (the single v1 list): name + preset + layout. */
export const collectionConfigSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(500).nullish(),
  preset: z.enum(PRESETS).optional(),
  layout: z.enum(["grid", "list"]).optional(),
});

export type CollectionConfigParsed = z.infer<typeof collectionConfigSchema>;
