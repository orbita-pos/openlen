# OpenLen Visual Engine 2A Live Canary Design

**Status:** Approved by the user on 2026-08-08.

## Objective

Replace the production-equivalent pilot's 75 duplicate intent analyses with one paid, bounded analysis for each of the 15 frozen base cases. The canary must prove that the live model selects the already-qualified skeleton for every base case before OpenLen reserves any of the 75 adaptation rows.

This is a pilot safety boundary. It does not change the user-facing Quick route, enable `skeleton`, alter selector thresholds, or implement 2B/2C.

## Evidence and root cause

The qualified 2A manifest is stable and selects 15 distinct allowlisted skeletons. The authorized live preflight nevertheless analyzed the same 15 briefs five times each: 72 valid decisions chose `section_composition` and only 3 chose `template_skeleton`. It stopped with zero reservations and the database remained `limit=75`, `used=0`, `existingRuns=0`.

The prior qualifier used frozen expected intents, while the production-equivalent preflight used live intent analysis. The new canary must validate the live boundary directly without multiplying identical intent requests across five non-intent scenarios.

## Chosen architecture

The paid 2A command runs a live canary inside the same process that would run the adaptations:

1. Revalidate the stable qualification manifest, commit, published catalog, hash-bound template material, zero-use quota and frozen rate card.
2. Analyze exactly the 15 frozen base-case briefs once each, with bounded concurrency.
3. Require all 15 results to be successful and complete. Each result must use the frozen model/prompt/policy versions, choose `template_skeleton`, select the case's qualified template ID, stay within its allowlist, and include complete usage.
4. Atomically write a redacted, self-hashed canary artifact before any reservation.
5. Revalidate commit, qualification material and quota after the artifact write.
6. Keep full live intents only in process memory. Expand each verified case result across its five frozen scenario rows and populate the existing rich-selection boundary for each row.
7. Run the existing 75-row adaptation, critique, render, ledger, evidence, rollback and scorecard flow unchanged.

There is no retry, replacement case, partial pass, quota reclaim or fallback from `15/15`. A canary failure ends the command with `reservationCount=0`.

## Redacted artifact

Write `scratch/visual-engine-2a/live-canary.json` atomically. The directory is already ignored. The artifact contains only:

- schema, dataset, qualification, catalog, commit, model, prompt, policy, taxonomy and rate-card versions or hashes;
- exactly 15 rows with `caseId`, route, selected template ID or `null`, structural/identity/adaptation scores or `null`, typed result code, usage counters or `null`, and a hash of the validated intent value;
- aggregate route/error/token/cost/duration counts;
- `reservationCount: 0` and a canonical self-hash.

It must never contain a brief, complete intent, prompt, response, HTML, copy, profile, image, screenshot, provider error body, key, email, reviewer identity or absolute path. Database telemetry remains the existing redacted pilot ledger; the canary artifact is local only.

## Cost and execution semantics

The canary makes exactly 15 paid intent requests, one per base case. A successful canary reuses those 15 in-memory selections for all five scenarios, so the pilot does not repeat 60 identical analyses. Creative direction, Quick copy construction and at most one diagnostic critic remain part of each adaptation's existing accounting.

The current paid authorization was consumed by the stopped 75-analysis preflight. Implementing and testing this design makes no live call. Running the completed canary requires a new explicit authorization for its 15 paid requests and any following 75 adaptations.

## Failure behavior

- Provider, schema, usage, version, route, allowlist, selected-template or staleness mismatch: write only the redacted terminal canary artifact and stop with zero reservations.
- Artifact write failure: stop before reservations.
- Post-write commit/catalog/material/quota drift: stop before reservations and do not overwrite evidence to force a pass.
- Process failure after reservations: retain the existing no-retry, no-replacement, no-reclaim rules.

## Verification

Automated tests must prove:

- exactly 15 selections, bounded concurrency and one call per case;
- strict `15/15` success and exact qualified-template matching;
- every failure class stops before reservation/adaptation;
- complete usage/cost aggregation and privacy allowlisting;
- atomic artifact write occurs before the post-write freshness/quota barrier;
- successful in-memory expansion produces exactly 75 rows and reuses one selection per case across five scenarios;
- existing 75-row adaptation accounting, rollback and scorecard contracts remain unchanged;
- no ordinary OpenLen request path or runtime feature flag changes.

One focused independent review and one full non-live regression gate close this single implementation block. Optional hardening and unrelated refactors are out of scope.
