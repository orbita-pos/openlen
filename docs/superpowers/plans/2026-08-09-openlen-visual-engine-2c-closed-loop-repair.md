# OpenLen Visual Engine 2C Closed-Loop Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one fail-open, compiler-bounded visual repair after valid 2A skeleton or 2B composition candidates, with calibrated multi-viewport critique and independent rollout control.

**Architecture:** A shared wrapper renders desktop/mobile, obtains a strict v2 visual verdict, optionally requests one allowlisted repair plan, recompiles through existing Visual Engine safety boundaries, re-renders, and accepts only a proven improvement. `OPENLEN_VISUAL_ENGINE_REPAIR=off|shadow|on` is independent from the existing delivery mode; every failure returns the original candidate byte-for-byte.

**Tech Stack:** TypeScript, Zod, Vitest, `@openlen/ai-gateway`, Puppeteer, `node-html-parser`, existing creative compiler/assets/sanitizer/fingerprint pipeline, Quick SSE/persistence boundary, Drizzle pilot ledger, `@inariwatch/capture`.

## Global Constraints

- Exactly five implementation tasks; do not add optional hardening tasks.
- Eligible input is a successful `template_skeleton` or `section_composition` candidate with current `CreativeDirection` metadata.
- Never alter copy, DOM structure, semantic roles, section order, navigation, forms, scripts, or behaviors.
- Maximum paid work per candidate: two critic calls and one repair call; no retry and no second patch.
- Repair authority is only existing `SkeletonAdaptationPlan` tokens, known hooks/properties, and known replaceable asset slots.
- Critic fallback, provider failure, timeout, invalid schema, failed compiler/sanitizer/render, or non-improvement returns the original HTML and metadata.
- `off` performs zero 2C work; `shadow` never delays or changes delivery; only `on` may deliver a proven repair.
- No extra user-credit debit during pilot/limited rollout.
- Telemetry is scalar/hash-only; never persist brief, copy, HTML, screenshots, image bytes, raw responses, explanations, CSS, provider errors, identity, keys, or local paths.
- `scratch/visual-engine-2c/` is the only local evidence root and must be ignored exactly.
- Qualification is local/read-only. Do not execute the paid eval, deploy, or change flags in this plan.
- Paid smoke cap is 15 cases, at most 33 calls, and at most `30000000` micro-MXN; it requires separate user authorization.

---

## File map

- `lib/generation/visual-repair-contracts.ts` — versioned critic, issue, score, repair metadata, and acceptance schemas.
- `lib/ai/visual-quality-renderer.ts` — SSRF-guarded desktop/mobile capture.
- `lib/ai/visual-quality-critic.ts` — strict v2 multimodal judge with safe usage preservation.
- `lib/generation/generate-visual-repair.ts` — bounded repair-plan provider.
- `lib/generation/apply-visual-repair.ts` — compile/assets/sanitize/fingerprint application boundary.
- `lib/generation/closed-loop-repair.ts` — one-iteration orchestration and acceptance.
- `lib/generation/visual-repair-mode.ts` — independent `off|shadow|on` parser.
- `lib/curate/quick-visual-repair.ts` — Quick on/shadow wrapper with original fallback.
- `lib/generation/visual-engine-2c-*` and `scripts/visual-engine-2c-*` — frozen qualification, smoke, review adapter, and scorecard.

---

### Task 1: Versioned critic contracts and multi-viewport visual input

**Files:**
- Create: `lib/generation/visual-repair-contracts.ts`
- Create: `lib/generation/visual-repair-contracts.test.ts`
- Create: `lib/ai/visual-quality-renderer.ts`
- Create: `lib/ai/visual-quality-renderer.test.ts`
- Create: `lib/ai/visual-quality-critic.ts`
- Create: `lib/ai/visual-quality-critic.test.ts`

**Interfaces:**
- Consumes: `InlineImage`, `StreamRequest`, `StreamEvent`, `IntentAnalysis`, `installSubresourceSsrfGuard`.
- Produces: `VisualQualityVerdictSchema`, `VisualQualityScoresSchema`, `VisualRepairIssueSchema`, `renderVisualQualityViewports()`, `critiqueVisualQuality()`.

- [ ] **Step 1: Write RED schema tests**

Define tests with the exact contract:

