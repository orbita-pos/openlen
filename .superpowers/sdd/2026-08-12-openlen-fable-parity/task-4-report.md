# Task 4 report — expressive safe-section compiler and adaptive composition

**Date:** 2026-08-13
**Task:** Fable-Parity Task 4 only
**Commit message:** `feat(generation): compile expressive adaptive sections`

## Outcome

Task 4 adds a strict `expressive-section-program/1.0` AST, a repository-owned
HTML/CSS compiler, a GLM provider behind the Task 2 Fireworks gateway and shared
`PageBudget`, and an adaptive atomic composer for Task 3 `reuse` / `rebuild` /
`generate` decisions.

GLM can return only the bounded AST. It cannot return raw HTML, CSS, JavaScript,
selectors, URLs, imports, event names, or literal copy. The compiler owns every
tag, class, declaration, breakpoint, responsive rule, destination, media
attribute, motion keyframe, and reduced-motion fallback. No network, provider,
Gemini, database, migration, publication, Fable, deployment, environment, or
persistence mutation was performed. Tests use local provider and validator
doubles only.

## Scope ruling

The brief-owned files were changed, plus two controller-authorized files:

- `lib/curate/run-ai-creation.ts`;
- `lib/curate/run-ai-creation.test.ts`.

Task 4 added internal result code `budget_exceeded` to the composition union.
That made the pre-existing exhaustive public mapping in `run-ai-creation.ts`
incomplete and caused `TS2366`. HEAD did not contain `budget_exceeded` in the
union, while the Task 4 worktree did. The controller authorized the minimum TDD
expansion: one table row and one switch case mapping the internal code to the
existing redacted public code `creative_direction_failed`. No public taxonomy
was added; adaptive telemetry retains the internal budget code.

The brief asks for an independent review, but the controller explicitly
prohibited subagents/reviewers. A full self-review is recorded below instead.

## RED evidence

### Contract RED

```text
npm.cmd test -- lib/generation/expressive-section-contracts.test.ts
exit 1
Test Files: 1 failed (1)
Tests: no tests collected
Exact failure: expressive-section-contracts module did not exist.
```

The tests specify depth 5, 64 nodes, 12 unique media slots, unique IDs,
finite recursion, closed enums, contextual copy/asset allowlists, valid mobile
targets, strict provenance, and rejection of literal/implementation syntax.

### Compiler RED

```text
npm.cmd test -- lib/generation/expressive-section-compiler.test.ts
exit 1
Test Files: 1 failed (1)
Tests: no tests collected
Exact failure: expressive-section-compiler module did not exist.
```

The tests require escaped copy, repository-owned destinations/classes/CSS,
inert decorations, owned breakpoints and reduced motion, donor reconstruction
rejection, and four visibly distinct niche fixtures.

### GLM provider RED

```text
npm.cmd test -- lib/generation/glm-section-program-provider.test.ts
exit 1
Test Files: 1 failed (1)
Tests: no tests collected
Exact failure: glm-section-program-provider module did not exist.
```

The tests require one Task 2 client request, GLM designer policy, no local
retry, generate without donor data, rebuild with one verified fragment only,
structural redaction of copy/attributes/styles/URLs, strict response
revalidation, and redacted failure usage.

### Adaptive composition RED

```text
npm.cmd test -- lib/generation/adaptive-section-composition.test.ts
exit 1
Test Files: 1 failed (1)
Tests: no tests collected
Exact failure: adaptive-section-composition module did not exist.
```

The tests require page order, exact reuse, rebuild/generate separation, every
per-section gate, assembly only after all rows pass, final sanitizer/seal, no
partial HTML on failure, and originality rejection.

### Integration contract RED

```text
npm.cmd test -- lib/generation/section-composition-contracts.test.ts lib/generation/generated-section-contracts.test.ts
exit 1
Test Files: 2 failed (2)
Tests: 3 failed, 6 passed (9)
```

Exact failures were the missing expressive export, missing adaptive manifest,
and missing `budget_exceeded` result code.

### Authorized exhaustive-mapping RED

```text
npm.cmd test -- lib/curate/run-ai-creation.test.ts -t "budget_exceeded"
exit 1
Tests: 1 failed, 30 skipped (31)
Expected creative_direction_failed; received undefined.
```

