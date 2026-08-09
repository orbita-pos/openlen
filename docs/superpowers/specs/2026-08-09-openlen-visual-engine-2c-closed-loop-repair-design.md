# OpenLen Visual Engine 2C — Closed-Loop Visual Repair Design

**Date:** 2026-08-09

**Status:** Approved design

**Scope:** Visual critic calibration and one bounded repair for valid 2A/2B candidates

## 1. Objective

Visual Engine 2C adds a shared post-processing loop to candidates already produced successfully by Visual Engine 2A (`template_skeleton`) or 2B (`section_composition`). It detects visible quality or theme-adherence defects, proposes at most one constrained repair, recompiles through the existing safe compiler, and accepts the repair only when a second visual review proves improvement without technical regression.

2C is not a new page generator. It does not replace Safe Selection, the HTML engine, the agent engine, 2A adaptation, or 2B composition.

## 2. Explicit non-goals

- No free-form or controlled-scratch generation.
- No repair for `template_full`, legacy weighted fallback, or failed 2A/2B candidates.
- No copy rewriting, role changes, section insertion/removal/reordering, navigation changes, arbitrary CSS, JavaScript, or arbitrary URLs.
- No full regeneration and no second repair attempt.
- No automatic production enablement, deployment, paid pilot, or flag mutation as part of implementation.
- No separate user-credit debit during the pilot or initial limited rollout; internal cost remains fully measured.

Controlled-scratch generation is a separate future phase and must not be smuggled into 2C.

## 3. Existing systems reused

2C must reuse rather than recreate:

- `lib/ai/vision-critique.ts` gateway and failure-handling patterns;
- the SSRF-guarded Chromium rendering path in `lib/ai/inline-image.ts`;
- `SkeletonInventory`, `CreativeDirection`, and `SkeletonAdaptationPlan` contracts;
- `compileSkeletonIdentity`, asset resolution, sanitization, contrast validation, and structural fingerprints;
- Quick's atomic preview/persistence boundary;
- Visual Engine pilot budget, scalar telemetry, rate-card, rollback, and qualification patterns.

The current critic remains unchanged for 2A evidence compatibility. 2C introduces a versioned v2 critic contract instead of silently changing historical 2A semantics.

## 4. Architecture

The shared wrapper is independent from the main Visual Engine delivery mode:

```text
valid 2A/2B candidate
  -> render desktop + mobile
  -> visual-quality-critic-v2
  -> keep / repair / nonrepairable
  -> at most one bounded repair plan
  -> existing compiler + assets + sanitizer + fingerprints
  -> render desktop + mobile again
  -> visual-quality-critic-v2 again
  -> accept repaired candidate or return the original byte-for-byte
```

The primary units are:

1. **Multi-viewport renderer** — captures desktop and mobile from one locally supplied HTML document with the existing subresource SSRF guard, bounded bytes, deterministic viewport settings, and no persistence.
2. **Visual critic v2** — receives only the two screenshots, a redacted intent summary, ordered semantic roles, route, and version metadata. It never receives raw HTML as prompt text and never emits CSS or HTML.
3. **Repair-plan provider** — receives the validated critic issues, current creative direction, and redacted skeleton inventory. It emits a strict `SkeletonAdaptationPlan` delta only.
4. **Closed-loop orchestrator** — enforces call count, deadlines, compilation, acceptance, cost, atomicity, and fail-open behavior.
5. **Quick integration wrapper** — applies 2C after a valid 2A/2B candidate and before the single preview/persist commit.

## 5. Independent feature flag

`OPENLEN_VISUAL_ENGINE_REPAIR` is independent from `OPENLEN_VISUAL_ENGINE`:

| Value | Behavior |
| --- | --- |
| unset or `off` | No render, critic, repair, 2C telemetry, or latency. |
| `shadow` | Evaluate and optionally build a repaired candidate in the background; always deliver the original 2A/2B candidate. |
| `on` | Deliver a repair only when every acceptance gate passes; otherwise deliver the original. |
| any other value | Treat as `off`. |

