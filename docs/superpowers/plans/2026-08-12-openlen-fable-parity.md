# OpenLen Fable-Parity Adaptive Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one closed implementation stage that makes OpenLen's landing-page generation adaptively reuse, rebuild, or generate sections with DeepSeek, GLM, Qwen, and Gemini Image, and proves visual parity against Fable 5 before rollout.

**Architecture:** DeepSeek handles inexpensive intent/copy/page planning, Qwen sees candidate and final renders, GLM emits bounded expressive section programs and one possible repair, and Gemini remains image-only. The existing OpenLen compiler, Rust HTML Engine, assets, composition, 2C, provenance, and atomic delivery gates remain authoritative; the catalog becomes optional per section.

**Tech Stack:** TypeScript, Next.js 15, Vitest, Zod, Fireworks OpenAI-compatible API, Google Gemini Image API, Playwright/Chromium renderer, Drizzle/Postgres, existing Rust-backed HTML/image packages.

## Global Constraints

- Read `docs/superpowers/specs/2026-08-12-openlen-fable-parity-design.md` completely before editing.
- This is exactly one stage with six tasks. Do not invent additional phases.
- Preserve all user work and all unrelated untracked files. Never reset, clean, restore, or stage broadly.
- Task 1 begins from the existing uncommitted catalog/compiler work; inspect and preserve it rather than recreating it.
- Use strict RED → GREEN TDD for every behavior change. Record the exact failing and passing commands in each task report.
- Use one independent Critical/Important review after each task. Fix confirmed Critical/Important findings inside that task; do not add optional hardening rounds.
- No paid model call, database migration/publication, production environment mutation, Fable run, or deployment without a fresh explicit authorization naming the payload, destination, maximum MXN, and number of calls.
- Gemini is image-only in the reachable Create-with-AI graph. Gemini text/vision cannot be a fallback.
- Never deliver raw model HTML, CSS, JavaScript, URLs, selectors, or copy. Models return strict OpenLen schemas.
- One creative attempt, at most one visual repair, and at most one transport retry only under the exact retry policy in the spec.
- Default target is 5 MXN and hard cap is 10 MXN per landing page, including retries and repair.
- Operational telemetry may contain only provider/model IDs, prompt/contract versions, stage, reason code, hashes, section IDs, aggregate usage, calculated cost, image count, and duration.
- Never persist or log briefs, copy, HTML, screenshots, contact sheets, prompts, raw responses, provider error bodies, private URLs, credentials, or user identity.
- Whole-template cloning remains available only through the explicit user-selected template route and remains unreachable from Create with AI.
- Communicate progress in Spanish at each RED, GREEN, review, commit, and blocker. Never leave the owner without an update while a long command runs.

---

## Task 1: Stabilize the authoritative 450-template catalog

**Deliverable:** The existing in-progress origin reader and bounded renderer compile all 450 published templates twice to the same corpus/catalog manifest, without depending on CDN-transformed HTML or nondeterministic animation geometry.

**Files:**
- Modify: `lib/ai/visual-quality-renderer.ts`
- Modify: `lib/ai/visual-quality-renderer.test.ts`
- Modify: `lib/generation/sections-compile-templates-cli.ts`
- Modify: `lib/generation/sections-compile-templates-cli.test.ts`
- Create: `lib/generation/template-object-reader.ts`
- Create: `lib/generation/template-object-reader.test.ts`
- Modify: `scripts/sections-compile-templates.ts`
- Modify only if contract evidence requires it: `docs/generation/template-derived-sections-runbook.md`
- Report: `.superpowers/sdd/2026-08-12-openlen-fable-parity/task-1-report.md`

**Interfaces:**
- Produce: `readTemplateObjectText(storageKey: string): Promise<string | null>`.
- Produce: `buildTemplateCorpusFromOrigin(records, readObject): Promise<TemplateCorpusManifest>`.
- Produce: `createVisualQualityRendererPool(size, internals): Promise<VisualQualityRendererPool>`.
- Preserve: `renderVisualQualityViewports(html)` behavior for all existing callers.