### Public seam RED

```text
npm.cmd test -- lib/generation/generate-missing-section.test.ts lib/generation/compose-sections.test.ts -t "expressive missing|adaptive atomic"
exit 1
Test Files: 2 failed (2)
Tests: 2 failed, 21 skipped (23)
```

Exact failures were missing `generateExpressiveMissingSection` and missing
`composeAdaptiveSections` export.

### Self-review mutation RED

Canonical identity and rebuild provenance:

```text
npm.cmd test -- lib/generation/expressive-section-contracts.test.ts lib/generation/expressive-section-compiler.test.ts lib/generation/glm-section-program-provider.test.ts
exit 1
Test Files: 2 failed, 1 passed (3)
Tests: 2 failed, 17 passed (19)
```

- renaming all node IDs changed `programHash`, permitting disguised duplicates;
- a valid compiled donor fingerprint did not equal a re-fingerprint of its
  stored scoped fragment, so a valid rebuild was rejected.

The cyclic-object case already failed closed due the finite depth-expanded
schema; it was retained as characterization/regression coverage and required no
production change.

Normalized originality:

```text
npm.cmd test -- lib/generation/adaptive-section-composition.test.ts -t "fingerprints collapse"
exit 1
Tests: 1 failed, 3 skipped (4)
```

Two generated sections with the same geometry but different roles, copy keys,
and IDs were incorrectly accepted because the composer used scoped derived
fingerprints rather than the compiler's normalized AST fingerprint.

Verified fragment reader:

```text
npm.cmd test -- lib/generation/adaptive-section-composition.test.ts -t "executes decisions"
exit 1
Tests: 1 failed, 3 skipped (4)
```

The composer passed an always-null reader instead of the injected verified
storage reader.

## GREEN implementation

### Strict AST and provenance

- Seven layout presets: stack, flex, grid, split, collage, bento, layered.
- Heading, body, list, quote, stat, badge, action, bounded media, and decorative
  shape/divider/texture nodes.
- Maximum depth 5, maximum 64 nodes, maximum 12 media nodes, unique node IDs,
  unique media slots, finite recursion, and unique valid mobile/motion targets.
- All visual values are closed enums: space, width, columns, alignment, color
  roles, radius, border, transform, blend, media treatment/aspect/fit, opacity,
  motion, intensity, and delay.
- Contextual validation binds every copy key and asset slot to the repository
  allowlists. Strict objects reject unknown implementation or copy fields.
- Generate provenance forbids every donor field; rebuild/reuse provenance binds
  candidate, source content/fingerprint, and paired template/band provenance.

### Repository compiler

- Node IDs become ordinal repository classes and never appear in delivered
  markup.
- Copy is HTML-escaped; copy keys never appear in markup.
- Actions use only repository destinations (`#contact` or owned action IDs).
- Decorations are pointer-inert and `aria-hidden`; empty media is also hidden.
- Repository CSS owns responsive breakpoints, class selectors, all dimensions,
  transforms, keyframes, and `prefers-reduced-motion` behavior.
- Canonical program hashes normalize node IDs and reference targets, so ID-only
  renames collide as intended.
- Structural fingerprints omit role, IDs, copy keys, and asset indexes, so the
  same geometry cannot masquerade as original through metadata changes.
- Rebuild rejects either a donor content-hash or normalized fingerprint match.

### GLM boundary

- Uses only Task 2 `FireworksJsonClient`, which requires the shared
  `PageBudget` and owns the single permitted transport retry.
- Uses designer role, GLM model policy, high reasoning, one strict schema call,
  and no local retry/model carousel.
- Generate payload has no inspiration/candidate/template/fragment fields.
- Rebuild accepts exactly one candidate chosen by Task 3 after hash/fragment
  verification. The model sees provenance plus a bounded tag-only fragment and
  node-count/depth summary—never whole document, styles, attributes, selectors,
  URLs, scripts, or copy values.
- The stored donor structural fingerprint is preserved as provenance; it is not
  incorrectly recomputed from the later scoped fragment.
- Invalid JSON/schema/provider failures preserve only model ID, usage, duration,
  and attempts.

### Atomic adaptive composition

