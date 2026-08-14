# OpenLen Creative Sandbox Generation — Design

**Date:** 2026-08-14
**Status:** Approved by the user on 2026-08-14; ready for implementation planning
**Product:** OpenLen Visual Engine / Create with AI

## Objective

Create distinctive landing pages with broad creative freedom while guaranteeing
that a provider timeout, malformed response, rejected visual opinion, or failed
image never destroys an otherwise safe page.

OpenLen remains the authority for safety, compilation, persistence, cost, and
delivery. DeepSeek becomes the primary creative designer. Qwen and Gemini are
optional improvement tools. GLM is removed from the Create-with-AI runtime.

This is an orchestration replacement, not a rebuild of Visual Engine.

## Evidence and Problem Statement

The current runtime requires a serial chain of probabilistic outputs:

1. DeepSeek intent;
2. DeepSeek copy;
3. Qwen catalog scout;
4. DeepSeek page plan;
5. GLM section programs;
6. Gemini assets;
7. Qwen final verdict;
8. optional GLM repair and another Qwen verdict.

The last real Mundo Pincel execution passed intent, copy, and Qwen scout, then
failed at `page_plan` with a provider-content error. The current boundary asks
models to reproduce OpenLen's large internal schemas, ordering, taxonomy, IDs,
and cross-field invariants. Tests largely use already-valid mocked provider
objects, so they prove that OpenLen accepts its own fixtures rather than that a
real model reliably produces those objects.

The failure is therefore architectural: strictness is applied to provider
expression instead of to the delivered artifact.

## Alternatives Considered

### 1. Continue patching structured schemas

This is the smallest immediate change and may advance the next live request,
but it preserves the multiplicative reliability problem and exposes the next
strict boundary only after another paid run. Rejected.

### 2. Replace the entire pipeline with an autonomous Vercel agent

This would provide an agent loop and, with Vercel Workflow, durable steps. It
would also introduce a new runtime dependency, less predictable cost, and a
large infrastructure migration before correcting the actual provider boundary.
Rejected for this cutover. The tool interfaces below remain compatible with a
future durable workflow if production later needs cross-request resumption.

### 3. Deterministic shell plus bounded creative sandbox

OpenLen first creates a safe local baseline. DeepSeek can inspect and modify it
through a small set of creative tools carrying HTML/CSS strings rather than an
internal AST. Every accepted mutation becomes a new `lastKnownGood`. Qwen and
Gemini can improve the candidate but cannot veto delivery. Recommended and
approved.

## Existing Foundation Retained

The cutover reuses:

- the 450-template and 1,453-fragment catalog;
- section metadata, retrieval, fingerprints, and assembly;
- Rust-backed HTML normalization, sanitization, and release sealing;
- project persistence and atomic credit debit;
- asset catalog, Gemini image provider, byte validation, R2 storage, and asset
  manifest application;
- desktop/mobile rendering and deterministic overflow, typography, and
  geometry diagnostics;
- Qwen screenshot inspection;
- page budget, provider usage accounting, and redacted telemetry;
- explicit whole-template cloning as a separate user-selected route.

The existing uncommitted Fireworks response-wrapper experiment is not the
architectural fix. It may be retained later as transport tolerance only if its
tests remain valid.

## Runtime Architecture

### 1. Safe baseline

Before any paid boundary, OpenLen constructs a complete baseline from published
catalog fragments and repository-owned defaults:

- a local brief interpreter supplies conservative section roles and visual
  hints when provider intent is unavailable;
- profile data and the user brief supply deterministic minimum copy;
- semantic retrieval chooses compatible fragments without a reuse quota;
- existing assembly, finalization, sanitization, sealing, and deterministic
  render checks produce the first valid candidate.

The baseline is stored request-locally as `lastKnownGood`. If no safe baseline
can be produced, generation fails before paid creative work. This is the only
pre-persistence artifact failure that may abort the page.

### 2. DeepSeek creative session

DeepSeek V4 Flash is the only creative text model. It receives:

- the original brief and profile copy;
- a bounded page outline and current HTML/CSS canvas;
- bounded metadata for relevant catalog fragments;
- the allowed URL policy;
- tool descriptions and the remaining page budget.