- [ ] **Step 1: Snapshot the current work without changing it**

Run:

```powershell
git status --short
git diff -- lib/ai/visual-quality-renderer.ts lib/ai/visual-quality-renderer.test.ts lib/generation/sections-compile-templates-cli.ts lib/generation/sections-compile-templates-cli.test.ts scripts/sections-compile-templates.ts
```

Record that the current dry runs share corpus hash
`sha256:f3f6c7eb8458e6f6f9018ea6d15199089e44fa7811abedfeecccb3e89cb84271`
but differ by the four IDs below, all crossing the `mobile_overflow` boundary:

```text
derived-about-solace-5-79b97218ed03
derived-about-stillwater-5-22976c71c49d
derived-gallery-vela-5-26356498c1de
derived-navbar-cafe-tramonto-3-44606a14d9a4
```

- [ ] **Step 2: Write deterministic-render RED tests**

Add tests proving that pooled pages:

```ts
expect(maximumConcurrentPages).toBe(2);
expect(first.mobileOverflow).toBe(second.mobileOverflow);
expect(pageHtml).toContain("animation:none!important");
expect(pageHtml).toContain("transition:none!important");
```

The renderer must inject a repository-owned deterministic render reset before
content executes, disable animations/transitions/caret, honor reduced motion,
await `document.fonts.ready`, await two animation frames, and calculate overflow
from the maximum of two consecutive geometry samples. If samples disagree, the
candidate fails closed as overflow rather than oscillating between manifests.

Run:

```powershell
npm.cmd test -- lib/ai/visual-quality-renderer.test.ts lib/generation/sections-compile-templates-cli.test.ts
```

Expected: FAIL on missing deterministic reset/two-sample behavior.

- [ ] **Step 3: Complete the origin reader and bounded pool**

The origin reader must:

```ts
export async function readTemplateObjectText(storageKey: string): Promise<string | null>
```

- accept only the canonical template storage-key grammar;
- reject traversal, absolute paths, credentials, query, fragment, and encoded separators;
- read direct R2 `GetObject` bytes when R2 is configured;
- use the existing local template filesystem boundary otherwise;
- never fetch a public CDN URL.

The compilation CLI must continue after typed extraction failures, record only
redacted template ID/ordinal/reason, preserve input order under concurrency two,
reuse exactly two browser workers, and close them in `finally`.

- [ ] **Step 4: Run focused GREEN and static gates**

```powershell
npm.cmd test -- lib/ai/visual-quality-renderer.test.ts lib/generation/sections-compile-templates-cli.test.ts lib/generation/template-object-reader.test.ts lib/generation/template-section-corpus.test.ts lib/generation/template-section-extractor.test.ts
npm.cmd run typecheck
git diff --check
```

Expected: all exit 0.

- [ ] **Step 5: Run two authoritative dry compiles**

Do not publish. Run the same command twice without restarting or editing between
runs:

```powershell
npm.cmd run sections:compile-templates -- --dry-run --expected-count=450
npm.cmd run sections:compile-templates -- --dry-run --expected-count=450
```

Require identical corpus and catalog hashes, accepted IDs, rejection counts,
coverage, and duplicates. If they differ, diagnose and fix the deterministic
boundary inside Task 1; do not proceed to Task 2.

- [ ] **Step 6: Review, commit, and stop before publication**

Request one read-only Critical/Important review. Then stage only the Task 1
files and commit:

```powershell
git add lib/ai/visual-quality-renderer.ts lib/ai/visual-quality-renderer.test.ts lib/generation/sections-compile-templates-cli.ts lib/generation/sections-compile-templates-cli.test.ts lib/generation/template-object-reader.ts lib/generation/template-object-reader.test.ts scripts/sections-compile-templates.ts docs/generation/template-derived-sections-runbook.md
git diff --cached --check
git commit -m "fix(generation): stabilize derived section compilation"
```

Publication/migration requires fresh explicit authorization and is not inferred
from implementation approval.

---