- Decisions execute in narrative order.
- Reuse fetches and retains the exact verified fragment bytes.
- Rebuild passes only its one chosen verified fragment and bounded provenance.
- Generate contains zero donor provenance.
- `generateExpressiveMissingSection` is the single provider-to-compiler seam;
  `compose-sections` exports the atomic adaptive entrypoint.
- Every row passes expressive compilation where applicable, derived compilation,
  component/semantic compatibility, assets, desktop/mobile render and overflow,
  sanitizer equality, and originality checks.
- Assembly starts only after every requested row passes. The complete document
  is sanitized and must obtain a successful final seal. Failure returns only a
  typed redacted result/manifest, never partial HTML.
- Normalized AST fingerprints and ID-normalized program hashes feed the existing
  adaptive originality policy. Rebuild donor reconstruction and shared-program
  mutations fail.

### Expressiveness fixtures

Deterministic fixtures cover:

- VHS horror: layered composition, film media, grain, drift;
- children's coloring: collage, paper media, star, stagger;
- editorial food: asymmetric split, quote/rule, bleed media, reveal;
- luxury hotel: bento, framed suite media, stat/orbit, fade-up.

They share the same safe vocabulary and compile to four distinct structural
fingerprints, program hashes, layouts, media treatments, and motion/decorative
treatments.

## GREEN evidence

Focused contracts/compiler:

```text
npm.cmd test -- lib/generation/expressive-section-contracts.test.ts lib/generation/expressive-section-compiler.test.ts
exit 0
Test Files: 2 passed (2)
Tests: 11 passed (11)
```

GLM provider:

```text
npm.cmd test -- lib/generation/glm-section-program-provider.test.ts
exit 0
Test Files: 1 passed (1)
Tests: 7 passed (7)
```

Adaptive composition:

```text
npm.cmd test -- lib/generation/adaptive-section-composition.test.ts
exit 0
Test Files: 1 passed (1)
Tests: 4 passed (4)
```

Integration contracts:

```text
npm.cmd test -- lib/generation/section-composition-contracts.test.ts lib/generation/generated-section-contracts.test.ts
exit 0
Test Files: 2 passed (2)
Tests: 9 passed (9)
```

Authorized budget mapping plus typecheck:

```text
npm.cmd test -- lib/curate/run-ai-creation.test.ts -t "budget_exceeded"
exit 0
Tests: 1 passed, 30 skipped (31)
npm.cmd run typecheck
exit 0
```

Public seams:

```text
npm.cmd test -- lib/generation/generate-missing-section.test.ts lib/generation/compose-sections.test.ts -t "expressive missing|adaptive atomic"
exit 0
Test Files: 2 passed (2)
Tests: 2 passed, 21 skipped (23)
```

Required focused suite before final fresh verification:

```text
npm.cmd test -- lib/generation/expressive-section-contracts.test.ts lib/generation/expressive-section-compiler.test.ts lib/generation/glm-section-program-provider.test.ts lib/generation/adaptive-section-composition.test.ts lib/generation/generated-section-contracts.test.ts lib/generation/compose-sections.test.ts lib/generation/section-composition-contracts.test.ts
exit 0
Test Files: 7 passed (7)
Tests: 49 passed (49)
```

Required gates before the final post-report run:

```text
npm.cmd run generation:template-derived-sections:gate
exit 0
Test Files: 19 passed (19)
Tests: 212 passed (212)
```

```text
npm.cmd run generation:ai-hybrid:gate
exit 0
Test Files: 20 passed (20)
Tests: 257 passed (257)
```

The gates emit the pre-existing Vite CJS deprecation warning. The derived and
AI-hybrid gates also emit intentional stderr from explicit-template-clone
failure fixtures; every assertion passed.

## Final verification

Fresh verification after the last test-only type narrowing:

```text
npm.cmd test -- lib/generation/expressive-section-contracts.test.ts lib/generation/expressive-section-compiler.test.ts lib/generation/glm-section-program-provider.test.ts lib/generation/adaptive-section-composition.test.ts lib/generation/generated-section-contracts.test.ts lib/generation/compose-sections.test.ts lib/generation/section-composition-contracts.test.ts
exit 0
Test Files: 7 passed (7)
Tests: 55 passed (55)
```

```text
npm.cmd run generation:template-derived-sections:gate
exit 0
Test Files: 19 passed (19)
Tests: 212 passed (212)
```

