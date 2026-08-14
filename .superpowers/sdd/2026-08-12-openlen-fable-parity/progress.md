# SDD ledger — plan: docs/superpowers/plans/2026-08-12-openlen-fable-parity.md

## Setup

- Branch: `codex/ai-hybrid-real-e2e-fix`
- Starting HEAD: `a1a8216f6ec49db4ae183f526d3ea5bb5a9209ae`
- Workspace ruling: continue in the existing feature branch because Task 1 already has uncommitted scoped work here; creating a fresh worktree would separate or risk losing that WIP. Cost if wrong: less filesystem isolation, mitigated by exact-path staging and per-task diff audits.
- Task 1 snapshot: five tracked modifications plus new `template-object-reader.ts/.test.ts`; all unrelated untracked files remain owner-owned and untouched.
- Prior dry-run evidence required by the plan: corpus hash `sha256:f3f6c7eb8458e6f6f9018ea6d15199089e44fa7811abedfeecccb3e89cb84271`; four unstable IDs crossed `mobile_overflow`: `derived-about-solace-5-79b97218ed03`, `derived-about-stillwater-5-22976c71c49d`, `derived-gallery-vela-5-26356498c1de`, `derived-navbar-cafe-tramonto-3-44606a14d9a4`.

## Preflight cross-task scan

| Producer / consumer | Contract or shared file | Finding / ruling |
|---|---|---|
| Task 1 self | Origin reader, bounded renderer pool, deterministic two-sample geometry, two dry compiles | Internally consistent. Preserve WIP and add missing deterministic reset/two-sample behavior before dry runs. Dry run is read-only; publication stays closed. |
| Task 2 self | Fireworks strict JSON gateway, retry semantics, model-keyed cost and reservation | Internally consistent. Historical pilot cost functions remain unchanged; new production API is additive. |
| Task 3 self | Bounded candidate retrieval, Qwen decision, DeepSeek program, originality | Internally consistent. `all generate` and zero donors are explicitly valid; no hidden donor quota. |
| Task 4 self | Strict expressive AST, repository compiler, GLM provider, atomic adaptive composition | Internally consistent. Raw HTML/CSS/JS remains impossible; only one verified rebuild fragment may reach GLM as bounded inspiration. |
| Task 5 self | Qwen final verdict, one GLM repair, image-only Gemini, route cutover | Internally consistent. The route must emit paid failure telemetry before atomic failure and never expose partial preview/project/debit. |
| Task 6 self | 20-case cohort, blind review, immutable score, deploy/rollback | Internally consistent. Live eval is implemented but not executed; hidden plaintext cannot be committed. |
| Task 1 → Task 3 | `visual-quality-renderer.ts` and contact-sheet rendering | Compatible sequential ownership. Task 3 must preserve Task 1's pool/single-call behavior and deterministic settling. |
| Task 1 → Task 6 | Derived-section gate and catalog evidence | Compatible. Task 6 consumes the deterministic gate; it does not publish the catalog. |
| Task 2 → Task 3 | Fireworks gateway/model policy consumed by Qwen scout and DeepSeek plan | Compatible. Task 3 must use the strict Task 2 boundary and its redacted usage semantics. |
| Task 2 → Task 5 | Gateway and page budget consumed by Qwen critic/GLM repair/route | Compatible. One shared reservation guard covers retries, images and repair. |
| Task 2 → Task 6 | Cost snapshots consumed by evaluation/scorecard | Compatible. Every paid failure remains in the denominator and cost evidence. |
| Task 2 → Task 6 | `package.json` | Sequential shared-file edit. Task 6 must preserve Task 2 scripts/configuration. |
| Task 3 → Task 4 | `AdaptivePageDesignProgram`, decisions, provenance, candidate set | Compatible. Task 4 compiles decisions in narrative order and retains provenance without model control. |
| Task 3 → Task 5 | Design program and candidate/final render semantics | Compatible. Task 5 critiques the assembled program rather than re-planning it. |
| Task 4 → Task 5 | Expressive programs and adaptive composition | Compatible. Task 5 may apply one bounded delta and must recompile/revalidate affected sections. |
| Task 5 → Task 6 | Production pipeline, telemetry, route and rollback semantics | Compatible. Task 6 evaluates exactly the production path and disables Create with AI without template fallback. |

