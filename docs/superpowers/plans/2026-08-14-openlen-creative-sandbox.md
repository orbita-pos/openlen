# OpenLen Creative Sandbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fail-stop four-model Create-with-AI chain with a safe local baseline that DeepSeek can freely improve through transactional HTML/CSS tools while Qwen and Gemini remain optional and GLM is unreachable.

**Architecture:** OpenLen first assembles, fills, finalizes, seals, and renders a provider-free section-composition baseline. A bounded Fireworks tool-call adapter lets DeepSeek inspect and mutate an isolated canvas; each safe mutation replaces request-local `lastKnownGood`. Qwen may advise one DeepSeek repair and Gemini may supply up to three optional images, but any provider/tool/budget failure delivers the latest safe candidate.

**Tech Stack:** TypeScript, Vitest, Zod, Fireworks Chat Completions, `node-html-parser`, PostCSS, existing Rust-backed HTML Engine, existing asset pipeline/R2 adapter, existing Qwen renderer/critic, PostgreSQL atomic persistence boundary.

**Spec:** `docs/superpowers/specs/2026-08-14-openlen-creative-sandbox-design.md`

## Global Constraints

- Do not add Vercel AI SDK, Workflow SDK, another agent framework, or a hosting migration.
- DeepSeek V4 Flash is the only creative text model in Create with AI.
- Remove GLM and every GLM model ID from the production Create-with-AI import graph; legacy non-Create features may retain their modules.
- Qwen is advisory and cannot veto a deterministic-safe candidate.
- Gemini is image-only, optional, zero to three calls, and cannot veto a candidate.
- Create `lastKnownGood` before any paid boundary; provider and budget failure after that point must return `ok: true`.
- Preserve scripts/event-handler/executable-URL/private-network protections while allowing relative, anchor, HTTPS, HTTP, mailto, and tel links.
- Keep the 10 MXN hard page budget, single atomic project-and-credit commit, redacted telemetry, and zero automatic model retries.
- Do not persist prompts, tool transcripts, intermediate/rejected HTML, CSS, URLs, screenshots, raw responses, credentials, reasoning, or user identity.
- Preserve explicit whole-template clone as a separate route; Create with AI remains `section_composition` with `templateId: null`.
- Preserve unrelated untracked files and the pre-existing uncommitted `lib/ai/fireworks-client.ts` / `.test.ts` response-wrapper experiment. Integrate that experiment only in Task 2 after its focused RED/GREEN; never mix it into another commit.
- Live Fireworks/Gemini calls, DATABASE_URL/R2 writes, publication, rollout, and deploy remain closed until Task 5 and require separate explicit authorization.

---

## File Map

### New production units

- `lib/curate/creative-baseline.ts` — provider-free intent/copy/fragment assembly, deterministic local fill, finalization, seal, metadata, and initial `lastKnownGood`.
- `lib/ai/fireworks-tool-client.ts` — OpenAI-compatible Fireworks tool-call transport with budget settlement, usage parsing, no retry, bounded messages, and redacted typed failures.
- `lib/curate/creative-sandbox-contracts.ts` — small provider DTOs for inspect, patch, image request, render preview, and tool results.
- `lib/curate/creative-sandbox.ts` — transactional canvas mutation, URL/CSS policy, sanitization, sealing, deterministic render gate, and last-known-good state.
- `lib/curate/deepseek-creative-session.ts` — finite tool loop: at most four DeepSeek calls and twelve accepted mutations.
- `lib/curate/optional-image-tool.ts` — per-request optional Gemini/curated image resolution; failures retain the candidate.
- `lib/curate/advisory-visual-review.ts` — one optional Qwen review and at most one DeepSeek repair; Qwen/repair failure retains the candidate.

### Existing production units modified

- `lib/ai/fireworks-contracts.ts` — add tool-role/message/result contracts without changing strict JSON contracts.
- `lib/ai/fireworks-client.ts` — retain the response-wrapper tolerance only for JSON calls and share redacted envelope/usage helpers with the tool adapter.
- `lib/curate/fable-runtime-composition.ts` — own one budget and Fireworks client, expose DeepSeek tool session/Qwen/Gemini, remove GLM providers.
- `lib/curate/run-ai-creation.ts` — baseline-first orchestration and fail-soft improvement.
- `lib/curate/ai-creation-contracts.ts` — stages/metadata for baseline, creative session, optional image, advisory review, and degraded success.
- `lib/curate/quick-section-composition.ts` — route production composition to the new baseline/sandbox result, preserving the injected legacy seam for non-production tests.
- `lib/curate/curate-post-handler.ts` — progress names only; persistence/debit behavior remains unchanged.
- `lib/generation/fable-generation-telemetry.ts` — accepted redacted stage names and degraded-delivery outcome.
- `lib/curate/ai-hybrid-import-boundary.test.ts` — prove GLM and legacy Fable planner modules are unreachable from the route.
- `package.json` and `vitest.config.ts` — register only the new focused tests in existing gates; add no runtime dependency.
- `docs/generation/ai-hybrid-only-runbook.md` — runtime roles, fallbacks, environment variables, canary authorization, rollback.

