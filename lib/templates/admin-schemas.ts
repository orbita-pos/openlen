import { z } from "zod";

import { detectSlotPath } from "@/lib/html-engine";
import { validatePageSlug } from "@/lib/projects/site-pages";

// Shared Zod schemas + invariant helpers for the admin template endpoints.
// Both POST (create / replace) and PUT (partial update) consume these so
// validation rules live in one place. The CLI under scripts/templates-add.ts
// validates against the same shape before dispatching to upsertTemplate().

export const FAMILY = z.enum([
  "technical-minimal",
  "editorial",
  "commerce",
  "documentation",
  "saas",
  "ai-ml",
  "fintech",
  "health-tech",
  "portfolio",
  "pre-launch",
  "event",
  "agency",
  "real-estate",
  "architecture",
  "hospitality",
  "ecommerce",
  "climate",
  "mobile-app",
  "education",
  "creator",
  "open-source",
  "music",
  "gaming",
  "local-services",
  "nonprofit",
  "wellness",
  "web3",
  "hardware",
  "aerospace",
  "podcast",
  "wedding",
  "travel",
  "food-beverage",
  "fashion",
]);
export const MODE = z.enum(["dark", "light", "cream"]);
export const STATUS = z.enum(["draft", "published", "archived"]);

// Slug rules: lowercase alphanumeric + hyphens, no leading/trailing hyphens,
// 1-32 chars. The slug is both the URL segment (/templates/<slug>) and the
// storage-key prefix (templates/<slug>-<hash>.html), so we keep it strict.
export const SLUG = z.string().regex(
  /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/,
  "slug must be 1-32 chars, lowercase alphanumeric/hyphens, no leading/trailing hyphens",
);

export const HEX_COLOR = z.string().regex(
  /^#[0-9a-fA-F]{6}$/,
  "accent must be #RRGGBB hex",
);

// Upper bound on the HTML body. Curated templates we've seen so far run
// 35-80KB; 500KB is generous headroom but rejects pathological payloads.
export const MAX_HTML_BYTES = 500_000;

export const HTML = z
  .string()
  .min(20, "html body looks empty")
  .max(MAX_HTML_BYTES, `html exceeds ${MAX_HTML_BYTES} bytes`);

// Extra pages for a MULTI-PAGE template. Each {slug, html}; slugs are validated
// against the SAME rules + reserved set as user site-pages (validatePageSlug —
// rejects "api", "assets", locale codes, etc.) and must be unique within the
// array, so a cloned template can never collide with a system/locale path.
export const PAGES = z
  .array(z.object({ slug: SLUG, html: HTML }))
  .max(20, "at most 20 extra pages")
  .superRefine((arr, ctx) => {
    const seen = new Set<string>();
    arr.forEach((p, i) => {
      const v = validatePageSlug(p.slug);
      if (!v.ok || v.slug !== p.slug) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `page slug "${p.slug}" is invalid or reserved`,
          path: [i, "slug"],
        });
      }
      if (seen.has(p.slug)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate page slug "${p.slug}"`,
          path: [i, "slug"],
        });
      }
      seen.add(p.slug);
    });
  });

// Full create / replace payload — every field required.
export const CreateSchema = z.object({
  id: SLUG,
  name: z.string().min(1).max(80),
  family: FAMILY,
  accent: HEX_COLOR,
  pitch: z.string().min(1).max(200),
  description: z.string().min(1).max(500),
  mode: MODE,
  html: HTML,
  // Extra pages for a multi-page template — each cloned into data.pages.
  pages: PAGES.optional(),
  status: STATUS.optional(),
});
export type CreateTemplateInput = z.infer<typeof CreateSchema>;

// Partial-update payload — every field optional. id comes from the URL,
// not the body. At least one field must be present.
export const UpdateSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    family: FAMILY.optional(),
    accent: HEX_COLOR.optional(),
    pitch: z.string().min(1).max(200).optional(),
    description: z.string().min(1).max(500).optional(),
    mode: MODE.optional(),
    html: HTML.optional(),
    pages: PAGES.optional(),
    status: STATUS.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "at least one field must be present",
  });
export type UpdateTemplateInput = z.infer<typeof UpdateSchema>;

// Same defense-in-depth check publishToDir() does: editor-mode markers
// from the workspace must never reach storage. Routed through the Rust-
// backed `detectSlotPath` so we catch mixed-case / entity-encoded /
// whitespace-around-equals variants the inline `String.includes` missed.
export function htmlContainsEditorMarker(html: string): boolean {
  return detectSlotPath(html);
}