```ts
const CLEAN = {
  schemaVersion: "visual-quality-verdict/2.0",
  decision: "keep",
  scores: {
    themeRecognition: 9, visualHierarchy: 8, componentCoherence: 8,
    mobileReadability: 9, imageryRelevance: 8, briefAdherence: 9,
  },
  issues: [],
};

expect(VisualQualityVerdictSchema.parse(CLEAN)).toEqual(CLEAN);
expect(() => VisualQualityVerdictSchema.parse({ ...CLEAN, extra: true })).toThrow();
expect(() => VisualQualityVerdictSchema.parse({
  ...CLEAN,
  issues: [{ code: "arbitrary_css", severity: "critical", explanation: "x" }],
})).toThrow();
```

Cover all seven approved issue codes, score bounds 1..10, 12-issue maximum, known hook IDs, strict keys, and the rule that `keep` has no critical issue while `repair` has at least one repairable issue.

- [ ] **Step 2: Write RED renderer tests**

Inject a fake capture seam and assert exact order/settings:

```ts
const calls: Array<{ width: number; height: number }> = [];
const result = await renderVisualQualityViewports("<!doctype html><html></html>", {
  capture: async (_html, viewport) => {
    calls.push(viewport);
    return { mimeType: "image/jpeg", dataBase64: Buffer.from(String(viewport.width)).toString("base64") };
  },
});
expect(calls).toEqual([{ width: 1280, height: 720 }, { width: 390, height: 844 }]);
expect(result).toMatchObject({ desktop: { mimeType: "image/jpeg" }, mobile: { mimeType: "image/jpeg" } });
```

Also assert either missing capture returns `null`, total decoded bytes are bounded, and production capture installs the subresource SSRF guard before `setContent`.

- [ ] **Step 3: Write RED critic tests**

Use an injected async provider stream. Assert:

```ts
const result = await critiqueVisualQuality({
  intent: INTENT,
  orderedRoles: ["header", "hero", "features", "footer"],
  route: "template_skeleton",
  images: VIEWPORTS,
  model: "critic-test",
  apiKey: "test-only",
}, { provider });

expect(result).toMatchObject({ ok: true, verdict: CLEAN, promptVersion: "visual-quality-critic/2.0" });
expect(provider.stream).toHaveBeenCalledWith(expect.objectContaining({
  images: [VIEWPORTS.desktop, VIEWPORTS.mobile],
  temperature: 0,
  responseMimeType: "application/json",
}));
```

Cover timeout/abort, render absence at caller boundary, malformed JSON, future version, unknown keys, done-error, thrown stream, usage before invalid response, no key/no HTTP call, and prompt privacy (no HTML, URLs, copy, or raw brief).

- [ ] **Step 4: Run RED**

Run:

```powershell
npm.cmd test -- lib/generation/visual-repair-contracts.test.ts lib/ai/visual-quality-renderer.test.ts lib/ai/visual-quality-critic.test.ts
```

Expected: FAIL because the three modules do not exist.

- [ ] **Step 5: Implement strict contracts**

Create Zod schemas and exported types. Use these exact score and issue keys:

```ts
export const VISUAL_QUALITY_VERDICT_VERSION = "visual-quality-verdict/2.0" as const;
export const VISUAL_REPAIR_ISSUE_CODES = [
  "theme_mismatch", "palette_mismatch", "weak_typography_hierarchy",
  "spacing_density", "mobile_overflow", "imagery_mismatch",
  "component_treatment_mismatch",
] as const;

export const VisualQualityScoresSchema = z.object({
  themeRecognition: z.number().int().min(1).max(10),
  visualHierarchy: z.number().int().min(1).max(10),
  componentCoherence: z.number().int().min(1).max(10),
  mobileReadability: z.number().int().min(1).max(10),
  imageryRelevance: z.number().int().min(1).max(10),
  briefAdherence: z.number().int().min(1).max(10),
}).strict();
```

Issue fields are `code`, `severity: "warning"|"critical"`, `hookId: string|null`, and `explanation` bounded to 180 safe non-HTML/non-URL characters. The verdict is strict and uses `decision: "keep"|"repair"|"nonrepairable"`.

- [ ] **Step 6: Implement the renderer**

`renderVisualQualityViewports(html, deps?)` captures desktop then mobile in one Chromium lifecycle. Production must dynamic-import Puppeteer, use `HOME=/tmp`, install `installSubresourceSsrfGuard(page)`, wait for `document.fonts.ready`, cap each JPEG at 1 MiB, close the browser in `finally`, and return `null` on any failure. Tests use `deps.capture` and never launch Chromium.

- [ ] **Step 7: Implement critic v2**

Use one structured gateway call with both images. Build the prompt from an allowlisted intent projection only:

