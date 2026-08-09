# OpenLen Visual Engine Staged Paid Smoke Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ejecutar un smoke pilot 2A de 15 casos con un techo conservador e inquebrantable de MXN 30 antes de comenzar 2B.

**Architecture:** Un ledger presupuestario in-memory, exclusivo del runner 2A, reserva costo máximo antes de cada operación pagada y reconcilia únicamente usage validado. El canary sigue siendo 15/15; después se ejecuta una sola fila `plain` por caso y el runner persiste un resumen redactado. No cambia ninguna ruta de producción.

**Tech Stack:** TypeScript, Vitest, Node.js, contratos Zod existentes, Gemini gateway existente, PostgreSQL ledger existente.

## Global Constraints

- Límite exacto: `30_000_000` micro-MXN para todo el proceso 2A.
- Exactamente 15 análisis live y, tras canary 15/15, exactamente 15 filas `plain`.
- Cero retries pagados, cero reemplazos, cero reclaim de cuota.
- Usage ausente o inválido conserva toda la reserva máxima.
- Ninguna llamada comienza si su reserva máxima puede superar el techo.
- No cambiar Quick, flags globales, thresholds, metadata ni contratos de usuario.
- No enviar briefs, HTML, copy, capturas o respuestas a ningún proveedor durante implementación o tests.
- No ejecutar el piloto live hasta verificación completa y confirmación operativa final.

---

### Task 1: Ledger presupuestario conservador

**Files:**
- Create: `lib/generation/visual-engine-pilot-budget.ts`
- Test: `lib/generation/visual-engine-pilot-budget.test.ts`
- Modify: `lib/generation/model-cost.ts`
- Test: `lib/generation/model-cost.test.ts`

**Interfaces:**
- Produces: `createPilotBudgetGuard(config): PilotBudgetGuard`.
- Produces: `guard.acquire(role, maximumUsage): PilotBudgetLease | null`.
- Produces: `lease.settle(actualUsage | undefined)` and `guard.snapshot()`.
- Uses: `calculateModelCostMicros()` and the frozen `PilotRateCardConfig`.

- [ ] **Step 1: Write RED tests for accounting and concurrency**

Add cases proving exact `30_000_000`, rejection at `30_000_001`, atomic acquisition under concurrent promises, idempotent settlement, actual-cost reconciliation, and full reservation retention for missing/negative/fractional usage.

```ts
const guard = createPilotBudgetGuard({ limitMicromxn: 30_000_000, rateCard });
const a = guard.acquire("intent", INTENT_MAX_USAGE);
expect(a).not.toBeNull();
expect(guard.acquire("creative", OVER_REMAINING_MAX)).toBeNull();
a!.settle(actualUsage);
expect(guard.snapshot().verifiedCostMicromxn).toBe(expectedActual);
```

- [ ] **Step 2: Run RED**

Run: `npm.cmd test -- lib/generation/visual-engine-pilot-budget.test.ts lib/generation/model-cost.test.ts`

Expected: FAIL because the budget module and maximum-cost helper do not exist.

- [ ] **Step 3: Implement the minimal ledger**

Use integer micro-MXN only. `acquire()` synchronously moves maximum cost from available to reserved. `settle()` is exactly-once; valid usage moves actual cost to verified and releases only the verified difference. Missing/invalid usage moves the full reservation to conservative spend. Once an acquisition is rejected, `exhausted` is terminal.

```ts
export type PilotBudgetRole = "intent" | "baseline" | "creative" | "critic" | "patch";
export interface PilotBudgetSnapshot {
  limitMicromxn: number;
  reservedMicromxn: number;
  verifiedCostMicromxn: number;
  conservativeCostMicromxn: number;
  availableMicromxn: number;
  exhausted: boolean;
  requests: Record<PilotBudgetRole, { acquired: number; settled: number; rejected: number; incomplete: number }>;
}
```

`maximumUsage` must be computed from the actual configured input byte upper bound, image-tile upper bound, `maxOutputTokens` and `thinkingBudget`. Tests must reject any operation whose request limits exceed the declared envelope.

- [ ] **Step 4: Run GREEN and typecheck**

Run: `npm.cmd test -- lib/generation/visual-engine-pilot-budget.test.ts lib/generation/model-cost.test.ts`

