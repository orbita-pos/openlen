// Adapter: maps `components/templates/_registry.ts` (the source-of-truth
// for the 15 curated HTML templates) into the shape the workspace's
// TemplatesPanel expects (cards with previewUrl, family grouping, etc.).
//
// History: this file used to carry a parallel TemplateSpec definition with
// hardcoded compositions of primitive blocks. With the move to pure-HTML
// templates that approach was obsolete; we now derive everything from the
// canonical registry so adding a new curated template means editing ONE
// file, not two.

import {
  TEMPLATES,
  TEMPLATE_FAMILY_META,
  templatePreviewUrl,
  type TemplateEntry,
  type TemplateFamily,
} from "@/components/templates/_registry";

export type { TemplateFamily } from "@/components/templates/_registry";

export interface TemplateFamilyMeta {
  id: TemplateFamily;
  label: string;
  tagline: string;
}

export const TEMPLATE_FAMILIES: TemplateFamilyMeta[] = (
  Object.entries(TEMPLATE_FAMILY_META) as Array<
    [TemplateFamily, { label: string; tagline: string }]
  >
).map(([id, meta]) => ({ id, ...meta }));

export interface TemplateSpec {
  id: string;
  family: TemplateFamily;
  name: string;
  pitch: string;
  description: string;
  tags: string[];
  previewUrl: string;
  /** Display-only hint of the template's accent — surfaced in the card
   *  chrome for visual identity. */
  accent: string;
}

function toSpec(t: TemplateEntry): TemplateSpec {
  return {
    id: t.id,
    family: t.family,
    name: t.name,
    pitch: t.pitch,
    description: t.description,
    tags: [t.family, t.mode],
    previewUrl: templatePreviewUrl(t),
    accent: t.accent,
  };
}

export const TEMPLATE_SPECS: TemplateSpec[] = TEMPLATES.map(toSpec);

export function templatesByFamily(family: TemplateFamily): TemplateSpec[] {
  return TEMPLATE_SPECS.filter((t) => t.family === family);
}