### Tests

- `lib/curate/creative-baseline.test.ts`
- `lib/ai/fireworks-tool-client.test.ts`
- `lib/curate/creative-sandbox-contracts.test.ts`
- `lib/curate/creative-sandbox.test.ts`
- `lib/curate/deepseek-creative-session.test.ts`
- `lib/curate/optional-image-tool.test.ts`
- `lib/curate/advisory-visual-review.test.ts`
- existing `lib/curate/run-ai-creation.test.ts`
- existing `lib/curate/curate-route.fable.integration.test.ts`
- existing `lib/generation/ai-hybrid-niche-cohort.test.ts`

---

### Task 1: Provider-Free Baseline and Last-Known-Good Contract

**Files:**
- Create: `lib/curate/creative-baseline.ts`
- Create: `lib/curate/creative-baseline.test.ts`
- Modify: `lib/curate/deterministic-page-input.ts`
- Modify: `lib/curate/deterministic-page-input.test.ts`
- Modify: `lib/curate/ai-creation-contracts.ts`
- Test: `lib/generation/compose-sections.test.ts`
- Test: `lib/curate/finalize-composed-document.test.ts`

**Interfaces:**
- Consumes: `buildDeterministicIntent(brief)`, `buildDeterministicPageCopy(brief, intent)`, `composeSectionCandidate(input, deps)`, `finalizeComposedDocument(input)`, `sealRelease(html)`, `renderVisualQualityViewports(html)`.
- Produces:

```ts
export interface SafeCreativeCandidate {
  readonly html: string;
  readonly title: string;
  readonly visualEngine: Extract<VisualEngineProjectMetadata, { route: "section_composition" }>;
  readonly filled: boolean;
  readonly appliedOps: number;
  readonly source: "baseline" | "deepseek" | "deepseek_repair";
}

export type CreativeBaselineResult =
  | { readonly ok: true; readonly candidate: SafeCreativeCandidate; readonly intent: IntentAnalysis; readonly copy: ExtractedBusinessData }
  | { readonly ok: false; readonly code: "section_inventory_unavailable" | "baseline_invalid" };

export async function buildCreativeBaseline(
  input: { readonly projectId: string; readonly brief: string; readonly profileData: BusinessProfileData; readonly records: readonly SectionRecord[] },
  deps?: CreativeBaselineDeps,
): Promise<CreativeBaselineResult>;
```

- `SafeCreativeCandidate` becomes the single candidate type used by Tasks 2–4.

- [ ] **Step 1: Write the failing provider-free baseline tests**

Add tests proving all of these in `creative-baseline.test.ts`:

```ts
it("builds and renders a safe Mundo Pincel baseline without any provider", async () => {
  const provider = vi.fn(() => { throw new Error("provider must not run"); });
  const result = await buildCreativeBaseline(INPUT, makeDeps({ provider }));
  expect(result).toMatchObject({ ok: true, candidate: { title: "Mundo Pincel", source: "baseline" } });
  if (!result.ok) return;
  expect(result.candidate.html).toContain('data-openlen-role="hero"');
  expect(result.candidate.html).not.toContain("MORADA");
  expect(result.candidate.visualEngine.templateId).toBeNull();
  expect(provider).not.toHaveBeenCalled();
});

it("fails before paid work when no catalog fragment can form a safe baseline", async () => {
  await expect(buildCreativeBaseline({ ...INPUT, records: [] }, makeDeps()))
    .resolves.toEqual({ ok: false, code: "section_inventory_unavailable" });
});

it("replaces every substantive donor text block locally", async () => {
  const result = await buildCreativeBaseline(INPUT, makeDeps({ fragments: LEAKY_FRAGMENTS }));
  expect(result.ok && detectTemplateLeaks(LEAKY_SOURCE, result.candidate.html).damaging).toEqual([]);
});
```

Extend `deterministic-page-input.test.ts` with unknown-but-valid niches, English
and Spanish briefs, explicit quoted names, and a guarantee of at least `hero`,
one content role, and `footer`.

- [ ] **Step 2: Run Task 1 RED**

Run:

```powershell
npm.cmd test -- lib/curate/creative-baseline.test.ts lib/curate/deterministic-page-input.test.ts lib/generation/compose-sections.test.ts lib/curate/finalize-composed-document.test.ts
```

Expected: FAIL because `creative-baseline.ts` and the provider-free local fill do
not exist. Existing regressions must continue to collect.

