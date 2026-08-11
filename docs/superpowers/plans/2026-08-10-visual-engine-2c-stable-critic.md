# Visual Engine 2C Stable Critic Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing 2C visual critic and repair gate deterministic enough to distinguish healthy pages, repairable defects and genuinely unusable pages without adding assets, retries or fixture-specific behavior.

**Architecture:** Advance the strict critic contract to `visual-quality-verdict/2.1`, then make repair acceptance depend on the issue-to-score dimensions it is meant to improve. Carry one typed, redacted outcome through the existing 2C runner and pilot ledger so the scorecard can prove class-specific behavior instead of inferring it from `adapted` versus `fallback` alone.

**Tech Stack:** TypeScript, Zod, Vitest, Gemini gateway structured-output schema, Drizzle/PostgreSQL scalar pilot ledger.

## Global Constraints

- Do not generate or add a hotel image and do not add any new asset-generation path.
- Do not branch on fixture ID, ordinal, domain or expected cohort label inside critic or repair production code.
- Keep one critic call for `keep`/`nonrepairable` and at most two critics plus one repair-plan call for `repair`; no retry.
- Never store HTML, copy, screenshots, prompts, provider responses, issue explanations, user identity or raw errors in telemetry.
- Any invalid provider output, timeout, compilation failure, render failure or invariant failure returns the original page.
- Keep 2A/2B behavior and Quick delivery unchanged except for the new version literal written by newly accepted repairs.
- Preserve backward type compatibility for already persisted `visual-quality-verdict/2.0` project metadata; new accepted repairs write `2.1`.
- Make no paid provider call, database migration, pilot mutation, rollout or deploy while implementing this plan.
- Use RED-GREEN TDD and commit each task separately.

---

### Task 1: Coherent visual verdict contract

**Files:**
- Modify: `lib/generation/visual-repair-contracts.ts`
- Modify: `lib/generation/visual-repair-contracts.test.ts`
- Modify: `lib/ai/visual-quality-critic.ts`
- Modify: `lib/ai/visual-quality-critic.test.ts`
- Modify: `lib/generation/generate-visual-repair.test.ts`
- Modify: `lib/generation/visual-engine-2c-qualification.ts`
- Modify: `lib/generation/visual-engine-2c-qualification.test.ts`
- Modify: `lib/curate/quick-visual-repair.test.ts`
- Modify: `lib/projects/types.ts`
- Modify: `scripts/visual-engine-2a-rollback-check.ts`

**Interfaces:**
- Produces: `VISUAL_QUALITY_VERDICT_VERSION = "visual-quality-verdict/2.1"`.
- Produces: `VisualNonrepairableReason = "none" | "primary_content_absent" | "primary_content_hidden" | "structurally_unusable"`.
- Produces: every `VisualQualityVerdict` has required `nonrepairableReason`.
- Consumed later by: `repairImprovesQuality`, closed-loop traces, qualification binding and 2C telemetry.

- [ ] **Step 1: Write failing contract tests for every coherent and incoherent verdict shape**

Add table-driven cases to `visual-repair-contracts.test.ts` using this factory:

```ts
const SCORES = {
  themeRecognition: 8,
  visualHierarchy: 8,
  componentCoherence: 8,
  mobileReadability: 8,
  imageryRelevance: 8,
  briefAdherence: 8,
};

const BASE = {
  schemaVersion: "visual-quality-verdict/2.1",
  nonrepairableReason: "none",
  scores: SCORES,
  issues: [],
};

it.each([
  { ...BASE, decision: "keep" },
  { ...BASE, decision: "repair", issues: [PALETTE_ISSUE] },
  { ...BASE, decision: "nonrepairable", nonrepairableReason: "primary_content_hidden", scores: { ...SCORES, briefAdherence: 2 } },
])("accepts coherent verdict %#", (value) => {
  expect(VisualQualityVerdictSchema.safeParse(value).success).toBe(true);
});

it.each([
  { ...BASE, decision: "keep", scores: { ...SCORES, imageryRelevance: 6 } },
  { ...BASE, decision: "keep", issues: [PALETTE_ISSUE] },
  { ...BASE, decision: "repair" },
  { ...BASE, decision: "repair", nonrepairableReason: "structurally_unusable", issues: [PALETTE_ISSUE] },
  { ...BASE, decision: "nonrepairable" },
  { ...BASE, decision: "nonrepairable", nonrepairableReason: "primary_content_absent" },
])("rejects incoherent verdict %#", (value) => {
  expect(VisualQualityVerdictSchema.safeParse(value).success).toBe(false);
});
```

