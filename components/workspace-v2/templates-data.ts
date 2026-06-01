// Workspace TemplatesPanel data layer.
//
// Family metadata (labels + taglines) is presentation-only and derived
// directly from the canonical TEMPLATE_FAMILY_META in lib/templates/families.ts
// so it can't drift. Per-template data is fetched live from /api/templates via
// the useTemplates() hook in `use-templates.ts`.

import {
  TEMPLATE_FAMILY_META,
  type TemplateFamily,
  type TemplateMode,
} from "@/lib/templates/families";

export type { TemplateFamily, TemplateMode } from "@/lib/templates/families";

export interface TemplateFamilyMeta {
  id: TemplateFamily;
  label: string;
  tagline: string;
}

// Derived from the canonical TEMPLATE_FAMILY_META so the workspace picker can
// never again drift from the schema/DB. The previous hand-maintained copy was
// stuck at 16 of 32 families and hid 56% of the published gallery.
export const TEMPLATE_FAMILIES: TemplateFamilyMeta[] = (
  Object.keys(TEMPLATE_FAMILY_META) as TemplateFamily[]
).map((id) => ({ id, ...TEMPLATE_FAMILY_META[id] }));

// Shape the TemplatesPanel cards consume. Derived from the API list
// response (id/name/pitch/family/accent/storageUrl/mode) plus a few
// presentation-only derivations like `previewUrl` (alias of storageUrl
// kept for backwards compat with the existing card code) and `tags`.
export interface TemplateSpec {
  id: string;
  family: TemplateFamily;
  name: string;
  pitch: string;
  description: string;
  tags: string[];
  /** Public URL to the HTML body — passed to <iframe src>. */
  previewUrl: string;
  /** Brand accent — surfaced in the card chrome for visual identity. */
  accent: string;
}

interface ApiListItem {
  id: string;
  name: string;
  family: TemplateFamily;
  accent: string;
  pitch: string;
  description: string;
  mode: TemplateMode;
  storageUrl: string;
  contentHash: string;
}

export function apiItemToSpec(t: ApiListItem): TemplateSpec {
  return {
    id: t.id,
    family: t.family,
    name: t.name,
    pitch: t.pitch,
    description: t.description,
    tags: [t.family, t.mode],
    previewUrl: t.storageUrl,
    accent: t.accent,
  };
}
