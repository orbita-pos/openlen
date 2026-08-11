# Visual Engine 2C Stable Critic Design

**Date:** 2026-08-10
**Status:** Approved 2026-08-10
**Scope:** Stabilize the existing 2C closed-loop visual repair gate. Do not redesign the Visual Engine, add a new asset generator, or change 2A/2B delivery.

## Context and evidence

The final 15-case 2C smoke completed without incomplete rows and consumed `400158` micro-MXN. It produced six `adapted` and nine `fallback` rows instead of the required twelve and three. Four healthy cases consumed one provider call and were classified as `nonrepairable`. Repairable cases 8 and 11 consumed all three calls and returned `not_improved`. Four accepted repairs produced complete local comparison evidence.

Earlier isolated checks showed that the same healthy hotel fixture could receive `keep` with high scores. Adding a hotel image therefore would not address the observed failure: the unstable boundary is the critic decision and the all-dimensions improvement rule, not the lack of a hotel-shaped asset.

The current contract also permits internally weak combinations: `nonrepairable` has no typed reason and can be emitted with no evidence of a missing or unusable primary experience. The current improvement gate rejects a repair when any unrelated score decreases by one, even if the reported defect is removed and its relevant score materially improves.

## Goals

1. Make `nonrepairable` a narrow, typed outcome for a visibly unavailable or structurally unusable primary experience.
2. Accept repairs using the defect they were intended to fix while still rejecting real regressions.
3. Preserve safe fallback, structural/copy/navigation invariants and strict provider schemas.
4. Persist enough redacted scalar telemetry to distinguish a healthy keep, accepted repair, nonrepairable result and rejected repair.
5. Revalidate only the failing synthetic boundaries before any decision to run another full paid smoke.

## Non-goals

- Generate a Gemini image for the hotel or introduce image generation into 2C.
- Tune behavior for fixture IDs, case ordinals, domains or expected pilot labels.
- Change templates, section composition, copy, navigation, roles or asset resolution.
- Auto-enable repair mode or ship a user-facing rollout.
- Continue paid retries until the scorecard passes.

## Considered approaches

### A. Generate or insert a hotel photograph

This can make one fixture more literal, but the hotel already received `keep` in an isolated check and failed again in the full run. It does not address the other healthy false negatives or the two repeatable `not_improved` repairs. Rejected.

### B. Prompt-only recalibration

This is small and inexpensive, but leaves contradictory verdict shapes valid and keeps acceptance coupled to noisy unrelated scores. It would be difficult to distinguish a real repair from a lucky pilot response. Rejected as the sole solution.

### C. Typed verdict coherence plus defect-directed acceptance

This changes the model contract and the deterministic acceptance policy together. It is more work than a prompt edit, but the behavior is explicit, testable and provider-independent after parsing. This is the selected approach.

## Contract design

The visual verdict advances to a new explicit contract version. It adds `nonrepairableReason` with this closed vocabulary:

- `none`
- `primary_content_absent`
- `primary_content_hidden`
- `structurally_unusable`

The schema enforces:

- `keep`: `nonrepairableReason=none`, zero issues, and no score below the satisfied threshold of 7.
- `repair`: `nonrepairableReason=none` and at least one repairable issue.
- `nonrepairable`: a non-`none` reason and at least one score of 3 or lower.

Missing photography, abstract imagery, palette mismatch, typography, density, radius, components and ordinary responsive defects are repairable visual issues. They must not be labeled nonrepairable. Provider responses that violate these combinations are invalid and fail open to the original page.

The prompt will state the same rules and the response schema will require the new field. Provider prose remains replaced by existing canonical issue explanations. No HTML, copy, URLs, prompts or raw responses enter traces or telemetry.

## Defect-directed improvement policy

Each issue code maps to the score dimensions it is expected to improve:

| Issue | Relevant score dimensions |
| --- | --- |
| `theme_mismatch` | `themeRecognition`, `briefAdherence` |
| `palette_mismatch` | `themeRecognition`, `briefAdherence` |
| `weak_typography_hierarchy` | `visualHierarchy` |
| `spacing_density` | `visualHierarchy`, `componentCoherence` |
| `mobile_overflow` | `mobileReadability` |
| `imagery_mismatch` | `imageryRelevance`, `briefAdherence` |
| `component_treatment_mismatch` | `componentCoherence` |