- [ ] **Step 2: Run the contract test and verify RED**

Run:

```powershell
npm.cmd test -- lib/generation/visual-repair-contracts.test.ts
```

Expected: FAIL because version `2.1` and `nonrepairableReason` are not in the current schema.

- [ ] **Step 3: Implement the strict `2.1` Zod contract**

In `visual-repair-contracts.ts`, add the reason schema and enforce decision coherence in `superRefine`:

```ts
export const VISUAL_QUALITY_VERDICT_VERSION = "visual-quality-verdict/2.1" as const;
export const VisualNonrepairableReasonSchema = z.enum([
  "none",
  "primary_content_absent",
  "primary_content_hidden",
  "structurally_unusable",
]);

// Required member of VisualQualityVerdictSchema:
nonrepairableReason: VisualNonrepairableReasonSchema,

// superRefine rules:
const minScore = Math.min(...Object.values(value.scores));
if (value.decision === "keep" && (value.nonrepairableReason !== "none" || value.issues.length > 0 || minScore < 7)) {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["decision"], message: "keep requires satisfied scores and no issues" });
}
if (value.decision === "repair" && (value.nonrepairableReason !== "none" || value.issues.length === 0)) {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["decision"], message: "repair requires repairable issues only" });
}
if (value.decision === "nonrepairable" && (value.nonrepairableReason === "none" || minScore > 3)) {
  ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["decision"], message: "nonrepairable requires a typed reason and visible failure score" });
}
```

Export the inferred `VisualNonrepairableReason` type.

- [ ] **Step 4: Add critic-boundary RED tests**

Update the clean fixture in `visual-quality-critic.test.ts` to `2.1` with `nonrepairableReason: "none"`. Add assertions that the outgoing structured schema requires the new enum and that the prompt contains the narrow rule:

```ts
expect(captured?.responseSchema).toMatchObject({
  properties: {
    nonrepairableReason: {
      type: "STRING",
      enum: ["none", "primary_content_absent", "primary_content_hidden", "structurally_unusable"],
    },
  },
  required: expect.arrayContaining(["nonrepairableReason"]),
});
expect(prompt).toContain("Missing photography, abstract imagery, palette, typography, spacing and component styling are repairable");
expect(prompt).toContain("Never use nonrepairable for an ordinary visual mismatch");
```

Add invalid provider cases for `keep` with a score of 6 and `nonrepairable` with reason `none`; both must return `{ ok: false, kind: "invalid_response" }` without provider prose.

- [ ] **Step 5: Run critic tests and verify RED**

Run:

```powershell
npm.cmd test -- lib/ai/visual-quality-critic.test.ts
```

Expected: FAIL because the response schema and prompt are still `2.0`/`2.2` and do not require the new field.

- [ ] **Step 6: Implement the `2.1` provider schema and prompt `2.3`**

In `visual-quality-critic.ts`:

```ts
export const VISUAL_QUALITY_CRITIC_PROMPT_VERSION = "visual-quality-critic/2.3" as const;

// RESPONSE_SCHEMA.properties
nonrepairableReason: {
  type: "STRING",
  enum: ["none", "primary_content_absent", "primary_content_hidden", "structurally_unusable"],
},

// RESPONSE_SCHEMA.required
"nonrepairableReason",
```

Replace the broad nonrepairable prompt language with exact rules from the spec. Keep `temperature: 0`, `thinkingBudget: 0`, strict JSON, canonical explanations, image allowlisting and existing failure redaction unchanged.

- [ ] **Step 7: Update exact version-bound consumers without breaking old project metadata**

Make these mechanical, scoped changes:

```ts
// lib/projects/types.ts
criticVersion: "visual-quality-verdict/2.0" | "visual-quality-verdict/2.1";

// lib/generation/visual-engine-2c-qualification.ts
criticVersion: "visual-quality-verdict/2.1";
// build and verify only 2.1 so the old qualification becomes intentionally stale.
```

