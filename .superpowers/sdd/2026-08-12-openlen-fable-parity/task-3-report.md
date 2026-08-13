# Task 3 report — adaptive visual scouting and page design program

**Date:** 2026-08-13
**Task:** Fable-Parity Task 3 only
**Commit message:** `feat(generation): plan adaptive visual compositions`

## Outcome

Task 3 adds a catalog-optional adaptive path. OpenLen builds the required role
plan without depending on catalog coverage, deterministically retrieves at most
12 compatible candidates and at most three for a role, verifies and renders
their fragments into one labeled JPEG contact sheet, asks Qwen for one strict
`reuse` / `rebuild` / `generate` decision per role, and asks DeepSeek for one
strict coherent page program. There is no catalog quota or minimum reuse count;
an all-`generate` response and a final page with zero real donors are valid.

No Fireworks, Gemini, network, database, migration, publication, Fable,
deployment, or environment mutation was performed. Provider tests used local
HTTP doubles only. The repository already contained `@inariwatch/capture`; this
task did not create a Node project or alter monitoring configuration.

## Scope ruling

Self-review found a real contradiction before scope widening: Task 3 required
Qwen to see the contact sheet through Task 2's gateway, while Task 2's exact
`FireworksJsonRequest` accepted only string message content. Embedding base64 in
JSON would deliver text, not vision. Work paused and the controller authorized
the minimum TDD expansion to:

- `lib/ai/fireworks-contracts.ts`;
- `lib/ai/fireworks-client.ts`;
- `lib/ai/fireworks-client.test.ts`.

The approved contract permits one OpenAI-compatible JPEG `image_url` block only
in a `visual_critic` user message. System, reasoner, and designer messages stay
text-only. The data URI must be canonical base64 with exact `image/jpeg` MIME,
nonempty, and at most one MiB. HTTP/file/private URLs, query strings,
credentials, alternate MIME types, duplicate images, malformed base64, unknown
keys, and oversized bytes fail before HTTP. Retry payload identity and the
mandatory shared `PageBudget` remain unchanged.

No other scope expansion occurred. The brief's independent-review step was
replaced by self-review because the controller explicitly prohibited a
subagent/reviewer.

## RED evidence

### Initial Task 3 RED

The sandbox-local command first failed before collection because esbuild could
not read a parent directory. The authoritative rerun used the approved
`npm.cmd test` execution outside that filesystem restriction:

```text
npm.cmd test -- lib/generation/adaptive-design-contracts.test.ts lib/generation/visual-candidate-scout.test.ts lib/generation/page-design-program.test.ts lib/generation/section-inventory.test.ts lib/generation/section-plan.test.ts lib/ai/visual-quality-renderer.test.ts
exit 1
Test Files: 6 failed (6)
Tests: 6 failed, 42 passed (48)
```

Exact intended failures:

- the three new modules did not exist;
- `planAdaptiveSectionComposition` did not exist;
- `retrieveAdaptiveSectionCandidates` and
  `hasAdaptiveSectionOriginality` did not exist;
- `renderVisualCandidateContactSheet` did not exist.

### Multimodal gateway RED after the scope ruling

```text
npm.cmd test -- lib/ai/fireworks-client.test.ts lib/generation/visual-candidate-scout.test.ts
exit 1
Test Files: 2 failed (2)
Tests: 2 failed, 39 passed (41)
```

Exact intended failures:

- the gateway rejected the valid Qwen JPEG content array before HTTP;
- the scout still delivered one textual JSON/base64 string rather than a text
  part plus native `image_url` part.

The invalid multimodal mutation rows already failed closed under the old
string-only boundary. The positive case and consumer seam were the mutations
that proved the missing visual capability.

## GREEN implementation

### Strict adaptive contracts

- `CandidateDecisionSchema` implements the exact bounded strict shape.
- `reuse` and `rebuild` require a candidate; `generate` forbids one.
- Decisions require unique contiguous ordinals and unique non-null candidate
  IDs; candidate references are bound to the retrieved ID, ordinal, and role.
- Program narrative must contain every required role exactly once and align
  with decisions.