Run: `npm.cmd run typecheck`

Expected: all pass.

- [ ] **Step 5: Commit Task 1**

```powershell
git add -- lib/generation/visual-engine-pilot-budget.ts lib/generation/visual-engine-pilot-budget.test.ts lib/generation/model-cost.ts lib/generation/model-cost.test.ts
git commit -m "feat(generation): cap paid visual engine pilots"
```

---

### Task 2: Canary y adaptación reducida bajo el mismo guard

**Files:**
- Modify: `lib/generation/visual-engine-2a-live-canary.ts`
- Test: `lib/generation/visual-engine-2a-live-canary.test.ts`
- Modify: `lib/generation/visual-engine-2a-eval.ts`
- Test: `lib/generation/visual-engine-2a-eval.test.ts`
- Modify: `scripts/visual-engine-2a-eval.ts`
- Test: `lib/generation/visual-engine-2a-eval-cli.integration.test.ts`

**Interfaces:**
- Consumes: `PilotBudgetGuard` from Task 1.
- Produces: `buildVisualEngine2ASmokeRows(eligible): readonly QualifiedPilotRow[]` containing 15 unique case IDs and only `scenarioId === "plain"`.
- Produces: `generateVisualEngine2ASmokeEvidence()` with exact 15-row cardinality.
- Extends CLI result with redacted `budget` snapshot.

- [ ] **Step 1: Write RED tests for the reduced cohort**

Assert that a successful canary returns 75 qualified rows for compatibility but the smoke reducer selects exactly 15 `plain` rows, preserves qualified template IDs, has one row per case, and rejects duplicates/missing cases/non-plain rows.

```ts
const smoke = buildVisualEngine2ASmokeRows(canary.eligible);
expect(smoke).toHaveLength(15);
expect(new Set(smoke.map((row) => row.caseId)).size).toBe(15);
expect(smoke.every((row) => row.scenarioId === "plain")).toBe(true);
```

- [ ] **Step 2: Write RED integration tests for ordering and budget failure**

Cover: qualification → canary 15/15 → artifact write → final freshness/quota gate → smoke reduction → exactly 15 reservations. Inject a guard that rejects the first canary call and another that rejects adaptation 8; assert no later provider call or DB reservation occurs and the terminal code is `budget_exhausted`.

- [ ] **Step 3: Run RED**

Run: `npm.cmd test -- lib/generation/visual-engine-2a-live-canary.test.ts lib/generation/visual-engine-2a-eval.test.ts lib/generation/visual-engine-2a-eval-cli.integration.test.ts`

Expected: FAIL on missing smoke reducer/runner and absent budget boundary.

- [ ] **Step 4: Wire leases to every paid high-level operation**

Pass the same guard instance through canary selection and evidence generation. Acquire before the provider boundary and before the matching DB `reserve()`. Settle from typed usage returned by intent, baseline fill, creative direction, critic and patch calls. A missing usage settles conservatively and makes the smoke result ineligible for automatic pass.

Do not use average cost or prior rows to authorize a request. Do not call `reserveVisualEnginePilotRun()` until the row-level maximum envelope is acquired.

- [ ] **Step 5: Implement the 15-row smoke runner**

Keep the existing 75-row full runner intact for future integrated evaluation. Add a separate exact-cardinality entry point rather than weakening `VISUAL_ENGINE_2A_PILOT_SIZE` globally.

```ts
export const VISUAL_ENGINE_2A_SMOKE_SIZE = 15;
export async function generateVisualEngine2ASmokeEvidence(args: SmokeEvidenceArgs) {
  if (args.eligible.length !== VISUAL_ENGINE_2A_SMOKE_SIZE) {
    throw new Error("smoke pilot requires exactly 15 plain rows");
  }
  return generateBoundedEvidence(args);
}
```

- [ ] **Step 6: Run GREEN, regressions and typecheck**

Run: `npm.cmd test -- lib/generation/visual-engine-pilot-budget.test.ts lib/generation/visual-engine-2a-live-canary.test.ts lib/generation/visual-engine-2a-eval.test.ts lib/generation/visual-engine-2a-eval-cli.integration.test.ts lib/generation/adapt-skeleton.test.ts lib/ai/vision-critique.test.ts`

