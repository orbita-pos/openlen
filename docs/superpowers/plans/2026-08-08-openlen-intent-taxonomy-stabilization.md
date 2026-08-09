# OpenLen Intent Taxonomy Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stabilize OpenLen's intent classification against the approved canonical taxonomy while preserving strict local validation, reviewed template allowlists, and the 2A failure barrier.

**Architecture:** Gemini remains the semantic analyzer but receives a deterministic temperature-zero JSON request with an explicit compact shape and unambiguous classification rules. OpenLen remains authoritative for Zod validation, ranking, route decisions, and pilot gating. The frozen cohort is corrected only where its expected structural labels contradict the same prompt policy; no allowlist or threshold is relaxed.

**Tech Stack:** TypeScript, Zod, Vitest, existing OpenLen intent/ranking/qualification modules.

## Global Constraints

- Do not call Gemini, another model, or any external network during implementation or verification.
- Do not write to the pilot database, start the reviewer, reserve quota, deploy, or change rollout flags.
- Keep `responseMimeType: "application/json"`; do not restore a provider-side `responseJsonSchema`.
- Keep local `IntentAnalysisSchema` validation and all existing typed failure behavior.
- Keep all template allowlists and ranking thresholds unchanged.
- Keep the live canary strict: `section_composition`, an outside-allowlist skeleton, any schema/API failure, or any non-exact qualified template remains a failure with zero reservations.
- Preserve all user-owned untracked files.

---

### Task 1: Deterministic intent request and canonical guidance

**Files:**
- Modify: `lib/generation/analyze-intent.ts`
- Modify: `lib/generation/analyze-intent.test.ts`
- Modify: `lib/generation/safe-selection.test.ts`
- Modify: `lib/generation/shadow-selection.test.ts`
- Modify: `lib/curate/quick-visual-engine.test.ts`
- Modify: `lib/curate/curate-route.integration.test.ts`
- Modify: `scripts/visual-engine-2a-rollback-check.ts`

**Interfaces:**
- Consumes: `IntentAnalysisSchema`, `CANONICAL_SITE_TYPES`, `CANONICAL_PRIMARY_AUDIENCES`, and `CANONICAL_SECTION_ROLES`.
- Produces: `INTENT_PROMPT_VERSION = "intent-prompt/1.8"`; unchanged `analyzeIntent(brief, options): Promise<AnalyzeIntentResult>`.

- [ ] **Step 1: Write the failing provider-contract test**

Extend the first `analyzeIntent` request test to require temperature zero, no `responseJsonSchema`, prompt version `1.8`, a compact JSON object example, and these exact semantic decisions:

```ts
expect(body.generationConfig).toMatchObject({
  temperature: 0,
  maxOutputTokens: 2048,
  responseMimeType: "application/json",
  thinkingConfig: { thinkingBudget: 0 },
});
expect(body.generationConfig).not.toHaveProperty("responseJsonSchema");
expect(body.systemInstruction.parts[0].text).toContain('"schemaVersion":"intent-analysis/1.0"');
expect(body.systemInstruction.parts[0].text).toContain("public cafe, bakery, wine bar, taqueria, or restaurant -> restaurant");
expect(body.systemInstruction.parts[0].text).toContain("appointment-based or membership-based local wellness studio -> small_business");
expect(body.systemInstruction.parts[0].text).toContain("child-focused creative club -> children");
expect(body.systemInstruction.parts[0].text).toContain("art educator creator hub -> educators");
expect(body.systemInstruction.parts[0].text).toContain("issue archive with membership CTA -> blog");
expect(body.systemInstruction.parts[0].text).toContain("signup-first publication without an issue archive -> newsletter");
expect(INTENT_PROMPT_VERSION).toBe("intent-prompt/1.8");
```

- [ ] **Step 2: Run the test and record RED**

Run:

```powershell
npm.cmd test -- lib/generation/analyze-intent.test.ts
```

Expected: FAIL because temperature is `0.2`, prompt version is `1.7`, and the compact example/canonical rules are absent.

- [ ] **Step 3: Implement the minimal prompt change**

In `analyze-intent.ts`:

```ts
export const INTENT_PROMPT_VERSION = "intent-prompt/1.8" as const;

const GENERATION_CONFIG = {
  temperature: 0,
  maxOutputTokens: 2_048,
  responseMimeType: "application/json",
  thinkingConfig: { thinkingBudget: 0 },
} as const;
```

Add one compact valid JSON example containing every required key and explicit scalar/array types. Add the six canonical decisions asserted above. State that `ageRange` is `null` unless the brief supports a concrete range and that `contentModel` is one descriptive lowercase `snake_case` string. Do not add case IDs, template IDs, or provider schema.

- [ ] **Step 4: Update prompt-version fixtures mechanically**

Replace only `intent-prompt/1.7` fixtures that represent `INTENT_PROMPT_VERSION` with `intent-prompt/1.8` in the listed consumer tests and rollback fixture. Do not change decision-policy versions.

- [ ] **Step 5: Run focused GREEN**

Run:

```powershell
npm.cmd test -- lib/generation/analyze-intent.test.ts lib/generation/safe-selection.test.ts lib/generation/shadow-selection.test.ts lib/curate/quick-visual-engine.test.ts lib/curate/curate-route.integration.test.ts
```

Expected: all selected files pass.

- [ ] **Step 6: Commit Task 1**

Stage only the seven listed files and commit:

```powershell
git commit -m "fix(generation): stabilize canonical intent prompt"
```

