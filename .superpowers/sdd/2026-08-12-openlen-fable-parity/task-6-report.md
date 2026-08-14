# Task 6 report: parity harness, release controls, and handoff

## Outcome

Task 6 implementation is ready for independent controller review, but the release acceptance contract is not satisfied and remains fail-closed.

- The current Task 6 focused tests, AI-hybrid regression gate, typecheck, deploy-script parse check, and local visual-engine rollback check pass. The corrected Fable rollback is a real remote transition and was not executed during this non-live fix round.
- The one-shot full `npm test` run had one Task 6 test timeout under full-suite contention. The test timeout was corrected and the focused file passed, but the full suite was intentionally not restarted.
- The one-shot build compiled, linted, typechecked, and generated all 4,781 static pages, then failed during standalone copying with local filesystem `EPERM` symlink errors and `ENOSPC`. The build was intentionally not restarted.
- Therefore this branch is not approved for paid evaluation, is not approved for deployment, and must not be represented as Fable-level.

No live evaluation, provider/model call, database call, catalog publication or migration, feature activation, deployment, or secret copy occurred during Task 6.

## Implemented scope

The implementation covers the brief's Task 6 scope plus the smallest
review-required expansion for the release-blocking action contract:

- `lib/generation/fable-parity-cohort.ts`
- `lib/generation/fable-parity-cohort.test.ts`
- `lib/generation/fable-parity-scorecard.ts`
- `lib/generation/fable-parity-scorecard.test.ts`
- `lib/generation/fable-parity-review-session.ts`
- `lib/generation/fable-parity-review-session.test.ts`
- `lib/generation/fable-parity-runbook-contract.test.ts`
- `scripts/fable-parity-eval.ts`
- `scripts/fable-parity-review.ts`
- `scripts/fable-parity-scorecard.ts`
- `scripts/fable-parity-rollback.ts`
- `docs/generation/fable-parity-runbook.md`
- `package.json`
- `infra/scripts/deploy.ps1`
- `.gitignore`
- `lib/generation/expressive-section-contracts.ts`
- `lib/generation/expressive-section-compiler.ts`
- `lib/generation/expressive-section-compiler.test.ts`
- `lib/sections/assemble.ts`
- `lib/sections/assemble.test.ts`
- this report and the Task 6 append-only progress ledger entry

Unrelated tracked and untracked owner files were not edited, deleted, reset, cleaned, staged, or committed.

## Observable RED to GREEN

1. Cohort and scorecard RED: the new test modules could not import the missing implementations. GREEN: 14/14 focused tests passed after implementing the exact cohort, reviewer denominator, cost, threshold, and sealed-scorecard contracts.
2. Review artifact RED: the review-session implementation was absent. The first implementation exposed a real cross-realm byte-type defect because a Node `Buffer` did not satisfy the other realm's `Uint8Array` check. GREEN: canonical byte conversion now accepts buffers and array-buffer views; 11/11 review-session tests passed.
3. Operational controls RED: the four operational scripts were absent. The initial seam test exposed the same cross-realm byte defect in the evaluation boundary. GREEN: 13/13 operational and runbook contract tests passed.
4. Privacy hardening RED: a behavior test demonstrated that public review data still returned raw HTML URLs, which could reveal origin metadata. GREEN: the public reviewer DTO and HTTP surface expose only opaque prompt and screenshot routes; private HTML remains hashed and verified but is not served to reviewers. Review and operational suites passed 24/24.
5. Full-suite contention RED: the complete test run timed out one session-locking test at 5 seconds after 5.062 seconds. The implementation result was correct; the test's default timeout was too narrow for full-suite contention. GREEN evidence after giving that integration-style test a 20-second bound: the focused review-session file passed 11/11 in 4.363 seconds, with the heavy test taking 2.753 seconds. Per the brief, the full suite was not rerun to conceal or erase the original failure.

Before the one-shot release sequence, the combined Task 6 focused preflight passed 38/38 and `npx.cmd tsc --noEmit --pretty false` exited 0.

## Cohort and blind evidence contract