## Task 2: Add the Fireworks gateway, model policy, retry rule, and page budget

**Deliverable:** One OpenLen-owned provider surface supports DeepSeek, GLM, and Qwen with strict structured responses, complete usage, redacted failures, exact retry semantics, and a shared per-page MXN reservation guard.

**Files:**
- Create: `lib/ai/fireworks-contracts.ts`
- Create: `lib/ai/fireworks-client.ts`
- Create: `lib/ai/fireworks-client.test.ts`
- Create: `lib/generation/fable-model-policy.ts`
- Create: `lib/generation/fable-model-policy.test.ts`
- Create: `lib/generation/page-generation-budget.ts`
- Create: `lib/generation/page-generation-budget.test.ts`
- Modify: `lib/generation/model-cost.ts`
- Modify: `lib/generation/model-cost.test.ts`
- Modify: `package.json`
- Report: `.superpowers/sdd/2026-08-12-openlen-fable-parity/task-2-report.md`

**Interfaces:**

```ts
type FableModelRole = "reasoner" | "designer" | "visual_critic";

interface FireworksJsonRequest<T> {
  role: FableModelRole;
  messages: readonly { role: "system" | "user"; content: string }[];
  responseSchema: z.ZodType<T>;
  maxOutputTokens: number;
  reasoningEffort: "none" | "high" | "max";
  requestId: string;
}

type FireworksJsonResult<T> =
  | { ok: true; value: T; modelId: string; usage: ModelTokenUsage; durationMs: number; attempts: 1 | 2 }
  | { ok: false; code: "missing_key" | "timeout" | "http" | "provider" | "invalid_json" | "schema" | "budget_exceeded"; modelId: string; usage?: ModelTokenUsage; durationMs: number; attempts: 0 | 1 | 2 };

interface PageBudget {
  reserve(call: PlannedPaidCall): { ok: true; leaseId: string } | { ok: false; code: "budget_exceeded" };
  complete(leaseId: string, usage: ModelTokenUsage | ImageUsage): void;
  snapshot(): RedactedPageCost;
}
```

- [ ] **Step 1: Write gateway RED tests**

Cover exact model routing:

```ts
expect(policy.reasoner.modelId).toBe("accounts/fireworks/models/deepseek-v4-flash");
expect(policy.designer.modelId).toBe("accounts/fireworks/models/glm-5p2");
expect(policy.visualCritic.modelId).toBe("accounts/fireworks/models/qwen3p7-plus");
```

Cover valid JSON, HTTP errors without body leakage, invalid JSON/schema,
timeout covering body parsing, complete cached/thinking usage, missing key, and
model IDs trimmed/allowlisted.

Cover retry mutation cases: body bytes, usage, schema error, 400/401/403/404,
or incompatibility must yield one attempt; empty 429/502/503/504 or connection
timeout may yield exactly two identical-payload attempts.

- [ ] **Step 2: Implement the minimal gateway**

Use `https://api.fireworks.ai/inference/v1/chat/completions`. Never log the
request/response. Parse the response into an allowlisted intermediate object,
then through the caller's Zod schema. Preserve usage on every response that
reports it, including failures.

Reasoning policy:

- DeepSeek: `none` for copy/simple extraction, `high` for page planning;
- GLM: `high` for initial section programs, `max` only for the one repair;
- Qwen: non-thinking for candidate scouting and final scoring.

- [ ] **Step 3: Write budget RED tests**

Use a multi-model rate map rather than the existing one-rate-card assumption:

```ts
const rates = {
  "accounts/fireworks/models/deepseek-v4-flash": { input: .14, cached: .028, output: .28 },
  "accounts/fireworks/models/glm-5p2": { input: 1.40, cached: .14, output: 4.40 },
  "accounts/fireworks/models/qwen3p7-plus": { input: .50, cached: .10, output: 3.00 },
  "gemini-2.5-flash-image": { image: .039 },
};
```

