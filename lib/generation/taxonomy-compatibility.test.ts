import { describe, expect, it } from "vitest";

import {
  audienceCompatibility,
  canonicalizeDomain,
  sectionComponentCompatibility,
  sectionRoleCompatibility,
  siteTypeCompatibility,
  TAXONOMY_COMPATIBILITY_VERSION,
} from "./taxonomy-compatibility";

describe("taxonomy compatibility", () => {
  it("exposes a versioned deterministic contract", () => {
    expect(TAXONOMY_COMPATIBILITY_VERSION).toBe("taxonomy-compatibility/1.4");
  });

  it.each([
    ["e_commerce", "ecommerce"],
    ["non_profit", "nonprofit"],
    ["weddings", "wedding"],
    ["food_and_drink", "food_beverage"],
    ["artificial_intelligence", "ai_ml"],
    ["unmapped_domain", "unmapped_domain"],
  ])("canonicalizes the observed domain %s without guessing", (observed, canonical) => {
    expect(canonicalizeDomain(observed)).toBe(canonical);
  });

  it("keeps site-type hierarchy directional", () => {
    expect(siteTypeCompatibility("landing_page", "product_landing_page"))
      .toMatchObject({ kind: "structural", score: 0.85 });
    expect(siteTypeCompatibility("product_landing_page", "landing_page"))
      .toEqual({ kind: "none", score: 0, ruleId: null });
  });

  it.each([
    ["business_presence", "restaurant_website"],
    ["business_presence", "fine_dining_restaurant"],
    ["business_presence", "local_business"],
    ["product_marketing", "product_landing_page"],
    ["product_marketing", "company_website"],
  ])("supports the audited site-type specialization %s > %s", (required, supported) => {
    expect(siteTypeCompatibility(required, supported))
      .toMatchObject({ kind: "structural", score: 0.85 });
    expect(siteTypeCompatibility(supported, required))
      .toEqual({ kind: "none", score: 0, ruleId: null });
  });

  it.each([
    ["restaurant", "bakery"],
    ["restaurant", "cafe"],
    ["restaurant", "wine_bar"],
    ["restaurant", "restaurant_website"],
    ["restaurant", "fine_dining_restaurant"],
    ["restaurant", "business"],
    ["small_business", "fitness_studio"],
    ["small_business", "business"],
    ["documentation_site", "technical_documentation"],
    ["saas_product_page", "saas_landing_page"],
    ["creator_hub", "creator_page"],
    ["educational_resource", "educational_site"],
    ["community_hub", "community_site"],
  ])("supports only the audited canonical specialization %s > %s", (required, supported) => {
    expect(siteTypeCompatibility(required, supported))
      .toMatchObject({ kind: "structural", score: 0.85 });
    expect(siteTypeCompatibility(supported, required))
      .toEqual({ kind: "none", score: 0, ruleId: null });
  });

  it.each([
    ["about", "origin_story"], ["about", "our_story"], ["about", "mission"],
    ["about", "about_page"], ["about", "about_us"],
    ["about", "about_us_page"], ["about", "about_us_section"],
    ["testimonials", "reviews"], ["testimonials", "social_proof"],
    ["how_it_works", "workflow"], ["how_it_works", "process"],
    ["events", "event_list"], ["events", "event_listing"],
    ["events", "events_list"], ["events", "events_page"],
    ["gallery", "image_gallery"], ["gallery", "media_gallery"],
    ["faq", "faq_page"], ["pricing", "pricing_page"],
    ["schedule", "schedule_section"],
    ["contact", "contact_page"], ["contact", "contact_us"],
    ["contact", "contact_form"],
    ["booking", "booking_form"], ["booking", "booking_page"],
  ])("maps the audited section alias %s <- %s exactly", (required, supported) => {
    expect(sectionRoleCompatibility(required, supported))
      .toMatchObject({ kind: "alias", score: 1 });
  });

  it("uses general only as soft support for a known site type", () => {
    expect(siteTypeCompatibility("portfolio", "general"))
      .toMatchObject({ kind: "soft", score: 0.35 });
    expect(siteTypeCompatibility("unknown", "general"))
      .toEqual({ kind: "none", score: 0, ruleId: null });
  });

  it("distinguishes gallery structure from coloring identity", () => {
    expect(sectionRoleCompatibility("gallery", "product_gallery"))
      .toEqual({ kind: "none", score: 0, ruleId: null });
    expect(sectionRoleCompatibility("coloring_gallery", "gallery"))
      .toMatchObject({ kind: "structural", score: 0.45 });
    expect(sectionRoleCompatibility("minigames", "activities"))
      .toEqual({ kind: "none", score: 0, ruleId: null });
    expect(sectionRoleCompatibility("stories", "testimonials"))
      .toEqual({ kind: "none", score: 0, ruleId: null });
  });

  it.each([
    ["hero", "hero", "exact", 1],
    ["header", "navbar", "alias", 1],
    ["call_to_action", "cta", "alias", 1],
    ["how_it_works", "how-it-works", "alias", 1],
    ["clients", "logos", "alias", 1],
    ["coloring_gallery", "gallery", "structural", 0.85],
    ["minigames", "features", "structural", 0.85],
    ["stories", "features", "structural", 0.85],
    ["activities", "features", "structural", 0.85],
    ["reservations", "contact", "structural", 0.85],
    ["membership", "pricing", "structural", 0.85],
  ])("maps the audited section component %s → %s", (role, component, kind, score) => {
    expect(sectionComponentCompatibility(role, component)).toMatchObject({ kind, score });
  });

  it.each([
    ["stories", "testimonials"],
    ["minigames", "pricing"],
    ["activities", "logos"],
    ["unknown", "unknown"],
    ["navbar", "navbar"],
  ])("rejects the misleading section substitution %s → %s", (role, component) => {
    expect(sectionComponentCompatibility(role, component))
      .toEqual({ kind: "none", score: 0, ruleId: null });
  });

  it("treats audience relations as soft rather than exact aliases", () => {
    expect(audienceCompatibility("fans", "sports_fans"))
      .toMatchObject({ kind: "soft", score: 0.7 });
    expect(audienceCompatibility("professionals", "financial_professionals"))
      .toMatchObject({ kind: "soft", score: 0.7 });
    expect(audienceCompatibility("children", "children_focused"))
      .toEqual({ kind: "none", score: 0, ruleId: null });
  });

  it.each([
    "coffee_lovers",
    "foodies",
    "tech_enthusiasts",
    "homeowners",
    "early_adopters",
  ])("treats the audited consumer specialty %s as soft support", (candidate) => {
    expect(audienceCompatibility("consumers", candidate))
      .toMatchObject({ kind: "soft", score: 0.7 });
    expect(audienceCompatibility(candidate, "consumers"))
      .toEqual({ kind: "none", score: 0, ruleId: null });
  });

  it("never maps unknown or visual-looking labels through fuzzy similarity", () => {
    expect(audienceCompatibility("unknown", "general"))
      .toEqual({ kind: "none", score: 0, ruleId: null });
    expect(sectionRoleCompatibility("course_progress_ui", "progress_bar"))
      .toEqual({ kind: "none", score: 0, ruleId: null });
  });
});