Preflight result: no plan/spec contradiction blocks Task 1. Exactly six tasks; no Task 7.

## Task 1 execution

- RED confirmed by implementer: deterministic render regression failed on the expected `false` versus `true` assertion before the fix.
- GREEN implementation is present only in the seven scoped Task 1 paths; no commit created.
- Blocker: sandboxed Vitest cannot resolve `vitest.config.ts` (`Access is denied`). The exact elevated local test command was rejected by automatic approval because the account hit its elevated-tool usage limit until 2026-08-18 16:16. No workaround attempted.
- Task 1 remains in progress pending explicit owner approval for the exact unsandboxed local test command. Dry runs, review and commit have not run.
- Owner authorized only the exact focused `npm.cmd test` outside sandbox; controller ran it once: 5 files, 42/42 tests, exit 0, 38.5s. The test harness automatically loaded `.env.local`; no file was copied or edited and no external boundary was invoked by these unit tests.
- Implementer static close: `npm.cmd run typecheck` exit 0; `git diff --check` exit 0; report at `task-1-report.md`; exact seven-file Task 1 implementation scope; no stage/commit.
- Remaining blocker: two consecutive authoritative `--dry-run --expected-count=450` executions need read-only access to current DB template metadata and configured R2 object storage. Owner's latest authorization explicitly prohibited DB/network, so they were not executed.
- Owner later authorized exactly two consecutive read-only dry runs (2 catalog queries / up to 900 R2 reads). Both commands exited 0 with 450 templates, 1453 accepted, 2986 rejected, 18 duplicates, but the gate FAILED determinism: run 1 catalog `sha256:0af32b2fe015fd11a9f0159f4218e8ac99349472671b71be68a210e48f804885`; run 2 `sha256:cad6f1daf87e05e866e33d05285cb8fe8cf3edcdff3ea58178f6fb34eef30925`. Only run 1 accepted `derived-hero-plotline-1-23f61ad7cbf7`; only run 2 accepted `derived-about-solace-5-79b97218ed03`; duplicate lists and rejection totals were equal.
- Architectural ruling confirmed by owner: keep the 450-template catalog as optional adaptive inspiration, with zero minimum reuse. It is not sent wholesale to models; explicit cloning remains separate. Cost if wrong: candidate scouting adds bounded Qwen context, but all-generate remains valid and catalog removal remains possible later.
- Diagnostic ruling for fix hypothesis: `geometrySamplesDisagree` currently compares overflow widths plus typography/component diagnostics and turns any diagnostic-only change into `mobileOverflow`. TDD will first isolate that false classification by comparing only overflow-relevant fields; no external rerun until local GREEN.
- Task 1 fix round 1: RED renderer 1/12 failed as intended (`mobileOverflow:true` for diagnostic-only sample changes); GREEN renderer 12/12 and combined Task 1 43/43. `npm.cmd run typecheck` and `git diff --check` exit 0. Fix compares only `rootScrollWidth`, `bodyScrollWidth`, and `clientWidth` for overflow disagreement; typography/component diagnostics remain reported but cannot fabricate overflow.
- Task 1 remains uncommitted pending a fresh authorized pair of authoritative dry runs. External Google Fonts remain a trigger that may change real widths; the next pair is the acceptance test, not an assumption of success.
- Task 1 authoritative acceptance pair after fix: both read-only dry runs completed with the same corpus `sha256:f3f6c7eb8458e6f6f9018ea6d15199089e44fa7811abedfeecccb3e89cb84271`, the same catalog `sha256:cad6f1daf87e05e866e33d05285cb8fe8cf3edcdff3ea58178f6fb34eef30925`, and identical totals (450 templates; 1453 accepted; 2986 rejected; 18 duplicates). No publication, mutation, model, migration, or deploy occurred.
- Task 1 implementation committed as `0ae2ea5685df694b61d557d751fff0a738de645b`; exact seven-file scope, focused 43/43, typecheck and diff-check exit 0. Independent task review pending.
- Task 1 fix round 1/5 (3 addressed, 0 open — dry-run writes removed; integral evidence hash added; reader null/typed-redacted failures; commit `f3f013d`).
- Task 1: complete (commits `a1a8216..f3f013d`, review clean). Historical pair predates `evidenceHash`, so its integral equality claim is retracted; future authorized pairs can compare the returned evidence hash without writes.