Run: `npm.cmd run typecheck`

Expected: all pass; zero external calls.

- [ ] **Step 7: Commit Task 2**

```powershell
git add -- lib/generation/visual-engine-2a-live-canary.ts lib/generation/visual-engine-2a-live-canary.test.ts lib/generation/visual-engine-2a-eval.ts lib/generation/visual-engine-2a-eval.test.ts scripts/visual-engine-2a-eval.ts lib/generation/visual-engine-2a-eval-cli.integration.test.ts
git commit -m "feat(generation): run bounded 2A smoke cohort"
```

---

### Task 3: Evidencia, runbook y gate no-live final

**Files:**
- Modify: `docs/generation/visual-engine-2a-runbook.md`
- Modify: `docs/generation/visual-engine-2a-pilot-cohort.md`
- Modify: `lib/generation/visual-engine-2a-runbook-contract.test.ts`
- Modify: `lib/generation/visual-engine-2a-cohort-ops-contract.test.ts`
- Modify: `scripts/visual-engine-2a-scorecard.ts`
- Test: `lib/generation/visual-engine-2a-eval.test.ts`

**Interfaces:**
- Consumes: redacted `PilotBudgetSnapshot` and 15-row smoke evidence.
- Produces: smoke scorecard requiring 15 starts, at least 14 technical completions, all completions reviewed, at least 12 visual wins, zero protected failures and complete conservative cost evidence.

- [ ] **Step 1: Write RED contract and scorecard tests**

Assert the documented `30_000_000` cap, `15 plain`, `14 technical`, `12 visual`, remaining quota 60, and prohibition on calling this a production rollout gate. Assert scorecard failure for 13 technical, 11 wins, missing review, missing usage, structural failure or cost above the cap.

- [ ] **Step 2: Run RED**

Run: `npm.cmd test -- lib/generation/visual-engine-2a-runbook-contract.test.ts lib/generation/visual-engine-2a-cohort-ops-contract.test.ts lib/generation/visual-engine-2a-eval.test.ts`

Expected: FAIL on obsolete 75-row operational language and missing smoke scorecard.

- [ ] **Step 3: Implement redacted artifact and documentation**

The artifact may contain only versions/hashes, scalar IDs, role counters, integer token usage, micro-MXN fields and status/reason codes. Update the runbook with the exact command, required env, preflight checks, expected `used=0` before execution and `used=15` only after all 15 starts.

- [ ] **Step 4: Run the complete non-live release gate**

Run: `npm.cmd test`

Run: `npm.cmd run typecheck`

Run: `npm.cmd run generation:visual-engine-2a:rollback-check`

Run: `git diff --check`

Expected: all pass; rollback reports `verified=true`; no model/DB writes.

- [ ] **Step 5: Audit privacy and repository state**

Confirm no `.env*`, API key, raw response, screenshot, HTML, email, absolute path, reviewer identity or `scratch/visual-engine-2a/**` is staged. Preserve all pre-existing untracked user files.

- [ ] **Step 6: Commit Task 3**

```powershell
git add -- docs/generation/visual-engine-2a-runbook.md docs/generation/visual-engine-2a-pilot-cohort.md lib/generation/visual-engine-2a-runbook-contract.test.ts lib/generation/visual-engine-2a-cohort-ops-contract.test.ts scripts/visual-engine-2a-scorecard.ts lib/generation/visual-engine-2a-eval.test.ts
git commit -m "docs(generation): operationalize bounded 2A smoke pilot"
```

---

## Post-implementation operational gate

After all three tasks pass and receive code review:

1. rerun qualification twice and verify identical self-hash;
2. inspect quota `limit=75`, `used=0`, `existingRuns=0`;
3. freeze the official Gemini rate card and exchange rate already selected;
4. show the exact command and expected maximum to the user;
5. obtain final confirmation for one paid execution;
6. execute once with `OPENLEN_VISUAL_ENGINE=shadow` and `OPENLEN_VISUAL_ENGINE_PILOT_BUDGET_MICROMXN=30000000` set only for that process;
7. stop after evidence generation and request blind human review;
8. score only after all technical successes are reviewed.