```ts
const criticIntent = {
  domains: input.intent.domains,
  audience: input.intent.audience,
  emotionalGoals: input.intent.emotionalGoals,
  requiredVisualSignals: input.intent.requiredVisualSignals,
  forbiddenVisualSignals: input.intent.forbiddenVisualSignals,
  orderedRoles: input.orderedRoles,
  route: input.route,
};
```

Return a discriminated union `{ok:true, verdict, usage, durationMs, promptVersion, modelId}` or `{ok:false, kind, usage?, durationMs, promptVersion, modelId}`. Preserve safe usage on every post-request failure. Never salvage JSON with prose; strict schema failure is closed to repair.

- [ ] **Step 8: Run GREEN, typecheck, review, commit**

```powershell
npm.cmd test -- lib/generation/visual-repair-contracts.test.ts lib/ai/visual-quality-renderer.test.ts lib/ai/visual-quality-critic.test.ts lib/ai/vision-critique.test.ts
npm.cmd run typecheck
git diff --check
git add -- lib/generation/visual-repair-contracts.ts lib/generation/visual-repair-contracts.test.ts lib/ai/visual-quality-renderer.ts lib/ai/visual-quality-renderer.test.ts lib/ai/visual-quality-critic.ts lib/ai/visual-quality-critic.test.ts
git commit -m "feat(generation): add calibrated visual critic"
```

---

### Task 2: One bounded repair plan and fail-open closed loop

**Files:**
- Create: `lib/generation/generate-visual-repair.ts`
- Create: `lib/generation/generate-visual-repair.test.ts`
- Create: `lib/generation/apply-visual-repair.ts`
- Create: `lib/generation/apply-visual-repair.test.ts`
- Create: `lib/generation/closed-loop-repair.ts`
- Create: `lib/generation/closed-loop-repair.test.ts`

**Interfaces:**
- Consumes: Task 1 verdict/renderer/critic, `SkeletonAdaptationPlanSchema`, `compileSkeletonIdentity`, `resolveSkeletonAssets`, `sanitizeForPublish`, `fingerprintStructure`, current `CreativeDirection`.
- Produces: `generateVisualRepairPlan()`, `applyVisualRepairPlan()`, `runClosedLoopVisualRepair()`, `shouldAttemptVisualRepair()`, `repairImprovesQuality()`.

- [ ] **Step 1: Write RED repair-provider tests**

Assert that the request contains only the current direction, bounded inventory, typed issues, and scores; it must not contain HTML, screenshot bytes, copy, raw brief, storage URL, or persistence capabilities. The response is exactly:

```ts
{
  schemaVersion: "visual-repair-response/1.0",
  plan: {
    schemaVersion: "skeleton-adaptation-plan/1.0",
    tokens: { "--ol-accent": "#E85D9E" },
    cssOverride: [],
    assets: [],
  },
}
```

Cover strict schema, future version, unknown token/hook/property/asset, timeout, HTTP/provider error, usage preservation, and absent key/no request.

- [ ] **Step 2: Write RED compiler-boundary tests**

Assert `applyVisualRepairPlan()`:

- rebuilds inventory from the supplied original;
- applies the current direction plus delta plan through `compileSkeletonIdentity`;
- resolves only known replaceable assets;
- sanitizes;
- preserves structural fingerprint and exact `data-openlen-role` order;
- returns no HTML on any failure.

Use this success assertion:

```ts
expect(result).toMatchObject({
  ok: true,
  structuralFingerprintBefore: "sha256:" + "a".repeat(64),
  structuralFingerprintAfter: "sha256:" + "a".repeat(64),
});
expect(result.html).not.toBe(INPUT.html);
```

- [ ] **Step 3: Write RED orchestration matrix**

Cover:

1. healthy verdict -> original, one critic, zero repair calls;
2. nonrepairable -> original;
3. critic fallback -> original;
4. repair provider failure -> original;
5. compile/assets/sanitize/render failure -> original;
6. final critic fallback -> original;
7. any score decrease -> original;
8. total gain below two -> original;
9. target critical issue remains/new critical issue appears -> original;
10. valid improvement -> repaired HTML and metadata;
11. overall timeout aborts upstream and returns original;
12. exact maximum `critic=2`, `repair=1`, no retry.

For every keep path:

```ts
expect(result.html).toBe(INPUT.html);
expect(result.metadata).toBe(INPUT.metadata);
```

- [ ] **Step 4: Run RED**

