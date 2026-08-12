# AI Hybrid Visual Quality Fail-Open Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver technically safe hybrid compositions when Gemini's visual critic is unavailable, while deterministically preventing the verified Mundo Pincel mobile overflow.

**Architecture:** Add a versioned, composition-owned mobile-safety style before creative adaptation so it participates in the sanitized structural baseline. Refine the closed-loop repair result so critic provider/response failures keep only the unchanged original composition and only when renderer diagnostics are clean; every structural and deterministic visual failure remains blocking.

**Tech Stack:** TypeScript, Vitest, node-html-parser, Puppeteer/Chromium, existing OpenLen renderer and Visual Engine contracts.

## Global Constraints

- No whole-template fallback or clone path may be restored.
- Do not bypass sanitizer, fingerprint, role, copy-leak, asset, render, or delivery validation.
- Never deliver an unverified repaired candidate after a critic failure.
- Do not hide overflow with clipping or `overflow-x: hidden`.
- Do not add retries or additional provider calls.
- Existing dirty worktree changes belong to the current Visual Engine diagnosis and must be preserved.

---

### Task 1: Deterministic mobile containment for composed sections

**Files:**
- Create: `lib/generation/composition-mobile-safety.ts`
- Create: `lib/generation/composition-mobile-safety.test.ts`
- Create: `lib/generation/composition-mobile-safety.browser.test.ts`
- Modify: `lib/generation/compose-sections.ts`
- Modify: `lib/generation/compose-sections.test.ts`

**Interfaces:**
- Produces: `ensureCompositionMobileSafety(html: string): string`
- Consumes: a complete assembled HTML document after fill and `normalizeBornCanonical`
- Guarantees: one exact `<style data-openlen-composition-safety="mobile/1.0">` in `<head>`, idempotence, unchanged section roles and copy, scoped shrink/wrap rules only

- [ ] **Step 1: Write the failing unit tests**

Add tests that require the function to insert exactly one owned style, remain idempotent, preserve the complete input text and ordered `data-openlen-role` values, and contain these scoped declarations:

```ts
const MOBILE_SAFETY_MARKER = 'data-openlen-composition-safety="mobile/1.0"';

expect(output.match(new RegExp(MOBILE_SAFETY_MARKER, "g"))).toHaveLength(1);
expect(ensureCompositionMobileSafety(output)).toBe(output);
expect(orderedRoles(output)).toEqual(orderedRoles(input));
expect(output).toContain("[data-openlen-role] *{min-width:0}");
expect(output).toContain("overflow-wrap:anywhere");
expect(output).not.toContain("overflow-x:hidden");
expect(output).not.toContain("overflow-x:clip");
```

- [ ] **Step 2: Run the unit test and confirm RED**

Run:

```powershell
npm.cmd test -- lib/generation/composition-mobile-safety.test.ts
```

Expected: collection fails because `./composition-mobile-safety` does not exist.

- [ ] **Step 3: Implement the minimal owned-style injector**

Create a small module with a constant style block and an idempotent head insertion:

```ts
export const COMPOSITION_MOBILE_SAFETY_VERSION = "mobile/1.0" as const;

const OWNED_STYLE = `<style data-openlen-composition-safety="${COMPOSITION_MOBILE_SAFETY_VERSION}">` +
  `[data-openlen-role] *{min-width:0}` +
  `[data-openlen-role] :is(h1,h2,h3,h4,h5,h6,p,li,a,button,span){overflow-wrap:anywhere}` +
  `</style>`;

export function ensureCompositionMobileSafety(html: string): string {
  if (html.includes(`data-openlen-composition-safety="${COMPOSITION_MOBILE_SAFETY_VERSION}"`)) return html;
  const headEnd = html.search(/<\/head\s*>/i);
  return headEnd >= 0
    ? `${html.slice(0, headEnd)}${OWNED_STYLE}${html.slice(headEnd)}`
    : `${OWNED_STYLE}${html}`;
}
```

- [ ] **Step 4: Wire the function before creative adaptation**

In `composeSectionCandidate`, replace the direct normalized HTML input:

```ts
const normalized = normalize(fill.html);
const mobileSafe = ensureCompositionMobileSafety(normalized);
const adaptInput = { html: mobileSafe, ... };
```

Update the composition tests to assert the adaptation input contains the owned marker exactly once and section role order is unchanged.

