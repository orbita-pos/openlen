import { z } from "zod";

/** Targets OpenLen owns and hands out; the model never invents one. */
export const StableTargetIdSchema = z.string().regex(/^ol-[a-z0-9]+(?:-[a-z0-9]+)*$/).max(64);

const HtmlBody = z.string().max(120_000);
const Css = z.string().max(80_000);

export const CreativePatchSchema = z.object({
  operations: z.array(z.discriminatedUnion("op", [
    z.object({ op: z.literal("replace_section"), targetId: StableTargetIdSchema, html: HtmlBody, css: Css.optional() }),
    z.object({ op: z.literal("insert_section"), afterTargetId: StableTargetIdSchema.nullable(), role: z.string().max(48), html: HtmlBody, css: Css.optional() }),
    z.object({ op: z.literal("remove_section"), targetId: StableTargetIdSchema }),
    z.object({ op: z.literal("move_section"), targetId: StableTargetIdSchema, afterTargetId: StableTargetIdSchema.nullable() }),
    z.object({ op: z.literal("set_page_css"), css: z.string().max(120_000) }),
    z.object({ op: z.literal("set_link"), targetId: StableTargetIdSchema, url: z.string().max(2_048), label: z.string().max(240).optional() }),
  ])).min(1).max(12),
}).passthrough();

export type CreativePatchInput = z.infer<typeof CreativePatchSchema>;
export type CreativeOperation = CreativePatchInput["operations"][number];

export interface CreativeCanvasTarget {
  readonly targetId: string;
  readonly role: string;
  readonly tag: string;
  readonly textPreview: string;
}

export interface CreativeCanvasInspection {
  readonly outline: readonly CreativeCanvasTarget[];
  readonly imageSlots: readonly { readonly targetId: string; readonly filled: boolean }[];
  readonly pageCssBytes: number;
  readonly diagnostics: { readonly mobileOverflow: boolean; readonly invalidGeometry: boolean } | null;
}

export type CreativeToolFailureCode =
  | "invalid_patch"
  | "unknown_target"
  | "unsafe_url"
  | "unsafe_css"
  | "sanitization_failed"
  | "behaviors_invalid"
  | "seal_failed"
  | "render_failed";

export type CreativeToolResult =
  | { readonly ok: true; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly code: CreativeToolFailureCode; readonly detail?: string };

export function parseCreativePatch(value: unknown): { ok: true; patch: CreativePatchInput } | { ok: false } {
  const parsed = CreativePatchSchema.safeParse(value);
  return parsed.success ? { ok: true, patch: parsed.data } : { ok: false };
}
