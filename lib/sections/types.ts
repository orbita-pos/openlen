// Client-safe section types + metadata. Zero node imports — safe to import
// from client components (mirrors lib/templates/families.ts). The section
// LIBRARY is typed by SECTION TYPE (hero/pricing/...), not by design family:
// a section's look is re-themed to the host page on insert, so the only axis
// the gallery groups by is what the section IS.

export const SECTION_TYPES = [
  "navbar",
  "hero",
  "logos",
  "features",
  "stats",
  "how-it-works",
  "testimonials",
  "pricing",
  "comparison",
  "integrations",
  "gallery",
  "faq",
  "about",
  "team",
  "contact",
  "cta",
  "footer",
] as const;

export type SectionType = (typeof SECTION_TYPES)[number];

export type SectionMode = "dark" | "light" | "cream";
export type SectionStatus = "draft" | "published" | "archived";

export interface SectionTypeMeta {
  /** Display label for the gallery group header. */
  label: string;
  /** Sort order in the gallery — roughly top-of-page → bottom-of-page. */
  order: number;
}

// Order mirrors a typical landing-page flow so the gallery reads top→bottom.
export const SECTION_TYPE_META: Record<SectionType, SectionTypeMeta> = {
  navbar: { label: "Navbar", order: 1 },
  hero: { label: "Hero", order: 2 },
  logos: { label: "Logo cloud", order: 3 },
  features: { label: "Features", order: 4 },
  stats: { label: "Stats", order: 5 },
  "how-it-works": { label: "How it works", order: 6 },
  testimonials: { label: "Testimonials", order: 7 },
  pricing: { label: "Pricing", order: 8 },
  comparison: { label: "Comparison", order: 9 },
  integrations: { label: "Integrations", order: 10 },
  gallery: { label: "Gallery", order: 11 },
  faq: { label: "FAQ", order: 12 },
  about: { label: "About", order: 13 },
  team: { label: "Team", order: 14 },
  contact: { label: "Contact", order: 15 },
  cta: { label: "CTA", order: 16 },
  footer: { label: "Footer", order: 17 },
};

export function isSectionType(v: string): v is SectionType {
  return (SECTION_TYPES as readonly string[]).includes(v);
}
