export const TAXONOMY_COMPATIBILITY_VERSION =
  "taxonomy-compatibility/1.0" as const;

export type CompatibilityKind = "exact" | "alias" | "structural" | "soft" | "none";

export interface Compatibility {
  kind: CompatibilityKind;
  score: number;
  ruleId: string | null;
}

const NONE: Compatibility = { kind: "none", score: 0, ruleId: null };

const DOMAIN_ALIASES: Readonly<Record<string, string>> = {
  ai_ml: "ai_ml",
  artificial_intelligence: "ai_ml",
  e_commerce: "ecommerce",
  ecommerce: "ecommerce",
  food_and_beverage: "food_beverage",
  food_and_drink: "food_beverage",
  food_beverage: "food_beverage",
  non_profit: "nonprofit",
  nonprofit: "nonprofit",
  wedding: "wedding",
  weddings: "wedding",
};

const SITE_TYPE_ALIASES: Readonly<Record<string, string>> = {
  e_commerce: "ecommerce",
  ecommerce: "ecommerce",
  non_profit_website: "nonprofit_website",
  nonprofit_website: "nonprofit_website",
};

const SITE_TYPE_CHILDREN: Readonly<Record<string, readonly string[]>> = {
  blog: ["food_blog", "personal_blog", "tech_blog", "travel_blog"],
  content_platform: [
    "community_platform",
    "entertainment_platform",
    "magazine",
    "media_hub",
    "media_library",
    "news_site",
  ],
  ecommerce: ["e_commerce_store", "ecommerce_store", "online_store"],
  landing_page: [
    "course_landing_page",
    "event_landing_page",
    "product_landing_page",
    "saas_landing_page",
  ],
  nonprofit_website: ["non_profit_site", "nonprofit_site"],
  portfolio: [
    "artist_portfolio",
    "developer_portfolio",
    "portfolio_site",
    "portfolio_website",
  ],
};

const SECTION_ROLE_ALIASES: Readonly<Record<string, string>> = {
  about: "about",
  about_page: "about",
  about_us: "about",
  about_us_page: "about",
  contact: "contact",
  contact_page: "contact",
  contact_us: "contact",
  faq: "faq",
  faq_page: "faq",
  pricing: "pricing",
  pricing_page: "pricing",
  schedule: "schedule",
  schedule_section: "schedule",
};

const SECTION_ROLE_CHILDREN: Readonly<Record<string, readonly string[]>> = {
  events: ["event_list", "event_listing", "events_list", "events_page"],
  gallery: ["image_gallery", "media_gallery", "product_gallery"],
};

const SOFT_AUDIENCES: Readonly<Record<string, readonly string[]>> = {
  consumers: ["adults", "customers", "general_consumers", "general_public", "young_adults"],
  creative_clients: ["clients", "creative_professionals", "creatives", "potential_clients"],
  fans: ["sports_fans"],
  guests: ["wedding_guests"],
  professionals: ["financial_professionals", "working_professionals"],
};

function exact(ruleId: string): Compatibility {
  return { kind: "exact", score: 1, ruleId };
}

function alias(ruleId: string): Compatibility {
  return { kind: "alias", score: 1, ruleId };
}

function structural(score: number, ruleId: string): Compatibility {
  return { kind: "structural", score, ruleId };
}

function soft(score: number, ruleId: string): Compatibility {
  return { kind: "soft", score, ruleId };
}

function canonicalize(value: string, aliases: Readonly<Record<string, string>>): string {
  return aliases[value] ?? value;
}

export function canonicalizeDomain(value: string): string {
  return canonicalize(value, DOMAIN_ALIASES);
}

export function canonicalizeSiteTypeAlias(value: string): string {
  return canonicalize(value, SITE_TYPE_ALIASES);
}

export function domainCompatibility(required: string, candidate: string): Compatibility {
  if (required === "unknown" || candidate === "unknown") return NONE;
  const canonicalRequired = canonicalizeDomain(required);
  const canonicalCandidate = canonicalizeDomain(candidate);
  if (canonicalRequired !== canonicalCandidate) return NONE;
  return required === candidate
    ? exact("domain:exact")
    : alias(`domain:alias:${canonicalRequired}`);
}

export function siteTypeCompatibility(
  required: string,
  supported: string,
): Compatibility {
  if (required === "unknown" || supported === "unknown") return NONE;
  const canonicalRequired = canonicalizeSiteTypeAlias(required);
  const canonicalSupported = canonicalizeSiteTypeAlias(supported);
  if (canonicalRequired === canonicalSupported) {
    return required === supported
      ? exact("site_type:exact")
      : alias(`site_type:alias:${canonicalRequired}`);
  }
  if (supported === "general") return soft(0.35, "site_type:general");
  if (SITE_TYPE_CHILDREN[canonicalRequired]?.includes(canonicalSupported)) {
    const score = canonicalRequired === "content_platform" ? 0.65 : 0.85;
    return structural(score, `site_type:${canonicalRequired}>${canonicalSupported}`);
  }
  return NONE;
}

export function sectionRoleCompatibility(
  required: string,
  supported: string,
): Compatibility {
  if (required === "unknown" || supported === "unknown") return NONE;
  const canonicalRequired = canonicalize(required, SECTION_ROLE_ALIASES);
  const canonicalSupported = canonicalize(supported, SECTION_ROLE_ALIASES);
  if (canonicalRequired === canonicalSupported) {
    return required === supported
      ? exact("section_role:exact")
      : alias(`section_role:alias:${canonicalRequired}`);
  }
  if (SECTION_ROLE_CHILDREN[canonicalRequired]?.includes(canonicalSupported)) {
    return structural(0.85, `section_role:${canonicalRequired}>${canonicalSupported}`);
  }
  if (canonicalRequired === "coloring_gallery" && canonicalSupported === "gallery") {
    return structural(0.45, "section_role:coloring_gallery>gallery");
  }
  return NONE;
}

export function audienceCompatibility(
  required: string,
  candidate: string,
): Compatibility {
  if (required === "unknown" || candidate === "unknown") return NONE;
  if (required === candidate) return exact("audience:exact");
  if (candidate === "general") return soft(0.35, "audience:general");
  if (SOFT_AUDIENCES[required]?.includes(candidate)) {
    return soft(0.7, `audience:${required}>${candidate}`);
  }
  return NONE;
}
