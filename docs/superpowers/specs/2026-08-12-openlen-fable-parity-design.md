# OpenLen Fable-Parity Adaptive Generation — Design

**Date:** 2026-08-12
**Status:** Approved by Jesús Bernal in session
**Product:** OpenLen Visual Engine / Create with AI

## Objective

Make OpenLen capable of producing landing pages with niche fidelity, visual
identity, polish, and variety comparable to Fable 5 while preserving OpenLen's
existing deterministic safety, responsive, provenance, asset, and persistence
guarantees.

“Fable parity” is an evaluation result, not a marketing assumption. The new
pipeline cannot be described as Fable-level until it passes the blind
comparison gate defined below.

## Current Foundation

This delivery reuses rather than rebuilds:

- hybrid-only AI creation and explicit separation from whole-template cloning;
- the 450 published-template donor corpus and derived-section compiler;
- reviewed visual metadata and deterministic semantic retrieval;
- design tokens, creative direction, fonts, geometry, and style hooks;
- the Rust-backed HTML Engine, sanitizer, structural fingerprints, and release
  sealing;
- domain assets, Gemini image generation, storage, and manifest validation;
- desktop/mobile rendering, overflow, typography, and component-geometry
  diagnostics;
- 2C closed-loop visual review and atomic persistence/credit behavior;
- redacted usage, cost, duration, and reason-code telemetry.

The current generated-section vocabulary is intentionally small: eight layouts
and five block types. That is sufficient as a safe fallback, but it is too
limited for VHS horror, tactile children's illustration, cinematic product
launches, editorial food, or other Fable-level identities. The delivery must
therefore improve the model boundary without discarding the validators around
it.

## Provider Roles

Create with AI uses four narrowly assigned model capabilities:

| Capability | Provider/model | Responsibility |
|---|---|---|
| Economical reasoning | Fireworks `accounts/fireworks/models/deepseek-v4-flash` (the stable DeepSeek-V4-Flash-0731 route) | intent, copy, page requirements, creative brief, and structured page plan |
| Visual construction | Fireworks `accounts/fireworks/models/glm-5p2` | produce expressive safe-section programs for `rebuild` and `generate`, and at most one visual repair |
| Visual perception | Fireworks `accounts/fireworks/models/qwen3p7-plus` | inspect candidate contact sheets and final desktop/mobile screenshots |
| Image generation | Google `gemini-2.5-flash-image` | generate requested photos, illustrations, and textures only |

Gemini text and Gemini vision are removed from the reachable Create-with-AI
graph. Other OpenLen features may retain their existing providers. Gemini is
not a text fallback for Create with AI.

All provider-specific payload parsing sits behind OpenLen-owned interfaces and
strict schemas. Model names are policy configuration, not scattered defaults.

## Adaptive Catalog Policy

The catalog is an optional source of strong visual ideas, not a quota.

For each requested page role, deterministic retrieval supplies a bounded set of
compatible candidates. Qwen receives a labeled contact sheet plus the
allowlisted brief and returns one of three decisions:

- `reuse`: use the verified compiled fragment when it already fits;
- `rebuild`: preserve only its useful structural idea and ask GLM for a new
  OpenLen section program;
- `generate`: reject the candidates and create a new section program.

There is no minimum number of catalog sections and no requirement to preserve a
candidate's original visual treatment. A page with zero reused sections is
valid when that is the best creative result.

The following remain mandatory:

- at least three distinct final structural fingerprints;
- no repeated generated program disguised with different IDs;
- no reconstruction of a source template's original band sequence;
- no source template contributing more than two directly reused sections;
- whole-template HTML is never reachable from Create with AI;
- every reused or rebuilt decision retains internal, non-model-controlled
  provenance.

## Expressive Safe-Section Program

GLM does not return executable HTML, CSS, JavaScript, URLs, or unbounded copy.
It returns a strict `ExpressiveSectionProgram` referencing only allowlisted copy
keys and asset-slot indexes.

The program supports:

- nested layout containers with bounded depth and node count;
- grid, flex, split, editorial, collage, bento, gallery, timeline, marquee,
  layered, and free-composition presets;
- headings, body text, lists, cards, actions, media, badges, stats, dividers,
  ornamental shapes, and bounded texture layers;
- responsive layout values for desktop/tablet/mobile;
- allowlisted typography, spacing, sizing, alignment, border, color-role,
  blend, and transform tokens;
- named, CSS-only motion presets with reduced-motion fallbacks;
- no arbitrary selectors, declarations, scripts, event handlers, external
  dependencies, URLs, or literal user copy.

OpenLen compiles the program into repository-owned HTML/CSS, then runs the
existing sanitizer, asset policy, fragment compiler, structural fingerprint,
desktop/mobile renderer, and semantic gates. A model output that cannot compile
fails closed.

## Page Workflow

1. DeepSeek analyzes the brief and creates copy and a bounded creative brief.
2. OpenLen builds the required section-role plan and retrieves 6–12 compatible
   candidates per page, not per role, subject to a hard total payload limit.
3. OpenLen renders a labeled contact sheet from verified fragments.
4. Qwen returns strict `reuse`, `rebuild`, or `generate` decisions and short
   allowlisted visual observations.
5. DeepSeek finalizes the page design program: rhythm, section order, contrast,
   narrative, required signals, forbidden signals, and image requirements.
6. GLM produces only the `rebuild` and `generate` section programs.
7. Gemini produces only the approved image slots.
8. OpenLen compiles, assembles, normalizes, sanitizes, seals, and renders the
   complete candidate.