- [ ] **Step 5: Add a real 390 px Chromium regression**

Use `renderVisualQualityViewports` on a representative flex section whose heading contains `Creaciones de nuestros&nbsp;pequeños&nbsp;artistas.`. Assert the unprotected HTML reports `mobileOverflow: true`, then pass it through `ensureCompositionMobileSafety` and assert `mobileOverflow: false`. Also assert `weakTypographyHierarchy` and `squareComponentTreatment` are false for the fixture.

- [ ] **Step 6: Run Task 1 GREEN verification**

Run:

```powershell
npm.cmd test -- lib/generation/composition-mobile-safety.test.ts lib/generation/composition-mobile-safety.browser.test.ts lib/generation/compose-sections.test.ts lib/ai/visual-quality-renderer.test.ts
```

Expected: all selected files pass; the browser regression reports no mobile overflow after the owned style.

- [ ] **Step 7: Commit Task 1**

```powershell
git add lib/generation/composition-mobile-safety.ts lib/generation/composition-mobile-safety.test.ts lib/generation/composition-mobile-safety.browser.test.ts lib/generation/compose-sections.ts lib/generation/compose-sections.test.ts
git commit -m "fix(generation): contain hybrid mobile layouts"
```

### Task 2: Bounded visual-critic fail-open

**Files:**
- Modify: `lib/generation/closed-loop-repair.ts`
- Modify: `lib/generation/closed-loop-repair.test.ts`
- Modify: `lib/curate/quick-visual-repair.ts`
- Modify: `lib/curate/quick-visual-repair.test.ts`

**Interfaces:**
- Produces result code: `critic_unavailable_keep`
- `runQuickVisualQualityGate` maps that result to `{ ok: true, outcome: "healthy_keep", html: originalHtml, visualEngine: resealedOriginalMetadata }`
- Deterministic diagnostic codes remain `mobile_overflow`, `weak_typography_hierarchy`, and `component_treatment_mismatch`

- [ ] **Step 1: Write failing closed-loop tests**

Add four cases:

```ts
// Initial critic unavailable + clean renderer => unchanged safe keep.
expect(result).toMatchObject({ accepted: false, html: INPUT.html, trace: { resultCode: "critic_unavailable_keep" } });

// Initial critic unavailable + mobileOverflow => remains blocking.
expect(result).toMatchObject({ trace: { resultCode: "initial_critic_failed" } });

// Final critic unavailable + both renderer passes clean => unchanged original keep.
expect(result).toMatchObject({ accepted: false, html: INPUT.html, trace: { resultCode: "critic_unavailable_keep" } });

// Final critic unavailable + final mobileOverflow => remains blocking.
expect(result).toMatchObject({ trace: { resultCode: "final_critic_failed" } });
```

Every test must assert the critic call count, that no retry occurs, that the original HTML is returned, and that reported usage remains redacted/preserved.

- [ ] **Step 2: Run the closed-loop test and confirm RED**

Run:

```powershell
npm.cmd test -- lib/generation/closed-loop-repair.test.ts
```

Expected: the clean critic-failure cases return the old `initial_critic_failed` or `final_critic_failed` codes.

- [ ] **Step 3: Implement diagnostic-aware critic failure classification**

Capture deterministic codes for the first and final renders:

```ts
const firstDiagnosticCodes = rendererDiagnosticCodes(firstImages, input.direction);
if (!first.ok) {
  return original(input, firstDiagnosticCodes.length === 0
    ? "critic_unavailable_keep"
    : "initial_critic_failed", usage);
}

const finalDiagnosticCodes = rendererDiagnosticCodes(finalImages, input.direction);
if (!final.ok) {
  const originalAndFinalAreDeterministicallyClean =
    firstDiagnosticCodes.length === 0 && finalDiagnosticCodes.length === 0;
  return original(input, originalAndFinalAreDeterministicallyClean
    ? "critic_unavailable_keep"
    : "final_critic_failed", usage);
}
```

Keep valid verdict handling and `repairImprovesQuality` unchanged.

- [ ] **Step 4: Write the failing Quick gate test**

Inject a repair result with `accepted: false`, original HTML, and `trace.resultCode: "critic_unavailable_keep"`. Require:

```ts
expect(result).toEqual({
  ok: true,
  outcome: "healthy_keep",
  html: input.html,
  visualEngine: sealAiCompositionOutput(input.visualEngine, input.html),
});
```

