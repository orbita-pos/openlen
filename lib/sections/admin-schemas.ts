import { z } from "zod";

import { detectSlotPath } from "@/lib/html-engine";
import { SECTION_TYPES } from "./types";

// Shared Zod schemas + invariant helpers for the section library — consumed
// by the seed CLI (and, later, the admin endpoints). Mirrors the contract in
// lib/templates/admin-schemas.ts but for section FRAGMENTS, not full pages.

export const SECTION_TYPE = z.enum(SECTION_TYPES);
export const MODE = z.enum(["dark", "light", "cream"]);
export const STATUS = z.enum(["draft", "published", "archived"]);

// A section's stored root can be any of these; the scoper records which one
// wraps the content so the insert/op layer knows what it's addressing.
export const ROOT_TAG = z.enum([
  "section",
  "header",
  "footer",
  "nav",
  "main",
  "article",
  "aside",
  "div",
]);

// Slug: <type>-<NN>, e.g. "pricing-03", "how-it-works-01". Same rules as the
// template slug (lowercase alphanumeric + hyphens, no leading/trailing
// hyphen) — it's both an id and the storage-key prefix (sections/<slug>-…).
export const SLUG = z.string().regex(
  /^[a-z0-9](?:[a-z0-9-]{0,46}[a-z0-9])?$/,
  "slug must be 1-48 chars, lowercase alphanumeric/hyphens, no leading/trailing hyphens",
);

// Sections are fragments (a single <section>/<header>/<footer> + its scoped
// <style>), so they're smaller than full templates. 200KB is generous.
export const MAX_HTML_BYTES = 200_000;

export const HTML = z
  .string()
  .min(20, "html body looks empty")
  .max(MAX_HTML_BYTES, `html exceeds ${MAX_HTML_BYTES} bytes`);

export const CreateSectionSchema = z.object({
  id: SLUG,
  type: SECTION_TYPE,
  name: z.string().min(1).max(100),
  variantLabel: z.string().min(1).max(80),
  rootTag: ROOT_TAG,
  mode: MODE.optional(),
  html: HTML,
  // Parsed :root custom properties (--accent / --font-display / --radius …)
  // so the re-theme path knows which tokens to remap. Free-form string map.
  designTokens: z.record(z.string(), z.string()).optional(),
  // Google-Fonts stylesheet hrefs the section relies on; the insert path
  // hoists these into the host <head>.
  fonts: z.string().array().optional(),
  needsJs: z.boolean().optional(),
  hasPlaceholders: z.boolean().optional(),
  status: STATUS.optional(),
});
export type CreateSectionInput = z.infer<typeof CreateSectionSchema>;

// Same defense-in-depth as publishToDir() / templates: editor-mode markers
// must never reach storage. Routed through the Rust-backed detector to catch
// mixed-case / entity-encoded variants.
export function htmlContainsEditorMarker(html: string): boolean {
  return detectSlotPath(html);
}