## Task 2 execution

- Ruling: add exactly `lib/ai/fireworks-client.test.ts` to `vitest.config.ts`'s explicit Vitest allowlist — the Task 2 brief mandates that suite and exact command, while the existing mixed-runner allowlist otherwise prevents collection. Cost if wrong: one additional Vitest-owned AI test path is collected by standard runs; no runtime or provider behavior changes.
- Task 2 fix round 1/5 (4 addressed, 1 open — mandatory budget, phase-aware retry, immutable rates/exact limits fixed; reasoning-enabled missing usage remained; commit `470626c`).
- Task 2 fix round 2/5 (1 addressed, 0 open — `none` permits absent reasoning details; `high|max` fail closed without retry; commit `deaddec`).
- Task 2: complete (commits `f3f013d..deaddec`, review clean).

## Task 3 execution

- Ruling: expand Task 3 minimally to `lib/ai/fireworks-contracts.ts`, `lib/ai/fireworks-client.ts`, and `lib/ai/fireworks-client.test.ts` so the Task 2 gateway supports Fireworks' documented OpenAI-compatible multimodal content array (`text` + `image_url`). The spec requires Qwen to inspect a JPEG contact sheet; base64 in a plain string is not visual input. Permit only a bounded canonical `data:image/jpeg;base64,...` image part for the `visual_critic` role; system and non-visual roles remain text-only, and remote/private URLs remain impossible. Cost if wrong: the gateway gains a narrowly typed image transport surface; tests and strict validation contain the added payload risk.
- Task 3 minor (deferred): exported candidate selection applies the three-candidate bound per plan ordinal rather than coalescing repeated roles; the canonical adaptive planner emits unique roles, so final review will triage whether the general API must reject repeated roles.
- Task 3 minor (deferred): contact-sheet renderer tests mock screenshot bytes and do not perform a native visual legibility assertion; final release gate should decide whether existing renderer integration evidence is sufficient.
- Task 3 fix round 1/5 (4 addressed, 0 open — ordered role continuity, sandboxed fragment contact sheet, decoded JPEG pre-budget/fetch, semantic signal/trait coherence; commit `58c3f0a`).
- Task 3: complete (commits `deaddec..58c3f0a`, review clean; 2 deferred minors remain for final review).

## Task 4 execution

- Ruling: expand Task 4 minimally to `lib/curate/run-ai-creation.ts` and `lib/curate/run-ai-creation.test.ts`. Task 4 adds typed composition reason `budget_exceeded`, making the existing exhaustive public mapping fail typecheck. Map it to the existing redacted `creative_direction_failed` public reason and add the exact table regression; do not widen the public delivery taxonomy. Cost if wrong: budget exhaustion is externally grouped with other creative-provider failures rather than exposed as a new public code, while internal typed telemetry retains `budget_exceeded`.
- Task 4 minor (deferred): four-niche expressiveness tests assert output classes/fingerprints while renderer use is doubled, not a native visual geometry/snapshot comparison; final review will triage after Task 5 visual gates.
- Task 4 minor (deferred): action destinations compile to inert repository-owned `data-openlen-action` markers and `none` is accepted; safe but not yet wired to public navigation, for final review triage.
- Task 4 fix round 1/5 (3 addressed, 1 open — internal repair handoff, accumulated paid telemetry, discriminated provenance fixed; tone cascade still allowed render-identical originality; commit `6c47b35`).
- Task 4 fix round 2/5 (1 addressed, 0 open — tone cascade and decoration blend materialized semantically; commit `ddd948a`).
- Task 4: complete (commits `58c3f0a..ddd948a`, review clean; 2 deferred minors remain for final review).

## Task 5 execution

- Task 5: complete (commits `ddd948a..fe1443b`, scoped rereview clean; 0 Critical/Important open).