Use the conservative listed Qwen rate even when the account dashboard offers a
lower rate. Test: positive configured FX, 5 MXN target telemetry, exact 10 MXN
hard cap, reservation before call, failed-call cost, retry reservation, image
count, integer-safe micromxn, incomplete usage failing closed, and no overspend
under concurrent reservations.

- [ ] **Step 4: Implement budget and model policy**

Reuse arithmetic from `model-cost.ts`, but add a model-keyed production API;
do not change historical pilot calculations. Require:

```text
FIREWORKS_API_KEY
OPENLEN_FABLE_RATE_CARD_VERSION
OPENLEN_FABLE_MXN_PER_USD
OPENLEN_FABLE_PAGE_TARGET_MICROMXN=5000000
OPENLEN_FABLE_PAGE_CAP_MICROMXN=10000000
```

Enabled mode fails closed when any rate/cap is absent or invalid.

- [ ] **Step 5: Verify and commit**

```powershell
npm.cmd test -- lib/ai/fireworks-client.test.ts lib/generation/fable-model-policy.test.ts lib/generation/page-generation-budget.test.ts lib/generation/model-cost.test.ts
npm.cmd run typecheck
git diff --check
```

After one independent review, commit only Task 2 files:

```powershell
git commit -m "feat(ai): add budgeted Fireworks model gateway"
```

---

## Task 3: Add adaptive visual scouting and page design decisions

**Deliverable:** OpenLen retrieves a bounded candidate set, produces a labeled contact sheet, asks Qwen to classify each required role as `reuse`, `rebuild`, or `generate`, and asks DeepSeek for one coherent page design program without imposing a catalog quota.

**Files:**
- Create: `lib/generation/adaptive-design-contracts.ts`
- Create: `lib/generation/adaptive-design-contracts.test.ts`
- Create: `lib/generation/visual-candidate-scout.ts`
- Create: `lib/generation/visual-candidate-scout.test.ts`
- Create: `lib/generation/page-design-program.ts`
- Create: `lib/generation/page-design-program.test.ts`
- Modify: `lib/generation/section-inventory.ts`
- Modify: `lib/generation/section-inventory.test.ts`
- Modify: `lib/generation/section-plan.ts`
- Modify: `lib/generation/section-plan.test.ts`
- Modify: `lib/ai/visual-quality-renderer.ts`
- Modify: `lib/ai/visual-quality-renderer.test.ts`
- Report: `.superpowers/sdd/2026-08-12-openlen-fable-parity/task-3-report.md`

**Interfaces:**

```ts
const CandidateDecisionSchema = z.object({
  ordinal: z.number().int().min(0).max(31),
  action: z.enum(["reuse", "rebuild", "generate"]),
  candidateId: z.string().nullable(),
  usefulTraits: z.array(TaxonomySlugSchema).max(8),
  rejectedTraits: z.array(TaxonomySlugSchema).max(8),
}).strict();

interface AdaptivePageDesignProgram {
  schemaVersion: "adaptive-page-design/1.0";
  narrative: readonly SectionRole[];
  direction: CreativeDirection;
  decisions: readonly CandidateDecision[];
  rhythm: "editorial" | "cinematic" | "playful" | "immersive" | "conversion" | "storytelling";
  requiredSignals: readonly string[];
  forbiddenSignals: readonly string[];
  imageSlots: readonly BoundedImageRequirement[];
}
```

- [ ] **Step 1: Write strict-contract RED tests**

Reject unknown keys, duplicate ordinals/candidate IDs, `reuse` without a
candidate, `generate` with a candidate, missing required roles, candidate IDs
outside the retrieved set, raw URLs/HTML/CSS/copy, and lists above bounds.

- [ ] **Step 2: Write retrieval/contact-sheet RED tests**

Prove deterministic hard-negative filtering still happens before provider
calls. Select at most 12 candidates across the whole page, at most three per
role, and never include raw whole-template HTML. Render verified fragments to a
single labeled JPEG contact sheet under the existing byte/dimension limits.

Tests must prove Qwen can choose all `generate` and the result remains valid;
there is no `minimumCatalogSections` field or hidden minimum reuse count.

