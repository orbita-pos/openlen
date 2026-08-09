import { describe, expect, it } from "vitest";

import type { IntentAnalysis } from "./contracts";
import {
  rankTemplates,
  scoreTemplate,
  type ScorableTemplate,
} from "./score-template";

const CHILDREN_INTENT: IntentAnalysis = {
  schemaVersion: "intent-analysis/1.0",
  language: "es",
  functional: {
    siteType: "content_platform",
    requiredSections: ["coloring_gallery", "minigames", "stories"],
    primaryActions: ["start_coloring", "play", "read"],
    contentModel: "catalog",
  },
  audience: { primary: "children", ageRange: "5_10", secondary: ["parents"] },
  domains: ["children_entertainment", "creative_play"],
  emotionalGoals: ["playful", "magical", "safe"],
  requiredVisualSignals: ["coloring_page_preview", "child_friendly_illustration"],
  forbiddenVisualSignals: ["saas_dashboard", "course_progress_ui"],
  explicitConstraints: [],
  ambiguities: [],
  confidence: 0.93,
};

const KIDS_TEMPLATE: ScorableTemplate = {
  id: "kids",
  visualMetadata: {
    schemaVersion: "template-visual-metadata/1.0",
    domains: ["children_entertainment", "creative_play"],
    audiences: ["children", "parents"],
    ageRanges: ["5_10"],
    emotionalRegisters: ["playful", "magical", "safe"],
    visualArchetypes: ["illustrated_creative_play"],
    visualSignals: ["coloring_page_preview", "child_friendly_illustration"],
    layoutTraits: ["image_forward"],
    requiredAssetTypes: ["illustration"],
    negativeTags: ["enterprise_b2b"],
    supportedSiteTypes: ["content_platform"],
    supportedSectionRoles: ["coloring_gallery", "minigames", "stories"],
    themeability: "high",
    identityStrength: "high",
    reviewStatus: "reviewed",
  },
};

