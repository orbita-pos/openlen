# AI Hybrid Visual Quality Fail-Open Design

## Problem

Real Mundo Pincel generation now completes intent, copy, eight-section composition, fill, creative compilation, sanitization, structural validation, and technical rendering. Delivery still fails for two independent reasons:

1. A reviewed gallery fragment contains an unbreakable heading inside a flex item. At 390 px the document reaches 407 px, so the deterministic mobile-overflow diagnostic is correct.
2. After the repair loop produces a candidate, Gemini's final critic can return an invalid/provider response. The current gate maps that model failure to `visual_quality_failed` and discards the already safe composition.

## Selected Design

### Deterministic mobile containment

Section composition will add one owned, versioned style before creative adaptation. It will be scoped exclusively to `[data-openlen-role]` descendants and will:

- set `min-width: 0` on section descendants so flex/grid children may shrink;
- allow long headings, paragraphs, labels, links, and buttons to wrap with `overflow-wrap: anywhere`;
- avoid clipping, hiding, restructuring, or rewriting copy.

The owned style becomes part of the sanitized structural baseline, so the existing fingerprint, sanitizer, role, and delivery gates remain authoritative.

### Bounded critic fail-open

The visual repair loop will distinguish model unavailability from a visual defect:

- If the initial critic is unavailable or invalid and deterministic renderer diagnostics are clean, return the unchanged composition as `critic_unavailable_keep`.
- If a final critic is unavailable after a repair attempt, return the unchanged original composition as `critic_unavailable_keep` only when both the original and final renders have no deterministic diagnostics.
- If mobile overflow, weak typography hierarchy, or incompatible component geometry is present, critic failure remains blocking.
- A valid critic verdict of `nonrepairable`, a failed repair, a failed render, or a non-improving repair remains blocking.

`runQuickVisualQualityGate` will accept `critic_unavailable_keep` exactly like `healthy_keep`, reseal the original composition hash, and never accept the unverified repair candidate.

## Safety Invariants

- No whole-template fallback or clone path is restored.
- No structural, sanitizer, fingerprint, role, asset, render, or copy-leak check is bypassed.
- Fail-open applies only to critic provider/response failure after deterministic diagnostics are clean.
- The original validated HTML is delivered; an unverified repaired candidate is never delivered.
- Provider failures remain available as redacted result codes/usage telemetry.

## Verification

- RED/GREEN unit tests for the owned mobile-safety style and its scope.
- A real Chromium regression at 390 px proving the known unbreakable flex heading no longer widens the document.
- Closed-loop tests for initial/final critic failure with clean diagnostics and with deterministic defects.
- Quick quality-gate tests proving original HTML/hash preservation on `critic_unavailable_keep`.
- Focused Visual Engine suites, typecheck, and diff checks.
- One real Mundo Pincel generation followed by desktop/mobile screenshot review.
- Only after Mundo Pincel passes, run the remaining six approved niche cases sequentially.

## Non-Goals

- Disabling the visual critic.
- Treating a valid negative verdict as success.
- Hiding overflow with `overflow-x: hidden` or clipping content.
- Adding retries or additional paid calls.