- [ ] **Step 3: Implement Qwen scout and DeepSeek page planner**

Qwen receives only the synthetic/allowlisted intent, creative requirements,
candidate IDs/roles, and contact sheet. DeepSeek receives Qwen's bounded
observations plus candidate metadata and copy-key names, not screenshots or
whole templates. Both return strict schemas through Task 2's gateway.

- [ ] **Step 4: Replace donor-quota selection with adaptive originality**

Retain the existing legacy selector API for historical callers. Add a new
adaptive path where final originality is based on:

```ts
new Set(finalStructuralFingerprints).size >= 3
```

plus no repeated program hash, no three contiguous original donor bands, and no
more than two direct reuses from one donor. Zero real donors is allowed.

- [ ] **Step 5: Verify and commit**

```powershell
npm.cmd test -- lib/generation/adaptive-design-contracts.test.ts lib/generation/visual-candidate-scout.test.ts lib/generation/page-design-program.test.ts lib/generation/section-inventory.test.ts lib/generation/section-plan.test.ts lib/ai/visual-quality-renderer.test.ts
npm.cmd run generation:template-derived-sections:gate
npm.cmd run typecheck
git diff --check
```

After one independent review:

```powershell
git commit -m "feat(generation): plan adaptive visual compositions"
```

---

## Task 4: Compile expressive safe-section programs and compose adaptively

**Deliverable:** GLM can create visually rich `rebuild` and `generate` sections through a bounded AST that OpenLen compiles and validates; raw model HTML/CSS/JS remains impossible.

**Files:**
- Create: `lib/generation/expressive-section-contracts.ts`
- Create: `lib/generation/expressive-section-contracts.test.ts`
- Create: `lib/generation/expressive-section-compiler.ts`
- Create: `lib/generation/expressive-section-compiler.test.ts`
- Create: `lib/generation/glm-section-program-provider.ts`
- Create: `lib/generation/glm-section-program-provider.test.ts`
- Create: `lib/generation/adaptive-section-composition.ts`
- Create: `lib/generation/adaptive-section-composition.test.ts`
- Modify: `lib/generation/generated-section-contracts.ts`
- Modify: `lib/generation/generate-missing-section.ts`
- Modify: `lib/generation/compose-sections.ts`
- Modify: `lib/generation/compose-sections.test.ts`
- Modify: `lib/generation/section-composition-contracts.ts`
- Modify: `lib/generation/section-composition-contracts.test.ts`
- Report: `.superpowers/sdd/2026-08-12-openlen-fable-parity/task-4-report.md`

**Interfaces:**

```ts
type ExpressiveNode =
  | LayoutNode       // stack, flex, grid, split, collage, bento, layered
  | CopyNode         // heading, body, list, quote, stat, badge, action
  | MediaNode        // bounded asset slot reference
  | DecorationNode;  // shape, divider, texture; aria-hidden only

interface ExpressiveSectionProgram {
  schemaVersion: "expressive-section-program/1.0";
  role: SectionRole;
  root: ExpressiveNode;
  responsive: ResponsiveProgram;
  motion: readonly MotionPreset[];
}

function compileExpressiveSection(input: {
  program: ExpressiveSectionProgram;
  allowedCopyKeys: readonly string[];
  allowedAssetSlots: readonly number[];
  provenance: SectionDecisionProvenance;
}): CompileExpressiveSectionResult;
```

- [ ] **Step 1: Write adversarial schema RED tests**

Require maximum depth 5, maximum 64 nodes, maximum 12 media slots, unique node
IDs, closed property/color/size/transform enums, copy-key and slot allowlists,
and valid mobile overrides. Reject literal copy, arbitrary CSS, selectors,
HTML, URLs, scripts, event names, imports, unknown motion, negative/extreme
dimensions, and recursive/duplicate structures.

- [ ] **Step 2: Implement schemas and repository compiler**

