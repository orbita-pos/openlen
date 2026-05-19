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
  {
    id: "documentation",
    label: "Documentation",
    tagline:
      "Side-nav, code blocks, callouts. For SDKs, APIs, and developer references.",
  },
  {
    id: "saas",
    label: "SaaS",
    tagline:
      "Long-form marketing pages with social proof, pricing, and conversion sections.",
  },
  {
    id: "ai-ml",
    label: "AI / ML",
    tagline:
      "Model playgrounds, eval dashboards, agent traces. For LLM and ML products.",
  },
  {
    id: "fintech",
    label: "Fintech",
    tagline:
      "Banking, payments, trading. Trust signals, tabular numbers, regulatory badges.",
  },
  {
    id: "health-tech",
    label: "Health-tech",
    tagline:
      "Telehealth, fitness, mental health, EHR. Calmer typography, warm accents, clinical trust signals.",
  },
  {
    id: "portfolio",
    label: "Portfolio",
    tagline:
      "Personal home page — name + work + writing + contact. Quieter, typography-driven, no pricing.",
  },
  {
    id: "pre-launch",
    label: "Pre-launch",
    tagline:
      "Single-purpose teaser. Display headline + waitlist input + optional countdown. Hype-building.",
  },
  {
    id: "event",
    label: "Event",
    tagline:
      "Conferences, workshops, meetups. Schedule grids, speaker cards, ticket tiers.",
  },
  {
    id: "agency",
    label: "Agency / Studio",
    tagline:
      "Brand studios, dev shops, motion houses. Case-study heavy, restrained voice, team-focused.",
  },
  {
    id: "real-estate",
    label: "Real Estate",
    tagline:
      "Property listings, agents, brokerages. Photo galleries, map views, comparable sales.",
  },
  {
    id: "hospitality",
    label: "Hospitality",
    tagline:
      "Restaurants, hotels, cafés. Menus, reservations, ambient photography, chef and owner stories.",
  },
  {
    id: "ecommerce",
    label: "E-commerce",
    tagline:
      "Single-product DTC landings. Multiple images, variants, size guides, reviews, add-to-cart.",
  },
  {
    id: "climate",
    label: "Climate / Sustainability",
    tagline:
      "Carbon accounting, ESG dashboards, climate tech. Emission charts, supply chain maps, certification badges.",
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
