# OpenLen Structural Taxonomy Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Gemini intent output and template scoring share one canonical structural vocabulary so semantically compatible templates are not rejected because of open-ended site-type, audience, or section-role synonyms.

**Architecture:** Add one immutable structural-taxonomy contract consumed by the Gemini response schema and prompt. Extend only explicit deterministic compatibility aliases/hierarchies at the scorer boundary; preserve the current decision thresholds, identity fields, strict 2A gate, and fail-safe composition fallback.

**Tech Stack:** TypeScript, Zod-compatible Gemini JSON schema, Vitest, existing deterministic template scorer and qualification/canary tooling.

## Global Constraints

- This is one bounded implementation task, not a new phase.
- No live Gemini call, database mutation, pilot run, migration, deploy, feature flag, dependency, UI, 2B assembler, or 2C generator change.
- Do not lower `DEFAULT_THRESHOLDS`, force the qualified template, add cohort IDs/examples to prompts, or introduce fuzzy/edit-distance/embedding matching.
- Structural values outside the reviewed vocabulary fail safely; visual/emotional identity fields remain expressive and open.
- Preserve the live-canary 1.1 privacy allowlist and strict 15/15 rule.
- A later live run requires new explicit paid authorization.

---

### Task 1: Align model and scorer structural taxonomy

**Files:**
- Create: `lib/generation/structural-taxonomy.ts`
- Create: `lib/generation/structural-taxonomy.test.ts`
- Modify: `lib/generation/analyze-intent.ts`
- Modify: `lib/generation/analyze-intent.test.ts`
- Modify: `lib/generation/taxonomy-compatibility.ts`
- Modify: `lib/generation/taxonomy-compatibility.test.ts`
- Modify mechanically for the prompt-version assertion: `lib/generation/safe-selection.test.ts`
- Modify mechanically for the prompt-version assertion: `lib/generation/shadow-selection.test.ts`

**Interfaces:**
- Produces `CANONICAL_SITE_TYPES`, `CANONICAL_PRIMARY_AUDIENCES`, `CANONICAL_SECTION_ROLES`, and their element types.
- `analyzeIntent` consumes those arrays in `RESPONSE_JSON_SCHEMA` and `INTENT_SYSTEM_PROMPT`; exports `INTENT_PROMPT_VERSION = "intent-prompt/1.6"`.
- Compatibility remains exposed through `siteTypeCompatibility`, `sectionRoleCompatibility`, and `audienceCompatibility`; exports `TAXONOMY_COMPATIBILITY_VERSION = "taxonomy-compatibility/1.2"`.
- `decideGenerationRoute` and `DEFAULT_THRESHOLDS` are not modified.

- [ ] **Step 1: Write the canonical-contract RED tests**

Create `structural-taxonomy.test.ts` asserting exact frozen arrays, uniqueness, lowercase snake case, `unknown` only in site/audience lists, and preservation of distinct `stories`, `testimonials`, `minigames`, `activities`, and `coloring_gallery` roles.

The exact arrays are:

```ts
export const CANONICAL_SITE_TYPES = [
  "unknown", "blog", "business", "business_presence", "community_hub",
  "content_platform", "creator_hub", "documentation_site", "ecommerce",
  "educational_resource", "landing_page", "newsletter", "nonprofit_website",
  "portfolio", "product_landing_page", "product_marketing", "restaurant",
  "restaurant_website", "saas_product_page", "small_business",
] as const;

export const CANONICAL_PRIMARY_AUDIENCES = [
  "unknown", "children", "parents", "adults", "developers", "consumers",
  "families", "professionals", "educators", "creative_clients", "businesses",
  "gamers", "fans", "guests", "donors", "home_buyers", "readers",
  "citizens", "homeowners",
] as const;

export const CANONICAL_SECTION_ROLES = [
  "header", "hero", "about", "services", "features", "how_it_works",
  "programs", "menu", "events", "reservations", "booking", "schedule",
  "pricing", "team", "testimonials", "gallery", "clients", "profile_summary",
  "link_list", "featured_content", "content_list", "social_links", "faq",
  "contact", "call_to_action", "footer", "coloring_gallery", "minigames",
  "stories", "activities", "products", "integrations", "use_cases",
  "case_studies", "membership", "location", "blog", "news", "newsletter",
] as const;
```