9. Qwen scores brief fidelity, niche recognition, coherence, visual quality,
   originality, and desktop/mobile execution.
10. If the candidate fails a repairable visual criterion, GLM receives the
    strict verdict and one bounded repair request. OpenLen recompiles and
    reruns every gate once.
11. The result is delivered only after deterministic and visual gates pass.

There is one creative generation attempt and at most one visual repair. There
is no model carousel and no recursive agent loop.

## Reliability and Failure Policy

Fireworks Standard is the default service tier. Priority may be enabled by
policy for the final GLM generation or Qwen review when measured production
capacity errors justify it.

One transport retry is permitted only when all of these are true:

- the first response produced no response body and no reported usage;
- the status is 429, 502, 503, 504, or a connection/timeout failure;
- the retry reuses the same redacted request ID and identical payload;
- the cost guard reserves the second attempt before it starts.

Schema, incompatibility, safety, and visual-quality failures are never
transport-retried. Provider failure never reaches whole-template fallback.

## Cost Policy

All paid calls use one shared rate card and reservation ledger.

- normal target: no more than 5 MXN per delivered landing page;
- hard default cap: 10 MXN per landing page;
- the cap includes transport retries and the optional visual repair;
- when the next worst-case reservation would exceed the cap, generation stops
  before the call;
- model usage, image count, calculated MXN, duration, and typed result are
  retained; prompts, copy, HTML, screenshots, raw responses, credentials, and
  user identity are not retained in operational telemetry.

The cap is configurable downward by product policy but cannot be absent or
non-positive in enabled production mode.

## Fable-Parity Evaluation Gate

### Cohort

The evaluation contains 20 landing-page prompts:

- 12 fixed public prompts spanning children's creativity, psychological
  horror/VHS, comedy, game launch, school/community, editorial cooking,
  boutique hospitality, physical product, music/culture, nonprofit cause,
  luxury/editorial, and an intentionally unusual niche;
- 8 sealed prompts unavailable to implementation prompts and fixtures until the
  release comparison begins.

Prompts include both explicit art direction and underspecified real-user briefs
to measure proactivity rather than prompt parroting.

### Blind comparison

Each prompt is generated once by OpenLen and once by Fable 5 under equivalent
content and image-generation permissions. Desktop and mobile results are
randomized and labeled A/B. At least three human reviewers vote independently.
Model identity and per-page cost remain hidden until decisions are locked.

Reviewers score:

- immediate niche recognition and prompt fidelity;
- distinctive art direction and absence of generic AI/SaaS styling;
- composition, hierarchy, typography, imagery, detail, and polish;
- coherence across the complete page;
- desktop and mobile usability;
- overall preference.

### Release thresholds

OpenLen passes only when all conditions hold:

- wins or ties at least 70% of pairwise comparisons;
- outright wins at least 40%, unless ties alone establish reviewer-equivalent
  quality on at least 80%;
- no page has majority-reviewed wrong niche identity;
- at least 90% of OpenLen attempts produce an eligible final page;
- zero whole-template clones, critical safety failures, horizontal overflow,
  unreadable primary text, or persistence/credit atomicity failures;
- median cost is at or below 5 MXN and every page remains below its 10 MXN cap.

Failure blocks rollout. Thresholds cannot be relaxed after seeing results. The
same artifacts may be diagnosed, but a new paid comparison requires a new
versioned cohort and explicit authorization.

## Rollout

1. Finish and commit the in-progress deterministic derived-catalog compiler;
   two dry runs must produce the same manifest.
2. Implement the provider and adaptive-generation changes with local mocks and
   no paid calls.
3. Run all deterministic release gates and the 20-prompt fixture cohort.
4. Obtain explicit authorization and an MXN cap for any live Fireworks, Gemini,
   or Fable evaluation.
5. Run a small provider canary, then the blind parity evaluation.
6. Enable for a bounded production percentage only after the parity gate passes.
7. Roll back by disabling Create with AI; explicit template cloning remains
   available. Never restore a whole-template AI fallback.

## Fixed Delivery Boundary

This is one implementation stage with six tasks:

1. stabilize and publish the derived catalog;
2. add the multi-provider gateway, model policy, reliability, and cost ledger;
3. add adaptive catalog scouting and page design decisions;
4. add the expressive safe-section compiler and adaptive composition;
5. integrate images, visual criticism, one repair, and Create-with-AI delivery;
6. add the Fable-parity evaluation, rollout gates, and operations documentation.

Critical or Important defects discovered by a task are fixed inside that task.
Optional hardening and new model experiments do not create additional release
phases. After Task 6 the stage is either release-approved or explicitly failed
by its evaluation; it is not extended indefinitely.

## Non-Goals

- Rebuilding the Rust HTML Engine, assets engine, 2B composition, or 2C repair.
- Removing explicit user-selected template cloning.
- Fine-tuning a model in this delivery.
- Sending all 450 templates or their screenshots to a model per request.
- Using raw model HTML/JavaScript directly in a delivered project.
- Claiming universal perfection for applications, dashboards, games, or
  arbitrary full-stack products; this gate covers landing and marketing pages.

## Evidence Basis

- Fireworks currently exposes DeepSeek V4 Flash, Qwen 3.7 Plus, and GLM 5.2 on
  its managed inference platform.
- Design Arena reports GLM 5.2 above Fable 5 on its single-turn HTML website
  design evaluation, while noting that Fable remains stronger in some other
  design categories. OpenLen therefore uses GLM as a visual constructor but
  still requires its own blind application-level evaluation.