```powershell
npm.cmd test -- lib/generation/generate-visual-repair.test.ts lib/generation/apply-visual-repair.test.ts lib/generation/closed-loop-repair.test.ts
```

Expected: FAIL for missing modules.

- [ ] **Step 5: Implement repair provider**

`generateVisualRepairPlan(request, deps?)` uses a strict structured response and `SkeletonAdaptationPlanSchema`. It returns no partial plan. The system prompt must say that the original identity is authoritative and the plan is a delta; brand/explicit constraints remain protected; no HTML/selectors/URLs/scripts/free CSS.

- [ ] **Step 6: Implement compiler boundary**

Use this order exactly:

```ts
inventory = buildSkeletonInventory(input.html, input.sourceId);
compiled = compileSkeletonIdentity({
  html: input.html,
  inventory,
  direction: input.direction,
  plan: input.plan,
  brand: input.brandAccent ? { accent: input.brandAccent } : undefined,
  explicitConstraints: input.explicitConstraints,
});
assets = await resolveSkeletonAssets({ html: compiled.html, inventory, direction: input.direction, plan: input.plan });
sanitized = sanitizeForPublish(assets.html);
after = fingerprintStructure(sanitized.html, { allowedAssetSlots });
```

Require `after === before`, exact semantic roles, exactly one owned Visual Engine style marker, and a successful technical render. Map failures to closed `VisualRepairFailureCode` values without returning provider/compiler messages.

- [ ] **Step 7: Implement acceptance and orchestration**

```ts
export function shouldAttemptVisualRepair(v: VisualQualityVerdict): boolean {
  return v.decision === "repair" && (
    Object.values(v.scores).some((score) => score < 7)
    || v.issues.some((issue) => issue.severity === "critical")
  );
}

export function repairImprovesQuality(before: VisualQualityVerdict, after: VisualQualityVerdict): boolean {
  const keys = Object.keys(before.scores) as Array<keyof VisualQualityScores>;
  return !after.issues.some((issue) => issue.severity === "critical")
    && before.issues.filter((issue) => issue.severity === "critical")
      .every((issue) => !after.issues.some((next) => next.code === issue.code))
    && keys.every((key) => after.scores[key] >= before.scores[key])
    && keys.reduce((sum, key) => sum + after.scores[key] - before.scores[key], 0) >= 2
    && after.scores.themeRecognition >= 7
    && after.scores.briefAdherence >= 7;
}
```

The orchestrator owns one overall `AbortController`, preserves provider usage from every call, returns a redacted trace, and never mutates input.

- [ ] **Step 8: Run GREEN, regress compiler, review, commit**

```powershell
npm.cmd test -- lib/generation/generate-visual-repair.test.ts lib/generation/apply-visual-repair.test.ts lib/generation/closed-loop-repair.test.ts lib/generation/creative-compiler.test.ts lib/generation/skeleton-assets.test.ts lib/generation/structural-fingerprint.test.ts lib/generation/adapt-skeleton.test.ts lib/generation/compose-sections.test.ts
npm.cmd run typecheck
git diff --check
git add -- lib/generation/generate-visual-repair.ts lib/generation/generate-visual-repair.test.ts lib/generation/apply-visual-repair.ts lib/generation/apply-visual-repair.test.ts lib/generation/closed-loop-repair.ts lib/generation/closed-loop-repair.test.ts
git commit -m "feat(generation): repair visual candidates once"
```

---

### Task 3: Independent repair mode and atomic Quick integration

**Files:**
- Create: `lib/generation/visual-repair-mode.ts`
- Create: `lib/generation/visual-repair-mode.test.ts`
- Create: `lib/curate/quick-visual-repair.ts`
- Create: `lib/curate/quick-visual-repair.test.ts`
- Modify: `lib/projects/types.ts`
- Modify: `lib/curate/quick-visual-engine.ts`
- Modify: `lib/curate/quick-visual-engine.test.ts`
- Modify: `lib/curate/quick-section-composition.ts`
- Modify: `lib/curate/quick-section-composition.test.ts`
- Modify: `app/api/curate/route.ts`
- Modify: `lib/curate/curate-route.integration.test.ts`

**Interfaces:**
- Consumes: Task 2 `runClosedLoopVisualRepair`, final 2A/2B candidate HTML/metadata, existing `commitQuickVisualEngineDocument`.
- Produces: `visualRepairMode()`, `runQuickVisualRepair()`, `launchShadowVisualRepair()`, accepted `repair` project metadata.

- [ ] **Step 1: Write RED mode tests**