It is not asked to emit `IntentAnalysis`, `AdaptivePageDesignProgram`,
`ExpressiveSectionProgram`, hashes, provenance, schema versions, or internal
IDs. OpenLen owns those values.

The session is finite: at most four DeepSeek turns, at most twelve accepted
mutations, no automatic transport retries, and no recursive sub-agent. Fireworks
tool calling is used through a provider-owned adapter; tool-call transport is
not allowed to leak into domain or persistence types.

### 3. Creative tools

The first implementation exposes four tools:

- `inspect_canvas`: returns the current outline, stable editable targets,
  bounded copy, available image slots, and sanitized diagnostics;
- `apply_creative_patch`: applies one or more bounded operations to replace,
  insert, remove, or reorder sections; update page CSS; edit copy; and set
  links. Section bodies may contain broad HTML and CSS;
- `request_image`: asks the existing asset pipeline for a described optional
  image slot;
- `render_preview`: renders desktop/mobile diagnostics and returns bounded
  measurements, not raw browser internals.

`finish` is represented by an assistant completion with no tool calls. Parallel
tool calls are not required. Unknown tools, malformed arguments, or unavailable
targets return a typed tool error and leave `lastKnownGood` unchanged.

### 4. Mutation transaction

Every creative patch is applied transactionally:

1. resolve only current stable target IDs;
2. apply the patch to an isolated candidate;
3. normalize and sanitize;
4. enforce the URL and CSS safety policies;
5. seal and run deterministic structural/render checks;
6. if valid, replace `lastKnownGood`; otherwise discard only that mutation and
   return a bounded diagnostic to DeepSeek.

No mutation writes the database, R2, credits, or operational telemetry. Those
effects remain at their existing controlled boundaries.

## Safety and URL Policy

Creative freedom includes arbitrary visual structure, semantic HTML, CSS,
typography, responsive layout, SVG ornament, CSS animation, and user-facing
copy.

The sandbox removes or rejects only executable or unsafe capabilities:

- `<script>`, event-handler attributes, `eval`, executable SVG handlers,
  plugin/object/embed surfaces, and unsafe iframes;
- `javascript:`, `vbscript:`, `file:`, executable HTML data URLs, embedded URL
  credentials, and private-network fetch targets;
- CSS execution primitives, unsafe imports, and network fetches that bypass the
  validated asset path;
- reserved OpenLen editor/runtime markers and writes outside the active page.

Normal user links are allowed without a domain allowlist:

- relative URLs and anchors;
- `https:` and `http:` destinations;
- `mailto:` and `tel:` actions.

User-provided URLs are preserved when they pass protocol and credential checks.
External image URLs are fetched through the existing SSRF-guarded asset path,
decoded, validated, and stored before they become durable project assets.

If sanitization removes a capability, the tool result tells DeepSeek exactly
what was removed so it can use existing OpenLen behaviors or CSS alternatives.

## Optional Visual and Image Improvement

### Qwen

Qwen receives only the final desktop/mobile images and a bounded copy of the
brief. It returns advisory issues. Deterministic safety diagnostics remain
authoritative.

- Qwen unavailable, malformed, or timed out: deliver `lastKnownGood`.
- Qwen accepts: deliver `lastKnownGood`.
- Qwen suggests improvement: allow one final DeepSeek repair turn.
- Repair invalid or worse: retain the previous `lastKnownGood`.
- No second Qwen call is required for delivery; deterministic checks validate
  the repaired candidate.

Qwen therefore cannot veto a safe page.

### Gemini

Gemini is reachable only through `request_image`, with zero to three optional
image calls per page. Every image is independently validated and applied.

- Provider, timeout, moderation, decode, storage, or budget failure leaves the
  current catalog image, CSS treatment, or placeholder intact.
- A later image failure does not discard earlier valid images.
- No image is required for delivery.

Gemini text and vision remain unreachable from Create with AI.

## Failure and Budget Semantics

The page budget covers all DeepSeek, Qwen, and Gemini calls. Before each paid
call OpenLen reserves its worst-case cost. When no reservation fits, it stops
paid improvement and delivers `lastKnownGood`.