The compiler—not GLM—owns all element names, class names, CSS declarations,
media attributes, reduced-motion CSS, and responsive breakpoints. Escape all
copy. Decorative nodes are noninteractive and `aria-hidden`. Actions compile to
safe buttons/anchors using existing repository-owned destinations only.

- [ ] **Step 3: Write GLM provider RED tests**

Cover `rebuild` with a candidate's structural summary/provenance and `generate`
without candidate material. The payload may contain candidate fragment HTML for
the single chosen rebuild only after it has passed fragment validation; it may
not contain a whole document, private URL, script, or copy values. Validate
usage on invalid JSON/schema/provider failure.

- [ ] **Step 4: Integrate adaptive composition**

Execute decisions in page order:

- `reuse`: fetch the exact verified fragment;
- `rebuild`: request and compile a new program, retaining inspiration
  provenance but a new content hash/fingerprint;
- `generate`: request and compile without donor provenance.

Run every output through `compileDerivedSection`, semantic compatibility,
assets, desktop/mobile render, sanitizer, and final composition seal. Assemble
nothing until all requested sections pass. A single section failure returns a
typed atomic failure and no partial HTML.

- [ ] **Step 5: Prove expressiveness and originality**

Add deterministic fixtures for VHS horror, children's coloring, editorial
food, and luxury hotel. They must compile visibly different structures and
motion/decorative treatments while using the same safe vocabulary. Mutation
tests must fail when all programs share one fingerprint or reconstruct a donor.

- [ ] **Step 6: Verify and commit**

```powershell
npm.cmd test -- lib/generation/expressive-section-contracts.test.ts lib/generation/expressive-section-compiler.test.ts lib/generation/glm-section-program-provider.test.ts lib/generation/adaptive-section-composition.test.ts lib/generation/generated-section-contracts.test.ts lib/generation/compose-sections.test.ts lib/generation/section-composition-contracts.test.ts
npm.cmd run generation:template-derived-sections:gate
npm.cmd run generation:ai-hybrid:gate
npm.cmd run typecheck
git diff --check
```

After one independent review:

```powershell
git commit -m "feat(generation): compile expressive adaptive sections"
```

---

## Task 5: Integrate image-only Gemini, Qwen final criticism, one GLM repair, and delivery

**Deliverable:** The real Create-with-AI route uses the adaptive pipeline, sends images only to Gemini, visually judges the complete page with Qwen, applies at most one GLM repair, and retains all atomic delivery and privacy guarantees.

**Files:**
- Create: `lib/ai/qwen-visual-critic.ts`
- Create: `lib/ai/qwen-visual-critic.test.ts`
- Create: `lib/generation/glm-visual-repair.ts`
- Create: `lib/generation/glm-visual-repair.test.ts`
- Create: `lib/generation/fable-generation-telemetry.ts`
- Create: `lib/generation/fable-generation-telemetry.test.ts`
- Modify: `lib/curate/run-ai-creation.ts`
- Modify: `lib/curate/run-ai-creation.test.ts`
- Modify: `lib/curate/quick-section-composition.ts`
- Modify: `lib/curate/quick-section-composition.test.ts`
- Modify: `lib/curate/quick-visual-repair.ts`
- Modify: `lib/curate/quick-visual-repair.test.ts`
- Modify: `lib/generation/asset-pipeline.ts`
- Modify: `lib/generation/asset-pipeline.test.ts`
- Modify: `app/api/curate/route.ts`
- Modify: `lib/curate/curate-route.integration.test.ts`
- Modify: `lib/curate/ai-hybrid-import-boundary.test.ts`
- Report: `.superpowers/sdd/2026-08-12-openlen-fable-parity/task-5-report.md`

**Interfaces:**

```ts
interface FinalVisualVerdict {
  schemaVersion: "fable-visual-verdict/1.0";
  nicheRecognition: number;   // 1..10
  promptFidelity: number;
  visualQuality: number;
  coherence: number;
  originality: number;
  mobileQuality: number;
  wrongNiche: boolean;
  genericAiStyle: boolean;
  issues: readonly BoundedVisualIssue[];
  decision: "accept" | "repair" | "reject";
}
```