- [ ] **Step 3: Implement bounded local input fallback**

Keep reviewed niche matches, but make unmatched briefs produce a conservative
generic intent instead of borrowing the first cohort row:

```ts
export function buildDeterministicIntent(brief: string): IntentAnalysis {
  const match = matchDeterministicNiche(brief);
  if (match.score > 0) return match.candidate.intent;
  return IntentAnalysisSchema.parse({
    schemaVersion: "intent-analysis/1.0",
    language: /\b(?:para|crea|página|sitio)\b/i.test(brief) ? "es" : "en",
    functional: { siteType: "marketing", requiredSections: ["header", "hero", "features", "cta", "footer"], primaryActions: [], contentModel: "landing_page" },
    audience: { primary: "general", secondary: [], ageRange: null },
    domains: [], emotionalGoals: [], requiredVisualSignals: [], forbiddenVisualSignals: [], explicitConstraints: [], ambiguities: [],
  });
}
```

Change `matchDeterministicNiche` to return `{ candidate, score }`; do not use a
zero-score cohort row as truth.

- [ ] **Step 4: Implement deterministic fragment fill**

In `creative-baseline.ts`, define role-owned text queues and replace every
visible leaf under each `[data-openlen-role]` with escaped local copy. The
implementation must remove donor text, not selectively patch it:

```ts
function fillSectionLocally(section: HTMLElement, role: string, copy: ExtractedBusinessData): number {
  const values = roleCopy(role, copy);
  const leaves = section.querySelectorAll("h1,h2,h3,h4,p,li,a,button,span,figcaption,blockquote")
    .filter((node) => node.querySelector("h1,h2,h3,h4,p,li,a,button,span,figcaption,blockquote") === null);
  let applied = 0;
  for (let index = 0; index < leaves.length; index += 1) {
    leaves[index].set_content(escapeHtml(values[index % values.length] ?? copy.business_name ?? "OpenLen"));
    applied += 1;
  }
  return applied;
}
```

Use `composeSectionCandidate` with injected deterministic fill and deterministic
creative adaptation; do not invoke `fillWithGemini`, `generateCreativeDirection`,
`adaptTemplateSkeleton`, or any provider. Generate the final composition
manifest/hash from the finalized HTML using existing schemas.

- [ ] **Step 5: Seal and deterministically render the baseline**

Accept only when:

```ts
const finalized = finalize({ html: locallyFilled, profileData: input.profileData, title });
if (!finalized.ok) return { ok: false, code: "baseline_invalid" };
const sealed = seal(finalized.html);
if (!sealed.sealed) return { ok: false, code: "baseline_invalid" };
const rendered = await render(sealed.html);
if (!rendered || rendered.mobileOverflow || rendered.invalidGeometry) {
  return { ok: false, code: "baseline_invalid" };
}
```

Weak typography is not a baseline safety abort; it is an improvement signal.

- [ ] **Step 6: Run Task 1 GREEN and typecheck**

Run the Step 2 command, then:

```powershell
npm.cmd run typecheck
git diff --check
```

Expected: all Task 1 tests PASS; typecheck and diff check exit 0.

- [ ] **Step 7: Commit Task 1**

Stage only Task 1 files and commit:

```powershell
git commit -m "feat(curate): add provider-free creative baseline"
```

---

### Task 2: Fireworks Tool Transport and Transactional Creative Sandbox

**Files:**
- Create: `lib/ai/fireworks-tool-client.ts`
- Create: `lib/ai/fireworks-tool-client.test.ts`
- Create: `lib/curate/creative-sandbox-contracts.ts`
- Create: `lib/curate/creative-sandbox-contracts.test.ts`
- Create: `lib/curate/creative-sandbox.ts`
- Create: `lib/curate/creative-sandbox.test.ts`
- Modify: `lib/ai/fireworks-contracts.ts`
- Modify: `lib/ai/fireworks-client.ts`
- Modify: `lib/ai/fireworks-client.test.ts`
- Test: `lib/agent/tools.test.ts`
- Test: `lib/html-engine.test.ts`

**Interfaces:**
- Consumes: `SafeCreativeCandidate`, `PageBudget`, `sanitizeForPublish`,
  `sealRelease`, `renderVisualQualityViewports`, `validateUrl` for fetched
  images only.
- Produces:

```ts
export type CreativeToolName = "inspect_canvas" | "apply_creative_patch" | "request_image" | "render_preview";
export interface FireworksToolCall { readonly id: string; readonly name: CreativeToolName; readonly arguments: unknown }
export type FireworksToolTurnResult =
  | { readonly ok: true; readonly calls: readonly FireworksToolCall[]; readonly content: string | null; readonly usage: ModelTokenUsage; readonly durationMs: number; readonly modelId: string }
  | { readonly ok: false; readonly code: "missing_key" | "budget_exceeded" | "timeout" | "http" | "provider" | "invalid_tool_call"; readonly usage?: ModelTokenUsage; readonly durationMs: number; readonly modelId: string };

export interface CreativeSandbox {
  current(): SafeCreativeCandidate;
  inspect(): CreativeCanvasInspection;
  applyPatch(input: CreativePatchInput): Promise<CreativeToolResult>;
  renderPreview(): Promise<CreativeToolResult>;
}
```