```ts
expect(parseVisualRepairMode(undefined)).toBe("off");
expect(parseVisualRepairMode("off")).toBe("off");
expect(parseVisualRepairMode("shadow")).toBe("shadow");
expect(parseVisualRepairMode("on")).toBe("on");
expect(parseVisualRepairMode("true")).toBe("off");
```

- [ ] **Step 2: Write RED Quick wrapper tests**

Define `QuickVisualRepairInput` with `html`, existing `VisualEngineProjectMetadata`, intent, brand accent, and explicit constraints. Cover:

- ineligible route or missing direction -> original/no dependency call;
- `off` -> original/no render;
- `on` accepted -> repaired HTML plus redacted `repair` metadata;
- `on` keep/failure -> original byte-for-byte and original metadata reference;
- `shadow` resolves after the caller receives original and has no preview/persist callback;
- capture only redacted exception context;
- no user-credit fields/capability.

- [ ] **Step 3: Write RED route integration tests**

Mock boundaries only (auth/DB/model/template/sections/repair). Assert:

```ts
expect(events).toEqual(["progress:reviewing", "progress:polishing", "preview:final", "persist:final"]);
expect(events).not.toContain("preview:original-before-repair");
expect(persisted.generation.visualEngine.repair.accepted).toBe(true);
```

For shadow, resolve POST before resolving repair work, preserve persisted original, and assert zero repair metadata. For off, preserve existing SSE sequence exactly. For fallback/full routes, assert zero repair calls.

- [ ] **Step 4: Run RED**

```powershell
npm.cmd test -- lib/generation/visual-repair-mode.test.ts lib/curate/quick-visual-repair.test.ts lib/curate/quick-visual-engine.test.ts lib/curate/quick-section-composition.test.ts lib/curate/curate-route.integration.test.ts
```

- [ ] **Step 5: Implement mode and metadata**

Add optional accepted-only metadata to both `VisualEngineProjectMetadata` variants:

```ts
repair?: {
  schemaVersion: "visual-repair-metadata/1.0";
  accepted: true;
  promptVersion: string;
  criticVersion: "visual-quality-verdict/2.0";
  compilerVersion: "creative-direction/1.0";
  issueCodesBefore: VisualRepairIssueCode[];
  issueCodesAfter: VisualRepairIssueCode[];
  scoresBefore: VisualQualityScores;
  scoresAfter: VisualQualityScores;
  outputHashBefore: string;
  outputHashAfter: string;
};
```

Do not persist explanations, usage, screenshots, or rejected-patch metadata in the project.

- [ ] **Step 6: Implement Quick wrappers**

`runQuickVisualRepair(input)` calls Task 2 only for valid metadata. `launchShadowVisualRepair(input)` catches internally, exposes no HTML, and accepts no preview/persist function. Both clone metadata before adding an accepted repair.

- [ ] **Step 7: Integrate the route**

Keep a local-only `repairInput` beside `DeliveredDocument`; never place intent/brief inside project metadata. Immediately before `commitQuickVisualEngineDocument`:

```ts
if (repairMode === "on" && repairInput) {
  emit("progress", { stage: "reviewing" });
  const repaired = await runQuickVisualRepair(repairInput, { onStage: (stage) => emit("progress", { stage }) });
  delivered.html = repaired.html;
  delivered.visualEngine = repaired.visualEngine;
} else if (repairMode === "shadow" && repairInput) {
  void launchShadowVisualRepair(repairInput);
}
```

`shadow` must be scheduled without awaiting it in the SSE path. `on` emits only final preview/persist. Credit calculation remains unchanged.

- [ ] **Step 8: Run GREEN, full Quick regression, review, commit**

```powershell
npm.cmd test -- lib/generation/visual-repair-mode.test.ts lib/curate/quick-visual-repair.test.ts lib/curate/quick-visual-engine.test.ts lib/curate/quick-section-composition.test.ts lib/curate/curate-route.integration.test.ts lib/curate/build-curated-document.test.ts lib/generation/visual-engine-mode.test.ts
npm.cmd run typecheck
npm.cmd run generation:visual-engine-2a:rollback-check
git diff --check
git add -- lib/generation/visual-repair-mode.ts lib/generation/visual-repair-mode.test.ts lib/curate/quick-visual-repair.ts lib/curate/quick-visual-repair.test.ts lib/projects/types.ts lib/curate/quick-visual-engine.ts lib/curate/quick-visual-engine.test.ts lib/curate/quick-section-composition.ts lib/curate/quick-section-composition.test.ts app/api/curate/route.ts lib/curate/curate-route.integration.test.ts
git commit -m "feat(curate): gate visual repair delivery"
```