Update test verdict fixtures in `generate-visual-repair.test.ts`, `quick-visual-repair.test.ts`, `visual-engine-2c-qualification.test.ts`, and `scripts/visual-engine-2a-rollback-check.ts` to include `nonrepairableReason` and the new version. New accepted repair fixtures must write `2.1`; retained backward-compatibility assertions may still use `2.0` project metadata.

- [ ] **Step 8: Run the focused Task 1 gate**

Run:

```powershell
npm.cmd test -- lib/generation/visual-repair-contracts.test.ts lib/ai/visual-quality-critic.test.ts lib/generation/generate-visual-repair.test.ts lib/generation/visual-engine-2c-qualification.test.ts lib/curate/quick-visual-repair.test.ts
npm.cmd run typecheck
git diff --check
```

Expected: all tests PASS, typecheck exit 0, diff check exit 0.

- [ ] **Step 9: Commit Task 1**

```powershell
git add -- lib/generation/visual-repair-contracts.ts lib/generation/visual-repair-contracts.test.ts lib/ai/visual-quality-critic.ts lib/ai/visual-quality-critic.test.ts lib/generation/generate-visual-repair.test.ts lib/generation/visual-engine-2c-qualification.ts lib/generation/visual-engine-2c-qualification.test.ts lib/curate/quick-visual-repair.test.ts lib/projects/types.ts scripts/visual-engine-2a-rollback-check.ts
git commit -m "fix(ai): require coherent visual verdicts"
```

---

### Task 2: Defect-directed repair acceptance

**Files:**
- Modify: `lib/generation/closed-loop-repair.ts`
- Modify: `lib/generation/closed-loop-repair.test.ts`

**Interfaces:**
- Consumes: `VisualRepairIssueCode`, `VisualQualityScores`, `VisualQualityVerdict` from Task 1.
- Produces: exported `VISUAL_REPAIR_SCORE_DIMENSIONS` and deterministic `repairImprovesQuality(before, after)`.
- Preserves: `runClosedLoopVisualRepair` call ceilings and original-page fallback.

- [ ] **Step 1: Replace the broad score test with table-driven RED cases**

Create `verdict()` and `score()` helpers in `closed-loop-repair.test.ts`. Add one accepted test for each mapping:

```ts
it.each([
  ["theme_mismatch", ["themeRecognition", "briefAdherence"]],
  ["palette_mismatch", ["themeRecognition", "briefAdherence"]],
  ["weak_typography_hierarchy", ["visualHierarchy"]],
  ["spacing_density", ["visualHierarchy", "componentCoherence"]],
  ["mobile_overflow", ["mobileReadability"]],
  ["imagery_mismatch", ["imageryRelevance", "briefAdherence"]],
  ["component_treatment_mismatch", ["componentCoherence"]],
] as const)("accepts targeted %s improvement", (code, dimensions) => {
  const before = verdict(code, "critical", 5);
  const afterScores = { ...before.scores };
  afterScores[dimensions[0]] += 2;
  expect(repairImprovesQuality(before, keep(afterScores))).toBe(true);
});
```

Add explicit rejection cases:

```ts
expect(repairImprovesQuality(before, keep({ ...improved, visualHierarchy: before.scores.visualHierarchy - 1 }))).toBe(true); // unrelated one-point jitter
expect(repairImprovesQuality(before, keep({ ...improved, visualHierarchy: before.scores.visualHierarchy - 2 }))).toBe(false);
expect(repairImprovesQuality(before, verdictWithNewIssue)).toBe(false);
expect(repairImprovesQuality(before, verdictWithRelevantDecrease)).toBe(false);
expect(repairImprovesQuality(before, verdictWithRemainingCritical)).toBe(false);
expect(repairImprovesQuality(before, verdictWithNegativeTotal)).toBe(false);
```

Ensure all fixtures use `visual-quality-verdict/2.1` and required `nonrepairableReason`.

- [ ] **Step 2: Run the closed-loop test and verify RED**

Run:

```powershell
npm.cmd test -- lib/generation/closed-loop-repair.test.ts
```

Expected: the one-point unrelated jitter case fails under the current all-keys-monotonic rule.

- [ ] **Step 3: Implement the issue-to-score map and deterministic policy**

In `closed-loop-repair.ts`:

