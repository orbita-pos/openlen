# OpenLen Structural Taxonomy Alignment Design

## Status and objective

Approved design for one bounded correction to OpenLen's shared intent-to-template routing boundary. The live 2A canary proved that the frozen intents select the reviewed skeletons 15/15, while production Gemini intents select `section_composition` 15/15. Redacted evidence attributes the mismatch to `unsupported_site_type` in 11 qualified templates, `audience_mismatch` in 3, and low exact section-role overlap in every case.

The objective is to make Gemini and the deterministic scorer communicate through the same versioned structural vocabulary without weakening safety gates, forcing templates, or encoding cohort-specific exceptions.

## Chosen architecture

Use a hybrid contract:

1. Constrain the structural fields emitted by Gemini to reviewed canonical values in the response JSON schema and system prompt.
2. Normalize audited legacy/catalog aliases deterministically at the scorer boundary.
3. Keep visual and emotional identity expressive; do not reduce domains, emotional goals, visual signals, forbidden signals, or explicit constraints to a generic template category.
4. Preserve fail-safe routing: an unknown or unsupported structural concept remains ineligible and falls to `section_composition`.

This combines predictable model output with deterministic compatibility. Prompt-only enforcement is rejected because structured models may still drift among synonyms over time. Fuzzy matching is rejected because it could make unrelated structures appear compatible.

## Canonical contracts

Create versioned, immutable canonical lists for the fields used structurally by scoring. The initial lists are exact:

- Site types: `unknown`, `blog`, `business`, `business_presence`, `community_hub`, `content_platform`, `creator_hub`, `documentation_site`, `ecommerce`, `educational_resource`, `landing_page`, `newsletter`, `nonprofit_website`, `portfolio`, `product_landing_page`, `product_marketing`, `restaurant`, `restaurant_website`, `saas_product_page`, and `small_business`.
- Primary audiences: `unknown`, `children`, `parents`, `adults`, `developers`, `consumers`, `families`, `professionals`, `educators`, `creative_clients`, `businesses`, `gamers`, `fans`, `guests`, `donors`, `home_buyers`, `readers`, `citizens`, and `homeowners`.
- Section roles: `header`, `hero`, `about`, `services`, `features`, `how_it_works`, `programs`, `menu`, `events`, `reservations`, `booking`, `schedule`, `pricing`, `team`, `testimonials`, `gallery`, `clients`, `profile_summary`, `link_list`, `featured_content`, `content_list`, `social_links`, `faq`, `contact`, `call_to_action`, `footer`, `coloring_gallery`, `minigames`, `stories`, `activities`, `products`, `integrations`, `use_cases`, `case_studies`, `membership`, `location`, `blog`, `news`, and `newsletter`.

The exact lists live in code beside the intent contract and are referenced by both the response schema and prompt. They are not generated from the current 2A cohort or injected dynamically from the template catalog. An unsupported section is omitted and recorded as an ambiguity; section arrays do not accept `unknown`. The existing low-confidence ambiguity rule is extended so a structural `unknown` cannot be returned with high confidence.

## Alias and hierarchy policy

Only explicit reviewed mappings are allowed. Initial structural aliases include unambiguous relations such as:

- `origin_story`, `our_story`, and `mission` to `about`;
- `about_page`, `about_us`, `about_us_page`, and `about_us_section` to `about`;
- `reviews` and `social_proof` to `testimonials`;
- `workflow` and `process` to `how_it_works`;
- `event_list`, `event_listing`, `events_list`, and `events_page` to `events`;
- `image_gallery` and `media_gallery` to `gallery` (while `product_gallery` stays product-specific);
- `faq_page`, `pricing_page`, and `schedule_section` to their suffix-free roles;
- `contact_page`, `contact_us`, and `contact_form` to `contact`;
- `booking_form` and `booking_page` to `booking`;
- `restaurant_website` remains a distinct canonical site type, while spelling variants such as `e_commerce` and `non_profit_website` retain their existing aliases;
- reviewed audience specialties to their existing broad audience relation;
- reviewed site-type aliases and parent/child relations already represented by the catalog.

The prompt makes only generic category decisions: dining, café, bakery, bar, and wine-bar presences use `restaurant`; appointment-based wellness providers use `small_business`; software product marketing uses `saas_product_page`; open-source product promotion uses `product_landing_page`; creator link/resource pages use `creator_hub`; personal work showcases use `portfolio`; teaching-resource libraries use `educational_resource`; and documentation uses `documentation_site`. The compatibility hierarchy adds audited structural support from these canonical requirements to their narrower catalog specializations; it does not make the reverse relation exact.

Aliases must not collapse meaningfully different roles. In particular, `stories` is not `testimonials`, `minigames` is not generic `activities`, and a coloring gallery is not treated as proof of an education product. No edit-distance, embedding, substring, or unrestricted semantic similarity is permitted in the safety-critical route decision.

## Data flow

1. `analyzeIntent` asks Gemini for the existing intent object, with structural fields constrained to the canonical vocabulary.
2. The schema rejects values outside the vocabulary. `unknown` remains valid only under the existing ambiguity and confidence rule.
3. `rankTemplates` compares the canonical intent against published metadata through deterministic aliases/hierarchies.
4. `decideGenerationRoute` keeps the existing thresholds and eligibility rules unchanged.
5. The strict 2A canary still requires the exact qualified template and `template_skeleton` 15/15 before exposing any of the 75 adaptations.

## Versioning and compatibility

- Bump the intent prompt version because model-visible instructions and response schema change.
- Bump the taxonomy compatibility version because deterministic relations change.
- Qualification artifacts become stale automatically and must be regenerated on the final commit.
- Existing stored template metadata remains valid; normalization occurs during compatibility checks rather than rewriting all catalog rows.
- No normal OpenLen feature flag is enabled by this work.

## Privacy and observability

The live-canary 1.1 artifact remains the diagnostic boundary. It may persist only the already-approved qualified-template scores/reason codes and classification-match booleans/counts. It must not persist raw intent values, briefs, prompts, model responses, HTML, copy, identity, or ranked lists.

## Testing and acceptance

Implementation uses RED-GREEN TDD and must prove:

- the response schema uses the versioned structural enums;
- the prompt instructs canonical structural output while preserving functional/visual separation;
- every audited alias maps deterministically and unknown/unmapped values remain incompatible;
- distinct creative roles remain distinct;
- existing route thresholds are byte-for-byte unchanged;
- the 15 frozen cohort intents still select their qualified skeletons locally;
- selector holdouts and adversarial domain/identity tests remain green;
- no live Gemini call, database mutation, pilot run, deploy, migration, or flag change occurs during implementation.

The non-live completion gate is the focused intent/taxonomy/scorer/canary/qualification suites, full `npm.cmd test`, typecheck, rollback fixture, and diff/privacy audit. A later live canary requires a new explicit paid authorization. Success remains strict 15/15; failure writes redacted diagnostics and stops before reservations.

## Out of scope

- No threshold reduction.
- No forced qualified-template selection.
- No cohort-specific prompt examples or ID mappings.
- No fuzzy matching or embeddings in the route gate.
- No 2B section assembler changes.
- No 2C scratch generation changes.
- No UI, dependency, migration, deployment, or production flag work.
