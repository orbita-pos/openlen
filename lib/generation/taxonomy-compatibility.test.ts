import { describe, expect, it } from "vitest";

import {
  audienceCompatibility,
  canonicalizeDomain,
  sectionRoleCompatibility,
  siteTypeCompatibility,
  TAXONOMY_COMPATIBILITY_VERSION,
} from "./taxonomy-compatibility";

describe("taxonomy compatibility", () => {
  it("exposes a versioned deterministic contract", () => {
    expect(TAXONOMY_COMPATIBILITY_VERSION).toBe("taxonomy-compatibility/1.1");
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

  it("uses general only as soft support for a known site type", () => {
    expect(siteTypeCompatibility("portfolio", "general"))
      .toMatchObject({ kind: "soft", score: 0.35 });
    expect(siteTypeCompatibility("unknown", "general"))
      .toEqual({ kind: "none", score: 0, ruleId: null });
  });

  it("distinguishes gallery structure from coloring identity", () => {
    expect(sectionRoleCompatibility("gallery", "product_gallery"))
      .toMatchObject({ kind: "structural", score: 0.85 });
    expect(sectionRoleCompatibility("coloring_gallery", "gallery"))
      .toMatchObject({ kind: "structural", score: 0.45 });
    expect(sectionRoleCompatibility("minigames", "activities"))
      .toEqual({ kind: "none", score: 0, ruleId: null });
    expect(sectionRoleCompatibility("stories", "testimonials"))
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