- The public cohort is frozen at exactly 12 records across the required niches and includes explicit and underspecified prompts.
- The hidden cohort is exactly eight externally supplied AES-256-GCM encrypted records. Hidden records are decrypted only through the external boundary and validated against a closed schema; duplicate IDs and invalid niches/signals fail closed. Hidden plaintext is absent from the repository.
- A complete run creates exactly 20 opaque comparison identities. Side assignments are private and reviewers receive no OpenLen/Fable identity.
- Every prompt manifest, HTML document, full-page desktop byte stream, full-page mobile byte stream, viewport, side assignment, decision, result, and aggregate manifest is cryptographically hashed.
- Safe-path and byte-integrity verification runs before every public asset serve and again before every decision. A changed or missing artifact invalidates the run.
- Each comparison receives decisions from exactly three independent reviewers. Each reviewer session must cover all 20 comparisons, producing exactly 60 decisions total. Partial, duplicated, or extra denominators fail closed.

## Score and cost contract

- Reviewer sides are neutralized against the sealed private assignment before scoring.
- Technical failures are losses, never exclusions.
- Paid calls include both delivered and failed paid attempts.
- Passing requires all immutable conditions: at least 70% non-losses, either at least 40% wins or at least 80% ties, at least 18 technically eligible comparisons, zero wrong-niche outcomes, zero critical failures, median OpenLen cost at most 5 MXN, and every OpenLen page below 10 MXN.
- A scorecard is sealed with its evidence hash and must be revalidated before a release decision.
- The deploy gate requires `OPENLEN_AI_CREATION_TARGET_MODE` to be explicitly `enabled` or `disabled`. Enabling rebuilds the scorecard from the exact artifact manifest and three reviewer sessions and requires the exact separately approved hash. The gate executes before the first `OPENLEN_SKIP_BUILD` branch; deploy then atomically applies and verifies that exact mode in the remote runtime environment before service start and verifies the running process value.
- Rollback is fail-closed: the CLI performs and reads back the real remote transition to disabled, makes no provider call, rejects a no-op enabled state, and verifies that explicit cloning remains available while whole-template fallback stays unavailable.

The harness maximum is exactly `20 × (10 MXN OpenLen cap + reviewed Fable reference-page cap)`. OpenLen's maximum is therefore exactly 200 MXN. If and only if the owner reviews and fixes the Fable reference-page cap at 2 MXN, the exact authorization request is 240 MXN. No Fable rate or paid authorization is inferred by this report; the owner must review the external reference cap before authorizing the one-time live run.

## Closed operational gates

- Live evaluation requires the exact one-time authorization `AUTHORIZED_FABLE_PARITY_EVAL_ONCE`, explicit live mode, configured provider authentication, approved model IDs, reviewed rate-card values, a 10 MXN OpenLen per-page cap, and an exact total cap before hidden-cohort or provider boundaries can run.
- The authorization must be consumed through the configured boundary; the production CLI uses an atomic scratch marker.
- Each of the 20 cases runs sequentially as OpenLen then the configured Fable reference, without harness retries.
- Review binds to `127.0.0.1`, requires a visible token of at least 32 characters on data routes, and serves opaque screenshot/prompt identities only.
- Score and deploy controls reverify source artifacts, three complete reviewer sessions, the sealed scorecard, and the separately approved scorecard hash.
- Rollback makes no provider call and explicitly verifies that cloning is unaffected.

Only non-live gates were executed. The live evaluation command was not run.

## One-shot non-live release sequence

The required release sequence was executed exactly once and was not restarted:

| Step | Command | Result |
|---:|---|---|
| 1 | `npm.cmd run generation:template-derived-sections:gate` | PASS, exit 0: 19 files, 215 tests. Expected fail-closed unit-test stderr only. |
| 2 | `npm.cmd run generation:fable-parity:gate` | PASS, exit 0: 4 files, 38 tests. |
| 3 | `npm.cmd run generation:ai-hybrid:gate` | PASS, exit 0: 20 files, 266 tests. |
| 4 | `npm.cmd run generation:visual-engine-assets:gate` | PASS, exit 0: 21 files, 350 tests. |
| 5 | `npm.cmd run typecheck` | PASS, exit 0. |
| 6 | `npm.cmd test` | FAIL, exit 1 after 94.9 seconds: 309 files passed and 1 failed; 3,760 tests passed and 1 failed. Sole failure was the Task 6 5-second contention timeout described above. |
| 7 | `npm.cmd run build` | FAIL, exit 1 after 243.2 seconds. Next compiled in 26.7 seconds, lint/typecheck passed, and all 4,781 static pages generated. Standalone tracing/copy then hit `EPERM` creating local workspace-package symlinks and finally `ENOSPC` while copying a generated template page. |
| 8 | `npm.cmd run generation:visual-engine-2a:rollback-check` | PASS, exit 0. Fixture `sha256:fe648789a1d56137e191f07dd957990d2e9045417eb609df5b85cf902cb810dc`; 2C `sha256:f1bf89d487c3132e95acfa2e0198cc11cfa990a2e17b07f73b13bbdde59390d4`. |
| 9 | `npm.cmd run generation:fable-parity:rollback` | Historical PASS, exit 0, no provider call, evidence `sha256:d269911abc32a02b24b289e1f5e3ca143e04b8cac20fb586eccd09b0494473d1`. That command was the superseded local implementation and is not evidence of the corrected remote runtime transition. |
| 10 | `git diff --check` | PASS, exit 0. |