`shadow` is pilot/allowlist-only and must not delay baseline delivery. `on` requires a separate rollout decision after a successful pilot. Removing the flag or setting `off` is the immediate rollback and leaves 2A/2B intact.

## 6. Critic v2 contract

The response schema is strict and versioned as `visual-quality-verdict/2.0`. Unknown keys or values invalidate the whole verdict.

It contains six integer scores from 1 through 10:

- `themeRecognition`;
- `visualHierarchy`;
- `componentCoherence`;
- `mobileReadability`;
- `imageryRelevance`;
- `briefAdherence`.

It also contains:

- `decision`: `keep | repair | nonrepairable`;
- up to 12 typed issues;
- each issue has a closed `code`, `severity`, optional known `hookId`, and bounded explanation intended for operator evidence only;
- no selectors, declarations, URLs, HTML, or executable instructions.

Initial repairable issue codes are:

- `theme_mismatch`;
- `palette_mismatch`;
- `weak_typography_hierarchy`;
- `spacing_density`;
- `mobile_overflow`;
- `imagery_mismatch`;
- `component_treatment_mismatch`.

Structural or content failures are `nonrepairable`. A fallback, timeout, missing render, invalid schema, provider error, or absent usage returns a typed critic fallback and can never authorize repair.

The critic uses temperature zero and an explicit output schema. Total critic work is bounded by the orchestrator; provider-reported usage is preserved even on invalid or fallback responses.

## 7. Repair contract and authority

Repair is attempted only when a non-fallback critic returns `repair` and either:

- at least one repairable score is below 7; or
- at least one typed issue is critical.

The repair provider may emit only a `SkeletonAdaptationPlan` delta using:

- allowlisted `--ol-*` design tokens;
- known style-hook IDs and their existing property allowlists;
- known replaceable asset-slot indices using the existing curated asset resolver.

It receives no persistence, filesystem, DB, renderer, or arbitrary fetch capability. The existing `CreativeDirection` remains the base direction; the repair plan is a constrained delta, not a new identity. Brand and explicit user constraints retain their existing precedence.

The compiler must rebuild the supplied inventory, reject stale or unknown hooks/assets, validate contrast and fonts, sanitize output, and require identical structural fingerprint and exact semantic role sequence.

## 8. Acceptance rule

A repaired candidate replaces the original only when all conditions hold:

1. compiler, asset resolver, sanitizer, technical render, contrast, structural fingerprint, and semantic-role checks pass;
2. the second desktop and mobile renders both exist within byte limits;
3. the second critic is non-fallback;
4. every targeted critical issue disappears and no new critical issue appears;
5. no score is lower than its original value;
6. the six-score total improves by at least two points;
7. final `themeRecognition` and `briefAdherence` are both at least 7.

Otherwise the wrapper returns the original candidate byte-for-byte, with its original metadata. Intermediate HTML is never previewed or persisted.

## 9. Failure, timeout, and latency policy

2C is fail-open to a technically valid original candidate:

- initial critic failure -> original;
- repair-provider failure -> original;
- compiler/asset/sanitizer/render failure -> original;
- second critic failure or non-improvement -> original;
- unexpected exception -> original plus redacted typed telemetry.

There is no retry. Maximum paid footprint for one eligible candidate is two critic calls and one repair call. Each call has its own abort deadline and the wrapper has an overall deadline; when the overall deadline wins, upstream work is aborted and the original is returned.

In `on`, the final candidate is selected before the single Quick preview/persist commit. In `shadow`, all 2C work is detached from the user's SSE critical path.

## 10. Metadata, privacy, and telemetry

Project metadata for an accepted repair records only:

- contract, prompt, policy, model, critic, compiler, and rate-card versions;
- route (`template_skeleton` or `section_composition`);
- before/after score vectors and typed issue codes;
- decision and acceptance code;
- structural fingerprints and output hashes;
- provider token usage, duration, and calculated scalar cost.

Pilot/operational telemetry must never store briefs, copy, HTML, screenshots, image bytes, raw model responses, repair explanations, arbitrary CSS, provider errors, user identity, API keys, or local paths. Evidence images and human-review state remain under an exact ignored `scratch/visual-engine-2c/` path and never enter the DB or Git.

## 11. Atomicity and route behavior

- Eligible routes: successful `template_skeleton` and `section_composition` only.
- Ineligible or incomplete metadata: return the original without rendering.
- 2C never changes the selected route or fallback template.
- Accepted repair metadata and repaired HTML commit together.
- Rejected repair metadata is diagnostic only and cannot be attached to the delivered project as if accepted.
- User credit behavior stays identical to current Quick during pilot and limited rollout.

## 12. Calibration cohort and paid boundary

The frozen local cohort contains exactly 15 synthetic cases:

- 6 healthy candidates that must be kept;
- 6 candidates with one controlled, repairable visual defect;
- 3 fallback, ambiguous, or nonrepairable cases that must keep the original.

The set is balanced between skeleton and composition and contains no real user data. Qualification is deterministic, local/read-only, and makes no provider call or DB write.

The paid smoke is a separately authorized operation. It allows at most:

- 15 initial critiques;
- 9 repair calls;
- 9 second critiques;
- 33 paid calls total;
- 30 MXN (`30000000` micro-MXN) total budget.

The runner is sequential, has no retry/replacement, validates HEAD, qualification self-hash, inventory, rate card, zero-use quota, budget, and an exact one-time authorization token before the first reservation or provider call. Implementation must not execute this runner.

## 13. Pilot gate and rollout

The smoke passes only when all gates pass together:

- 100% technical integrity among started rows;
- zero healthy candidates degraded or incorrectly replaced;
- zero changes outside token/hook/asset allowlists;
- zero structural, copy, role, navigation, or identity leakage;
- complete usage and cost rows for every paid call;
- total cost no greater than the separately authorized budget;
- human blind review prefers or ties the repair in at least 80% of comparable accepted repairs;
- immediate rollback fixture verifies `off`, `shadow`, and `on` while 2A/2B delivery remains unchanged.

A passing smoke does not enable `on`. Promotion is a separate explicit decision, first limited by environment/allowlist. Pilot failure leaves `OPENLEN_VISUAL_ENGINE_REPAIR=off` and requires a new decision before any paid rerun.

## 14. Verification strategy

Implementation is limited to five blocks:

1. versioned critic/repair contracts and multi-viewport rendering;
2. bounded repair provider and compiler-based closed loop;
3. Quick wrapper, independent flag, atomic delivery, metadata, budget, and telemetry;
4. frozen 15-case qualification and disabled-unless-authorized pilot tooling;
5. rollback, runbook, full 2A/2B/2C regression, privacy audit, and one final release review.

Tests must use injected provider, renderer, filesystem, DB, and persistence boundaries. They must prove exact call counts, no retry, timeout abortion, fail-open byte identity, no intermediate persistence, complete cost accounting, shadow non-blocking behavior, structural invariants, and untouched legacy/off behavior.

No extra implementation block may be added without identifying a genuine release blocker that makes an approved invariant impossible. Optional hardening belongs to a later decision.

## 15. Completion definition

2C implementation is complete when:

1. the shared wrapper works for valid skeleton and composition candidates behind the independent repair flag;
2. one bounded repair can be accepted only through the approved score and technical gates;
3. every failure returns the original candidate without partial preview or persistence;
4. the 15-case qualification is reproducible on a clean committed HEAD;
5. all 2A/2B regression, typecheck, rollback, privacy, and artifact gates pass;
6. no paid smoke, deployment, production enablement, or flag change occurred without separate authorization.