---

### Task 4: Frozen 15-case qualification and disabled paid smoke

**Files:**
- Create: `lib/generation/visual-engine-2c-cohort.ts`
- Create: `lib/generation/visual-engine-2c-cohort.test.ts`
- Create: `lib/generation/visual-engine-2c-qualification.ts`
- Create: `lib/generation/visual-engine-2c-qualification.test.ts`
- Create: `lib/generation/visual-engine-2c-qualify-cli.test.ts`
- Create: `scripts/visual-engine-2c-qualify.ts`
- Create: `lib/generation/visual-engine-2c-eval.ts`
- Create: `lib/generation/visual-engine-2c-eval.test.ts`
- Create: `lib/generation/visual-engine-2c-eval-cli.integration.test.ts`
- Create: `scripts/visual-engine-2c-eval.ts`
- Create: `scripts/visual-engine-2c-review.ts`
- Create: `scripts/visual-engine-2c-scorecard.ts`
- Modify: `package.json`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: Tasks 1–3, phase `2c` pilot store, shared budget/rate-card/evidence/reviewer infrastructure.
- Produces: deterministic qualification manifest, guarded eval, hash-bound blind-review source, and 2C scorecard.

- [ ] **Step 1: Write RED cohort tests**

Freeze exactly 15 synthetic rows:

- six `healthy_keep` (three skeleton, three composition);
- six `repairable` with one of the approved issue codes (three skeleton, three composition);
- three `nonrepairable_or_fallback`.

Each row stores synthetic intent, route, deterministic HTML fixture ID, expected initial decision, expected call ceiling, and expected delivery. Assert distinct IDs, balanced routes, exact class counts, no URL/email/key/absolute path/user identity, and no raw screenshot bytes.

- [ ] **Step 2: Write RED qualification tests**

Qualification calls only local contracts/compiler with injected deterministic verdicts and repair plans:

```ts
const result = await qualifyVisualEngine2CCohort({
  cases: VISUAL_ENGINE_2C_CASES,
  buildFixture: LOCAL_FIXTURES,
  evaluate: LOCAL_RESULTS,
  commitSha: "a".repeat(40),
});
expect(result).toMatchObject({ ok: true, counts: { total: 15, keep: 6, repairable: 6, nonrepairable: 3 } });
expect(JSON.stringify(result.manifest)).not.toMatch(/html|dataBase64|brief|explanation/i);
```

Manifest fields are versions, HEAD, case IDs, route/class, input/output hashes, result codes, call ceilings, counts, and canonical self-hash only.

- [ ] **Step 3: Write RED paid-runner tests**

The injected runner must refuse before provider/renderer/reservation unless all hold:

- `OPENLEN_VISUAL_ENGINE_REPAIR=shadow`;
- exact one-time token `AUTHORIZED_2C_SMOKE_ONCE`;
- current self-hash-valid qualification and matching HEAD;
- phase `2c` ledger has `limit=150`, `used=0`, `existingRuns=0`;
- complete rate card;
- `OPENLEN_VISUAL_ENGINE_2C_PILOT_BUDGET_MICROMXN` is integer `1..30000000`;
- maximum 15 reservations and 33 provider calls;
- second HEAD/quota gate immediately before first reservation.

Assert sequential order, no retry/replacement, complete scalar cost for every reserved row, one completion per reservation, and one redacted terminal record.

- [ ] **Step 4: Write RED evidence/review/scorecard tests**

Reuse the hash-bound evidence/session/server primitives; adapt 2C original/repaired desktop/mobile pairs to the existing blind pair DTO. Validate that review covers every accepted repair and no rejected/healthy row. Scorecard gates:

```ts
expect(scoreVisualEngine2CPilot(rows, decisions, { budgetMicromxn: 30_000_000 })).toEqual(expect.objectContaining({
  passed: true,
  technicalIntegrity: true,
  healthyReplacementCount: 0,
  allowlistViolationCount: 0,
  humanPreferredOrTiedRate: expect.any(Number),
  costCoverage: 1,
}));
```

Require preferred-or-tied rate `>=0.80`, zero healthy replacements, zero technical/allowlist/structure/copy/role/navigation/identity violations, complete costs, and total `<= budget`.

- [ ] **Step 5: Run RED**

