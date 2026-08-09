# OpenLen Visual Engine 2A Live Canary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gate the paid 2A evaluation with exactly 15 production-equivalent intent selections and reuse each successful selection across the case's five adaptation scenarios.

**Architecture:** Add one pure live-canary orchestrator beside the existing 2A preflight code, then replace the eval CLI's 75-selection preflight call with that orchestrator. The canary writes one self-hashed, privacy-allowlisted local artifact before a final commit/catalog/material/quota barrier; only a strict 15/15 pass expands to the existing 75-row adaptation runner.

**Tech Stack:** TypeScript, Vitest, existing Visual Engine 2A qualification/safe-selection/cost contracts, injected CLI dependencies, atomic JSON writer.

## Global Constraints

- The implementation is one bounded block. Do not add optional hardening tasks, new phases, runtime UI, migrations, dependencies or unrelated refactors.
- Make no live Gemini, database mutation, pilot, deploy or feature-flag call during implementation or verification.
- The canary performs exactly 15 selections, one per frozen base case, with maximum concurrency `3`; it never retries or replaces a case.
- Success is exactly `15/15`: every result is successful, version-compatible, usage-complete, `template_skeleton`, allowlisted and equal to the qualified template ID.
- Full intents may exist only in process memory. Never persist briefs, full intents, prompts, responses, HTML, copy, profiles, images, provider bodies, secrets, emails, reviewer identity or absolute paths.
- Write `scratch/visual-engine-2a/live-canary.json` atomically before any reservation/adaptation; a failure still writes its redacted terminal artifact when the writer itself is available.
- After writing a successful artifact, recheck HEAD, recomputed qualification hashes, HEAD again and exact quota `limit=75`, `used=0`, `existingRuns=0` before adapting.
- Reuse one successful selection per case across its five scenarios; do not make another intent call in the adaptation path.
- Preserve the existing 75-row adaptation, critic, renderer, evidence, ledger, rollback and scorecard behavior.
- The previous paid authorization is consumed. The completed code must not run a live canary without new explicit user authorization.

---

### Task 1: Implement and integrate the strict 15/15 live canary

**Files:**
- Create: `lib/generation/visual-engine-2a-live-canary.ts`
- Create: `lib/generation/visual-engine-2a-live-canary.test.ts`
- Modify: `scripts/visual-engine-2a-eval.ts`
- Modify: `lib/generation/visual-engine-2a-eval-cli.integration.test.ts`
- Modify: `docs/generation/visual-engine-2a-runbook.md`
- Modify: `docs/generation/visual-engine-2a-pilot-cohort.md`

**Interfaces:**
- Consumes: `VISUAL_ENGINE_2A_PILOT_CASES`, `buildVisualEngine2APool`, `canonicalJsonSha256`, `SafeSelectionResult`, `VisualEngine2AQualificationManifest`, `verifyVisualEngine2AQualification`, `calculateModelCostMicros`, `ModelTokenUsage`, and the eval CLI's existing freshness/quota dependencies.
- Produces:

```ts
export type VisualEngine2ALiveCanaryFailureCode =
  | "invalid_quota"
  | "existing_runs"
  | "qualification_invalid"
  | "qualification_stale"
  | "selection_failed"
  | "version_mismatch"
  | "usage_missing"
  | "ineligible_route"
  | "template_outside_allowlist";

export interface VisualEngine2ALiveCanaryRow {
  caseId: string;
  route: "template_full" | "template_skeleton" | "section_composition" | "scratch_controlled" | "safe_failure" | null;
  selectedTemplateId: string | null;
  structuralFit: number | null;
  identityFit: number | null;
  adaptationCost: number | null;
  resultCode: "ok" | "missing_key" | "api" | "parse" | "schema" | "aborted" | "timeout" | "invalid_input" | "unexpected_error" | "version_mismatch" | "usage_missing" | "ineligible_route" | "template_outside_allowlist";
  usage: ModelTokenUsage | null;
  intentSha256: string | null;
}

export interface VisualEngine2ALiveCanaryReport {
  schemaVersion: "visual-engine-2a-live-canary/1.0";
  datasetVersion: "visual-engine-2a-cohort/1.0";
  datasetSha256: string;
  qualificationManifestSha256: string;
  catalogSha256: string;
  commitSha: string;
  modelId: string;
  promptVersion: string;
  policyVersion: string;
  taxonomyVersion: string;
  rateCardVersion: string;
  rows: readonly VisualEngine2ALiveCanaryRow[];
  counts: { cases: 15; analyzed: number; passed: number; failed: number };
  tokens: ModelTokenUsage | null;
  usageComplete: boolean;
  productionEquivalentCostMicromxn: number | null;
  totalDurationMs: number;
  reservationCount: 0;
  reportSha256: string;
}

export type VisualEngine2ALiveCanaryResult =
  | { ok: true; eligible: readonly QualifiedPilotRow[]; selectionsByCase: ReadonlyMap<string, Extract<SafeSelectionResult, { ok: true }>>; report: VisualEngine2ALiveCanaryReport }
  | { ok: false; code: VisualEngine2ALiveCanaryFailureCode; report: VisualEngine2ALiveCanaryReport };

export async function runVisualEngine2ALiveCanary(args: {
  cases: readonly VisualEngine2APilotCase[];
  qualification: VisualEngine2AQualificationManifest;
  currentQualification: Omit<VisualEngine2AQualificationManifest, "manifestSha256">;
  quota: { limit: number; used: number; existingRuns: number };
  modelId: string;
  rateCard: PilotRateCard;
  mxnPerUsd: number;
  select(row: VisualEngine2APoolRow): Promise<SafeSelectionResult>;
  now?: () => number;
}): Promise<VisualEngine2ALiveCanaryResult>;
```

- The implementation may extract the existing qualification-integrity predicate from `visual-engine-2a-preflight.ts` into a narrowly exported helper only if duplication would otherwise be required. If extracted, preserve all existing preflight tests and add the moved helper to the Task 1 file list/report; do not otherwise redesign the legacy module.

- [ ] **Step 1: Write RED tests for one-call-per-case and bounded concurrency**