Provider failures are recorded with redacted stage, model, usage when present,
duration, category, and cost. Prompts, HTML, CSS, copy, screenshots, URLs, raw
responses, credentials, and user identity are not stored in operational
telemetry.

Generation returns an error only when:

- no baseline passes normalization, sanitization, sealing, and essential render
  checks;
- final project persistence or atomic credit debit fails;
- an existing authorization, rollout, or input precondition fails.

Every DeepSeek, Qwen, Gemini, tool, mutation, and budget failure after the
baseline exists must still return a successful composition using
`lastKnownGood`.

## Persistence and Metadata

Only the final selected candidate crosses the existing atomic project-and-debit
boundary. Persisted metadata records:

- section-composition route and `templateId: null`;
- final manifest/hash/provenance generated by OpenLen;
- whether DeepSeek changed the baseline;
- whether Qwen advice was available and whether a repair was retained;
- asset manifest and trace only as a valid pair;
- redacted aggregate model/image usage.

Tool transcripts, model reasoning, intermediate HTML, rejected mutations, and
screenshots are not persisted in the project.

## Testing Strategy

### Local deterministic tests

- Baseline succeeds without Fireworks or Gemini credentials.
- Every provider stage independently throws, times out, returns malformed
  content, or exhausts budget and `runAiCreation` still returns `ok: true` with
  the latest safe candidate.
- Scripts, event handlers, executable URLs, credentials, private-network image
  fetches, and unsafe CSS are removed/rejected without losing the page.
- User HTTPS/HTTP/mailto/tel/relative links survive.
- Invalid section patches revert only that section transaction.
- Qwen rejection or failure cannot veto delivery.
- Gemini failures are isolated per slot and never discard the page.
- GLM and its model IDs are unreachable from the production Create-with-AI
  import graph.
- Persistence and credit debit remain one atomic final effect.

### Provider contract tests

- Snapshot the exact Fireworks tool definitions and allowlisted keyword set.
- Replay sanitized real envelopes for content, tool calls, usage, finish reason,
  and malformed arguments.
- Distinguish missing content, invalid JSON, invalid tool call, tool error, and
  provider failure without retaining provider bytes.
- Run one isolated canary for DeepSeek tool calling and one for Qwen vision
  before any complete paid page.

### Real acceptance

After local gates pass and with separate explicit authorization:

1. generate Mundo Pincel once;
2. visually inspect desktop and mobile;
3. generate terror, school, cooking, hotel, and product pages once each;
4. verify niche recognition, distinctive identity, usable links, safe output,
   cost, and no total failure when optional providers are disabled;
5. only then enable a bounded rollout.

## Delivery Boundary

This is one architectural cutover with four implementation checkpoints, not
four new product phases:

1. safe baseline and `lastKnownGood` failure semantics;
2. DeepSeek creative tool adapter and transactional HTML/CSS sandbox;
3. optional Qwen/Gemini wiring and removal of GLM from the runtime graph;
4. failure matrix, provider canaries, niche cohort, and rollout gate.

Each checkpoint remains on one feature branch and is not considered complete
until its focused tests and the existing AI-hybrid/assets gates pass. Live
provider calls require explicit authorization and a positive MXN cap.

## Non-Goals

- Rewriting the HTML Engine, catalog, assets pipeline, editor, or persistence.
- Migrating OpenLen hosting to Vercel Workflow in this cutover.
- Allowing arbitrary JavaScript or unrestricted network access.
- Replacing explicit template cloning.
- Guaranteeing full-stack applications; this work targets landing and
  marketing pages.
- Claiming Fable-level quality before real blind or visual evaluation.

## Completion Criteria

The cutover is complete when all of the following are true:

- a real Mundo Pincel generation reaches persistence and preview;
- DeepSeek can materially change structure and visual identity through the
  sandbox without reproducing an internal AST;
- every isolated DeepSeek/Qwen/Gemini failure still delivers a safe baseline;
- production Create-with-AI cannot import or invoke GLM;
- normal user URLs survive while executable URLs and scripts do not;
- the final result passes existing sanitizer, seal, deterministic render,
  asset, metadata, persistence, credit, budget, and privacy gates;
- at least six real niche pages are reviewed before rollout.