A repaired candidate is accepted only when all conditions hold:

1. No critical issue remains.
2. Every critical issue code reported before repair is absent afterward.
3. No new issue code appears after repair.
4. The union of relevant score dimensions gains at least two points in total and none of those dimensions decreases.
5. Any unrelated score may decrease by at most one point, preventing one-point model jitter from vetoing a targeted improvement while still rejecting meaningful regressions.
6. The sum across all scores does not decrease.
7. Final `themeRecognition` and `briefAdherence` are at least 7.
8. Existing compiler, structural fingerprint, copy, navigation, role and sanitizer checks still pass.

This policy is deterministic after the two verdicts have been parsed. It contains no fixture or domain special case.

## Telemetry and scorecard

The closed loop keeps a redacted result code from this finite set:

- `healthy_keep`
- `repair_accepted`
- `nonrepairable`
- `not_improved`
- existing typed technical failure codes

The 2C runner writes the corresponding typed pilot reason plus cost and structural-invariant scalar fields. It never stores issue explanations, screenshots, HTML, prompts or responses. The scorecard will derive:

- healthy cases pass only as `healthy_keep`;
- repairable cases pass only as `repair_accepted` with comparison evidence;
- nonrepairable cohort cases pass only as `nonrepairable`;
- an accepted repair on a healthy case is a healthy replacement and fails the gate.

This removes the current ambiguity where `adapted` alone cannot distinguish a keep from a repair.

## Data flow and failure behavior

1. Render original desktop and mobile views.
2. Parse one strict critic verdict.
3. Return original immediately for coherent `keep` or `nonrepairable`.
4. For `repair`, generate one bounded plan, compile it through existing allowlists, and render the candidate.
5. Parse the final verdict and evaluate it with the deterministic defect-directed policy.
6. Accept only on complete proof; otherwise return the original.
7. Persist redacted scalar telemetry and write local evidence only for accepted repairable-cohort candidates.

Any timeout, invalid schema, compiler failure, render failure or invariant failure returns the original. Missing usage is costed conservatively and cannot become incomplete or free telemetry. There is no retry and no new provider call in this design.

## Testing strategy

Implementation follows RED-GREEN TDD:

- Contract tests for every valid and invalid decision/reason combination.
- Critic request-schema and prompt tests for the new field and narrow nonrepairable definition.
- Table-driven improvement tests for all seven issue mappings, one-point unrelated jitter, relevant regression, new issue codes, remaining critical issues and global score regression.
- Closed-loop tests proving exact call ceilings remain one call for keep/nonrepairable and three for repair.
- Runner/store/scorecard tests proving the four outcome classes remain distinguishable without storing content.
- Existing 2A, 2B, 2C, typecheck, rollback and privacy gates remain green.

No paid call is needed to implement or verify these contracts. Once local verification is green, a separate explicit decision controls a bounded synthetic diagnostic. It should test the previously failing healthy and repair boundaries first. Another complete 15-case smoke is allowed only if those targeted checks pass and a fresh budget is explicitly approved.

## Success criteria

- The implementation has no fixture-ID, ordinal or domain branch.
- Invalid/incoherent critic output fails open without leaking provider content.
- One-point unrelated score noise alone cannot reject a proven targeted repair.
- A real relevant-score regression, new issue, remaining critical issue or total regression is rejected.
- Telemetry differentiates healthy keep, accepted repair, nonrepairable and not improved.
- All non-live repository gates pass.
- Repair mode remains closed until the 2C human-review scorecard passes on a separately authorized pilot.

## Approved post-diagnostic correction

The first targeted run under the new `2.1` contract used ten provider calls across healthy cases 1, 2, 3 and 5 plus repairable cases 8 and 11. All six returned the redacted outcome `visual_not_improved`; measured cost was `171020` micro-MXN. The 15-case smoke therefore remained closed.

Local review established two boundaries that the original design did not cover:

1. The healthy renders visibly communicate their domains and requested experiences, but the critic prompt asks the model to compare every creative-direction field and can turn optional polish into a repair requirement. The critic must report a mismatch only for a material visible contradiction. Simple relevant symbols, abstract shapes, CSS illustration or lack of optional photography are not defects by themselves. `requiredVisualSignals` are semantic cues, not a literal asset checklist.
2. `mobile_overflow` is declared repairable, but the bounded compiler does not allow the model to emit arbitrary width, grid or overflow CSS. The repair path will therefore add one deterministic responsive-containment preset when—and only when—the validated initial verdict contains `mobile_overflow`. The preset is owned by OpenLen, fixed in source, scoped to mobile, appended inside the existing Visual Engine style marker and never authored or parameterized by the model.

The preset may constrain the document root wrapper and role-marked regions to the viewport, collapse hero/features grids to one bounded column, and constrain replaced media. It must not change DOM, copy, roles, navigation, URLs, assets or arbitrary selectors. Structural fingerprint equality and the existing sanitizer/render gates remain mandatory.

The critic prompt advances to `visual-quality-critic/2.4`; the verdict schema remains `visual-quality-verdict/2.1`. The targeted six-case diagnostic must be repeated before a full smoke. Passing requires four `visual_healthy_keep` and two `visual_repair_accepted` outcomes with no technical failure. This is a correction inside 2C, not a new phase or rollout.

## Approved deterministic overflow correction

The repeated targeted diagnostic matched five of six cases. Healthy cases 1, 2, 3 and 5 and repairable case 8 matched their expected outcomes. Case 11 remained the only mismatch: its mobile render has document-level horizontal overflow, but the critic returned `keep`. Local rendering also proved that the existing fixed containment preset removes that overflow while preserving the structural fingerprint.

Document-level horizontal overflow is browser geometry, not a subjective visual judgment. The production renderer will therefore measure it at the 390-pixel mobile viewport by comparing the document/body scroll width with the viewport client width using a one-pixel tolerance. It will return only the boolean `mobileOverflow`; no DOM content, dimensions or selectors enter the provider request, trace or telemetry.

When the initial production render reports `mobileOverflow=true`, OpenLen will deterministically reconcile a coherent `keep` or `repair` verdict into a repair verdict containing the canonical critical `mobile_overflow` issue and a mobile-readability score no greater than 5. A coherent `nonrepairable` verdict remains authoritative. The final render is measured again; acceptance requires `mobileOverflow=false` in addition to the existing defect-directed improvement and structural gates. Injected/custom renderers that cannot measure geometry leave the boolean absent and preserve existing behavior.

This is generic browser diagnostics with no fixture, ordinal, template or domain branch. It adds no provider call and does not change copy, DOM structure, navigation, templates or model-authored CSS.

## Approved deterministic typography and component-geometry correction

The final 15-case smoke matched 13 expected semantic classes. Cases 9 and 12 were the only mismatches: the rendered case-9 typography was materially unreadable and case 12 visibly flattened the rounded component treatment, while the critic classified both as healthy. These are computed-style boundaries that OpenLen can measure without another provider call.

At the existing 390-pixel mobile viewport, the production renderer will additionally measure only these redacted scalars:

- the visible `h1` and first hero/main/body paragraph computed font sizes;
- the count of visible buttons, button roles and articles;
- the count of those components whose largest computed corner radius is at least 8 pixels.

It derives two booleans. `weakTypographyHierarchy` is true only when a visible `h1` is below 24 pixels, the corresponding visible body text is below 12 pixels, or their size ratio is below 1.5. `squareComponentTreatment` is true only with at least three measured components and fewer than 25 percent rounded components. Raw dimensions, selectors, HTML and computed styles do not enter Gemini requests, traces or telemetry.

The closed loop reconciles a coherent `keep` or `repair` verdict with these measurements. Weak typography adds the canonical critical `weak_typography_hierarchy` issue and caps `visualHierarchy` at 5. Essentially square components add the canonical critical `component_treatment_mismatch` issue and cap `componentCoherence` at 5 only when the approved direction does not explicitly request square geometry. A coherent `nonrepairable` verdict remains authoritative. The final render must clear every deterministic diagnostic before acceptance.

This correction is generic and contains no case ID, ordinal, fixture, template or domain branch. It reuses the existing compiler tokens and structural fingerprint gate, adds no provider call, and makes no database change during implementation.