The full-test failure was a code-owned verification issue: the Task 6 test's timeout did not tolerate complete-suite contention. The timeout was fixed and focused behavior is green, but full-suite verification after the fix is absent by design because the brief prohibited restarting the long command.

The build failure is an environmental prerequisite failure after compilation/static generation: the local account could not create the two standalone workspace-package symlinks and the volume had no space remaining. No source build error was reported before that boundary. The environment must provide symlink permission and sufficient free disk space for a future authorized full build.

The commands automatically loaded the existing `.env.local` where the repository tooling does so. Task 6 did not read, copy, print, alter, or commit its secrets, and the non-live tests did not invoke provider or database boundaries.

## Privacy and repository audit

- No `.env` file is in Task 6 scope.
- Hidden prompt plaintext is not stored in the implementation, tests, runbook, report, or ledger. Test prompt strings are synthetic public fixtures, not hidden records.
- No generated screenshots, HTML results, provider responses, reviewer identities, cost ledgers, telemetry payloads, authorization markers, or secrets are included in tracked Task 6 scope.
- `scratch/fable-parity/` is ignored. Operational evidence remains local and untracked.
- Public review data uses opaque identities and does not include raw HTML or side assignments.
- The handoff documentation contains no absolute workstation path.

## Deferred Task 3 and Task 4 minor dispositions

1. Repeated-role bound: no Task 6 expansion. The canonical adaptive planner emits unique roles and the release harness evaluates the production planner. A broader exported-API constraint is not load-bearing for this release contract.
2. Native contact-sheet/full-page evidence: no Task 3 expansion. Task 5's production full-page renderer and Task 6's byte-bound desktop/mobile full-page artifacts are the release authority. Native contact-sheet legibility remains a non-blocking test-quality improvement.
3. Four-niche native visual evidence: no Task 4 expansion. The frozen 12-case public cohort plus eight sealed hidden cases and three-reviewer full-page scoring are the release visual authority. Non-live pixel snapshots would not replace this blind comparison.
4. Inert action destination: resolved as release-blocking in review. `none` is rejected, action markup uses native repository-owned anchors, and assembly assigns deterministic IDs to existing primary, secondary, and contact section roots. A referenced target that cannot exist fails closed; navigation requires no JavaScript.

## Task 6 fix round 1/5

Independent review found one Critical and four Important defects. Each was
verified against behavior before implementation and repaired through an
observable failing test:

1. Remote activation/rollback: RED was three operational failures showing that local `OPENLEN_AI_CREATION` could disagree with the systemd environment and that rollback could report a fabricated disabled state. GREEN makes `OPENLEN_AI_CREATION_TARGET_MODE` explicit, verifies the gated target, atomically patches and reads back `/etc/openlen/openlen.env`, and checks the started process environment. Rollback performs the same real remote transition through an injected SSH boundary, rejects a no-op enabled readback, and anonymously probes the explicit clone route for its expected 401/403 fail-closed response. The final operational file passed 22/22.
2. Scorecard provenance: RED showed that `{passed:true}` plus a recomputed unkeyed envelope hash could be accepted. GREEN seals normalized 20-comparison and 60-decision source evidence, recomputes the immutable score, binds the exact artifact manifest hash, and rebuilds from the manifest and three completed sessions during deploy verification. Forgery and source-session tampering are rejected.
3. Evaluation/result validation: RED mutations demonstrated permissive status, eligibility, failure, viewport, full-page, and paid-accounting inputs. GREEN strictly validates each enum and invariant, requires positive paid accounting for successful OpenLen and Fable results, permits zero only for ineligible pre-call failures, and makes aggregate failed-but-eligible rows invalid before scoring.
4. Reviewer integrity: RED exposed lost concurrent state, arbitrary output paths, missing nested parents, and serve-time path replacement after verification. GREEN serializes decision/completion persistence per session, confines every output below ignored `scratch/fable-parity/`, creates exact parents, verifies complete sessions, and serves retained verified bytes with their bound content type rather than rereading a path. The review-session file passed 15/15.
5. Action destinations: RED showed that `none`, inert buttons, and dead contact links compiled successfully. GREEN rejects `none`, emits only native repository-owned anchors, deterministically binds requested primary/secondary/contact destinations to existing assembled section roots, and fails closed if a referenced target cannot exist. The focused compiler/assembly set passed 48/48 across five files.

Final fix-round verification: Fable parity gate 55/55 across four files; AI-hybrid gate 266/266 across 20 files; action/assembly set 48/48 across five files; TypeScript check exit 0; `deploy.ps1` parser check passed; existing local visual-engine rollback passed with fixture `sha256:fe648789a1d56137e191f07dd957990d2e9045417eb609df5b85cf902cb810dc` and 2C `sha256:f1bf89d487c3132e95acfa2e0198cc11cfa990a2e17b07f73b13bbdde59390d4`; exact diff/whitespace, ignored-evidence, `.env`, absolute-path, and credential-pattern audits passed.

The full `npm test` and build commands were not rerun, preserving the brief's one-shot rule. The actual Fable rollback command was also not run: after this correction it uses SSH to change and restart the configured production runtime, which was expressly outside fix-round authority. Its transition, readback, no-op rejection, route reachability, and zero-provider behavior are covered through injected boundaries. No live/provider/model/network/database/deploy/activation operation occurred. Paid evaluation and rollout remain closed.

## Handoff

No files are staged and no commit was created. The controller should request an independent scoped review of the files listed above. Even if that review is clean, paid evaluation and deployment remain closed until the missing acceptance evidence is resolved through an authorized future full-suite/build run and the immutable live-evaluation authorization and cost controls are separately satisfied.

## Whole-branch final fix round

The final whole-branch review reported two Critical and four Important release
blockers. All six were reproduced in one focused RED run (7 files, 103 tests:
24 failed and 79 passed) and corrected without crossing a live boundary:

1. Live-eval authorization is now owner-manifest-bound. Every request and
   authenticated adapter attestation binds the cohort, adapter, model IDs,
   rate card, source/build identity and remaining cap. Aggregate cost is
   reserved before a call and settled from the verified ledger.
2. Scorecard schema v2 seals both paid ledgers and exact release provenance.
   Deploy compares the approved/current revision, build ID and artifact digest;
   skip-build verifies an existing attestation and cannot relabel stale output.
3. Catalog donors are metadata-only inspiration. `reuse` is rebuilt through
   the expressive compiler, donor HTML/copy is rejected at the provider seam,
   and visible donor-copy leakage is measured rather than self-declared.
4. The production POST installs the strict nonthrowing redacted telemetry sink.
5. Review evidence is decoded JPEG with bounded dimensions, matching MIME,
   viewport width and declared full-page content height. Corrupt, header-only,
   wrong-size and viewport-only evidence fails before sealing or serving.
6. AI creation requires an explicit rollout percentage from 1 through 99 and
   a stable SHA-256 user bucket. Missing, 0 and 100 fail closed before credits,
   budget or providers. Deploy/rollback bind mode and percentage together.

Final local evidence: the original focused set reached 116/116 functional
passes, followed by 3/3 for the final documentation contract; AI-hybrid passed
21 files / 275 tests; Fable parity passed four files / 74 tests; the adaptive
pipeline passed 3/3; TypeScript, diff-check and the deploy PowerShell parser
all passed. No full test/build rerun, live eval, provider/model request,
database operation, activation, rollback or deploy occurred. Paid evaluation,
deployment and any Fable-level claim remain closed pending independent
rereview and the separately authorized release sequence.