```text
npm.cmd run generation:ai-hybrid:gate
exit 0
Test Files: 20 passed (20)
Tests: 257 passed (257)
```

```text
npm.cmd run typecheck
exit 0
tsc --noEmit

git diff --check
exit 0
```

The first in-sandbox attempt to run the final AI-hybrid gate could not load
`vitest.config.ts` because esbuild was denied access above the workspace. The
identical command was rerun with filesystem permission and passed 257/257; this
was an environmental startup denial, not a test failure. The commit hash is
returned in the controller handoff because embedding a commit's own hash in a
file contained by that commit is self-referential.

## Mutations proved

- depth 6, node 65, media 13;
- duplicate/cyclic node structures, duplicate media slots;
- missing/non-layout/duplicate mobile targets and unknown motion;
- literal copy, HTML, CSS, selector, URL, script, event, import, arbitrary
  colors/transforms/sizes/extreme dimensions;
- unknown copy keys and asset slots;
- generate with donor data and rebuild without donor identity;
- provider role drift and allowlist drift after a claimed success;
- whole-document/scripted/hash-stale fragment input;
- rebuild equal to donor content hash or fingerprint;
- same program renamed by node IDs;
- same structure hidden behind different roles/copy keys/IDs;
- all final fingerprints collapsed;
- exact-reuse byte drift;
- provider, semantic, asset, render, sanitizer, assembly/seal atomic failure;
- missing real storage reader;
- internal budget exhaustion leaking into an undefined public reason.

## Files

Brief-owned new files:

- `lib/generation/expressive-section-contracts.ts` and test;
- `lib/generation/expressive-section-compiler.ts` and test;
- `lib/generation/glm-section-program-provider.ts` and test;
- `lib/generation/adaptive-section-composition.ts` and test.

Brief-owned modified files:

- `lib/generation/generated-section-contracts.ts` and test;
- `lib/generation/generate-missing-section.ts` and test;
- `lib/generation/compose-sections.ts` and test;
- `lib/generation/section-composition-contracts.ts` and test.

Controller-authorized load-bearing files:

- `lib/curate/run-ai-creation.ts` and test.

This report is the only non-code file. No package, lockfile, environment,
database, migration, publication, deployment, generated artifact, or unrelated
user/untracked file was changed.

## Self-review

- Re-read the exact Task 4 brief and design after implementation.
- Confirmed the model schema has no raw implementation/copy/URL field and all
  objects are strict.
- Confirmed generated node IDs never enter HTML and ID-only renames share one
  program hash.
- Confirmed structural originality uses normalized AST geometry, not scoped IDs,
  role labels, copy keys, or asset indexes.
- Confirmed rebuild binds its selected candidate in both Task 3 metadata and the
  frozen inventory before fetching bytes.
- Confirmed only the chosen rebuild fragment reaches the provider, after exact
  content hash and fragment-shape verification, and it is redacted to tags only.
- Confirmed generate has no donor/candidate/template/fragment provenance.
- Confirmed `fetchText` is propagated to the existing frozen-source verifier.
- Confirmed no assembly, seal, persistence, or HTML result exists on any row
  failure.
- Confirmed all success rows pass derived, semantic, assets, desktop/mobile,
  sanitizer, originality, final sanitizer, and seal gates.
- Confirmed the Task 2 client remains the only owner of retry and budget
  reservation; the provider/composer add neither.
- Confirmed telemetry contains only prompt version, model ID, usage, duration,
  attempts, result code, and hashes—no prompts, copy, HTML, URL, raw response,
  credential, screenshot, or identity.
- Confirmed no reviewer/subagent was used, per the controller restriction.
- Confirmed unrelated user-owned/untracked files were not edited, removed,
  reset, cleaned, restored, or selected for staging.

## Concerns

- Provider compatibility is local-only as required. A live GLM canary belongs
  to the later explicitly authorized rollout task.
- Task 4 exposes the adaptive entrypoint and all deterministic dependencies;
  Task 5 owns end-to-end image, visual-critic, repair, and Create-with-AI
  orchestration. No live route was switched prematurely.

## Commit

Only the files enumerated above plus this report will be staged, using:

```text
feat(generation): compile expressive adaptive sections
```