```ts
export const VISUAL_REPAIR_SCORE_DIMENSIONS = {
  theme_mismatch: ["themeRecognition", "briefAdherence"],
  palette_mismatch: ["themeRecognition", "briefAdherence"],
  weak_typography_hierarchy: ["visualHierarchy"],
  spacing_density: ["visualHierarchy", "componentCoherence"],
  mobile_overflow: ["mobileReadability"],
  imagery_mismatch: ["imageryRelevance", "briefAdherence"],
  component_treatment_mismatch: ["componentCoherence"],
} as const satisfies Record<VisualRepairIssueCode, readonly (keyof VisualQualityScores)[]>;
```

Implement `repairImprovesQuality` in this exact order:

1. Reject any final critical issue.
2. Reject any final issue code absent from the initial issue-code set.
3. Reject if an initial critical code remains.
4. Build the unique relevant-dimension set from every initial issue.
5. Reject a decrease in a relevant dimension.
6. Require relevant-dimension total gain `>= 2`.
7. Reject any unrelated decrease below `-1`.
8. Require global total delta `>= 0`.
9. Require final theme recognition and brief adherence `>= 7`.

Do not read fixture metadata, domains or case IDs.

- [ ] **Step 4: Prove closed-loop behavior and trace privacy remain unchanged**

Add/retain assertions that:

```ts
expect(d.critic).toHaveBeenCalledTimes(2);
expect(d.generatePlan).toHaveBeenCalledTimes(1);
expect(d.applyPlan).toHaveBeenCalledTimes(1);
expect(result.trace).toMatchObject({ resultCode: "accepted", criticVersion: "visual-quality-verdict/2.1" });
expect(JSON.stringify(result.trace)).not.toMatch(/html|explanation|dataBase64/i);
```

Keep and nonrepairable paths must call the critic exactly once and never call the plan generator.

- [ ] **Step 5: Run Task 2 verification**

Run:

```powershell
npm.cmd test -- lib/generation/closed-loop-repair.test.ts lib/generation/apply-visual-repair.test.ts lib/generation/generate-visual-repair.test.ts lib/curate/quick-visual-repair.test.ts
npm.cmd run typecheck
git diff --check
```

Expected: PASS, typecheck exit 0, diff check exit 0.

- [ ] **Step 6: Commit Task 2**

```powershell
git add -- lib/generation/closed-loop-repair.ts lib/generation/closed-loop-repair.test.ts
git commit -m "fix(generation): score visual repairs by defect"
```

---

### Task 3: Typed 2C outcomes and scorecard proof

**Files:**
- Modify: `lib/generation/visual-engine-pilot-store.ts`
- Modify: `lib/generation/visual-engine-pilot-store.test.ts`
- Modify: `lib/generation/visual-engine-2c-eval.ts`
- Modify: `lib/generation/visual-engine-2c-eval.test.ts`
- Modify: `lib/generation/visual-engine-2c-eval-cli.integration.test.ts`
- Modify: `scripts/visual-engine-2c-eval.ts`
- Modify: `scripts/visual-engine-2c-review.ts`
- Modify: `scripts/visual-engine-2c-scorecard.ts`
- Modify: `docs/generation/visual-engine-2a-runbook.md`
- Modify if version assertions require it: `lib/generation/visual-engine-2c-runbook-contract.test.ts`

**Interfaces:**
- Produces `VisualEngine2COutcomeCode`:
  `visual_healthy_keep | visual_repair_accepted | visual_nonrepairable | visual_not_improved`.
- Produces `classifyVisualEngine2CTraceResult(accepted, resultCode)` returning typed `status`, `reasonCode` and `structuralInvariantPassed`.
- Produces `buildVisualEngine2CScoreRow(caseClass, ledgerRow)` for scripts and tests.
- Persists only existing scalar `reasonCode`; no migration or new column.

- [ ] **Step 1: Write RED tests for the four typed outcomes**

Extend the pilot reason test table:

```ts
[
  "visual_healthy_keep",
  "visual_repair_accepted",
  "visual_nonrepairable",
  "visual_not_improved",
] as const satisfies readonly PilotReasonCode[]
```

In `visual-engine-2c-eval.test.ts`, add:

