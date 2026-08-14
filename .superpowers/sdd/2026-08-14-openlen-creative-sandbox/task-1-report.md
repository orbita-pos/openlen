# Task 1 Report: Provider-Free Baseline and Last-Known-Good Contract

## Scope completed

- Added `SafeCreativeCandidate` to the shared creation contracts with the
  baseline, DeepSeek, and repair source states.
- Added `buildCreativeBaseline`, which builds intent/copy locally, composes
  catalog fragments with an injected local fill and deterministic adaptation,
  finalizes, seals, renders, and returns only a sealed valid candidate.
- Added a local role-owned text replacement pass for every visible text leaf
  under each `data-openlen-role` section. It escapes inserted copy and leaves no
  donor-visible text in the accepted candidate.
- Reworked deterministic niche matching to return its score. A zero-score brief
  now uses a conservative marketing intent rather than borrowing the first
  reviewed cohort row.
- Added baseline coverage for Mundo Pincel without a provider, unavailable
  inventory, and full donor-copy replacement; added English and Spanish
  zero-score fallback coverage with quoted names and required structural roles.

## Provider boundary

`buildCreativeBaseline` does not invoke a provider. It injects both
`fillAssembled` and `adaptTemplateSkeleton` into `composeSectionCandidate`:

- local fill uses `node-html-parser` plus escaped deterministic business copy;
- local adaptation emits the repository-owned deterministic creative direction;
- no generated-section fallback, asset mode, or provider dependency is supplied.

The visual render gate rejects missing renders, mobile overflow, and invalid
geometry. Weak typography remains advisory as required.

## Verification evidence

RED command, before implementation:

```powershell
npm.cmd test -- lib/curate/creative-baseline.test.ts lib/curate/deterministic-page-input.test.ts lib/generation/compose-sections.test.ts lib/curate/finalize-composed-document.test.ts
```

Result: failed as expected because `creative-baseline.ts` did not exist and the
old niche matcher did not expose a score. The pre-existing composition and
finalization suites still collected and passed.

GREEN command, after implementation:

```powershell
npm.cmd test -- lib/curate/creative-baseline.test.ts lib/curate/deterministic-page-input.test.ts lib/generation/compose-sections.test.ts lib/curate/finalize-composed-document.test.ts
```

Result: 4 files passed, 33 tests passed.

Type check:

```powershell
npm.cmd run typecheck
```

Result: exited 0.

Diff check:

```powershell
git diff --check
```

Result: exited 0. A staged diff check is also run immediately before commit.

## Known constraint

The existing `IntentAnalysisSchema` requires at least one domain and a
confidence field, while the approved fallback sketch uses an empty domain list
and omits confidence. The implementation preserves the approved conservative
roles/language behavior and uses `domains: ["general"]` and `confidence: 0` so
the result remains a valid `IntentAnalysis` without claiming a reviewed niche.