- [ ] **Step 1: Write Fireworks tool-transport RED tests**

Cover exact OpenAI-compatible envelopes, usage, `finish_reason`, single and
multiple sequential calls, malformed arguments, unknown tools, missing content
with tool calls, timeout through `response.json/text`, no retry, and budget
settlement:

```ts
it("accepts a tool-call turn with null content and settles its exact usage", async () => {
  const result = await client.turn(REQUEST);
  expect(result).toMatchObject({ ok: true, calls: [{ name: "inspect_canvas", arguments: {} }] });
  expect(budget.snapshot().modelUsage).toHaveLength(1);
});

it("rejects an unknown or ambiguous tool without exposing arguments", async () => {
  await expect(client.turn(REQUEST)).resolves.toMatchObject({ ok: false, code: "invalid_tool_call" });
  expect(JSON.stringify(result)).not.toContain("private prompt");
});
```

- [ ] **Step 2: Write sandbox-contract and mutation RED tests**

The DTO must be deliberately small and lenient only where creativity needs it:

```ts
const CreativePatchSchema = z.object({
  operations: z.array(z.discriminatedUnion("op", [
    z.object({ op: z.literal("replace_section"), targetId: StableTargetId, html: z.string().max(120_000), css: z.string().max(80_000).optional() }),
    z.object({ op: z.literal("insert_section"), afterTargetId: StableTargetId.nullable(), role: z.string().max(48), html: z.string().max(120_000), css: z.string().max(80_000).optional() }),
    z.object({ op: z.literal("remove_section"), targetId: StableTargetId }),
    z.object({ op: z.literal("move_section"), targetId: StableTargetId, afterTargetId: StableTargetId.nullable() }),
    z.object({ op: z.literal("set_page_css"), css: z.string().max(120_000) }),
    z.object({ op: z.literal("set_link"), targetId: StableTargetId, url: z.string().max(2_048), label: z.string().max(240).optional() }),
  ])).min(1).max(12),
}).passthrough();
```

Unknown top-level explanatory fields are ignored; unknown operation kinds and
missing load-bearing fields are rejected. Tests must prove transactional
rollback for malformed HTML, duplicate IDs, reserved markers, scripts, unsafe
URLs, unsafe CSS, overflow, and invalid geometry.

- [ ] **Step 3: Run Task 2 RED**

```powershell
npm.cmd test -- lib/ai/fireworks-tool-client.test.ts lib/curate/creative-sandbox-contracts.test.ts lib/curate/creative-sandbox.test.ts lib/ai/fireworks-client.test.ts lib/agent/tools.test.ts lib/html-engine.test.ts
```

Expected: new modules missing and new behavior fails; existing regressions
remain collected.

- [ ] **Step 4: Implement the no-retry tool transport**

Build a separate `createFireworksToolClient` using the same endpoint/model
policy/usage decoder as `fireworks-client.ts`, but send `tools` and
`tool_choice:"auto"`, never `response_format`. Preserve assistant
`reasoning_content` on subsequent DeepSeek V4 turns as required by Fireworks.

The request must enforce:

```ts
const payload = {
  model: modelIdForRole("reasoner"),
  messages,
  tools: CREATIVE_TOOL_DEFINITIONS,
  tool_choice: "auto",
  reasoning_effort: "high",
  reasoning_history: "interleaved",
  temperature: 0.2,
  max_tokens: request.maxOutputTokens,
  user: request.requestId,
};
```

Reserve once, call once, settle once. Do not reuse the JSON response formatter.
Export shared usage/envelope helpers from `fireworks-client.ts` only when doing
so reduces duplication without widening their accepted shapes.

- [ ] **Step 5: Finish or discard the pre-existing parser experiment by test evidence**

Run its existing/new test in isolation. Keep `jsonCandidates` only for strict
JSON calls when exactly one schema-valid candidate exists; tool-call responses
must never pass through it. If the focused tests show ambiguity or byte-retention
problems, revert only this uncommitted experiment with an explicit patch, not a
destructive Git command.

- [ ] **Step 6: Implement URL and CSS policy**

Add pure validators in `creative-sandbox.ts`:

