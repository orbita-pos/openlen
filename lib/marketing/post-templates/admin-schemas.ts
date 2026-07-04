import { z } from "zod";

// Shared Zod schemas + invariant helpers for the post-template catalog.
// Calco of lib/templates/admin-schemas.ts slug rules.

export const POST_REGISTER = z.enum([
  "restaurante",
  "belleza",
  "gym",
  "consultorio",
  "tienda",
  "oficios",
  "general",
]);
export const POST_FORMAT = z.enum(["square", "story"]);
export const POST_GOAL = z.enum(["promo", "anuncio", "testimonio", "info"]);
export const POST_STATUS = z.enum(["draft", "published", "archived"]);

const SLUG = z.string().regex(
  /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/,
  "slug must be 1-32 chars, lowercase alphanumeric/hyphens",
);

export const PostCreateSchema = z.object({
  id: SLUG,
  name: z.string().min(1).max(80),
  register: POST_REGISTER,
  format: POST_FORMAT,
  goal: POST_GOAL,
  html: z.string().min(100),
  status: POST_STATUS.optional(),
});
export type PostCreateInput = z.infer<typeof PostCreateSchema>;

// data-slot-path is a reserved editor marker — must never enter the catalog
// (repo invariant #4, same check as templates).
export function htmlContainsEditorMarker(html: string): boolean {
  return html.includes("data-slot-path=");
}