describe("scoreTemplate", () => {
  it("makes missing and unreviewed metadata ineligible", () => {
    const missing = scoreTemplate(CHILDREN_INTENT, { id: "missing", visualMetadata: null });
    const unreviewed = scoreTemplate(CHILDREN_INTENT, {
      ...KIDS_TEMPLATE,
      id: "unreviewed",
      visualMetadata: { ...KIDS_TEMPLATE.visualMetadata!, reviewStatus: "unreviewed" },
    });

    expect(missing).toEqual({
      id: "missing",
      eligible: false,
      structuralFit: 0,
      identityFit: 0,
      adaptationCost: 1,
      themeability: null,
      reasonCodes: ["metadata_missing"],
    });
    expect(unreviewed.eligible).toBe(false);
    expect(unreviewed.reasonCodes).toContain("metadata_unreviewed");
  });

  it("hard-filters unknown intent even when metadata declares general support", () => {
    const unknownIntent: IntentAnalysis = {
      ...CHILDREN_INTENT,
      functional: { ...CHILDREN_INTENT.functional, siteType: "unknown", contentModel: "unknown" },
      audience: { primary: "unknown", ageRange: null, secondary: [] },
      domains: ["unknown"],
      ambiguities: ["The product category is unspecified."],
      confidence: 0.3,
    };
    const generic: ScorableTemplate = {
      ...KIDS_TEMPLATE,
      id: "generic",
      visualMetadata: {
        ...KIDS_TEMPLATE.visualMetadata!,
        domains: ["general"],
        audiences: ["general"],
        supportedSiteTypes: ["general"],
      },
    };

    const score = scoreTemplate(unknownIntent, generic);

    expect(score.eligible).toBe(false);
    expect(score.reasonCodes).toContain("intent_ambiguous");
  });

  it("preserves intent ambiguity when template metadata is also missing", () => {
    const unknownIntent: IntentAnalysis = {
      ...CHILDREN_INTENT,
      functional: { ...CHILDREN_INTENT.functional, siteType: "unknown" },
      ambiguities: ["The requested site type is unclear."],
      confidence: 0.4,
    };

    const score = scoreTemplate(unknownIntent, { id: "missing", visualMetadata: null });

    expect(score.reasonCodes).toEqual(["intent_ambiguous", "metadata_missing"]);
  });

  it("hard-filters forbidden visual signals", () => {
    const academy: ScorableTemplate = {
      ...KIDS_TEMPLATE,
      id: "academy",
      visualMetadata: {
        ...KIDS_TEMPLATE.visualMetadata!,
        domains: ["education"],
        audiences: ["adults"],
        visualSignals: ["course_progress_ui", "saas_dashboard"],
        supportedSectionRoles: ["courses", "pricing"],
      },
    };

    const score = scoreTemplate(CHILDREN_INTENT, academy);

    expect(score.eligible).toBe(false);
    expect(score.reasonCodes).toContain("forbidden_visual_signal");
  });

  it("applies negative tags to audience as well as domain", () => {
    const adultsOnly: ScorableTemplate = {
      ...KIDS_TEMPLATE,
      id: "adults-only",
      visualMetadata: {
        ...KIDS_TEMPLATE.visualMetadata!,
        negativeTags: ["children"],
      },
    };

    const score = scoreTemplate(CHILDREN_INTENT, adultsOnly);

    expect(score.eligible).toBe(false);
    expect(score.reasonCodes).toContain("audience_mismatch");
    expect(score.reasonCodes).not.toContain("domain_incompatible");
  });

  it("reports a negative domain tag as domain incompatibility", () => {
    const incompatible: ScorableTemplate = {
      ...KIDS_TEMPLATE,
      id: "domain-incompatible",
      visualMetadata: {
        ...KIDS_TEMPLATE.visualMetadata!,
        negativeTags: ["creative_play"],
      },
    };

    const score = scoreTemplate(CHILDREN_INTENT, incompatible);

    expect(score.reasonCodes).toContain("domain_incompatible");
    expect(score.reasonCodes).not.toContain("audience_mismatch");
  });

  it("applies audited domain aliases to negative tags", () => {
    const commerceIntent: IntentAnalysis = {
      ...CHILDREN_INTENT,
      domains: ["ecommerce"],
    };
    const incompatible: ScorableTemplate = {
      ...KIDS_TEMPLATE,
      id: "negative-domain-alias",
      visualMetadata: {
        ...KIDS_TEMPLATE.visualMetadata!,
        negativeTags: ["e_commerce"],
      },
    };

    expect(scoreTemplate(commerceIntent, incompatible).reasonCodes)
      .toContain("domain_incompatible");
  });

  it("hard-filters an explicit age-range mismatch", () => {
    const adults: ScorableTemplate = {
      ...KIDS_TEMPLATE,
      id: "adults",
      visualMetadata: {
        ...KIDS_TEMPLATE.visualMetadata!,
        ageRanges: ["18_plus"],
      },
    };

    const score = scoreTemplate(CHILDREN_INTENT, adults);

    expect(score.eligible).toBe(false);
    expect(score.reasonCodes).toContain("audience_mismatch");
  });

  it("treats overlapping numeric and semantic age ranges as compatible", () => {
    const sixToTwelve = scoreTemplate(CHILDREN_INTENT, {
      ...KIDS_TEMPLATE,
      id: "six-to-twelve",
      visualMetadata: { ...KIDS_TEMPLATE.visualMetadata!, ageRanges: ["6_12"] },
    });
    const semanticChildren = scoreTemplate(CHILDREN_INTENT, {
      ...KIDS_TEMPLATE,
      id: "semantic-children",
      visualMetadata: { ...KIDS_TEMPLATE.visualMetadata!, ageRanges: ["children"] },
    });

    expect(sixToTwelve.reasonCodes).not.toContain("audience_mismatch");
    expect(sixToTwelve.identityFit).toBeCloseTo(0.9833, 3);
    expect(semanticChildren.reasonCodes).not.toContain("audience_mismatch");
    expect(semanticChildren.identityFit).toBe(1);
  });

  it("scores age by required-range coverage instead of any overlap", () => {
    const marginalOverlap = scoreTemplate(CHILDREN_INTENT, {
      ...KIDS_TEMPLATE,
      id: "marginal-overlap",
      visualMetadata: { ...KIDS_TEMPLATE.visualMetadata!, ageRanges: ["10_18"] },
    });

    expect(marginalOverlap.reasonCodes).not.toContain("audience_mismatch");
    expect(marginalOverlap.identityFit).toBeCloseTo(0.9167, 3);
  });

  it("keeps structure and identity as independent scores", () => {
    const strong = scoreTemplate(CHILDREN_INTENT, KIDS_TEMPLATE);
    const structuralOnly = scoreTemplate(CHILDREN_INTENT, {
      ...KIDS_TEMPLATE,
      id: "structural-only",
      visualMetadata: {
        ...KIDS_TEMPLATE.visualMetadata!,
        domains: ["education"],
        emotionalRegisters: ["institutional"],
        visualSignals: ["generic_cards"],
        negativeTags: [],
      },
    });

    expect(strong).toMatchObject({
      eligible: true,
      structuralFit: 1,
      identityFit: 1,
    });
    expect(structuralOnly.structuralFit).toBe(1);
    expect(structuralOnly.identityFit).toBeLessThan(0.5);
  });

  it("does not treat absent optional intent dimensions as perfect evidence", () => {
    const sparseIntent: IntentAnalysis = {
      ...CHILDREN_INTENT,
      audience: { primary: "collectors", ageRange: null, secondary: [] },
      domains: ["fine_art"],
      emotionalGoals: [],
      requiredVisualSignals: [],
    };

    const score = scoreTemplate(sparseIntent, KIDS_TEMPLATE);

    expect(score.identityFit).toBe(0);
  });

  it("deduplicates repeated requirements before calculating overlap", () => {
    const duplicated: IntentAnalysis = {
      ...CHILDREN_INTENT,
      functional: {
        ...CHILDREN_INTENT.functional,
        requiredSections: ["coloring_gallery", "coloring_gallery", "stories"],
      },
      emotionalGoals: ["playful", "playful", "safe"],
      requiredVisualSignals: [
        "coloring_page_preview",
        "coloring_page_preview",
        "child_friendly_illustration",
      ],
    };
    const deduplicated: IntentAnalysis = {
      ...duplicated,
      functional: {
        ...duplicated.functional,
        requiredSections: ["coloring_gallery", "stories"],
      },
      emotionalGoals: ["playful", "safe"],
      requiredVisualSignals: ["coloring_page_preview", "child_friendly_illustration"],
    };

    const partialTemplate: ScorableTemplate = {
      ...KIDS_TEMPLATE,
      visualMetadata: {
        ...KIDS_TEMPLATE.visualMetadata!,
        supportedSectionRoles: ["coloring_gallery"],
        emotionalRegisters: ["playful"],
        visualSignals: ["coloring_page_preview"],
      },
    };

    expect(scoreTemplate(duplicated, partialTemplate)).toMatchObject({
      structuralFit: scoreTemplate(deduplicated, partialTemplate).structuralFit,
      identityFit: scoreTemplate(deduplicated, partialTemplate).identityFit,
    });
  });

  it("accepts general site-type and audience support for a known intent", () => {
    const generalSupport: ScorableTemplate = {
      ...KIDS_TEMPLATE,
      id: "general-support",
      visualMetadata: {
        ...KIDS_TEMPLATE.visualMetadata!,
        audiences: ["general"],
        supportedSiteTypes: ["general"],
      },
    };

    const score = scoreTemplate(CHILDREN_INTENT, generalSupport);

    expect(score.reasonCodes).not.toContain("unsupported_site_type");
    expect(score.reasonCodes).not.toContain("audience_mismatch");
    expect(score.eligible).toBe(true);
  });

  it("scores audited taxonomy aliases without rewriting metadata", () => {
    const commerceIntent: IntentAnalysis = {
      ...CHILDREN_INTENT,
      functional: {
        ...CHILDREN_INTENT.functional,
        siteType: "landing_page",
        requiredSections: ["gallery", "about", "contact"],
      },
      audience: { primary: "consumers", ageRange: null, secondary: [] },
      domains: ["ecommerce"],
      emotionalGoals: [],
      requiredVisualSignals: [],
      forbiddenVisualSignals: [],
    };
    const observedMetadata: ScorableTemplate = {
      id: "observed-commerce",
      visualMetadata: {
        ...KIDS_TEMPLATE.visualMetadata!,
        domains: ["e_commerce"],
        audiences: ["general_consumers"],
        ageRanges: [],
        emotionalRegisters: [],
        visualSignals: [],
        supportedSiteTypes: ["product_landing_page"],
        supportedSectionRoles: ["media_gallery", "about_us", "contact_page"],
      },
    };

    const score = scoreTemplate(commerceIntent, observedMetadata);

    expect(score.eligible).toBe(true);
    expect(score.structuralFit).toBeGreaterThan(0.8);
    expect(score.identityFit).toBeGreaterThan(0.8);
  });

  it.each([
    {
      id: "grano",
      siteType: "ecommerce",
      domains: ["food_beverage", "ecommerce"],
      audience: "coffee_lovers",
      supportedSiteTypes: ["e_commerce", "landing_page"],
      metadataDomains: ["food_and_drink", "e_commerce"],
    },
    {
      id: "marcato",
      siteType: "business_presence",
      domains: ["food_beverage", "hospitality", "local_services"],
      audience: "foodies",
      supportedSiteTypes: ["restaurant_website", "fine_dining_restaurant"],
      metadataDomains: ["food_and_drink", "hospitality", "restaurants"],
    },
    {
      id: "lintel",
      siteType: "product_marketing",
      domains: ["consumer_technology", "hardware", "wellness"],
      audience: "tech_enthusiasts",
      supportedSiteTypes: ["product_landing_page", "company_website"],
      metadataDomains: ["hardware", "smart_home", "technology", "e_commerce"],
    },
  ])("does not hard-filter the audited $id category", ({
    id,
    siteType,
    domains,
    audience,
    supportedSiteTypes,
    metadataDomains,
  }) => {
    const intent: IntentAnalysis = {
      ...CHILDREN_INTENT,
      functional: {
        ...CHILDREN_INTENT.functional,
        siteType,
        requiredSections: ["about", "contact"],
      },
      audience: { primary: "consumers", ageRange: "adults", secondary: [] },
      domains,
      emotionalGoals: [],
      requiredVisualSignals: [],
      forbiddenVisualSignals: [],
    };
    const template: ScorableTemplate = {
      id,
      visualMetadata: {
        ...KIDS_TEMPLATE.visualMetadata!,
        domains: metadataDomains,
        audiences: [audience],
        ageRanges: ["adults"],
        emotionalRegisters: [],
        visualSignals: [],
        supportedSiteTypes,
        supportedSectionRoles: ["about_us", "contact_page"],
      },
    };

    const score = scoreTemplate(intent, template);

    expect(score.eligible).toBe(true);
    expect(score.reasonCodes).not.toContain("unsupported_site_type");
    expect(score.reasonCodes).not.toContain("audience_mismatch");
  });

  it("does not invent a complete children-coloring match from a generic gallery", () => {
    const sportsSchool: ScorableTemplate = {
      id: "sports-school",
      visualMetadata: {
        ...KIDS_TEMPLATE.visualMetadata!,
        domains: ["sports", "education"],
        audiences: ["children"],
        ageRanges: ["6_12"],
        emotionalRegisters: ["energetic"],
        visualSignals: ["sports_photography"],
        supportedSiteTypes: ["school_website"],
        supportedSectionRoles: ["gallery", "activities", "testimonials"],
      },
    };

    const score = scoreTemplate(CHILDREN_INTENT, sportsSchool);

    expect(score.eligible).toBe(false);
    expect(score.reasonCodes).toContain("unsupported_site_type");
    expect(score.structuralFit).toBeLessThan(0.5);
    expect(score.identityFit).toBeLessThan(0.4);
  });
});

