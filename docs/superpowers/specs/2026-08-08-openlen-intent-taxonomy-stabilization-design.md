# OpenLen Intent Taxonomy Stabilization

**Date:** 2026-08-08
**Status:** Approved design, pending implementation plan

## Objective

Make OpenLen's intent classification stable enough for the strict Visual Engine 2A gate without weakening template allowlists, identity thresholds, fallback behavior, privacy, or budget controls. The change remains provider-compatible: Gemini supplies semantic analysis, while OpenLen owns canonical taxonomy and validation.

## Evidence and root cause

The corrected Gemini boundary succeeded, but the 15-case smoke produced 3 exact passes, 5 `section_composition` routes, 3 skeletons outside the allowlist, 3 schema failures, and 1 API failure. Among the 11 valid classifications, `contentModel` differed in 11, `siteType` in 5, audience in 2, and age range in 4.

The frozen cohort and prompt contain concrete contradictions. Examples include bakery/cafe being `business` in the cohort while the prompt requires dining/cafe/bakery to use `restaurant`, and prenatal movement being `business` while appointment-based wellness is directed to `small_business`. The audience guidance supports `educators` structurally but omits it from a later prose list. `contentModel` is a free descriptive slug and does not contribute to template scoring, so literal equality is useful telemetry but must not be treated as a canonical routing invariant.

## Chosen design

### 1. One canonical structural policy

Create or extend a single, testable policy for ambiguous structural categories. The policy must be expressed in general product terms, never pilot case IDs:

- public dining, cafe, bakery, wine bar, and taqueria presences use `restaurant`;
- appointment- or membership-based local wellness studios use `small_business`;
- child-focused creative programs use `children` as primary visual audience, with parents/families secondary when registration is adult-mediated;
- educator creator/resource hubs may use `educators` as primary audience;
- a newsletter/blog hybrid whose primary surface is an issue archive uses `blog`; a signup-first publication without an archive uses `newsletter`;
- unsupported classifications remain `unknown` with an ambiguity and confidence at or below 0.49.

The prompt and frozen 2A expected intents must consume the same decisions. Cohort expectations may change only where they contradict this policy. Template allowlists must not be widened automatically.

### 2. Deterministic provider request

Set intent temperature to `0`. Keep `responseMimeType: application/json` and do not restore the rejected complex provider schema. Add a compact JSON shape example plus explicit scalar/array requirements so required fields consistently satisfy OpenLen's existing strict Zod schema.

`schemaVersion` remains the literal `intent-analysis/1.0`; `functional.contentModel` remains one lowercase `snake_case` string. It is descriptive evidence, not a canonical enum and not a template-scoring signal.

### 3. Ranking and gate behavior

Do not lower structural, identity, audience, domain, adaptation-cost, or themeability thresholds. Do not accept `section_composition` as a 2A skeleton success. Do not accept a skeleton outside the reviewed per-case allowlist.

After aligning taxonomy, run the existing read-only qualification. If deterministic ranking selects a template outside an existing allowlist, stop and report the case and reason codes for human metadata review. Never mutate allowlists merely to make the pilot pass.

The live canary may continue reporting literal `contentModel` match as diagnostics, but exact content-model equality must not be interpreted as a route-quality gate because the scorer does not consume it.

## Data flow

1. A user brief enters `analyzeIntent`.
2. Gemini receives the semantic instructions at temperature zero and returns JSON without a provider-side complex schema.
3. OpenLen parses and validates the response with `IntentAnalysisSchema`.
4. Canonical structural policy and existing safety checks reject unsupported or contradictory values; no silent nearest-category fallback is introduced.
5. Existing deterministic ranking and route decision consume the validated intent.
6. The unchanged 2A canary compares the selected skeleton with the qualified allowlist and stops atomically on any mismatch.

## Error handling and privacy

- Invalid JSON or Zod output remains typed `parse`/`schema` failure with usage preserved when supplied.
- API failures remain typed `api`; no retry is introduced.
- Diagnostic telemetry may contain case IDs, match booleans, reason codes, token counts, cost, duration, and hashes only. It must not contain generated bodies, briefs, provider error bodies, secrets, or reviewer identity.
- No database reservation occurs until all 15 canary cases pass and the existing post-artifact freshness/quota gate succeeds.

## Verification

Implementation follows RED-GREEN TDD and must cover:

- provider request temperature zero and compact output-shape instructions;
- the canonical structural decisions above in both English and Spanish phrasing where applicable;
- prompt/cohort consistency for all 15 frozen cases;
- local Zod rejection of malformed scalar/array shapes;
- unchanged template thresholds, allowlists, no-retry behavior, budget guard, and zero-reservation failure barrier;
- stable qualification hash across two consecutive runs;
- focused intent, selection, scoring, qualification, canary, and CLI integration suites;
- TypeScript typecheck, rollback fixture, and diff/privacy audit.

No paid or live request is part of implementation verification. A later live confirmation or smoke requires separate explicit authorization.

## Non-goals

- No new Visual Engine phase.
- No provider migration.
- No template redesign or metadata auto-approval.
- No relaxation of the 2A quality gate.
- No changes to 2B/2C composition behavior.
- No rollout or production flag change.