```ts
export function safeCreativeUrl(raw: string): boolean {
  if (/^(?:#|\/|\.\/|\.\.\/)/.test(raw)) return !raw.startsWith("//");
  const parsed = new URL(raw);
  return ["https:", "http:", "mailto:", "tel:"].includes(parsed.protocol)
    && parsed.username === ""
    && parsed.password === "";
}
```

For CSS, parse with PostCSS and reject `@import`, `expression`, executable data
URLs, `javascript:`, `behavior`, `-moz-binding`, and external `url(...)` that
does not reference an already validated asset URL. Allow ordinary selectors,
media/container queries, custom properties, gradients, transforms, SVG styling,
and CSS animations.

- [ ] **Step 7: Implement transactional canvas mutation**

Clone the current HTML, apply operations against stable `data-openlen-edit-id`
targets, then run:

```ts
const sanitized = sanitize(candidateHtml);
if (sanitized.html === null) return toolFailure("sanitization_failed");
const sealed = seal(sanitized.html);
if (!sealed.sealed) return toolFailure("seal_failed");
const rendered = await render(sealed.html);
if (!rendered || rendered.mobileOverflow || rendered.invalidGeometry) return toolFailure("render_failed");
state = resealCandidate(sealed.html, state, "deepseek");
return { ok: true, candidate: state, warnings: sanitizedWarnings(sanitized.removed) };
```

Never mutate `state` before every check passes. Return explicit warnings for
removed scripts/handlers/iframes so DeepSeek can use OpenLen behaviors or CSS.

- [ ] **Step 8: Run Task 2 GREEN, typecheck, and diff check**

Run the Step 3 command, then `npm.cmd run typecheck` and `git diff --check`.
Expected: PASS with zero network, DB, model, storage, or browser-external calls.

- [ ] **Step 9: Commit Task 2**

Stage only Task 2 files and commit:

```powershell
git commit -m "feat(curate): add transactional creative sandbox"
```

---

### Task 3: DeepSeek Session, Optional Images, and Advisory Qwen

**Files:**
- Create: `lib/curate/deepseek-creative-session.ts`
- Create: `lib/curate/deepseek-creative-session.test.ts`
- Create: `lib/curate/optional-image-tool.ts`
- Create: `lib/curate/optional-image-tool.test.ts`
- Create: `lib/curate/advisory-visual-review.ts`
- Create: `lib/curate/advisory-visual-review.test.ts`
- Modify: `lib/curate/fable-runtime-composition.ts`
- Modify: `lib/curate/fable-runtime-composition.test.ts`
- Modify: `lib/generation/fable-generation-telemetry.ts`
- Modify: `lib/generation/fable-generation-telemetry.test.ts`
- Test: `lib/generation/asset-pipeline.test.ts`
- Test: `lib/ai/qwen-visual-critic.test.ts`

**Interfaces:**
- Consumes: `CreativeSandbox`, `createFireworksToolClient`, existing Qwen
  `assessFinalVisualCandidate`, existing Gemini `AssetPackProvider`, existing
  asset byte/storage validation, one `PageBudget`.
- Produces:

```ts
export type CreativeSessionResult = {
  readonly candidate: SafeCreativeCandidate;
  readonly changed: boolean;
  readonly acceptedMutations: number;
  readonly stoppedBy: "finished" | "provider" | "budget" | "tool_limit" | "turn_limit";
};

export async function runDeepSeekCreativeSession(input: CreativeSessionInput, deps: CreativeSessionDeps): Promise<CreativeSessionResult>;
export async function runOptionalImageTool(input: OptionalImageToolInput, deps: OptionalImageToolDeps): Promise<{ readonly candidate: SafeCreativeCandidate; readonly applied: boolean }>;
export async function runAdvisoryVisualReview(input: AdvisoryReviewInput, deps: AdvisoryReviewDeps): Promise<{ readonly candidate: SafeCreativeCandidate; readonly reviewed: boolean; readonly repaired: boolean }>;
```

- [ ] **Step 1: Write finite-session RED tests**

Cover finish without tools, sequential tools, malformed/unknown calls, provider
failure on every turn, budget exhaustion, exactly four turns, at most twelve
accepted mutations, and preservation of `lastKnownGood`:

```ts
it.each(["timeout", "provider", "invalid_tool_call", "budget_exceeded"])(
  "returns lastKnownGood on %s",
  async (code) => {
    const result = await runDeepSeekCreativeSession(INPUT, depsFailingWith(code));
    expect(result.candidate).toEqual(INPUT.baseline);
    expect(result.changed).toBe(false);
  },
);
```

- [ ] **Step 2: Write optional image RED tests**

Prove zero to three calls, one intent per call, catalog-first behavior, decoded
bytes/storage checks, and per-slot failure isolation. The tool must pass
`required:false` and `identityBearing:false` to the existing asset boundary.