```powershell
npm.cmd test -- lib/generation/visual-engine-2c-cohort.test.ts lib/generation/visual-engine-2c-qualification.test.ts lib/generation/visual-engine-2c-qualify-cli.test.ts lib/generation/visual-engine-2c-eval.test.ts lib/generation/visual-engine-2c-eval-cli.integration.test.ts
```

- [ ] **Step 6: Implement local qualification and CLI**

Write ignored `scratch/visual-engine-2c/qualification.json` atomically. Capture HEAD before and after; reject movement. Production qualification may read only published template/section material needed to verify fixture compatibility; it must not import provider modules or write DB.

- [ ] **Step 7: Implement guarded eval without running it**

Use a pure environment guard before importing DB/provider modules. The runner reserves phase `2c` immediately before the first paid call for a row, shares one per-row budget lease across critic/patch/critic, writes only hash-bound local evidence, and completes the scalar ledger once. Any ambiguous cost settles conservatively at the configured per-row ceiling.

- [ ] **Step 8: Implement review adapter and scorecard**

`generation:visual-engine-2c:review` reuses the loopback/tokenized reviewer UI and persists identity/session only under ignored 2C scratch. `generation:visual-engine-2c:scorecard` reads phase `2c` ledger plus verified manifests and decisions; it never reads HTML or raw responses.

- [ ] **Step 9: Register commands and privacy root**

Add:

```json
"generation:visual-engine-2c:qualify": "tsx --env-file=.env.local --tsconfig tsconfig.eval.json --require ./scripts/test-node-server-only-shim.cjs scripts/visual-engine-2c-qualify.ts",
"generation:visual-engine-2c:eval": "tsx --env-file=.env.local --tsconfig tsconfig.eval.json --require ./scripts/test-node-server-only-shim.cjs scripts/visual-engine-2c-eval.ts",
"generation:visual-engine-2c:review": "tsx --env-file=.env.local --tsconfig tsconfig.eval.json --require ./scripts/test-node-server-only-shim.cjs scripts/visual-engine-2c-review.ts",
"generation:visual-engine-2c:scorecard": "tsx --env-file=.env.local --tsconfig tsconfig.eval.json --require ./scripts/test-node-server-only-shim.cjs scripts/visual-engine-2c-scorecard.ts"
```

Add exact `.gitignore` rule `/scratch/visual-engine-2c/`.

- [ ] **Step 10: Run GREEN, privacy audit, commit**

```powershell
npm.cmd test -- lib/generation/visual-engine-2c-cohort.test.ts lib/generation/visual-engine-2c-qualification.test.ts lib/generation/visual-engine-2c-qualify-cli.test.ts lib/generation/visual-engine-2c-eval.test.ts lib/generation/visual-engine-2c-eval-cli.integration.test.ts lib/generation/visual-engine-pilot-store.test.ts lib/generation/visual-engine-pilot-budget.test.ts lib/generation/visual-engine-2a-review-session.test.ts
npm.cmd run typecheck
git diff --check
git check-ignore -v scratch/visual-engine-2c/qualification.json
git add -- .gitignore package.json lib/generation/visual-engine-2c-cohort.ts lib/generation/visual-engine-2c-cohort.test.ts lib/generation/visual-engine-2c-qualification.ts lib/generation/visual-engine-2c-qualification.test.ts lib/generation/visual-engine-2c-qualify-cli.test.ts lib/generation/visual-engine-2c-eval.ts lib/generation/visual-engine-2c-eval.test.ts lib/generation/visual-engine-2c-eval-cli.integration.test.ts scripts/visual-engine-2c-qualify.ts scripts/visual-engine-2c-eval.ts scripts/visual-engine-2c-review.ts scripts/visual-engine-2c-scorecard.ts
git commit -m "test(generation): qualify Visual Engine 2C repair"
```

Do not run `generation:visual-engine-2c:eval`.

---

### Task 5: Rollback, runbook, complete regression, and release gate

**Files:**
- Modify: `scripts/visual-engine-2a-rollback-check.ts`
- Modify: `lib/generation/visual-engine-2a-eval.test.ts`
- Modify: `docs/generation/visual-engine-2a-runbook.md`
- Create: `lib/generation/visual-engine-2c-runbook-contract.test.ts`

**Interfaces:**
- Consumes: all Tasks 1–4.
- Produces: five-engine-mode plus three-repair-mode rollback evidence, current operator commands, and final release evidence.

- [ ] **Step 1: Write RED rollback tests**

Capture the matrix without provider/DB:

| Main mode | Repair mode | Expected delivery | 2C calls |
| --- | --- | --- | ---: |
| off | off/on/shadow | weighted legacy | 0 |
| skeleton | off | 2A original | 0 |
| composition | off | 2A/2B original | 0 |
| skeleton | shadow | 2A original, detached diagnostic | bounded |
| composition | shadow | 2A/2B original, detached diagnostic | bounded |
| skeleton | on | repaired only if accepted | bounded |
| composition | on | repaired only if accepted | bounded |

Assert both environment variables restore in `finally`, unset repair equals off repair, shadow delivery hashes equal original, rejected on hashes equal original, and accepted on changes only HTML plus accepted repair metadata.

- [ ] **Step 2: Write RED runbook contract test**

Require the runbook to contain exact flag values, four package commands, `30000000`, `AUTHORIZED_2C_SMOKE_ONCE`, 15/33 limits, privacy path, no retry, separate rollout approval, immediate off rollback, and explicit “controlled-scratch is out of scope”.

- [ ] **Step 3: Implement rollback fixture and runbook**

Extend the current fixture without network/DB. Preserve 2A evidence compatibility and add a separate 2C evidence block rather than changing historical 2A hashes. Document qualification, authorization boundary, review, scorecard, incident response, cost audit, and forbidden artifacts.

- [ ] **Step 4: Run focused 2A/2B/2C gate**

```powershell
npm.cmd test -- lib/generation/visual-repair-contracts.test.ts lib/ai/visual-quality-renderer.test.ts lib/ai/visual-quality-critic.test.ts lib/generation/generate-visual-repair.test.ts lib/generation/apply-visual-repair.test.ts lib/generation/closed-loop-repair.test.ts lib/generation/visual-repair-mode.test.ts lib/curate/quick-visual-repair.test.ts lib/curate/quick-visual-engine.test.ts lib/curate/quick-section-composition.test.ts lib/curate/curate-route.integration.test.ts lib/generation/visual-engine-2c-cohort.test.ts lib/generation/visual-engine-2c-qualification.test.ts lib/generation/visual-engine-2c-qualify-cli.test.ts lib/generation/visual-engine-2c-eval.test.ts lib/generation/visual-engine-2c-eval-cli.integration.test.ts lib/generation/visual-engine-2c-runbook-contract.test.ts lib/generation/adapt-skeleton.test.ts lib/generation/compose-sections.test.ts lib/generation/visual-engine-2a-eval.test.ts
npm.cmd run typecheck
npm.cmd run generation:visual-engine-2a:rollback-check
```

- [ ] **Step 5: Run full non-live suite once**

```powershell
npm.cmd test
npm.cmd run typecheck
git diff --check
```

No live critic, eval, deploy, or flag command is allowed in this step.

- [ ] **Step 6: Commit operational close**

```powershell
git add -- scripts/visual-engine-2a-rollback-check.ts lib/generation/visual-engine-2a-eval.test.ts docs/generation/visual-engine-2a-runbook.md lib/generation/visual-engine-2c-runbook-contract.test.ts
git diff --cached --check
git commit -m "docs(generation): operationalize Visual Engine 2C repair"
```

- [ ] **Step 7: Qualify twice on exact final HEAD**

```powershell
npm.cmd run generation:visual-engine-2c:qualify
Get-FileHash -Algorithm SHA256 scratch/visual-engine-2c/qualification.json
npm.cmd run generation:visual-engine-2c:qualify
Get-FileHash -Algorithm SHA256 scratch/visual-engine-2c/qualification.json
```

Expected: both qualification runs pass and both file hashes are identical.

- [ ] **Step 8: Final privacy and scope audit**

```powershell
git status --short --untracked-files=no
git diff --check
git diff --cached --check
git check-ignore -v scratch/visual-engine-2c/qualification.json
git log -5 --oneline
```

Confirm exactly five 2C implementation commits, tracked status clean, and no `.env*`, scratch artifact, screenshot, HTML, raw response, identity, key, generated binding, or unrelated user file was committed.

- [ ] **Step 9: One release review and stop**

Review only Critical/Important correctness, security, privacy, fail-open byte identity, atomicity, cost completeness, timeout abortion, and rollout findings. Fix only confirmed release blockers with focused RED/GREEN tests and rerun the affected gate once. Do not open optional hardening tasks.

## Completion handoff

When all five tasks pass, report separately:

1. 2C implementation status;
2. exact non-live verification evidence;
3. qualification hash;
4. confirmation that paid smoke, deploy, and flags were not executed;
5. the still-closed authorization required before `generation:visual-engine-2c:eval`.