- Ruling: Task 5 must add the smallest production runtime adapter/factory needed to instantiate the shared `PageBudget`/Fireworks client and supply Task 3/4 composition/gate dependencies to `runAiCreation`. The spec requires a real end-to-end route cutover; leaving the POST permanently fail-closed behind injected test-only deps would be a false completion. The implementer must declare exact new paths before editing, keep provider calls behind existing boundaries, and cover the real POST with injected external seams. Cost if wrong: Task 5 gains a small production composition root not listed in the original file map, but avoids duplicating provider logic or creating a seventh task.
- Task 5 minor (deferred): the image-only import-boundary test proves forbidden Gemini text/vision absence but does not positively assert the sole reachable Gemini asset provider path; final review will triage after the reachability fix.
- Task 5 minor (deferred): some delivery-gate failures are currently labeled `visual_quality` in operational telemetry; fix round will correct if touched, otherwise final review will triage monitoring accuracy.
- Task 5 fix round 1/5 (5 blockers + 2 minors addressed, 0 open — strict full-page visual gate, renderer diagnostics, one-statement project/debit atomicity, complete paid-failure telemetry, GLM→Gemini→compile order, real hybrid POST evidence, positive Gemini image-only reachability and `delivery_gate` telemetry; scoped fix complete).

## Task 6 execution

- RED to GREEN: cohort/scorecard began with missing modules and passed 14/14 after implementing the exact 12 public + 8 externally encrypted hidden cohort and immutable denominator/threshold/cost contracts. Review artifacts began missing, then exposed a cross-realm byte conversion defect, and passed 11/11 after canonical buffer/view handling. Operational scripts began missing, exposed the same byte defect at the eval seam, and passed 13/13 after the boundary fix.
- Privacy hardening RED to GREEN: a behavioral test showed public reviewer data exposed raw HTML URLs. Public DTO/HTTP output now contains only opaque prompt and screenshot routes; private HTML remains hashed and verified. Review plus operational suites passed 24/24.
- Focused preflight: Task 6 gate 38/38; standalone TypeScript check exit 0.
- Ruling on Task 3 repeated-role minor: no expansion. The production planner emits unique roles, so a broader exported-API constraint is not load-bearing for this release contract.
- Ruling on Task 3 native contact-sheet minor: no expansion. Task 5 production full-page rendering plus Task 6 byte-bound desktop/mobile full-page artifacts are the release authority; native contact-sheet legibility is a non-blocking test-quality improvement.
- Ruling on Task 4 four-niche native-visual minor: no expansion. The 12 public plus 8 sealed hidden full-page blind comparisons, reviewed three times, are stronger release evidence than non-live pixel snapshots.
- Ruling on Task 4 inert action-destination minor: no expansion. Repository-owned inert markers are safe, contact is wired, and any remaining usability penalty is included in the blind score. This is not deploy-gate load-bearing.
- Required non-live release sequence ran exactly once. PASS: template-derived gate 215 tests; Fable-parity gate 38; AI-hybrid gate 266; visual-assets gate 350; typecheck; visual-engine rollback; Fable rollback; exact diff check.
- Full `npm test` exit 1: 3,760 passed / 1 failed, solely the Task 6 session-locking test exceeding its 5-second default by 62 ms under full-suite contention. The test timeout was bounded at 20 seconds and the focused file then passed 11/11; the long full suite was not restarted, so post-fix full-suite evidence remains absent.
- Build exit 1 after successful compile, lint/typecheck, and generation of all 4,781 static pages: standalone copy hit local `EPERM` symlink errors for the workspace packages and `ENOSPC` copying a generated template. This is recorded as an environmental prerequisite failure; the long build was not restarted or hidden by cleanup.
- Acceptance ruling: Task 6 is ready for independent scoped review but not ready for paid evaluation or deployment because all non-live gates did not exit 0 in the one-shot sequence. It must not be described as Fable-level. No live eval, provider/model call, DB call, publication/migration, activation, deploy, or secret copy occurred.
- Full evidence and scope: `task-6-report.md`. No staging or commit; controller review is required first.

### Task 6 fix round 1/5

