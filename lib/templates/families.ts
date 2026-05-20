// Pure data — types + family metadata. Has NO node imports so it can be
// imported from client components without dragging fs/crypto into the
// browser bundle. The server-only store.ts re-exports these so existing
// `from "@/lib/templates/store"` imports continue to work.

export type TemplateFamily =
  | "technical-minimal"
  | "editorial"
  | "commerce"
  | "documentation"
  | "saas"
  | "ai-ml"
  | "fintech"
  | "health-tech"
  | "portfolio"
  | "pre-launch"
  | "event"
  | "agency"
  | "real-estate"
  | "hospitality"
  | "ecommerce"
  | "climate"
  | "mobile-app"
  | "education"
  | "creator"
  | "open-source"
  | "music";

export type TemplateMode = "dark" | "light" | "cream";
export type TemplateStatus = "draft" | "published" | "archived";

export const TEMPLATE_FAMILY_META: Record<
  TemplateFamily,
  { label: string; tagline: string }
> = {
  "technical-minimal": {
    label: "Technical Minimal",
    tagline:
      "Dark, mono accents, terminal mockups. For devtools and infra.",
  },
  editorial: {
    label: "Editorial",
    tagline:
      "Serif headlines, numbered sections, magazine rhythm. For premium and craft brands.",
  },
  commerce: {
    label: "Commerce",
    tagline:
      "Modern retail tech, payment flows, product mockups. For POS and marketplace.",
  },
  documentation: {
    label: "Documentation",
    tagline:
      "Side-nav, code blocks, callouts. For SDKs, APIs, and developer references.",
  },
  saas: {
    label: "SaaS",
    tagline:
      "Long-form marketing pages with social proof, pricing, and conversion sections.",
  },
  "ai-ml": {
    label: "AI / ML",
    tagline:
      "Model playgrounds, eval dashboards, agent traces. For LLM and ML products.",
  },
  fintech: {
    label: "Fintech",
    tagline:
      "Banking, payments, trading. Trust signals, tabular numbers, regulatory badges.",
  },
  "health-tech": {
    label: "Health-tech",
    tagline:
      "Telehealth, fitness, mental health, EHR. Calmer typography, warm accents, clinical trust signals.",
  },
  portfolio: {
    label: "Portfolio",
    tagline:
      "Personal home page — name + work + writing + contact. Quieter, typography-driven, no pricing.",
  },
  "pre-launch": {
    label: "Pre-launch",
    tagline:
      "Single-purpose teaser. Display headline + waitlist input + optional countdown. Hype-building.",
  },
  event: {
    label: "Event",
    tagline:
      "Conferences, workshops, meetups. Schedule grids, speaker cards, ticket tiers.",
  },
  agency: {
    label: "Agency / Studio",
    tagline:
      "Brand studios, dev shops, motion houses. Case-study heavy, restrained voice, team-focused.",
  },
  "real-estate": {
    label: "Real Estate",
    tagline:
      "Property listings, agents, brokerages. Photo galleries, map views, comparable sales.",
  },
  hospitality: {
    label: "Hospitality",
    tagline:
      "Restaurants, hotels, cafés. Menus, reservations, ambient photography, chef and owner stories.",
  },
  ecommerce: {
    label: "E-commerce",
    tagline:
      "Single-product DTC landings. Multiple images, variants, size guides, reviews, add-to-cart.",
  },
  climate: {
    label: "Climate / Sustainability",
    tagline:
      "Carbon accounting, ESG dashboards, climate tech. Emission charts, supply chain maps, certification badges.",
  },
  "mobile-app": {
    label: "Mobile App",
    tagline:
      "Consumer iOS / Android apps. Phone mockups as hero, App Store + Google Play badges, star ratings, B2C-friendly chroma.",
  },
  education: {
    label: "Course / Education",
    tagline:
      "Online courses, cohorts, bootcamps, workshops, memberships. Syllabus grids, instructor bios, enrollment urgency.",
  },
  creator: {
    label: "Creator / Link-in-bio",
    tagline:
      "Single-page link hubs — avatar, bio, vertical button stack. For musicians, podcasters, writers, and creators.",
  },
  "open-source": {
    label: "Open Source",
    tagline:
      "OSS project home pages — install command, code examples, GitHub stars, contributor community. For frameworks, libraries, and tools.",
  },
  music: {
    label: "Music / Release",
    tagline:
      "Album and EP release pages — giant album art, tracklist, streaming badges, tour dates, press quotes, merch.",
  },
};
