// Workspace TemplatesPanel data layer.
//
// Family metadata is presentation-only (labels + taglines) and lives here
// as a static array — translating from store's TEMPLATE_FAMILY_META, which
// is canonical. Per-template data is fetched live from /api/templates via
// the useTemplates() hook in `use-templates.ts`.

import type {
  TemplateFamily,
  TemplateMode,
} from "@/lib/templates/families";

export type { TemplateFamily, TemplateMode } from "@/lib/templates/families";

export interface TemplateFamilyMeta {
  id: TemplateFamily;
  label: string;
  tagline: string;
}

export const TEMPLATE_FAMILIES: TemplateFamilyMeta[] = [
  {
    id: "technical-minimal",
    label: "Technical Minimal",
    tagline:
      "Dark, mono accents, terminal mockups. For devtools and infra.",
  },
  {
    id: "editorial",
    label: "Editorial",
    tagline:
      "Serif headlines, numbered sections, magazine rhythm. For premium and craft brands.",
  },
  {
    id: "commerce",
    label: "Commerce",
    tagline:
      "Modern retail tech, payment flows, product mockups. For POS and marketplace.",
  },
];

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
