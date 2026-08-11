# Task 6 report - niche cohort, release gate, and operations

## Outcome

Task 6 adds the deterministic seven-case hybrid-only release cohort, the
Mundo Pincel regression, the explicit template-clone distinction, the focused
release gate, deploy ordering controls, and the operations runbook. Production
AI creation remains section-composition-only; no legacy whole-template path was
added or re-enabled.

The deploy script now runs the exact hybrid gate and typecheck once each before
the `OPENLEN_SKIP_BUILD` branch. Skipping a build therefore cannot skip either
safety check. No provider, database, deployment, network, or paid action was
performed.

## Delivered contracts

- `AI_HYBRID_NICHE_CASES` contains exactly the seven approved immutable rows.
  Every intent and creative direction is schema-parsed, and every row has exact
  role/component expectations plus required, forbidden, and residue signals.
- The cohort exercises the injected `runAiCreation` success path and verifies
  composition-only metadata, exact ordered and unique section IDs, the creative
  direction hash, all required signals, each forbidden signal individually,
  and absence of every forbidden residue.
- The Mundo Pincel regression rejects hash-valid Lyceum full-document HTML at
  the real verified-section fetch boundary with `section_fragment_invalid` and
  proves a whole-template loader is unreachable. Its valid injected path
  returns `section_composition` with `templateId: null` and no legacy residue.
- The TypeScript compiler-API import boundary from Task 5 remains unchanged and
  is now part of the release gate. It covers static imports, re-exports, dynamic
  imports, transitive repository traversal, and repository-relative failures.
- The explicit clone contract covers authorization, unknown/unpublished
  templates, unavailable bodies, persistence failure, and a successful clone
  that reads the requested ID and persists transformed, normalized, sanitized,
  seeded HTML with template tags.
- `generation:ai-hybrid:gate` is the exact approved 15-file command.
- The runbook documents fail-closed mode semantics, model precedence,
  no-retry/privacy policy, local gates, activation, rollback, and the separately
  authorized seven-case canary with a positive MXN cap and one request per case.

## TDD evidence

The requested pre-file baseline command exited `0` because this Vitest version
silently ignored explicit paths that did not yet exist and ran only the
pre-existing import-boundary test. This was recorded as a prediction mismatch,
not treated as RED evidence.

The first meaningful RED was collected after adding the tests but before the
missing implementation/contracts:

```text
npm.cmd test -- lib/generation/ai-hybrid-niche-cohort.test.ts lib/curate/ai-hybrid-import-boundary.test.ts lib/curate/ai-hybrid-regression.test.ts lib/curate/explicit-template-clone-contract.test.ts lib/curate/ai-hybrid-runbook-contract.test.ts
  exit 1
  cohort/regression collection failed: ai-hybrid-niche-cohort was unresolved
  runbook contract failed: package command and runbook were absent, deploy checks were absent
```

Minimal GREEN after implementing the missing cohort and contracts:

```text
same five-file command
  exit 0; 5 files passed; 27 tests passed
```

The complete suite exposed three stale Task 2 fixture helpers that no longer
matched the canonical section-ID/hash/storage-key contract. Parent authorization
confirmed these were equivalent fixtures already covered by Task 2 scope. A
focused characterization run observed RED before changing tests only:

```text
npm.cmd test -- lib/generation/visual-engine-2b-qualification.test.ts lib/generation/visual-engine-2b-qualify-cli.test.ts lib/generation/visual-engine-2b-eval-cli.integration.test.ts
  exit 1; 11 failed, 1 passed; section_inventory_stale
```

The helpers now derive the 12-character SHA-256 hash from their fixture HTML and
use `sections/<id>-<hash>.html`; no production code changed. Focused GREEN:

```text
same three-file command
  exit 0; 3 files passed; 12 tests passed
```

## Independent review fixes

Independent review reported no Critical findings and three Important contract
gaps. All three were confirmed and corrected without a production behavior
change:

1. The original runbook set `OPENLEN_AI_CREATION` only in the local PowerShell
   process, while the systemd unit reads `/etc/openlen/openlen.env`. A strengthened
   contract first failed 1 of 3 tests because `OPENLEN_ENV_LOCAL` was absent.
   Activation and immediate rollback now create a one-value temporary patch and
   call the existing `infra/scripts/push-env.sh`, which preserves the other
   remote values, installs the mode in the systemd environment file, restarts
   the app, and verifies the unit. The focused contract then passed 3/3.
2. The clone fixture's transformed HTML was already sanitized and carried no
   normalization-sensitive input. It now contains a script, event handler, and
   static radius/spacing/type CSS, and asserts both unsafe residue removal and
   born-canonical radius markers. Temporary mutation checks observed RED when
   bypassing sanitization (`private()` remained) and separately when bypassing
   normalization (`data-ol-radius` was absent). Both mutations were reverted;
   the real production chain passed 5/5.
3. The two whole-template spies were detached locals. They are now injected as
   Proxy tripwires into the actual verified-fragment and `runAiCreation`
   dependency objects. Temporary property-access mutations in each SUT produced
   the expected RED (`loadWholeTemplate` called once); both mutations were
   reverted. The real boundaries passed 2/2 and retain no loader dependency.

Combined review-fix GREEN:

```text
npm.cmd test -- lib/curate/explicit-template-clone-contract.test.ts lib/curate/ai-hybrid-regression.test.ts lib/curate/ai-hybrid-runbook-contract.test.ts
  exit 0; 3 files passed; 10 tests passed
```

Independent re-review confirmed all three Important findings resolved, no
remaining Critical/Important finding, and no residual diff in the three
temporarily mutated production files.

## Release verification

Fresh final deterministic checks:

```text
npm.cmd run generation:ai-hybrid:gate
  exit 0; 15 files passed; 162 tests passed

npm.cmd run generation:visual-engine-assets:gate
  exit 0; 21 files passed; 326 tests passed

npm.cmd run typecheck
  exit 0

npx.cmd tsx --tsconfig tsconfig.eval.json --require ./scripts/test-node-server-only-shim.cjs scripts/visual-engine-2a-rollback-check.ts
  exit 0; verified: true

git diff --check
  exit 0
```

The rollback command used the repository's existing server-only shim because
`.env.local` was unavailable. No secret was copied or synthesized.

The required uninterrupted full-suite run did not exit `0`. Its Task 6 tests
passed, but environment-dependent legacy tests failed because the public npm
launcher expected absent `.env.local` (`node: .env.local: not found`) and DB
notification integration tests resolved the repository's invalid fallback host
(`getaddrinfo ENOTFOUND invalid`). The same run also exposed the three stale 2B
fixtures described above; those fixtures subsequently passed their focused
12-test run. Repository inspection found no supported repo-wide non-live skip
mechanism for the remaining environment-dependent tests, so secrets were not
copied, no database was contacted, and full-suite GREEN is not claimed.

`npm.cmd run build` compiled and typechecked successfully, then exited `1` while
collecting page data because the templates query attempted the same unavailable
fallback database host (`getaddrinfo ENOTFOUND invalid`). No supported non-live
build bypass was introduced, so build GREEN is not claimed.

## Scope and privacy

The only files outside the literal Task 6 list are the three parent-authorized
Task 2 fixture tests described above. The Task 5 import-boundary file was already
tracked at the starting commit and was not modified. No optional hardening or
production behavior change was added.

The diff/privacy audit found no credentials, DSNs, private URLs, user data, raw
provider responses, or generated artifacts in the change. Runbook references
are environment-variable names and synthetic examples only. The canary remains
closed pending separate one-time authorization and an explicit positive MXN cap.