- Required/forbidden signals, traits, image slots, copy keys, and all arrays
  have explicit bounds and duplicate checks where applicable.
- Output vocabulary is enums, taxonomy slugs, structured colors/tokens, copy
  key names, and asset indexes. Raw URLs, HTML, CSS, JavaScript, selectors, and
  literal copy cannot pass the model-owned schemas.
- `minimumCatalogSections` is not a field; strict parsing rejects it. The test
  fixture with every decision set to `generate` is valid.

### Adaptive planning and candidate retrieval

- Historical `planSectionComposition` and `resolveSectionPlan` remain public
  and preserve their donor-based behavior for existing callers.
- `planAdaptiveSectionComposition` plans canonical roles even when the catalog
  has no matching entry, allowing later generation.
- Shared deterministic semantic ranking applies hard-negative eligibility
  before fragment fetch, rendering, or provider calls.
- Round-robin retrieval is deterministic, globally unique, capped at 12 for
  the page and three for any role, and exposes metadata only—never HTML or
  storage URLs.
- Only frozen, hash-matching, fragment-shaped bytes reach the contact sheet;
  whole documents remain rejected by the existing fragment verifier.

### Contact sheet and provider boundaries

- The contact sheet uses the existing calibrated renderer pool, browser reuse,
  SSRF guard, deterministic settling, desktop dimensions, JPEG quality, and
  one-MiB output guard. It adds repository-owned ordinal/role/candidate labels
  and renders once for the page.
- Qwen receives only synthetic allowlisted intent, structured creative
  requirements, role/candidate IDs, and one native bounded JPEG block.
- The gateway permits that one image only for `visual_critic`; request payload
  serialization occurs once, so the existing one permitted transport retry is
  byte-identical and reserves the page budget again before fetch.
- DeepSeek receives Qwen's bounded decisions/traits, candidate metadata,
  synthetic intent, initial direction, and copy-key names. It never receives
  the screenshot, fragment HTML, storage URL, or copy value.
- The contextual DeepSeek schema requires it to reproduce Qwen's decisions
  exactly; mutation fails as `schema` with usage preserved.
- Scout and planner each call the Task 2 client exactly once. There is no local
  retry, model carousel, or recursive creative loop.

### Adaptive originality

`hasAdaptiveSectionOriginality` requires:

- at least three distinct final structural fingerprints;
- unique non-null program hashes for every `rebuild` / `generate` output;
- no three adjacent candidate inspirations reconstructing sequential bands
  from one donor;
- no more than two direct `reuse` decisions from one donor.

Generated rows require no donor provenance, so zero real donors is valid.

## GREEN evidence

Initial Task 3 GREEN:

```text
npm.cmd test -- lib/generation/adaptive-design-contracts.test.ts lib/generation/visual-candidate-scout.test.ts lib/generation/page-design-program.test.ts lib/generation/section-inventory.test.ts lib/generation/section-plan.test.ts lib/ai/visual-quality-renderer.test.ts
exit 0
Test Files: 6 passed (6)
Tests: 56 passed (56)
```

Multimodal GREEN:

```text
npm.cmd test -- lib/ai/fireworks-client.test.ts lib/generation/visual-candidate-scout.test.ts
exit 0
Test Files: 2 passed (2)
Tests: 41 passed (41)
```

An intermediate typecheck found seven test-double errors: generic gateway
methods widened `ok` / `attempts`, and a readonly creative fixture was supplied
without schema parsing. The doubles now implement the real generic method and
the fixture is parsed through `CreativeDirectionSchema`. The next typecheck
passed.

Expanded focused regression after all changes:

```text
npm.cmd test -- lib/ai/fireworks-client.test.ts lib/generation/adaptive-design-contracts.test.ts lib/generation/visual-candidate-scout.test.ts lib/generation/page-design-program.test.ts lib/generation/section-inventory.test.ts lib/generation/section-plan.test.ts lib/ai/visual-quality-renderer.test.ts
exit 0
Test Files: 7 passed (7)
Tests: 95 passed (95)
Vitest duration: 3.86s
```

Required derived-section gate:

