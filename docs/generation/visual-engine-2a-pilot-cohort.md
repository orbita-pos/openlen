# Visual Engine 2A qualified pilot cohort operations

This document is the operational handoff for the bounded 2A cohort. It does not authorize a live run. `OPENLEN_VISUAL_ENGINE` stays `off`; a future paid evaluation must not run without new explicit approval.

## Required order and authorization boundary

Perform the following order without skipping or combining gates:

1. Run the read-only qualification checkpoint: `npm.cmd run generation:visual-engine-2a:qualify`.
2. Have a human review the resulting qualification manifest and its selected-template distribution.
3. Immediately before any approval, freeze the current provider rate card and dated FIX/USD-MXN basis.
4. Obtain new, explicit authorization for the complete paid footprint.
5. Run the one live evaluation only after that authorization: `npm.cmd run generation:visual-engine-2a:eval`.
6. Conduct the blinded review.
7. Regenerate non-live rollback evidence.
8. Run the unchanged scorecard gates.

The prior paid authorization was consumed by the stopped 150-call preflight. It cannot be reused for this or any other live evaluation. Selector adversarial cases remain separate from the 2A cohort. Complex coloring, minigames, and stories belong to 2B, not to a replacement 2A row or route.

## Ignored, redacted aggregate artifacts

Both artifacts belong under ignored `scratch/visual-engine-2a/`; they must never be staged, shared as evidence with raw inputs, or edited to make a check pass. They are redacted aggregate schemas: no brief, copy, HTML, profile, prompt, raw response, user/reviewer identity, email, secret, API key, provider error body, screenshot, or absolute local path belongs in either file.

`scratch/visual-engine-2a/qualification.json` has schema version `visual-engine-2a-qualification/1.0` and only records `datasetVersion`, `datasetSha256`, `catalogSha256`, `commitSha`, prompt/policy/taxonomy versions, the 15 redacted case identifiers with selected template IDs and allowlist hashes, qualified template IDs with metadata/HTML/inventory hashes, `baseCaseCount: 15`, `expandedRowCount: 75`, and `manifestSha256`.

`scratch/visual-engine-2a/preflight.json` has schema version `visual-engine-2a-preflight/1.0` and records dataset/qualification/commit hashes, model and prompt/policy/taxonomy/rate-card versions, aggregate route counts, aggregate token usage or `null`, `usageComplete`, aggregate production-equivalent cost or `null`, duration, `reservationCount=0`, and `reportSha256`. It contains no per-row selection response or generated output.

Qualification is read-only: `npm.cmd run generation:visual-engine-2a:qualify` makes no provider call and no database write. It is stale if the candidate commit, catalog, cohort/hash-bound material, prompt, policy, taxonomy, metadata, HTML, or inventory differs from the manifest. Stop, re-run qualification, and obtain a new human review; do not edit hashes or metadata to force freshness.

## Live preflight and accounting rules

The live runner starts only from the qualified manifest and rechecks its commit and current aggregate hashes. It requires a 75/75 barrier: exactly 75 eligible `template_skeleton` rows from the frozen 75-row cohort, with no existing run and quota state of limit `75`, used `0`. Until that barrier is met, preflight keeps `reservationCount=0` and no row is reserved.

Preflight writes its aggregate report before any adaptation reservation. When selector usage is incomplete, the aggregate report sets `usageComplete` false and token/cost aggregates to `null`; do not replace that missing evidence with zero. The final scorecard still requires cost evidence for all 75 starts, so usage-incomplete evidence cannot satisfy the unchanged score gates.

There are no replacement rows. A provider failure, invalid output, render failure, crash, missing persistence, or an abandoned started row consumes its reservation and remains in the 75-start denominator. Mark a truly stale `started` run as `abandoned` after the existing one-hour inspection, but never decrement quota, delete a row, reuse an ordinal, retry a row, or replace it with a more attractive result.

## Blind review, rollback, and scorecard

The reviewer source covers 72–75 hash-verified technically successful candidate manifests, exactly one manifest per successful candidate and none for a technical failure. Every successful candidate receives one valid blind verdict; failures and abandoned starts remain in the denominator. Do not put reviewer identity or session data in the ledger or tracked evidence.

Regenerate rollback proof on the evaluated commit. Use the package command:

```powershell
npm.cmd run generation:visual-engine-2a:rollback-check
```

If invoking `tsx` directly, use the server-only shim:

```powershell
npx.cmd tsx --env-file=.env.local --tsconfig tsconfig.eval.json --require ./scripts/test-node-server-only-shim.cjs scripts/visual-engine-2a-rollback-check.ts
```

Rollback evidence is non-live and may create only ignored fixture evidence; it must make no model or database call. The final scorecard gates are unchanged: exactly 75 starts, at least 72/75 technical success, complete valid blind review, the existing blind-preference threshold, zero structural/behavior/data failures, zero partial persistence, zero accepted forbidden signals, complete cost evidence below the existing limit, and the verified unset/off/shadow rollback fixture. A passing scorecard still does not enable `skeleton`; a separate rollout decision is required.