- Critical remote-environment finding RED to GREEN: operational tests exposed local/remote mode mismatch and fabricated rollback state. Deploy now gates an explicit `OPENLEN_AI_CREATION_TARGET_MODE`, atomically applies it to `/etc/openlen/openlen.env`, verifies the file before start and the running process after start. Rollback performs and reads back the configured SSH transition, rejects no-op enabled state, makes zero provider calls, and probes the explicit clone route for its anonymous fail-closed response.
- Important scorecard-provenance finding RED to GREEN: the sealed scorecard now includes normalized 20-comparison/60-decision source evidence; verification recomputes the immutable score and deploy rebuilds it from the exact artifact manifest and three complete distinct sessions before comparing both evidence and separately approved scorecard hashes. A forged `passed:true` envelope and source-session tamper fail closed.
- Important result-validation finding RED to GREEN: technical status, failure enums, eligibility consistency, full-page viewport/bytes, and paid ledgers are strict. Successful OpenLen/Fable results require positive paid accounting; an empty zero-cost ledger is allowed only for an ineligible failed pre-call result. Contradictory failed-but-eligible aggregate rows cannot enter the denominator.
- Important reviewer-integrity finding RED to GREEN: persisted decisions/completion serialize per session, all session/scorecard paths stay below ignored `scratch/fable-parity/`, missing exact parents are created, and reviewer responses serve immutable verified bytes instead of rereading a replaceable path.
- Important action-contract finding RED to GREEN and previous ruling superseded: `none` and inert buttons are rejected; native `primary|secondary|contact` anchors resolve to deterministic existing assembled section roots and missing referenced targets fail closed without JavaScript. Smallest required scope expansion: `lib/generation/expressive-section-contracts.ts`, `lib/generation/expressive-section-compiler.ts` plus its test, and `lib/sections/assemble.ts` plus its test. Cost if wrong: generated action destinations are deliberately restricted to repository-owned in-page targets and documents with unresolvable destinations are rejected instead of shipped inert.
- Final focused verification: Fable parity 55/55; action/assembly 48/48; AI-hybrid 266/266; typecheck exit 0; deploy PowerShell parse PASS; local visual-engine rollback PASS; exact diff/whitespace/privacy/ignore/`.env` audits PASS. Full test/build were not rerun. Corrected Fable rollback was not executed because it now crosses the real SSH production boundary; injected behavior tests cover transition/readback/no-op/clone/no-provider semantics. No live/provider/model/network/DB/deploy/activation call occurred; paid eval and rollout remain closed.
- Deferred nonblocking minors remain exactly three: repeated-role bound; native contact-sheet test evidence; native four-niche visual test evidence. They do not authorize rollout and are parked for later test-quality work.

### Whole-branch final fix

- Ruling: the live parity harness trusts only an owner-manifest-bound, authenticated repository adapter attestation and exact pre-reserved aggregate cap; self-declared endpoint model/rate/build/ledger fields are not release evidence. Cost if wrong: integrations that cannot attest the approved path fail closed, but unknown spend or provenance cannot be authorized.
- Ruling: an approved scorecard binds the exact source revision and standalone build attestation; `OPENLEN_SKIP_BUILD` may verify an existing artifact but never relabel it. Cost if wrong: reuse of an unstamped build fails closed and requires a fresh successful build.
- Ruling: the optional catalog is metadata-only inspiration. Every donor decision is rebuilt; donor HTML or visible copy is never delivered. Cost if wrong: rebuilding costs a bounded GLM section call instead of cheap byte reuse, but prevents clone-like output and inherited content.
- Ruling: enabled creation requires an explicit stable 1..99 percent rollout; missing/0/100 are invalid and disabled means 0. Cost if wrong: there is no accidental global enablement, and expansion requires an explicit deployment plus matching scorecard.
- RED: 7 files / 103 tests, 24 failed and 79 passed, covering exactly the two Critical and four Important findings.
- GREEN: focused functionality 116/116 plus final documentation 3/3; AI-hybrid 275/275; Fable parity 74/74; adaptive pipeline 3/3; typecheck, diff-check and deploy parser PASS.
- No live/provider/model/network/DB/deploy/activation/rollback operation occurred. Full test/build were not rerun. Paid eval, deployment and Fable-level claims remain closed pending scoped rereview and separately authorized release evidence.