```text
npm.cmd run generation:template-derived-sections:gate
exit 0
Test Files: 19 passed (19)
Tests: 207 passed (207)
Vitest duration: 11.04s
```

The test runs emitted the pre-existing Vite CJS deprecation warning. The gate
also emitted intentional stderr from explicit-template-clone failure fixtures;
all assertions passed. Fresh final typecheck and staged diff checks are recorded
below after this report is included.

## Files

Brief-owned Task 3 files:

- new `lib/generation/adaptive-design-contracts.ts` and test;
- new `lib/generation/visual-candidate-scout.ts` and test;
- new `lib/generation/page-design-program.ts` and test;
- modified `lib/generation/section-inventory.ts` and test;
- modified `lib/generation/section-plan.ts` and test;
- modified `lib/ai/visual-quality-renderer.ts` and test;
- this report.

Controller-authorized visual gateway files:

- modified `lib/ai/fireworks-contracts.ts`;
- modified `lib/ai/fireworks-client.ts` and test.

No package, lockfile, environment, database, migration, publication, or
deployment file changed.

## Self-review

- Confirmed no `minimumCatalogSections`, minimum reuse count, or minimum donor
  count exists in the adaptive contracts or selection path.
- Confirmed deterministic semantic rejection occurs before fetch/render/Qwen;
  the rejected candidate ID, HTML, and URL never appear in the provider payload.
- Confirmed Qwen gets one visual `image_url`, not textual base64, and DeepSeek
  gets neither image bytes nor contact-sheet metadata.
- Confirmed reasoner/designer/system image mutations fail before HTTP; image
  URI/MIME/base64/count/byte limits and unknown content-part keys fail closed.
- Confirmed Qwen and DeepSeek response schemas are strict at the gateway and
  parsed again through contextual Zod refinements.
- Confirmed all-generate survives Qwen and page-program validation.
- Confirmed legacy selector tests and the full derived-section gate pass.
- Confirmed adaptive originality checks structural fingerprints and program
  hashes directly, permits zero donors, and retains sequence/direct-reuse caps.
- Confirmed no production `fetch`, Gemini import, logger, raw response retention,
  screenshot telemetry, prompt telemetry, or second creative request was added.
- Confirmed user-owned/untracked workspace files were not edited, removed,
  reset, cleaned, or staged.
- No independent review was run because subagents/reviewers were explicitly
  prohibited; this section records the required self-review instead.

## Concerns

- Provider compatibility is verified only with local HTTP doubles, as required.
  A later explicitly authorized canary must validate Fireworks' live multimodal
  dialect and Qwen vision behavior.
- The one-MiB JPEG ceiling matches the existing renderer boundary. The shared
  budget can still reject a large but otherwise valid contact sheet before HTTP
  when its conservative byte-based input reservation would exceed 10 MXN; this
  is intentional fail-closed behavior.

## Commit

Only the exact Task 3 files and the three controller-authorized gateway files
will be staged. The required message is:

```text
feat(generation): plan adaptive visual compositions
```

The resulting hash is returned in the controller handoff; embedding a commit's
own hash in a file contained by that commit is self-referential.

## Final verification

Fresh post-report expanded focused suite:

```text
npm.cmd test -- lib/ai/fireworks-client.test.ts lib/generation/adaptive-design-contracts.test.ts lib/generation/visual-candidate-scout.test.ts lib/generation/page-design-program.test.ts lib/generation/section-inventory.test.ts lib/generation/section-plan.test.ts lib/ai/visual-quality-renderer.test.ts
exit 0
Test Files: 7 passed (7)
Tests: 95 passed (95)
Vitest duration: 4.32s
```

Fresh required derived-section gate:

```text
npm.cmd run generation:template-derived-sections:gate
exit 0
Test Files: 19 passed (19)
Tests: 207 passed (207)
Vitest duration: 9.19s
```

Fresh final typecheck:

```text
npm.cmd run typecheck
> tsc --noEmit
exit 0
```

Only the pre-existing Vite warning and intentional explicit-clone failure
fixture stderr described above were emitted. The staged diff check and scoped
commit are recorded by the final controller handoff.