- [ ] **Step 1: Write Qwen verdict RED tests**

Require desktop and mobile images, brief-derived required/forbidden signals,
strict scores/issues, no HTML/CSS/URL/copy proposals, and exact accept policy.
Deterministic OpenLen failures override Qwen acceptance. Qwen `accept` cannot
pass `wrongNiche`, generic style, low niche recognition, overflow, typography,
or geometry failure.

- [ ] **Step 2: Implement final Qwen critic**

Use Task 2's gateway. Qwen sees only the bounded synthetic/allowlisted brief
summary and final screenshots. Preserve usage on malformed/provider failures.

- [ ] **Step 3: Write and implement one-repair contract**

GLM receives the prior `AdaptivePageDesignProgram`, current expressive section
programs, and Qwen's bounded issue list. It returns a delta over program IDs,
never HTML/CSS/JS. Apply the delta, recompile every affected section, reassemble,
rerender, and rerun deterministic + Qwen gates exactly once. A second repair
request must be impossible by type/state machine.

- [ ] **Step 4: Make Gemini image-only reachable**

Add a transitive import/configuration gate proving that Create with AI can reach
`gemini-2.5-flash-image` only through the asset provider and cannot reach
Gemini text/vision providers. Preserve decoded-image validation, max-three
provider calls per asset pack, storage URL policy, and manifest/trace pairing.

- [ ] **Step 5: Cut over `runAiCreation` and real POST atomically**

Required order:

```text
budget → DeepSeek intent/copy → candidates → Qwen scout → DeepSeek page plan
→ GLM programs → Gemini images → compile/assemble → deterministic render gates
→ Qwen final verdict → optional one GLM repair → final gate
→ one preview → atomic project persistence → debit → done
```

Any failure: no partial preview, no project, no debit, stable redacted SSE
reason. Sink telemetry before returning paid failures so cost is never lost.

- [ ] **Step 6: Verify and commit**

```powershell
npm.cmd test -- lib/ai/qwen-visual-critic.test.ts lib/generation/glm-visual-repair.test.ts lib/generation/fable-generation-telemetry.test.ts lib/curate/run-ai-creation.test.ts lib/curate/quick-section-composition.test.ts lib/curate/quick-visual-repair.test.ts lib/generation/asset-pipeline.test.ts lib/curate/curate-route.integration.test.ts lib/curate/ai-hybrid-import-boundary.test.ts
npm.cmd run generation:ai-hybrid:gate
npm.cmd run generation:visual-engine-assets:gate
npm.cmd run typecheck
git diff --check
```

After one independent review:

```powershell
git commit -m "feat(curate): deliver adaptive Fable-parity pages"
```

---

## Task 6: Add the blind Fable-parity gate, release controls, and handoff

**Deliverable:** A deterministic 20-case harness, sealed hidden cohort, blind A/B reviewer, immutable scorecard, release gate, and runbook prevent OpenLen from claiming or deploying Fable parity without evidence.

**Files:**
- Create: `lib/generation/fable-parity-cohort.ts`
- Create: `lib/generation/fable-parity-cohort.test.ts`
- Create: `lib/generation/fable-parity-scorecard.ts`
- Create: `lib/generation/fable-parity-scorecard.test.ts`
- Create: `lib/generation/fable-parity-review-session.ts`
- Create: `lib/generation/fable-parity-review-session.test.ts`
- Create: `scripts/fable-parity-eval.ts`
- Create: `scripts/fable-parity-review.ts`
- Create: `scripts/fable-parity-scorecard.ts`
- Create: `scripts/fable-parity-rollback.ts`
- Create: `docs/generation/fable-parity-runbook.md`
- Create: `lib/generation/fable-parity-runbook-contract.test.ts`
- Modify: `package.json`
- Modify: `infra/scripts/deploy.ps1`
- Modify: `.gitignore`
- Report: `.superpowers/sdd/2026-08-12-openlen-fable-parity/task-6-report.md`

**Interfaces:**

