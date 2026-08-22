# Template-derived section catalog runbook

This catalog lets Create with AI compose pages from verified sections extracted offline from exactly 450 published templates. The 451st catalog row, Apex Freedom, remains archived and is excluded. Source templates remain unchanged. The explicit **Use this template** command remains the only whole-template clone path.

## Deterministic release gates

Run from the repository root, with no paid provider call:

```powershell
npm.cmd run generation:template-derived-sections:gate
npm.cmd run generation:ai-hybrid:gate
npm.cmd run generation:visual-engine-assets:gate
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
git diff --check
```

The deploy script runs the template-derived, asset, hybrid, and typecheck gates before its first `OPENLEN_SKIP_BUILD` conditional. A reused build cannot bypass them.

## Compile and publication

1. Run the idempotent schema migration: `npm.cmd run sections:derived-migrate`.
2. Dry compile: `npm.cmd run sections:compile-templates -- --dry-run --expected-count=450`.
3. Review `scratch/visual-engine-derived-sections/compilation-report.json`. Require exactly 450 published templates processed, a stable corpus/catalog manifest, and viable coverage for Mundo Pincel, terror, escuela, cocina, hotel and producto físico.
4. Repeat dry compile and require the same manifest hash.
5. Publish atomically: `npm.cmd run sections:compile-templates -- --publish --expected-count=450`.

Migration and publication mutate the current database/storage and require explicit authorization. Publication writes immutable content-addressed fragments and commits the catalog rows plus active manifest in one database transaction. A failed write leaves the previous manifest authoritative.

## Runtime contract and privacy

Selection is deterministic and rejects forbidden semantics before ranking. A page uses at least three distinct section hashes and normally at least three real template donors, with no donor contributing more than two bands and no contiguous reconstruction. When a role has no compatible verified fragment, at most two roles may use generated repository-owned sections; even then at least two real donors remain mandatory.

Gemini receives only synthetic/allowlisted intent, direction, role, copy-key names and asset-slot descriptors. It returns a strict JSON spec, never HTML, CSS, JavaScript, URLs or copy values. OpenLen renders, sanitizes, compiles and revalidates the section. There is one request per missing role and no retry.

Reports and telemetry may retain only IDs, hashes, typed reason codes, aggregate usage/cost, duration and scalar counts. Never retain briefs, copy, HTML, prompts, responses, screenshots, credentials, user identity, private URLs or absolute local paths.

## Separately authorized six-case canary

The canary is closed by default. After deterministic preflight, obtain one-time authorization for exactly six synthetic briefs, Gemini payload classes, telemetry writes to the current database, a positive MXN cap, one sequential attempt per fixture and no retries. Then run:

```powershell
$env:OPENLEN_TEMPLATE_DERIVED_CANARY_AUTHORIZATION = "AUTHORIZED_TEMPLATE_DERIVED_CANARY_ONCE"
$env:OPENLEN_TEMPLATE_DERIVED_CATALOG_SHA256 = "<reviewed-catalog-sha256>"
$env:OPENLEN_TEMPLATE_DERIVED_CORPUS_SHA256 = "<current-450-template-corpus-sha256>"
$env:OPENLEN_TEMPLATE_DERIVED_CANARY_MAX_MICROMXN = "<approved-positive-integer>"
$env:OPENLEN_TEMPLATE_DERIVED_CANARY_CASE_MAX_MICROMXN = "<conservative-positive-per-case-integer>"
npm.cmd run generation:template-derived-sections:canary -- --live
```

The six cases are Mundo Pincel, atmospheric horror, warm school/community, editorial cooking, boutique hotel and physical-product sale. Every technical or visual failure stays in the six-case denominator. Cost reporting is deliberately conservative: each workflow reserves its configured worst case. Stop before the next request when recorded cost plus the next reserved worst case would exceed the cap. Do not publish canary projects or store their HTML/screenshots.

## Activation, rollback and incident handling

Activate only after the catalog manifest, six-case scorecard and desktop/mobile review are clean. Use the existing remote environment merge (`infra/scripts/push-env.sh`) to persist `OPENLEN_AI_CREATION=enabled` and `OPENLEN_VISUAL_ENGINE_ASSETS=hybrid`, then deploy.

Immediate rollback:

1. Persist `OPENLEN_AI_CREATION=disabled` remotely; explicit template cloning remains available.
2. Restore the prior catalog from its immutable historical report in one transaction: `npm.cmd run sections:derived-rollback -- --report=scratch/visual-engine-derived-sections/history/<prior-catalog-sha256>.json`; do not delete immutable fragments during the incident.
3. Set `OPENLEN_VISUAL_ENGINE_ASSETS=off` if asset resolution contributed.
4. Restart and verify new AI creation fails closed with zero provider calls.
5. Archive superseded derived rows only after rollback evidence is complete; never reclaim them during a live incident.

Diagnose by typed reasons such as stale corpus/catalog, semantic coverage, unavailable/invalid fragment, originality, provider/schema/timeout, asset, render, mobile overflow, typography or geometry. Keep only redacted scalar evidence.