---

### Task 2: Align frozen cohort with canonical structural policy

**Files:**
- Modify: `lib/generation/visual-engine-2a-cohort.ts`
- Modify: `lib/generation/visual-engine-2a-cohort.test.ts`
- Modify: `lib/generation/visual-engine-2a-qualification.test.ts`

**Interfaces:**
- Consumes: `VISUAL_ENGINE_2A_PILOT_CASES`, `qualifyVisualEngine2ACohort`, and prompt version `1.8`.
- Produces: the same immutable 15-case `VISUAL_ENGINE_2A_PILOT_CASES` interface with corrected expected structural labels.

- [ ] **Step 1: Write failing cohort-policy assertions**

Add exact assertions by synthetic case ID:

```ts
expect(byId("bakery-morning-en").expectedIntent.functional.siteType).toBe("restaurant");
expect(byId("botanical-winebar-es").expectedIntent.functional.siteType).toBe("restaurant");
expect(byId("prenatal-movement-en").expectedIntent.functional.siteType).toBe("small_business");
expect(byId("creative-club-es").expectedIntent.functional.siteType).toBe("business");
expect(byId("creative-club-es").expectedIntent.audience.primary).toBe("children");
expect(byId("teacher-art-hub-en").expectedIntent.audience.primary).toBe("educators");
expect(byId("literary-newsletter-en").expectedIntent.functional.siteType).toBe("blog");
```

Also assert that all 15 `contentModel` values remain non-empty lowercase `snake_case` descriptors and are not used as allowlist keys.

- [ ] **Step 2: Run the cohort test and record RED**

Run:

```powershell
npm.cmd test -- lib/generation/visual-engine-2a-cohort.test.ts
```

Expected: FAIL on bakery, botanical wine bar, and prenatal movement site types.

- [ ] **Step 3: Correct only contradictory expected intents**

Change:

```ts
"bakery-morning-en": business -> restaurant
"botanical-winebar-es": restaurant_website -> restaurant
"prenatal-movement-en": business -> small_business
```

Do not alter briefs, identity signals, expected sections, template allowlists, template IDs, rationales, or the remaining expected intents.

- [ ] **Step 4: Prove prompt/cohort policy consistency**

Extend the qualification contract test so the runbook/prompt version and the three corrected expected site types are consumed without modifying threshold or allowlist assertions. The test must still prove 15 distinct reviewed allowlist IDs.

- [ ] **Step 5: Run focused GREEN and read-only qualification**

Run:

```powershell
npm.cmd test -- lib/generation/visual-engine-2a-cohort.test.ts lib/generation/visual-engine-2a-qualification.test.ts lib/generation/visual-engine-2a-preflight.test.ts
npm.cmd run generation:visual-engine-2a:qualify
```

Expected tests: PASS. Expected qualification: `ok=true`, `templateCount=15`.

If qualification fails or selects outside an existing allowlist, stop. Report the case, selected template ID, reviewed allowlist, and reason codes. Do not edit allowlists or metadata in this plan.

- [ ] **Step 6: Commit Task 2**

Stage only the three listed files and commit:

```powershell
git commit -m "fix(generation): align 2A cohort taxonomy"
```

---

### Task 3: Regression and release gate

**Files:**
- Modify only if a directly related regression exposes a defect in Tasks 1-2; otherwise no source changes.

**Interfaces:**
- Consumes: prompt `1.8`, aligned 15-case cohort, unchanged scorer/route/allowlist/budget contracts.
- Produces: fresh verification evidence and a stable ignored qualification artifact.

- [ ] **Step 1: Run the complete focused regression**

```powershell
npm.cmd test -- lib/generation/analyze-intent.test.ts lib/generation/safe-selection.test.ts lib/generation/shadow-selection.test.ts lib/generation/score-template.test.ts lib/generation/decide-route.test.ts lib/generation/visual-engine-2a-cohort.test.ts lib/generation/visual-engine-2a-qualification.test.ts lib/generation/visual-engine-2a-preflight.test.ts lib/generation/visual-engine-2a-live-canary.test.ts lib/generation/visual-engine-2a-eval-cli.integration.test.ts lib/generation/visual-engine-pilot-budget.test.ts lib/curate/quick-visual-engine.test.ts lib/curate/curate-route.integration.test.ts
```

Expected: all selected tests pass with no assertion failures.

- [ ] **Step 2: Run static and rollback gates**

```powershell
npm.cmd run typecheck
npm.cmd run generation:visual-engine-2a:rollback-check
git diff --check
```

Expected: typecheck exit `0`; rollback reports `verified=true`; diff check exit `0`.

- [ ] **Step 3: Prove qualification stability twice**

Run `npm.cmd run generation:visual-engine-2a:qualify`, hash `scratch/visual-engine-2a/qualification.json`, run qualification again, and hash it again. Expected: both runs report `ok=true`, `templateCount=15`, and both SHA-256 values are identical.

- [ ] **Step 4: Audit privacy and repository state**

Confirm no `.env`, API key, database URL, raw provider body, generated brief, screenshot, reviewer identity, or `scratch/visual-engine-2a/**` evidence is staged. Confirm user-owned untracked files are unchanged. Review the commits against the design non-goals.

- [ ] **Step 5: Final handoff**

Report exact test counts, typecheck/rollback results, stable qualification hash, commit IDs, and any remaining uncertainty. Do not claim 2A passed and do not execute another live request. A future live confirmation or smoke requires a new explicit authorization.
