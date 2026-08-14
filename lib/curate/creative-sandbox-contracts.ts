import { z } from "zod";

import type { SafeCreativeCandidate } from "./ai-creation-contracts";

export const StableTargetId = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export const CreativePatchSchema = z.object({
  operations: z.array(z.discriminatedUnion("op", [
    z.object({ op: z.literal("replace_section"), targetId: StableTargetId, html: z.string().max(120_000), css: z.string().max(80_000).optional() }),
    z.object({ op: z.literal("insert_section"), afterTargetId: StableTargetId.nullable(), role: z.string().max(48), html: z.string().max(120_000), css: z.string().max(80_000).optional() }),
    z.object({ op: z.literal("remove_section"), targetId: StableTargetId }),
    z.object({ op: z.literal("move_section"), targetId: StableTargetId, afterTargetId: StableTargetId.nullable() }),
    z.object({ op: z.literal("set_page_css"), css: z.string().max(120_000) }),
    z.object({ op: z.literal("set_link"), targetId: StableTargetId, url: z.string().max(2_048), label: z.string().max(240).optional() }),
  ])).min(1).max(12),
}).passthrough();

export type CreativePatchInput = z.infer<typeof CreativePatchSchema>;

export interface CreativeCanvasTarget {
  readonly targetId: string;
  readonly role: string;
  readonly tagName: string;
}

export interface CreativeCanvasInspection {
  readonly title: string;
  readonly targets: readonly CreativeCanvasTarget[];
}

export type CreativeToolFailureCode =
  | "invalid_patch"
  | "target_not_found"
  | "duplicate_target"
  | "reserved_marker"
  | "unsafe_url"
  | "unsafe_css"
  | "sanitization_failed"
  | "seal_failed"
  | "render_failed";

export type CreativeToolResult =
  | { readonly ok: true; readonly candidate: SafeCreativeCandidate; readonly warnings: readonly string[] }
  | { readonly ok: false; readonly code: CreativeToolFailureCode; readonly warnings: readonly string[] };

export interface CreativeSandbox {
  current(): SafeCreativeCandidate;
  inspect(): CreativeCanvasInspection;
  applyPatch(input: CreativePatchInput): Promise<CreativeToolResult>;
  renderPreview(): Promise<CreativeToolResult>;
}
