// First-party showcase account + curated Explore seed manifest.
//
// Honest seed of /explore: our own best templates, published for real and
// remixable, under ONE clearly first-party account. Not fake personas.

export const SHOWCASE = {
  id: "showcase-openlen",
  email: "showcase@openlen.com",
  name: "Hecho con OpenLen",
  handle: "openlen",
  avatarUrl: "https://openlen.com/icon-192.png",
  bio: "Páginas de ejemplo hechas con OpenLen. Ábrelas y remixéalas.",
} as const;

export type SeedEntry = { templateId: string; subdomain: string };

// 24 hand-picked published templates, one per family for maximum variety
// (★ = template store's `featured` top-tier flag). Subdomain rule:
// `<templateId>-demo` — namespaced so bare premium slugs stay free for real
// users. Final visual curation happens in the approval gallery before any
// prod publish; swap ids here if one looks weak.
export const SEED_ENTRIES: SeedEntry[] = [
  { templateId: "exodus", subdomain: "exodus-demo" }, // aerospace ★
  { templateId: "obra", subdomain: "obra-demo" }, // architecture ★
  { templateId: "luma", subdomain: "luma-demo" }, // cinema ★
  { templateId: "lume", subdomain: "lume-demo" }, // ecommerce ★
  { templateId: "mundial-26", subdomain: "mundial-26-demo" }, // event ★
  { templateId: "liebre", subdomain: "liebre-demo" }, // fashion ★
  { templateId: "aetherborn", subdomain: "aetherborn-demo" }, // gaming ★
  { templateId: "avenir", subdomain: "avenir-demo" }, // hardware ★
  { templateId: "atrium", subdomain: "atrium-demo" }, // agency
  { templateId: "aiml-dark", subdomain: "aiml-dark-demo" }, // ai-ml
  { templateId: "tideline", subdomain: "tideline-demo" }, // climate
  { templateId: "counter", subdomain: "counter-demo" }, // commerce
  { templateId: "manuscript", subdomain: "manuscript-demo" }, // editorial
  { templateId: "atlas", subdomain: "atlas-demo" }, // documentation
  { templateId: "atelier", subdomain: "atelier-demo" }, // education
  { templateId: "reservoir", subdomain: "reservoir-demo" }, // fintech
  { templateId: "crumb", subdomain: "crumb-demo" }, // food-beverage
  { templateId: "hearth", subdomain: "hearth-demo" }, // health-tech
  { templateId: "halcyon-lodge", subdomain: "halcyon-lodge-demo" }, // hospitality
  { templateId: "fade-and-co", subdomain: "fade-and-co-demo" }, // local-services
  { templateId: "ribbon", subdomain: "ribbon-demo" }, // mobile-app
  { templateId: "solstice", subdomain: "solstice-demo" }, // music
  { templateId: "headwaters", subdomain: "headwaters-demo" }, // nonprofit
  { templateId: "bio-priyarose", subdomain: "bio-priyarose-demo" }, // creator
];