- [ ] **Step 2: Run the canonical-contract test and record RED**

Run:

```powershell
npm.cmd test -- lib/generation/structural-taxonomy.test.ts
```

Expected: FAIL because `./structural-taxonomy` does not exist.

- [ ] **Step 3: Implement the immutable canonical contract**

Create `structural-taxonomy.ts` with the exact arrays above, element types using `(typeof ARRAY)[number]`, `Object.freeze` on each exported array, and no catalog/cohort imports.

- [ ] **Step 4: Verify the canonical contract GREEN**

Run the Step 2 command. Expected: all canonical-contract tests PASS.

- [ ] **Step 5: Write response-schema and prompt RED tests**

In `analyze-intent.test.ts`, assert:

```ts
expect(siteTypeSchema.enum).toEqual(CANONICAL_SITE_TYPES);
expect(primaryAudienceSchema.enum).toEqual(CANONICAL_PRIMARY_AUDIENCES);
expect(requiredSectionsSchema.items.enum).toEqual(CANONICAL_SECTION_ROLES);
expect(INTENT_SYSTEM_PROMPT).toContain(CANONICAL_SITE_TYPES.join(", "));
expect(INTENT_SYSTEM_PROMPT).toContain(CANONICAL_PRIMARY_AUDIENCES.join(", "));
expect(INTENT_SYSTEM_PROMPT).toContain(CANONICAL_SECTION_ROLES.join(", "));
expect(INTENT_SYSTEM_PROMPT).toContain("stories and testimonials are different roles");
expect(INTENT_SYSTEM_PROMPT).toContain("minigames and activities are different roles");
expect(INTENT_PROMPT_VERSION).toBe("intent-prompt/1.6");
```

Also assert an out-of-vocabulary `siteType`, primary audience, or required section is rejected by the real `analyzeIntent` response-validation path with a typed schema failure while preserving any valid reported usage. Keep `requiredVisualSignals` open and prove it accepts a new snake-case value.

- [ ] **Step 6: Run intent tests and record RED**

Run:

```powershell
npm.cmd test -- lib/generation/analyze-intent.test.ts
```

Expected: FAIL on unconstrained structural schema/prompt version; existing visual-signal openness still passes.

- [ ] **Step 7: Constrain only structural model output**

Modify `analyze-intent.ts`:

```ts
export const INTENT_PROMPT_VERSION = "intent-prompt/1.6" as const;

const enumArraySchema = (values: readonly string[]) => ({
  type: "array" as const,
  items: { type: "string" as const, enum: values },
  maxItems: 24,
});
```

Use `enum: CANONICAL_SITE_TYPES` for `functional.siteType`, `enumArraySchema(CANONICAL_SECTION_ROLES)` for `requiredSections`, and `enum: CANONICAL_PRIMARY_AUDIENCES` for `audience.primary`. Keep actions, secondary audiences, domains, emotions, visual signals, constraints, and ambiguities on their existing open schemas.

After `IntentAnalysisSchema.safeParse(parsed)` succeeds, enforce the same structural vocabulary at runtime against the parsed `siteType`, primary audience, and every required section. If a mocked, changed, or nonconforming provider returns an out-of-vocabulary structural value despite the advertised response schema, return the existing typed `schema` failure shape and preserve safe reported usage. Do not globally narrow `IntentAnalysisSchema`; legacy callers and stored contracts remain compatible.

Append prompt rules that print the three canonical arrays, require canonical structural values instead of synonyms, omit unsupported section roles while recording an ambiguity, preserve wrapper roles for a complete page, and state the distinct-role protections. Include generic category guidance from the approved spec without cohort IDs, briefs, or template IDs.

- [ ] **Step 8: Verify intent contract GREEN and update prompt-version fixtures**

Run Step 6. If the only failures are hard-coded `intent-prompt/1.5` expectations, update them to `intent-prompt/1.6` in `analyze-intent.test.ts`, `safe-selection.test.ts`, and `shadow-selection.test.ts`, then rerun until GREEN.

