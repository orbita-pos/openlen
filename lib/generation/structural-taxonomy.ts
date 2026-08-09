export const CANONICAL_SITE_TYPES = Object.freeze([
  "unknown", "blog", "business", "business_presence", "community_hub",
  "content_platform", "creator_hub", "documentation_site", "ecommerce",
  "educational_resource", "landing_page", "newsletter", "nonprofit_website",
  "portfolio", "product_landing_page", "product_marketing", "restaurant",
  "restaurant_website", "saas_product_page", "small_business",
] as const);

export const CANONICAL_PRIMARY_AUDIENCES = Object.freeze([
  "unknown", "children", "parents", "adults", "developers", "consumers",
  "families", "professionals", "educators", "creative_clients", "businesses",
  "gamers", "fans", "guests", "donors", "home_buyers", "readers",
  "citizens", "homeowners",
] as const);

export const CANONICAL_SECTION_ROLES = Object.freeze([
  "header", "hero", "about", "services", "features", "how_it_works",
  "programs", "menu", "events", "reservations", "booking", "schedule",
  "pricing", "team", "testimonials", "gallery", "clients", "profile_summary",
  "link_list", "featured_content", "content_list", "social_links", "faq",
  "contact", "call_to_action", "footer", "coloring_gallery", "minigames",
  "stories", "activities", "products", "integrations", "use_cases",
  "case_studies", "membership", "location", "blog", "news", "newsletter",
] as const);

export type CanonicalSiteType = (typeof CANONICAL_SITE_TYPES)[number];
export type CanonicalPrimaryAudience = (typeof CANONICAL_PRIMARY_AUDIENCES)[number];
export type CanonicalSectionRole = (typeof CANONICAL_SECTION_ROLES)[number];