Also assert a result code of `initial_critic_failed` remains `{ ok: false, reasonCode: "visual_quality_failed" }`.

- [ ] **Step 5: Run the Quick test and confirm RED**

Run:

```powershell
npm.cmd test -- lib/curate/quick-visual-repair.test.ts
```

Expected: `critic_unavailable_keep` is rejected by the current strict `healthy_keep` comparison.

- [ ] **Step 6: Implement the minimal Quick mapping**

Change only the nonaccepted result branch:

```ts
const safeKeep = result.trace.resultCode === "healthy_keep"
  || result.trace.resultCode === "critic_unavailable_keep";
return safeKeep
  ? { ok: true, outcome: "healthy_keep", html: input.html, visualEngine: sealAiCompositionOutput(input.visualEngine, input.html) }
  : qualityFailure(result.trace.resultCode);
```

- [ ] **Step 7: Run Task 2 GREEN verification**

Run:

```powershell
npm.cmd test -- lib/generation/closed-loop-repair.test.ts lib/curate/quick-visual-repair.test.ts lib/curate/run-ai-creation.test.ts
```

Expected: all selected tests pass, no retries, original hashes remain exact.

- [ ] **Step 8: Commit Task 2**

```powershell
git add lib/generation/closed-loop-repair.ts lib/generation/closed-loop-repair.test.ts lib/curate/quick-visual-repair.ts lib/curate/quick-visual-repair.test.ts
git commit -m "fix(curate): tolerate unavailable visual critic"
```

### Task 3: Release and real-generation verification

**Files:**
- Verify existing production/test changes in the current worktree.
- Use ignored diagnostics under `scratch/`; do not commit generated HTML, screenshots, prompts, or provider responses.

**Interfaces:**
- Consumes the Task 1 mobile safety marker and Task 2 `critic_unavailable_keep` result.
- Produces evidence that Mundo Pincel completes and renders without deterministic mobile defects.

- [ ] **Step 1: Run the focused Visual Engine regression set**

```powershell
npm.cmd test -- lib/generation/deterministic-creative-direction.test.ts lib/curate/deterministic-page-input.test.ts lib/assemble/fill-gemini.test.ts lib/generation/creative-compiler.test.ts lib/generation/skeleton-inventory.test.ts lib/generation/adapt-skeleton.test.ts lib/generation/compose-sections.test.ts lib/generation/closed-loop-repair.test.ts lib/curate/quick-visual-repair.test.ts lib/curate/run-ai-creation.test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Run static verification**

```powershell
npm.cmd run typecheck
git diff --check
```

Expected: both commands exit 0.

- [ ] **Step 3: Run the local no-Gemini composition diagnostic**

```powershell
npx.cmd tsx --env-file=.env.local --tsconfig tsconfig.eval.json --require ./scripts/test-node-server-only-shim.cjs scratch/diagnose-deterministic-composition.mts
```

Expected events: `inventory.ok`, `compile.ok`, `adapt.ok`, and `composition.ok` are all `true`.

- [ ] **Step 4: Execute Mundo Pincel once through the real path**

Run the existing ignored diagnostic with the exact approved Mundo Pincel brief. Do not log provider bodies. Require a successful `section_composition` result with at least three distinct section hashes and write only the final HTML to `scratch/`.

- [ ] **Step 5: Render and inspect desktop/mobile output**

Use the existing visual-quality renderer at 1280×720 and 390×844. Require:

```json
{
  "mobileOverflow": false,
  "weakTypographyHierarchy": false,
  "squareComponentTreatment": false
}
```

Visually confirm that the page reads as children's coloring/creativity, is not a school/SaaS/game page, contains multiple coherent section designs, and contains no donor copy.

- [ ] **Step 6: Run the six remaining approved niches sequentially**

Run horror, comedy, video game, school, cooking, and product one at a time. Stop on the first failure, record only stage/reason/duration, and do not retry. For every success, save the ignored HTML and deterministic renderer result for review.

- [ ] **Step 7: Final verification and scoped commit**

Re-run the focused tests, typecheck, and `git diff --check`. Stage only the production/test files belonging to this Visual Engine fix; exclude `scratch/**`, screenshots, provider output, and unrelated pre-existing user files. Review the staged diff before committing.