Create fixtures from the real frozen 15-case cohort and qualification contract. The selection seam must block on deferred promises so the test proves `15` total calls, `15` unique case IDs, only the `plain` representative scenario, and a measured maximum of exactly `3` in flight. Assert there is no retry after a rejected or failed result.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
npm.cmd test -- lib/generation/visual-engine-2a-live-canary.test.ts
```

Expected: FAIL because `./visual-engine-2a-live-canary` does not exist.

- [ ] **Step 3: Write RED contract tests for strict 15/15 and redacted evidence**

Cover successful exact-template expansion to `75` rows and each terminal failure class: invalid quota, existing rows, invalid/stale qualification, provider/parse/schema/timeout error, thrown selection, version mismatch, missing usage, non-skeleton route and outside/different qualified template. Assert deterministic case-order failure precedence, `reservationCount: 0`, canonical self-hash, complete cost aggregation, exactly 15 allowlisted row objects, intent hash without intent content, and JSON absence of every brief plus keys such as `intent`, `ranked`, `prompt`, `response`, `html`, `copy`, `email`, `path` and `message`.

- [ ] **Step 4: Implement the minimal pure canary orchestrator**

Use a fixed worker pool of three over the 15 `plain` rows derived from `buildVisualEngine2APool(args.cases)`. Store results by original case order, never completion order. Map provider error kinds through an explicit allowlist; unknown errors become `unexpected_error`. Hash successful intents with `canonicalJsonSha256` but retain full successful selections only in the returned in-memory map. Aggregate usage only when every row provides usage; missing usage must fail with `tokens=null` and cost `null`. Build the 75 eligible rows from the frozen pool and qualified template map only after all 15 rows pass.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run:

```powershell
npm.cmd test -- lib/generation/visual-engine-2a-live-canary.test.ts lib/generation/visual-engine-2a-preflight.test.ts
```

Expected: all tests pass; no network, database or filesystem access occurs.

- [ ] **Step 6: Write RED CLI integration tests**

Update the injected fixture so `select` is expected exactly 15 times. Assert the success order is:

```text
initial quota -> HEAD -> qualification -> recompute -> HEAD -> quota ->
15 provider selections -> atomic live-canary write -> HEAD -> recompute -> HEAD -> quota -> evidence/reservations
```

Assert the written path is `scratch/visual-engine-2a/live-canary.json`, no `preflight.json` write occurs, the artifact precedes all reservations, and `generateEvidence` receives exactly 75 frozen rows. Add failure tests showing all canary and post-write drift cases keep `generateEvidence` and reservations at zero.

- [ ] **Step 7: Integrate the canary into the eval CLI**

Replace only the CLI call to `runVisualEngine2APreflight` with `runVisualEngine2ALiveCanary`. Add `liveCanaryPath(cwd)`. Keep the existing initial and final freshness/quota gates. In production dependencies, replace the scenario-keyed rich-selection cache with a case-keyed cache populated by each successful canary selection; retain the scenario-keyed prepared-build cache because brand/assets scenarios differ. The adaptation seam must read the one case selection and must never invoke intent analysis again.

- [ ] **Step 8: Run CLI integration and regression tests**

Run:

```powershell
npm.cmd test -- lib/generation/visual-engine-2a-live-canary.test.ts lib/generation/visual-engine-2a-eval-cli.integration.test.ts lib/generation/visual-engine-2a-preflight.test.ts lib/generation/visual-engine-2a-eval.test.ts
```

Expected: all tests pass, with `15` selector calls and `75` existing-engine adaptation rows.

- [ ] **Step 9: Update the two operator documents**

Replace the obsolete paid footprint and 75/75 selection-preflight wording with the exact order `stable qualification -> new explicit authorization -> 15/15 live canary -> atomic redacted canary artifact -> post-write freshness/quota gate -> 75 adaptations`. State that the stopped 75-analysis run consumed its authorization, the new code must not be run live yet, and the artifact allowlist/forbidden fields from the design are binding. Preserve blind review, rollback, scorecard and no-reclaim rules.

- [ ] **Step 10: Add documentation contract assertions and verify them**

Extend the existing CLI integration documentation test to require `live-canary.json`, `15/15`, `one intent request per frozen base case`, `maximum concurrency 3`, `75 adaptations`, `reservationCount=0`, and `new explicit approval`; assert obsolete statements about 75 paid intent-analysis calls are absent.

- [ ] **Step 11: Run the complete non-live gate**

Run exactly:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run generation:visual-engine-2a:rollback-check
git diff --check
```

Expected: all repository tests pass; typecheck exits `0`; rollback prints `verified=true`; diff check exits `0`. Do not run qualification, canary, eval, reviewer server, database migration or any live model command.

- [ ] **Step 12: Privacy, scope and commit audit**

Verify tracked/staged changes contain only the six planned files plus a narrowly extracted qualification helper file if Step 4 required it. Confirm no `.env`, scratch artifact, prompt/response, evidence, screenshot, email, secret, absolute path or generated binding is staged. Append an implementation report under `.superpowers/sdd/2026-08-08-openlen-visual-engine-2a-live-canary/`, then commit the scoped implementation:

```powershell
git add lib/generation/visual-engine-2a-live-canary.ts lib/generation/visual-engine-2a-live-canary.test.ts scripts/visual-engine-2a-eval.ts lib/generation/visual-engine-2a-eval-cli.integration.test.ts docs/generation/visual-engine-2a-runbook.md docs/generation/visual-engine-2a-pilot-cohort.md
git commit -m "feat(generation): gate 2A with live canary"
```

- [ ] **Step 13: Independent review and final handoff**

Review the task diff against the design, focusing on call count/concurrency, privacy, strict 15/15 semantics, in-memory reuse, artifact-before-reservation ordering, staleness/quota TOCTOU and preservation of the existing adaptation path. Fix only confirmed Critical/Important findings with TDD and one scoped rereview. Do not add optional hardening. Report that a new paid authorization is still required; do not execute the canary.