```ts
expect(classifyVisualEngine2CTraceResult(false, "healthy_keep")).toEqual({
  status: "adapted", reasonCode: "visual_healthy_keep", structuralInvariantPassed: undefined,
});
expect(classifyVisualEngine2CTraceResult(true, "accepted")).toEqual({
  status: "adapted", reasonCode: "visual_repair_accepted", structuralInvariantPassed: true,
});
expect(classifyVisualEngine2CTraceResult(false, "nonrepairable")).toEqual({
  status: "fallback", reasonCode: "visual_nonrepairable", structuralInvariantPassed: undefined,
});
expect(classifyVisualEngine2CTraceResult(false, "not_improved")).toEqual({
  status: "fallback", reasonCode: "visual_not_improved", structuralInvariantPassed: undefined,
});
```

Add score-row cases proving healthy/repaired/nonrepairable exact matches pass, an accepted repair on a healthy case sets `healthyReplacement: true`, and status-only matches with a wrong reason become `technicalFailure: true`.

- [ ] **Step 2: Run the telemetry tests and verify RED**

Run:

```powershell
npm.cmd test -- lib/generation/visual-engine-pilot-store.test.ts lib/generation/visual-engine-2c-eval.test.ts
```

Expected: FAIL because the new reason codes and classification helpers do not exist.

- [ ] **Step 3: Implement typed outcomes without a migration**

Add the four codes to `PilotReasonCode`. In `visual-engine-2c-eval.ts` add:

```ts
export type VisualEngine2COutcomeCode =
  | "visual_healthy_keep"
  | "visual_repair_accepted"
  | "visual_nonrepairable"
  | "visual_not_improved";

export function classifyVisualEngine2CTraceResult(accepted: boolean, resultCode: string) {
  if (accepted && resultCode === "accepted") return { status: "adapted" as const, reasonCode: "visual_repair_accepted" as const, structuralInvariantPassed: true as const };
  if (!accepted && resultCode === "healthy_keep") return { status: "adapted" as const, reasonCode: "visual_healthy_keep" as const, structuralInvariantPassed: undefined };
  if (!accepted && resultCode === "nonrepairable") return { status: "fallback" as const, reasonCode: "visual_nonrepairable" as const, structuralInvariantPassed: undefined };
  if (!accepted && resultCode === "not_improved") return { status: "fallback" as const, reasonCode: "visual_not_improved" as const, structuralInvariantPassed: undefined };
  const technicalReason = {
    initial_render_failed: "technical_render_failed",
    final_render_failed: "technical_render_failed",
    technical_render_failed: "technical_render_failed",
    initial_critic_failed: "provider_error",
    final_critic_failed: "provider_error",
    repair_provider_failed: "provider_error",
    timeout: "provider_timeout",
    inventory_failed: "invalid_inventory",
    compile_failed: "css_policy_violation",
    asset_failed: "required_asset_unavailable",
    sanitization_failed: "sanitization_failed",
    structural_invariant_failed: "structural_invariant_failed",
    internal_error: "internal_error",
  } as const satisfies Record<string, PilotReasonCode>;
  return {
    status: "fallback" as const,
    reasonCode: technicalReason[resultCode as keyof typeof technicalReason] ?? "internal_error",
    structuralInvariantPassed: resultCode === "structural_invariant_failed" ? false as const : undefined,
  };
}
```

Also export `buildVisualEngine2CScoreRow` so both the script and unit tests share one class-specific truth table. It must require:

```ts
healthy_keep                 -> adapted + visual_healthy_keep
repairable                   -> adapted + visual_repair_accepted
nonrepairable_or_fallback    -> fallback + visual_nonrepairable
```

Set `acceptedRepair` only for the second row and `healthyReplacement` only when a healthy case has `visual_repair_accepted`.

- [ ] **Step 4: Carry the outcome through the runner and ledger**

Extend the internal `evaluate`/`complete` scalar result with `reasonCode: PilotReasonCode` and optional `structuralInvariantPassed`. If evaluation throws, the existing conservative catch must return `status: "failed"`, `reasonCode: "internal_error"`, the leased call/cost ceilings and no structural claim. In `scripts/visual-engine-2c-eval.ts`, classify `result.accepted` plus `result.trace.resultCode`, return those scalars, and complete with:

```ts
store.completeVisualEnginePilotRun(id, {
  status: result.status,
  reasonCode: result.reasonCode,
  observedPilotCostMicromxn: result.costMicromxn,
  productionEquivalentCostMicromxn: result.costMicromxn,
  rateCardVersion: rateCard?.version,
  candidatePersisted: false,
  structuralInvariantPassed: result.structuralInvariantPassed,
});
```

Do not add a database column. Keep evidence writing limited to `result.accepted`.

- [ ] **Step 5: Make review and scorecard use exact reasons**

Update both ledger queries to select `reasonCode`. In `visual-engine-2c-review.ts`, `acceptedRepair` must be true only for a repairable cohort row with `visual_repair_accepted`. In `visual-engine-2c-scorecard.ts`, replace the local status-only truth table with `buildVisualEngine2CScoreRow` and keep human verdict, forbidden-signal and cost validation unchanged.

Add an integration assertion that each `complete` call receives the correct reason for a 6 healthy / 6 repaired / 3 nonrepairable fixture run:

```ts
expect(state.deps.complete.mock.calls.map(([, value]) => value.reasonCode)).toEqual([
  ...Array(6).fill("visual_healthy_keep"),
  ...Array(6).fill("visual_repair_accepted"),
  ...Array(3).fill("visual_nonrepairable"),
]);
```

- [ ] **Step 6: Update runbook wording and qualification expectations**

In the 2C runbook section, document the four redacted outcome codes and state that the gate uses exact class/outcome matches. Keep the existing six accepted repairs, human preference, privacy and 30-MXN ceiling unchanged. Update the runbook contract test only if it asserts the affected paragraph.

- [ ] **Step 7: Run the focused Task 3 gate**

Run:

```powershell
npm.cmd test -- lib/generation/visual-engine-pilot-store.test.ts lib/generation/visual-engine-2c-eval.test.ts lib/generation/visual-engine-2c-eval-cli.integration.test.ts lib/generation/visual-engine-2c-qualification.test.ts lib/generation/visual-engine-2c-runbook-contract.test.ts
npm.cmd run typecheck
git diff --check
```

Expected: PASS, typecheck exit 0, diff check exit 0.

- [ ] **Step 8: Run the complete non-live release gate**

Run exactly once after focused tests are green:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run generation:visual-engine-2a:rollback-check
git diff --check
```

Expected: full Vitest suite PASS, typecheck exit 0, rollback output contains `"verified":true`, diff check exit 0. Do not run 2C qualification or eval in this step.

- [ ] **Step 9: Audit privacy and scope**

Run:

```powershell
git diff --name-only HEAD
git diff --check
git status --short
```

Confirm no `.env*`, evidence, JPG/PNG, reviewer identity/session, raw response, generated binding, scratch diagnostic, absolute local path or unrelated user artifact is staged. Preserve all existing untracked user files unchanged.

- [ ] **Step 10: Commit Task 3**

```powershell
git add -- lib/generation/visual-engine-pilot-store.ts lib/generation/visual-engine-pilot-store.test.ts lib/generation/visual-engine-2c-eval.ts lib/generation/visual-engine-2c-eval.test.ts lib/generation/visual-engine-2c-eval-cli.integration.test.ts scripts/visual-engine-2c-eval.ts scripts/visual-engine-2c-review.ts scripts/visual-engine-2c-scorecard.ts docs/generation/visual-engine-2a-runbook.md lib/generation/visual-engine-2c-runbook-contract.test.ts
git commit -m "fix(generation): record typed 2c visual outcomes"
```

## Post-implementation decision gate

After the three commits and a clean non-live gate:

1. Regenerate the ignored 2C qualification twice and require identical bytes because the critic version changed.
2. Do not mutate the current failed 2C ledger until its 15 scalar rows and evidence are archived under the existing guarded operational flow.
3. Request explicit approval for a bounded synthetic diagnostic only. Test the previously unstable healthy cases and repair cases 8/11 first.
4. Permit another 15-case paid smoke only if the targeted diagnostic matches all expected classes and a new explicit budget is approved.
5. Open blind review only when exactly six repairable cases have accepted evidence and the ledger has six `visual_healthy_keep`, six `visual_repair_accepted`, and three `visual_nonrepairable` outcomes.