```ts
it("keeps the existing candidate when image two fails after image one", async () => {
  const result = await runOptionalImageTool(TWO_IMAGES, depsWithSecondFailure());
  expect(result.candidate.html).toContain("/api/projects/p/assets/" + FIRST_SHA + ".webp");
  expect(result.candidate.html).toContain("data-original-image-two");
});
```

- [ ] **Step 3: Write advisory Qwen RED tests**

Prove Qwen accept, Qwen unavailable, Qwen malformed, Qwen reject, repair
success, repair failure, and repaired deterministic failure. Every branch must
return a candidate, never `{ok:false}`:

```ts
it.each(["unavailable", "malformed", "reject"])("cannot veto on %s", async (mode) => {
  const result = await runAdvisoryVisualReview(INPUT, reviewDeps(mode));
  expect(result.candidate).toEqual(INPUT.candidate);
});
```

- [ ] **Step 4: Run Task 3 RED**

```powershell
npm.cmd test -- lib/curate/deepseek-creative-session.test.ts lib/curate/optional-image-tool.test.ts lib/curate/advisory-visual-review.test.ts lib/curate/fable-runtime-composition.test.ts lib/generation/fable-generation-telemetry.test.ts lib/generation/asset-pipeline.test.ts lib/ai/qwen-visual-critic.test.ts
```

Expected: FAIL for missing new modules and old GLM-owned runtime behavior.

- [ ] **Step 5: Implement the finite DeepSeek loop**

The loop must be explicit, not recursive:

```ts
for (let turn = 0; turn < 4 && acceptedMutations < 12; turn += 1) {
  const response = await deps.client.turn({ ...request, messages });
  if (!response.ok) return finish(response.code === "budget_exceeded" ? "budget" : "provider");
  deps.recordModel("creative_session", response);
  if (response.calls.length === 0) return finish("finished");
  for (const call of response.calls) {
    const result = await dispatchCreativeTool(call, deps);
    if (result.ok && result.changed) acceptedMutations += result.appliedOperations;
    messages.push(toolResultMessage(call.id, redactToolResult(result)));
    if (acceptedMutations >= 12) return finish("tool_limit");
  }
}
return finish("turn_limit");
```

Provider/tool failures are observations, not page failures. Do not expose raw
HTML or URLs in telemetry or tool result logs.

- [ ] **Step 6: Implement optional image isolation**

Resolve each requested image independently. Reuse the existing curated resolver
before Gemini. Apply an image only after bytes, MIME, dimensions, checksum,
storage response, manifest, and DOM target all validate. A failed call records a
redacted image trace and returns the unchanged candidate for that slot.

- [ ] **Step 7: Implement advisory Qwen and one DeepSeek repair**

Render the current candidate once. Deterministic overflow or invalid geometry
reverts to the pre-review `lastKnownGood`; Qwen failures do not. On an
improvement verdict, invoke `runDeepSeekCreativeSession` with `maxTurns:1` and a
bounded issue summary. Accept the repaired candidate only after sandbox gates.
Do not call Qwen twice.

- [ ] **Step 8: Remove GLM ownership from the request runtime**

`FableRuntimeComposition` becomes a compatibility name temporarily but exposes
only:

```ts
interface FableRuntimeComposition {
  pageBudget: PageBudget;
  fireworksToolClient: FireworksToolClient;
  geminiAssetPackProvider: AssetPackProvider;
  recordModel(...): void;
  recordImage(...): void;
  recordFailure(...): Promise<void>;
  recordDelivered(...): Promise<void>;
  runCreativeSession(...): Promise<CreativeSessionResult>;
  runAdvisoryReview(...): Promise<AdvisoryReviewResult>;
}
```

Delete production construction/imports of `createGlmSectionProgramProvider`,
`createGlmVisualRepairProvider`, `GlmSectionProgramProvider`, and
`GlmVisualRepairProvider`. Do not delete legacy module files yet; Task 4 proves
they are unreachable.

- [ ] **Step 9: Run Task 3 GREEN and regressions**

Run Step 4, then:

```powershell
npm.cmd run generation:visual-engine-assets:gate
npm.cmd run typecheck
git diff --check
```

Expected: all tests PASS, asset gate PASS, typecheck and diff check exit 0.

- [ ] **Step 10: Commit Task 3**

```powershell
git commit -m "feat(curate): make visual providers optional"
```

---

### Task 4: Production Cutover, Failure Matrix, and Release Gates

**Files:**
- Modify: `lib/curate/run-ai-creation.ts`
- Modify: `lib/curate/run-ai-creation.test.ts`
- Modify: `lib/curate/quick-section-composition.ts`
- Modify: `lib/curate/quick-section-composition.test.ts`
- Modify: `lib/curate/curate-post-handler.ts`
- Modify: `lib/curate/curate-route.fable.integration.test.ts`
- Modify: `lib/curate/ai-hybrid-import-boundary.test.ts`
- Modify: `lib/curate/ai-hybrid-regression.test.ts`
- Modify: `lib/generation/ai-hybrid-niche-cohort.test.ts`
- Modify: `lib/curate/ai-hybrid-runbook-contract.test.ts`
- Modify: `package.json`
- Modify: `vitest.config.ts`
- Modify: `docs/generation/ai-hybrid-only-runbook.md`