describe("rankTemplates", () => {
  it("ranks deterministically by binary id after equal scores without mutating input", () => {
    const lowercase = { ...KIDS_TEMPLATE, id: "a" };
    const uppercase = { ...KIDS_TEMPLATE, id: "Z" };
    const input = [lowercase, uppercase];

    const ranked = rankTemplates(CHILDREN_INTENT, input);

    expect(ranked.map((score) => score.id)).toEqual(["Z", "a"]);
    expect(input.map((template) => template.id)).toEqual(["a", "Z"]);
  });

  it.each([
    {
      criterion: "eligibility",
      preferred: KIDS_TEMPLATE,
      other: {
        ...KIDS_TEMPLATE,
        id: "a-ineligible",
        visualMetadata: { ...KIDS_TEMPLATE.visualMetadata!, reviewStatus: "unreviewed" as const },
      },
    },
    {
      criterion: "structural fit",
      preferred: KIDS_TEMPLATE,
      other: {
        ...KIDS_TEMPLATE,
        id: "a-weaker-structure",
        visualMetadata: {
          ...KIDS_TEMPLATE.visualMetadata!,
          supportedSectionRoles: ["coloring_gallery"],
        },
      },
    },
    {
      criterion: "identity fit",
      preferred: KIDS_TEMPLATE,
      other: {
        ...KIDS_TEMPLATE,
        id: "a-weaker-identity",
        visualMetadata: {
          ...KIDS_TEMPLATE.visualMetadata!,
          emotionalRegisters: ["playful"],
          visualSignals: ["coloring_page_preview"],
        },
      },
    },
    {
      criterion: "adaptation cost",
      preferred: KIDS_TEMPLATE,
      other: {
        ...KIDS_TEMPLATE,
        id: "a-higher-cost",
        visualMetadata: { ...KIDS_TEMPLATE.visualMetadata!, themeability: "low" as const },
      },
    },
  ])("prioritizes $criterion before the id tie-breaker", ({ preferred, other }) => {
    const ranked = rankTemplates(CHILDREN_INTENT, [other, preferred]);

    expect(ranked[0]?.id).toBe(preferred.id);
  });
});