- [ ] **Step 9: Write deterministic compatibility RED tests**

In `taxonomy-compatibility.test.ts`, add tables proving:

```ts
sectionRoleCompatibility("about", "origin_story").score === 1;
sectionRoleCompatibility("testimonials", "reviews").score === 1;
sectionRoleCompatibility("how_it_works", "workflow").score === 1;
sectionRoleCompatibility("events", "event_listing").score === 1;
sectionRoleCompatibility("gallery", "media_gallery").score === 1;
sectionRoleCompatibility("booking", "booking_form").score === 1;
siteTypeCompatibility("restaurant", "bakery").score === 0.85;
siteTypeCompatibility("restaurant", "wine_bar").score === 0.85;
siteTypeCompatibility("small_business", "fitness_studio").score === 0.85;
siteTypeCompatibility("documentation_site", "technical_documentation").score === 0.85;
siteTypeCompatibility("saas_product_page", "saas_landing_page").score === 0.85;
siteTypeCompatibility("creator_hub", "creator_page").score === 0.85;
siteTypeCompatibility("educational_resource", "educational_site").score === 0.85;
siteTypeCompatibility("community_hub", "community_site").score === 0.85;
```

Cover every approved section alias as an exact table, not just one example per family:

```ts
[
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
]
```

Retain negative assertions: reverse parent relations do not become exact, unmapped values remain `none`, `stories` does not match `testimonials`, `minigames` does not match `activities`, `product_gallery` does not collapse to generic `gallery`, and `coloring_gallery` retains its existing partial gallery relation only. Keep the existing regression that an `unknown` structural classification requires a concrete ambiguity and confidence at or below `0.49`.

- [ ] **Step 10: Run compatibility tests and record RED**

Run:

```powershell
npm.cmd test -- lib/generation/taxonomy-compatibility.test.ts
```

Expected: FAIL for the newly audited aliases/hierarchies and version `1.2`.

- [ ] **Step 11: Implement the minimal audited compatibility expansion**

Add only the mappings named in the approved spec and RED tables. Extend `SECTION_ROLE_ALIASES` with the exact alias table; move the audited event/gallery variants into exact aliases, remove `product_gallery` from generic gallery compatibility, and preserve the existing partial `coloring_gallery` relation. Extend directional `SITE_TYPE_CHILDREN` for `restaurant`, `small_business`, `documentation_site`, `saas_product_page`, `creator_hub`, `educational_resource`, and `community_hub` using only the child slugs asserted by the RED table. Do not add substring/fuzzy fallback. Bump the taxonomy version to `taxonomy-compatibility/1.2`.

- [ ] **Step 12: Verify focused routing and cohort regressions**

Run:

```powershell
npm.cmd test -- lib/generation/structural-taxonomy.test.ts lib/generation/analyze-intent.test.ts lib/generation/taxonomy-compatibility.test.ts lib/generation/score-template.test.ts lib/generation/safe-selection.test.ts lib/generation/shadow-selection.test.ts lib/generation/selector-holdout-cases.test.ts lib/generation/visual-engine-2a-cohort.test.ts lib/generation/visual-engine-2a-qualification.test.ts lib/generation/visual-engine-2a-live-canary.test.ts lib/generation/visual-engine-2a-eval-cli.integration.test.ts
```

Expected: all tests PASS; cohort qualification remains 15 cases/75 rows and strict canary behavior is unchanged.

- [ ] **Step 13: Run the full non-live release gate**

Run exactly once:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run generation:visual-engine-2a:rollback-check
git diff --check
```

Expected: zero failed tests, typecheck exit `0`, rollback `verified=true`, and clean diff check. Do not run qualify/eval/review/scorecard/migration.

- [ ] **Step 14: Audit scope and commit**

Confirm `DEFAULT_THRESHOLDS`, canary schema/privacy fields, cohort IDs/briefs, database schema, dependencies, and feature flags are unchanged. Stage only the files listed above and commit:

```powershell
git commit -m "fix(generation): align structural intent taxonomy"
```

Record exact RED/GREEN evidence, full gate counts, changed paths, and concerns in the ignored SDD report. Stop before any paid canary and request new explicit authorization.
