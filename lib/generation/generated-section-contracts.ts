import { z } from "zod";

import { canonicalJsonSha256 } from "./content-hash";
import { SectionPlanRowSchema } from "./section-composition-contracts";
import type { SectionType } from "@/lib/sections/types";

export {
  ExpressiveSectionProgramSchema,
  MotionPresetSchema,
  ResponsiveProgramSchema,
  SectionDecisionProvenanceSchema,
  validateExpressiveSectionProgram,
} from "./expressive-section-contracts";
export type {
  DecorationNode,
  ExpressiveNode,
  ExpressiveSectionProgram,
  LayoutNode,
  MediaNode,
  MotionPreset,
  ResponsiveProgram,
  SectionDecisionProvenance,
} from "./expressive-section-contracts";

const CopyKeySchema = z.string().min(1).max(80).regex(/^[a-z][a-z0-9_.-]*$/);
const GeneratedBlockSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("heading"), copyKey: CopyKeySchema }).strict(),
  z.object({ kind: z.literal("body"), copyKey: CopyKeySchema }).strict(),
  z.object({ kind: z.literal("cards"), copyKeys: z.array(CopyKeySchema).min(2).max(8) }).strict(),
  z.object({ kind: z.literal("media"), slotIndex: z.number().int().min(0).max(11) }).strict(),
  z.object({ kind: z.literal("actions"), copyKeys: z.array(CopyKeySchema).min(1).max(2) }).strict(),
]);

export const GeneratedSectionSpecSchema = z.object({
  schemaVersion: z.literal("generated-section-spec/1.0"),
  role: SectionPlanRowSchema.shape.requestedRole,
  layout: z.enum(["split", "centered", "grid", "editorial", "gallery", "timeline", "marquee", "stacked_cards"]),
  blocks: z.array(GeneratedBlockSchema).min(2).max(10),
  geometry: z.object({
    density: z.enum(["airy", "balanced", "dense"]),
    emphasis: z.enum(["copy", "media", "balanced"]),
  }).strict(),
}).strict();

export type GeneratedSectionSpec = z.infer<typeof GeneratedSectionSpecSchema>;

export interface GeneratedSectionDraft {
  id: string;
  html: string;
  role: GeneratedSectionSpec["role"];
  specHash: string;
  rootTag: "nav" | "header" | "section" | "footer";
}

export function validateGeneratedSectionReferences(
  input: unknown,
  allowed: { copyKeys: readonly string[]; assetSlots: readonly number[] },
): input is GeneratedSectionSpec {
  const parsed = GeneratedSectionSpecSchema.safeParse(input);
  if (!parsed.success) return false;
  const copyKeys = new Set(allowed.copyKeys);
  const assetSlots = new Set(allowed.assetSlots);
  const usedSlots = new Set<number>();
  for (const block of parsed.data.blocks) {
    if (block.kind === "media") {
      if (!assetSlots.has(block.slotIndex) || usedSlots.has(block.slotIndex)) return false;
      usedSlots.add(block.slotIndex);
      continue;
    }
    const keys = "copyKey" in block ? [block.copyKey] : "copyKeys" in block ? block.copyKeys : [];
    if (keys.some((key) => !copyKeys.has(key))) return false;
  }
  return true;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const LAYOUT_CLASS: Record<GeneratedSectionSpec["layout"], string> = {
  split: "ol-gen-split", centered: "ol-gen-centered", grid: "ol-gen-grid",
  editorial: "ol-gen-editorial", gallery: "ol-gen-gallery", timeline: "ol-gen-timeline",
  marquee: "ol-gen-marquee", stacked_cards: "ol-gen-stacked",
};

export function renderGeneratedSectionDraft(
  input: GeneratedSectionSpec,
  copy: Readonly<Record<string, string>>,
  componentType?: SectionType,
): GeneratedSectionDraft {
  const spec = GeneratedSectionSpecSchema.parse(input);
  const specHash = canonicalJsonSha256(spec);
  const id = `generated-${componentType ?? spec.role}-${spec.role}-${specHash.replace(/^sha256:/, "").slice(0, 12)}`;
  const rootTag = componentType === "navbar" ? "nav" : componentType === "footer" ? "footer" : componentType === "hero" ? "header" : "section";
  const blocks = spec.blocks.map((block) => {
    if (block.kind === "heading") return `<h2 class="ol-gen-heading">${escapeHtml(copy[block.copyKey] ?? "")}</h2>`;
    if (block.kind === "body") return `<p class="ol-gen-body">${escapeHtml(copy[block.copyKey] ?? "")}</p>`;
    if (block.kind === "cards") return `<div class="ol-gen-cards">${block.copyKeys.map((key) => `<article class="ol-gen-card"><p>${escapeHtml(copy[key] ?? "")}</p></article>`).join("")}</div>`;
    if (block.kind === "actions") return `<div class="ol-gen-actions">${block.copyKeys.map((key) => `<button type="button" class="ol-gen-action">${escapeHtml(copy[key] ?? "")}</button>`).join("")}</div>`;
    return `<div class="ol-gen-media" data-openlen-asset-slot="${block.slotIndex}" aria-hidden="true"></div>`;
  }).join("");
  const html = `<style>[data-sec="${id}"]{display:grid;gap:var(--space-6,1.5rem);padding:var(--space-8,2rem);background:var(--surface);color:var(--ink);border-radius:var(--radius)}[data-sec="${id}"] .ol-gen-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(12rem,1fr));gap:var(--space-4,1rem)}[data-sec="${id}"] .ol-gen-card{padding:var(--space-4,1rem);background:var(--bg);border:1px solid var(--line);border-radius:var(--radius)}[data-sec="${id}"] .ol-gen-media{min-height:12rem;background:var(--surface);border-radius:var(--radius)}</style><${rootTag} data-sec="${id}" data-openlen-generated="generated-section-spec/1.0" class="${LAYOUT_CLASS[spec.layout]}" data-density="${spec.geometry.density}" data-emphasis="${spec.geometry.emphasis}">${blocks}</${rootTag}>`;
  return { id, html, role: spec.role, specHash, rootTag };
}
