# Visual Engine 2A qualified pilot cohort operations

This document is the operational handoff for the bounded 2A cohort. It does not authorize a live run. `OPENLEN_VISUAL_ENGINE` stays `off`; the completed canary code must not run live without new explicit approval.

## Required order and authorization boundary

Perform the following order without skipping or combining gates:

1. Establish stable qualification with the read-only checkpoint: `npm.cmd run generation:visual-engine-2a:qualify`.
2. Have a human review the resulting qualification manifest and selected-template distribution.
3. Freeze the current provider rate card and dated FIX/USD-MXN basis.
4. Obtain new explicit approval for the complete paid footprint.
5. Run the strict 15/15 live canary, one intent request per frozen base case, sequentially with a 6-second pause before each request after the first.
6. Atomically write the redacted canary artifact, then pass the post-write freshness/quota gate.
7. Run the frozen 75 adaptations using the 15 successful in-memory selections.
8. Conduct the blinded review, regenerate non-live rollback evidence, and run the unchanged score gates.

The prior paid authorization was consumed by the stopped 75-analysis run. It cannot be reused for this or any other live evaluation. The new code must not be run live yet; its 15 paid intent requests and any following 75 adaptations require a new explicit approval. Selector adversarial cases remain separate from the 2A cohort. Complex coloring, minigames, and stories belong to 2B, not to a replacement 2A row or route.

## Ignored, redacted aggregate artifacts

Both artifacts belong under ignored `scratch/visual-engine-2a/`; they must never be staged, shared with raw inputs, or edited to make a check pass.

`scratch/visual-engine-2a/qualification.json` has schema version `visual-engine-2a-qualification/1.0` and only records `datasetVersion`, `datasetSha256`, `catalogSha256`, `commitSha`, prompt/policy/taxonomy versions, the 15 redacted case identifiers with selected template IDs and allowlist hashes, qualified template IDs with metadata/HTML/inventory hashes, `baseCaseCount: 15`, `expandedRowCount: 75`, and `manifestSha256`.

`scratch/visual-engine-2a/live-canary.json` has schema version `visual-engine-2a-live-canary/1.1`. Its binding allowlist is schema/dataset/qualification/catalog/commit identifiers or hashes; model, prompt, policy, taxonomy and rate-card versions; exactly 15 rows containing only `caseId`, route, selected template ID or `null`, decision structural/identity/adaptation scores or `null`, typed result code, usage counters or `null`, `intentSha256`, the already-qualified template ID with its eligibility, fit/cost scores, themeability and typed reason codes, and classification-match booleans plus expected/observed/exact-overlap counts for sections and domains; aggregate counts, token/cost/duration values; `reservationCount=0`; and the canonical `reportSha256` self-hash. It never stores raw classification values or a ranked list.

Full intents stay in process memory. The artifact must never contain a brief, complete intent, ranked results, prompt, response, HTML, copy, profile, image, screenshot, provider error body, key, secret, email, reviewer identity, message or absolute path. A failure writes the same redacted terminal shape when the writer is available and stops before reservations.

Qualification is read-only: `npm.cmd run generation:visual-engine-2a:qualify` makes no provider call and no database write. It is stale if the candidate commit, catalog, cohort/hash-bound material, prompt, policy, taxonomy, metadata, HTML, or inventory differs from the manifest. Stop, re-run qualification, and obtain a new human review; do not edit hashes or metadata to force freshness.

## Live canary and accounting rules

The live runner starts only from the stable qualified manifest and exact quota state `limit=75`, `used=0`, `existingRuns=0`. It performs exactly 15 sequential selections over the `plain` representative rows, one per case, with a 6-second pause before each request after the first and no retry or replacement. Success is strict 15/15: every response must be usage-complete and version-compatible, choose `template_skeleton`, stay in the case allowlist, and equal the qualified template ID.

The runner atomically writes the redacted canary before any adaptation reservation, then rechecks HEAD, recomputed qualification hashes, HEAD again, and exact zero-use quota. Only then does it reuse one successful selection per case across five scenarios and expose 75 adaptations. Missing canary usage sets token/cost aggregates to `null` and fails the canary; do not replace missing evidence with zero.

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
