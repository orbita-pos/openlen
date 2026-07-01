import { z } from "zod";

// Shared Zod schemas + invariant helpers for the admin model endpoints.
// Both POST (create / replace) and PUT (partial update) consume these so
// validation rules live in one place. The CLI under scripts/models-add.ts
// validates against the same shape before dispatching to upsertModel().

export const FAMILY = z.enum([
  "product",
  "decorative",
  "prop",
  "character",
  "mechanical",
]);

export const STATUS = z.enum(["draft", "published", "archived"]);

// Slug rules: lowercase alphanumeric + hyphens, no leading/trailing hyphens,
// 1-32 chars. The slug is both the URL segment (/models/<slug>) and the
// storage-key prefix (models/<slug>-<hash>.glb), so we keep it strict.
export const SLUG = z.string().regex(
  /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/,
  "slug must be 1-32 chars, lowercase alphanumeric/hyphens, no leading/trailing hyphens",
);

// GLB binary. 100 B minimum (rejects empty/stub files); 100 MB maximum
// (curated models should be well under this, but provides headroom for
// high-poly assets).
export const MIN_GLB_BYTES = 100;
export const MAX_GLB_BYTES = 100 * 1024 * 1024; // 100 MB

export const GLB = z
  .instanceof(Buffer)
  .refine(
    (b) => b.byteLength >= MIN_GLB_BYTES,
    `glb must be at least ${MIN_GLB_BYTES} bytes`,
  )
  .refine(
    (b) => b.byteLength <= MAX_GLB_BYTES,
    `glb exceeds ${MAX_GLB_BYTES} bytes`,
  );

// Full create / replace payload — every required field present.
export const CreateSchema = z.object({
  id: SLUG,
  name: z.string().min(1).max(80),
  family: FAMILY,
  author: z.string().min(1).max(120).optional(),
  pitch: z.string().min(1).max(200),
  description: z.string().min(1).max(500),
  glb: GLB,
  sceneSpec: z.record(z.unknown()).optional(),
  tags: z.array(z.string().min(1).max(40)).max(10).optional(),
  license: z.string().min(1).max(40).optional(),
  status: STATUS.optional(),
});
export type CreateModelInput = z.infer<typeof CreateSchema>;

// Partial-update payload — every field optional. id comes from the URL,
// not the body. At least one field must be present.
export const UpdateSchema = z
  .object({
    name: z.string().min(1).max(80).optional(),
    family: FAMILY.optional(),
    author: z.string().min(1).max(120).optional(),
    pitch: z.string().min(1).max(200).optional(),
    description: z.string().min(1).max(500).optional(),
    glb: GLB.optional(),
    sceneSpec: z.record(z.unknown()).optional(),
    tags: z.array(z.string().min(1).max(40)).max(10).optional(),
    license: z.string().min(1).max(40).optional(),
    status: STATUS.optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "at least one field must be present",
  });
export type UpdateModelInput = z.infer<typeof UpdateSchema>;