```ts
interface BlindDecision {
  comparisonId: string;
  reviewerSessionId: string;
  desktopPreference: "A" | "tie" | "B";
  mobilePreference: "A" | "tie" | "B";
  overallPreference: "A" | "tie" | "B";
  wrongNicheSide: "none" | "A" | "B" | "both";
  rubric: { niche: number; fidelity: number; polish: number; coherence: number; usability: number };
}

interface FableParityScore {
  comparisons: 20;
  eligibleOpenLenPages: number;
  nonLossRate: number;
  outrightWinRate: number;
  wrongNicheCount: number;
  medianCostMicromxn: number;
  maxCostMicromxn: number;
  passed: boolean;
  failures: readonly string[];
}
```

- [ ] **Step 1: Write cohort/score RED tests**

Public cohort has exactly 12 versioned prompts and closed niche/forbidden-signal
metadata. Hidden cohort loader requires exactly eight encrypted or externally
provided records whose plaintext is absent from repository fixtures and prompts.
IDs are opaque during review.

Score tests enforce all spec thresholds, count technical failures as losses,
require three independent decisions per comparison, neutralize A/B side,
include every paid failure in cost, and reject incomplete/duplicate decisions.

- [ ] **Step 2: Implement blind artifact integrity**

Write ignored evidence only under `scratch/fable-parity/**`. Hash every prompt
manifest, HTML artifact, desktop/mobile screenshot, side assignment, and result.
The reviewer receives opaque paths and never provider/model identity, cost, or
telemetry. Revalidate hashes before serving and before accepting a decision.

- [ ] **Step 3: Implement commands with closed live gates**

Add:

```text
generation:fable-parity:gate        deterministic, no provider/DB
generation:fable-parity:eval        live, authorization + cap required
generation:fable-parity:review      localhost-only, token required
generation:fable-parity:scorecard   verified artifacts only
generation:fable-parity:rollback    no provider call
```

Live eval must require exact one-time authorization, reviewed model IDs/rate
card, positive total cap, per-page 10 MXN cap, 20 OpenLen calls and 20 Fable
comparisons, sequential execution, and no creative retries beyond production
policy. Do not execute it during implementation.

- [ ] **Step 4: Add deploy and rollback gates**

Run the deterministic Fable gate before the first `OPENLEN_SKIP_BUILD` branch.
Deployment must require a verified passing scorecard manifest when enabling the
new mode. Rollback disables Create with AI without enabling whole-template
fallback and leaves explicit template cloning available.

- [ ] **Step 5: Run the complete non-live release sequence once**

```powershell
npm.cmd run generation:template-derived-sections:gate
npm.cmd run generation:fable-parity:gate
npm.cmd run generation:ai-hybrid:gate
npm.cmd run generation:visual-engine-assets:gate
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run generation:visual-engine-2a:rollback-check
npm.cmd run generation:fable-parity:rollback
git diff --check
```

Do not restart a long full-suite/build command to hide a failure. Separate code
failures from missing local secrets/DB prerequisites with exact evidence; never
copy production secrets into the worktree.

- [ ] **Step 6: Final review and commit**

Request one complete release review limited to confirmed Critical/Important
issues. Verify privacy, ignored evidence, staged scope, no `.env`, no provider
response, no screenshot, no identity, and no absolute local path is committed.

```powershell
git commit -m "test(generation): gate Fable-parity adaptive creation"
```

Report exact verified commands and any environmental deviations. State clearly
that live Fable parity, catalog publication, DB migration, activation, and deploy
remain unauthorized/unexecuted unless the owner separately authorized them.

---

## Execution Completion Contract

The implementation stage ends after Task 6 with one of two outcomes:

1. **Implementation ready for paid evaluation:** all non-live gates pass, and
   the owner receives an exact cost estimate and authorization request.
2. **Implementation failed:** a named acceptance criterion cannot be satisfied;
   report it directly without creating more phases or declaring partial parity.

Only after separately authorized live artifacts pass the immutable scorecard may
the release be described as “Fable-level” and activated in production.
