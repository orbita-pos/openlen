import { describe, expect, it } from "vitest";

import {
  CANONICAL_PRIMARY_AUDIENCES,
  CANONICAL_SECTION_ROLES,
  CANONICAL_SITE_TYPES,
} from "./structural-taxonomy";

const EXPECTED_SITE_TYPES = [
  "unknown", "blog", "business", "business_presence", "community_hub",
  "content_platform", "creator_hub", "documentation_site", "ecommerce",
  "educational_resource", "landing_page", "newsletter", "nonprofit_website",
  "portfolio", "product_landing_page", "product_marketing", "restaurant",
  "restaurant_website", "saas_product_page", "small_business",
] as const;

const EXPECTED_PRIMARY_AUDIENCES = [
  "unknown", "children", "parents", "adults", "developers", "consumers",
  "families", "professionals", "educators", "creative_clients", "businesses",
  "gamers", "fans", "guests", "donors", "home_buyers", "readers",
  "citizens", "homeowners",
] as const;

const EXPECTED_SECTION_ROLES = [
  "header", "hero", "about", "services", "features", "how_it_works",
  "programs", "menu", "events", "reservations", "booking", "schedule",
  "pricing", "team", "testimonials", "gallery", "clients", "profile_summary",
  "link_list", "featured_content", "content_list", "social_links", "faq",
  "contact", "call_to_action", "footer", "coloring_gallery", "minigames",
  "stories", "activities", "products", "integrations", "use_cases",
  "case_studies", "membership", "location", "blog", "news", "newsletter",
] as const;

const expectCanonicalValues = (values: readonly string[]) => {
  expect(new Set(values).size).toBe(values.length);
  expect(values.every((value) => /^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(value))).toBe(true);
  expect(Object.isFrozen(values)).toBe(true);
};

describe("structural taxonomy contract", () => {
  it("publishes the reviewed site-type vocabulary", () => {
    expect(CANONICAL_SITE_TYPES).toEqual(EXPECTED_SITE_TYPES);
    expectCanonicalValues(CANONICAL_SITE_TYPES);
  });

  it("publishes the reviewed primary-audience vocabulary", () => {
    expect(CANONICAL_PRIMARY_AUDIENCES).toEqual(EXPECTED_PRIMARY_AUDIENCES);
    expectCanonicalValues(CANONICAL_PRIMARY_AUDIENCES);
  });

  it("publishes distinct reviewed section roles without an unknown role", () => {
    expect(CANONICAL_SECTION_ROLES).toEqual(EXPECTED_SECTION_ROLES);
    expectCanonicalValues(CANONICAL_SECTION_ROLES);
    expect(CANONICAL_SECTION_ROLES).not.toContain("unknown");
    expect(CANONICAL_SECTION_ROLES).toEqual(expect.arrayContaining([
      "stories", "testimonials", "minigames", "activities", "coloring_gallery",
    ]));
  });
});