**Interfaces:**
- Consumes: `buildCreativeBaseline`, `runDeepSeekCreativeSession`,
  `runOptionalImageTool`, `runAdvisoryVisualReview`, existing
  `validateAiCompositionDelivery`, existing route commit/debit.
- Produces: the existing public `runAiCreation(input, deps): Promise<AiCreationResult>`
  and unchanged POST/SSE success contract.

- [ ] **Step 1: Rewrite `runAiCreation` tests as a baseline-first failure matrix**

Remove expectations that intent, copy, page plan, GLM, assets, or Qwen failure
returns `{ok:false}` after a baseline exists. Add one test for every boundary:

```ts
it.each([
  "deepseek_missing_key", "deepseek_timeout", "deepseek_invalid_tool",
  "deepseek_budget", "qwen_timeout", "qwen_malformed", "qwen_reject",
  "gemini_timeout", "gemini_blocked", "gemini_invalid_image", "gemini_storage",
])("delivers lastKnownGood on %s", async (failure) => {
  const result = await runAiCreation(INPUT, depsForFailure(failure));
  expect(result).toMatchObject({ ok: true, route: "section_composition", templateId: null });
  expect(result.ok && result.html).toBe(BASELINE_HTML);
});
```

Retain failure tests only for invalid request/rollout, no safe baseline, and
persistence/debit at the route boundary.

- [ ] **Step 2: Add a real no-provider POST integration**

The real route with provider clients throwing must still emit exactly one
preview, create one project, debit once, emit done once, and record degraded
telemetry after commit. Add separate tests for provider-improved and pure
baseline delivery.

- [ ] **Step 3: Add the transitive GLM import gate RED**

From `app/api/curate/route.ts`, recursively resolve production imports and fail
if any path reaches:

```ts
const FORBIDDEN = [
  "lib/generation/glm-section-program-provider.ts",
  "lib/generation/glm-visual-repair.ts",
  "lib/generation/adaptive-section-composition.ts",
  "lib/generation/page-design-program.ts",
  "lib/generation/visual-candidate-scout.ts",
];
```

Also fail if the production graph contains `accounts/fireworks/models/glm` or a
Gemini text-generation module.

- [ ] **Step 4: Run Task 4 RED**

```powershell
npm.cmd test -- lib/curate/run-ai-creation.test.ts lib/curate/quick-section-composition.test.ts lib/curate/curate-route.fable.integration.test.ts lib/curate/ai-hybrid-import-boundary.test.ts lib/curate/ai-hybrid-regression.test.ts lib/generation/ai-hybrid-niche-cohort.test.ts lib/curate/ai-hybrid-runbook-contract.test.ts
```

Expected: failures show the old mandatory pipeline and GLM import graph.

- [ ] **Step 5: Cut over `runAiCreation`**

The production order must be exactly:

```ts
const records = await loadPublishedSections();
const baseline = await buildCreativeBaseline({ ...input, records });
if (!baseline.ok) return failure("composition", baseline.code);

let lastKnownGood = baseline.candidate;
const creative = await runCreativeSession({ ...input, baseline: lastKnownGood, intent: baseline.intent, copy: baseline.copy });
lastKnownGood = creative.candidate;
const reviewed = await runAdvisoryReview({ ...input, candidate: lastKnownGood });
lastKnownGood = reviewed.candidate;

const delivery = validateAiCompositionDelivery({ html: lastKnownGood.html, visualEngine: lastKnownGood.visualEngine, leaksAfter: 0 });
if (!delivery.ok) return baselineDeliveryOrFailure(baseline.candidate, delivery);
return success(lastKnownGood, telemetry.finalize);
```

If an improvement candidate unexpectedly fails final delivery, revalidate and
deliver the baseline. Abort only if both improvement and baseline fail.

- [ ] **Step 6: Preserve public route atomicity and progress**

Map progress to `baseline`, `creative`, `images`, `review`, and `persisting`.
Do not change project allocation, credit calculation, `commitAiCompositionDocument`,
preview buffering, version creation, or thumbnail best effort.

- [ ] **Step 7: Update the focused gates and runbook**

Add every new test exactly once to `generation:ai-hybrid:gate`. The runbook must
state:

- DeepSeek primary, Qwen advisory, Gemini image-only, GLM absent;
- provider-free baseline and `lastKnownGood` semantics;
- four-turn/twelve-mutation/three-image/zero-retry bounds;
- allowed and forbidden URL/script policy;
- 10 MXN hard cap and budget-exhausted delivery;
- exact local gate commands;
- provider canaries and real niche pages require separate authorization;
- rollback disables Create with AI without affecting explicit clone.

- [ ] **Step 8: Run focused GREEN**

Run the Step 4 command. Expected: all PASS and no provider/network/DB/storage
calls.

- [ ] **Step 9: Run the complete deterministic release sequence once**

```powershell
npm.cmd run generation:ai-hybrid:gate
npm.cmd run generation:fable-boundary:gate
npm.cmd run generation:visual-engine-assets:gate
npm.cmd run generation:template-derived-sections:gate
npm.cmd run typecheck
git diff --check
```

Then run the existing non-live rollback check using its repository-supported
shim/environment-independent command. Do not run full `npm test` or `npm build`
when the known `.env.local`/DATABASE_URL/native-package environment is absent;
record that exact deviation instead of inventing a skip.

- [ ] **Step 10: Perform privacy and import audits**

Verify staged paths contain no `.env`, keys, raw responses, HTML artifacts,
screenshots, user identifiers, absolute workstation paths, or scratch evidence.
Verify the route import graph has DeepSeek/Qwen/Gemini-image only and that each
provider shares one page budget.

- [ ] **Step 11: Commit Task 4**

```powershell
git commit -m "feat(curate): deliver fail-soft creative generation"
```

---

### Task 5: Authorized Provider Canaries and Niche Acceptance

**Files:**
- Create: `scripts/creative-sandbox-canary.ts`
- Create: `lib/curate/creative-sandbox-canary.test.ts`
- Modify: `package.json`
- Modify: `docs/generation/ai-hybrid-only-runbook.md`
- Evidence only under ignored: `scratch/creative-sandbox/<run-id>/`

**Interfaces:**
- Consumes: exact production DeepSeek tool adapter, Qwen critic, Gemini image
  provider, `runAiCreation`, redacted telemetry, and one shared `PageBudget`.
- Produces: a redacted canary summary with request ID, commit, contract versions,
  model IDs, usage/cost/duration/category, mutation counts, image counts,
  deterministic diagnostics, final hash, and no content bytes.

- [ ] **Step 1: Write the CLI boundary RED**

Test that the CLI is inert when imported, requires an explicit `--live` flag,
positive `--max-mxn`, exact commit, and required credentials; it must never
retry. Assert that its JSON artifact contains no prompt, copy, HTML, CSS, URL,
screenshot, raw response, credential, email, or user identity.

- [ ] **Step 2: Implement the canary runner**

Support three separately invocable modes:

```text
--provider=deepseek-tool   one synthetic tool-call capability probe
--provider=qwen-vision     one synthetic two-viewport advisory probe
--page=<cohort-id>         one complete page through production boundaries
```

The isolated provider probes must run before a complete page. A failed optional
provider probe does not invalidate local release gates, but it blocks enabling
that optional provider in rollout policy.

- [ ] **Step 3: Run local CLI tests and all deterministic gates**

Run `creative-sandbox-canary.test.ts`, the four Task 4 gates, typecheck, and
diff check. Expected: PASS without live calls.

- [ ] **Step 4: Obtain explicit authorization before crossing live boundaries**

Request one authorization that names provider(s), prompt/HTML/image data,
DATABASE_URL/R2 read/write scope, maximum image writes, telemetry policy,
zero retries, and a positive MXN cap. Do not infer authorization from prior
runs.

- [ ] **Step 5: Run isolated canaries once**

Run DeepSeek tool calling first and Qwen vision second. Verify exact model IDs,
no retries, usage present, cost under cap, and redacted artifacts. If either
fails, fix the generic provider adapter locally before any page call; never
patch a single response fixture.

- [ ] **Step 6: Generate and inspect Mundo Pincel once**

Generate through the real production root. Inspect desktop and mobile images,
HTML safety, niche identity, link behavior, mutation count, image count, final
hash, persistence, debit, and cost. A baseline delivery is operational success
but does not satisfy the creative-quality criterion unless DeepSeek materially
changed structure/identity.

- [ ] **Step 7: Run the remaining five niche pages once each**

Generate psychological horror, school, editorial cooking, boutique hotel, and
physical product. Record human review for niche recognition, distinctive
identity, usability, and whether provider failures degraded rather than
aborted. Do not add new runtime features based on one aesthetic preference;
only generic Critical/Important defects reopen code.

- [ ] **Step 8: Release review and final commit**

Require an independent Critical/Important review of Tasks 1–5, rerun affected
focused tests after fixes, verify working tree scope/privacy, and commit only
the canary script/test/runbook/package paths. Rollout and deploy remain separate
explicit actions after acceptance.
