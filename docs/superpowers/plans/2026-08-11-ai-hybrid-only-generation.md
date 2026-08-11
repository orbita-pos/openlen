# AI Hybrid-Only Generation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every OpenLen “Create with AI” request deliver a validated section composition or a typed retryable error, while preserving whole-template cloning only for the explicit template-gallery action.

**Architecture:** Replace Quick's catalog-aware picker and whole-template fallbacks with a copy-only Gemini boundary and a single `runAiCreation` pipeline. The pipeline composes verified section fragments, applies the existing Visual Engine/assets, requires a strict 2C quality result, seals and validates final provenance, and only then persists and previews. `/api/projects/from-template` remains the sole whole-template loader.

**Tech Stack:** Next.js 15 route handlers, TypeScript, Vitest, Zod, `node-html-parser`, Drizzle/Postgres boundaries, Gemini REST `generateContent`, existing OpenLen 2B/2C/assets engines.

## Global Constraints

- “Create with AI” may only succeed with `route: "section_composition"` and `templateId: null`.
- `weighted`, `template_full`, `template_skeleton`, and whole-template fallback delivery are forbidden from `/api/curate`.
- `/api/projects/from-template` remains functionally unchanged and is the only explicit whole-template clone path.
- Any intent, copy, composition, asset, semantic, visual, or persistence failure is fail-closed: no fallback HTML, no partial preview, no `done`, and no user-credit debit.
- The first preview is the final validated HTML and occurs only after the project insert succeeds.
- No raw Gemini response, prompt, brief, copy, HTML, credential, private URL, or user identity may enter operational telemetry.
- No new provider or npm dependency is introduced.
- Paid/live validation requires an explicit MXN limit immediately before execution; deterministic tests use no network or production DB.
- Existing 2A/2B/2C/assets pilots remain available for evaluation, but production Quick no longer imports their legacy template-delivery adapters.

---

## File Map

| File | Responsibility |
|---|---|
| `lib/curate/generate-page-copy.ts` | Copy-only Gemini contract; no template catalog or raw response |
| `lib/curate/generate-page-copy.test.ts` | Provider, timeout, schema, usage, and redaction tests |
| `lib/curate/finalize-composed-document.ts` | Brand/meta/sanitize finalizer with no template-store dependency |
| `lib/curate/finalize-composed-document.test.ts` | Finalization and marker-leak contract |
| `lib/curate/quick-section-composition.ts` | Fail-closed wrapper around existing 2B composer |
| `lib/curate/quick-section-composition.test.ts` | Success and typed-failure atomicity |
| `lib/generation/section-inventory.ts` | Require authoritative section storage and reject full-document bytes disguised as fragments |
| `lib/generation/section-inventory.test.ts` | Section namespace, single-root fragment, and stale-byte provenance tests |
| `lib/generation/section-composition-contracts.ts` | Add the typed invalid-fragment failure code |
| `lib/generation/section-composition-contracts.test.ts` | Manifest/result-code regression coverage |
| `lib/curate/ai-composition-delivery.ts` | Seal and validate final hybrid provenance, roles, markers, hashes, and assets |
| `lib/curate/ai-composition-delivery.test.ts` | One-mutation-per-invariant delivery tests |
| `lib/curate/quick-visual-repair.ts` | Add strict visual-quality gate while preserving legacy pilot helper |
| `lib/curate/quick-visual-repair.test.ts` | Healthy, repaired, nonrepairable, timeout, and provider-failure behavior |
| `lib/curate/ai-creation-contracts.ts` | Stable stages, reason codes, success/failure result types, policy version |
| `lib/curate/run-ai-creation.ts` | Copy+intent barrier, sections, 2B, delivery gates, and strict 2C orchestration |
| `lib/curate/run-ai-creation.test.ts` | Orchestrator order and failure matrix |
| `lib/curate/ai-creation-mode.ts` | Exact `enabled|disabled` kill switch; disabled by default |
| `lib/curate/ai-creation-mode.test.ts` | Kill-switch parser contract |
| `lib/curate/ai-creation-credits.ts` | Copy-usage credit calculation with no legacy template imports |
| `lib/curate/ai-creation-credits.test.ts` | Existing billing-formula compatibility and bounds |
| `lib/curate/commit-ai-composition.ts` | Require hybrid metadata; insert before final preview |
| `lib/curate/commit-ai-composition.test.ts` | Persistence/preview ordering and DB-failure atomicity |
| `app/api/curate/route.ts` | Thin auth/rate/credit/SSE adapter over `runAiCreation` |
| `lib/curate/curate-route.integration.test.ts` | Real POST behavior with injected external boundaries |
| `lib/use-curation.ts` | Accurate progress copy for analyze/compose/review stages |
| `lib/generation/ai-hybrid-niche-cohort.ts` | Seven deterministic niche cases |
| `lib/generation/ai-hybrid-niche-cohort.test.ts` | Intent/roles/signals contract for all seven cases |
| `lib/curate/ai-hybrid-import-boundary.test.ts` | Traverse the production TypeScript import graph and prove no whole-template dependency is reachable |
| `lib/curate/ai-hybrid-regression.test.ts` | Mundo Pincel/Lyceum and niche residue regressions |
| `lib/curate/explicit-template-clone-contract.test.ts` | Preserve the separate, user-selected whole-template clone behavior |
| `docs/generation/ai-hybrid-only-runbook.md` | Flags, failure semantics, gates, rollout, rollback, and canary |
| `lib/curate/ai-hybrid-runbook-contract.test.ts` | Runbook and package-command contract |
| `package.json` | Focused release-gate command |
| `infra/scripts/deploy.ps1` | Run focused hybrid gate and typecheck before build |

### Task 1: Copy-only Gemini boundary

**Files:**
- Create: `lib/curate/generate-page-copy.ts`
- Create: `lib/curate/generate-page-copy.test.ts`
- Reference only: `lib/curate/pick-template.ts`
- Reference only: `lib/generation/analyze-intent.ts`

**Interfaces:**
- Consumes: `LenientBusinessDataSchema`, `ExtractedBusinessData`, `ModelTokenUsage`, `GEMINI_API_KEY`.
- Produces:

```ts
export const PAGE_COPY_PROMPT_VERSION = "page-copy-prompt/1.0" as const;
export const PAGE_COPY_TIMEOUT_MS = 12_000;

export type GeneratePageCopyFailureKind =
  | "invalid_input"
  | "missing_key"
  | "timeout"
  | "aborted"
  | "http"
  | "provider"
  | "parse"
  | "schema";

export type GeneratePageCopyResult =
  | {
      ok: true;
      copy: ExtractedBusinessData;
      modelId: string;
      promptVersion: typeof PAGE_COPY_PROMPT_VERSION;
      usage?: ModelTokenUsage;
      durationMs: number;
    }
  | {
      ok: false;
      error: { kind: GeneratePageCopyFailureKind; message: string };
      modelId: string;
      promptVersion: typeof PAGE_COPY_PROMPT_VERSION;
      usage?: ModelTokenUsage;
      durationMs: number;
    };

export function generatePageCopy(
  brief: string,
  options?: {
    apiKey?: string;
    modelId?: string;
    signal?: AbortSignal;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    now?: () => number;
  },
): Promise<GeneratePageCopyResult>;
```

- [ ] **Step 1: Write provider-contract tests before production code**

Create table-driven tests that assert:

```ts
expect(JSON.stringify(requestBody)).not.toMatch(
  /templateIds|CATALOG|family=|screenshot|Lyceum|pitch/i,
);
expect(result).toMatchObject({
  ok: true,
  copy: { business_name: "Mundo Pincel" },
  promptVersion: "page-copy-prompt/1.0",
  usage: { inputTokens: 21, outputTokens: 13, cachedTokens: 0, thinkingTokens: 0 },
});
expect(JSON.stringify(result)).not.toMatch(/raw|secret-key|private response/i);
```

Cover blank input, missing key, already-aborted signal, timeout while fetching, timeout while parsing `response.json()`, HTTP failure, network failure, malformed JSON, invalid envelope, invalid copy schema, unsafe usage counters, and success without usage.

- [ ] **Step 2: Run the focused RED**

Run:

```powershell
npm.cmd test -- lib/curate/generate-page-copy.test.ts
```

Expected: FAIL at collection because `./generate-page-copy` does not exist.

- [ ] **Step 3: Implement the strict copy provider**

Use a strict envelope and no raw field:

```ts
const PageCopyEnvelopeSchema = z.object({
  schemaVersion: z.literal("page-copy/1.0"),
  copy: LenientBusinessDataSchema,
}).strict();

const modelId = options.modelId
  ?? process.env.OPENLEN_PAGE_COPY_MODEL
  ?? process.env.CURATE_PICK_MODEL
  ?? process.env.STYLE_MATCH_TEXT_MODEL
  ?? "gemini-2.5-flash";
```

Copy only the existing invention rules from `pick-template.ts`; remove every picker/catalog instruction. Follow `analyze-intent.ts` for AbortController composition, safe usage parsing, redacted errors, and a timer that remains active through `response.json()`.

- [ ] **Step 4: Verify Task 1 GREEN**

Run:

```powershell
npm.cmd test -- lib/curate/generate-page-copy.test.ts lib/generation/analyze-intent.test.ts
npm.cmd run typecheck
git diff --check
```

Expected: all tests pass; typecheck and diff-check exit `0`.

- [ ] **Step 5: Commit Task 1**

```powershell
git add lib/curate/generate-page-copy.ts lib/curate/generate-page-copy.test.ts
git commit -m "feat(curate): generate copy without template catalog"
```

### Task 2: Make the 2B delivery wrapper fail closed

**Files:**
- Create: `lib/curate/finalize-composed-document.ts`
- Create: `lib/curate/finalize-composed-document.test.ts`
- Modify: `lib/curate/quick-section-composition.ts`
- Modify: `lib/curate/quick-section-composition.test.ts`
- Modify: `lib/generation/section-inventory.ts`
- Modify: `lib/generation/section-inventory.test.ts`
- Modify: `lib/generation/section-composition-contracts.ts`
- Modify: `lib/generation/section-composition-contracts.test.ts`

**Interfaces:**
- Consumes: `composeSectionCandidate`, `SectionCompositionManifestSchema`, `seedBrandIntoHtml`, `ensurePageMeta`, `sanitizeForPublish`, `sha256`.
- Produces:

```ts
export function finalizeComposedDocument(input: {
  html: string;
  profileData: BusinessProfileData;
  title: string;
}): { ok: true; html: string } | { ok: false; reasonCode: "sanitization_failed" };

export type QuickSectionCompositionResult =
  | ({
      ok: true;
      route: "section_composition";
      templateId: null;
      html: string;
      visualEngine: Extract<VisualEngineProjectMetadata, { route: "section_composition" }>;
    } & DeliveryData)
  | {
      ok: false;
      route: "section_composition";
      reasonCode: Exclude<SectionCompositionResultCode, "composed">;
      manifest?: SectionCompositionManifest;
    };
```

`SectionCompositionCandidateInput` no longer contains `fallbackTemplateId` or `fallbackTitle`. `RunSectionCompositionCandidateDeps` no longer contains `fillAndNormalizeCuratedTemplate`.

- [ ] **Step 1: Replace fallback expectations with RED fail-closed expectations**

Add tests for a typed 2B failure, finalizer failure, and thrown exception:

```ts
expect(result).toMatchObject({
  ok: false,
  route: "section_composition",
  reasonCode: "section_fragment_stale",
});
expect(JSON.stringify(result)).not.toContain("WEIGHTED-COMPLETE");
expect(loadWholeTemplate).not.toHaveBeenCalled();
```

Add a source-boundary assertion that `quick-section-composition.ts` contains none of:

```ts
[
  "weightedFallback",
  "fillAndNormalizeCuratedTemplate",
  "fallbackTemplateId",
  "fallbackTitle",
  "build-curated-document",
]
```

Add provenance REDs at the section boundary:

- a published record whose canonical `storageKey` is not exactly `sections/<sectionId>-<contentHash>.html` is rejected as stale inventory (no traversal, query, alternate prefix, or mismatched ID/hash);
- an actual document-level `<!doctype>`, `<html>`, `<head>`, or `<body>` tag is rejected even when the bytes hash correctly and contain the requested `data-sec` marker; text inside comments/style/raw-text is not treated as markup;
- bytes must contain exactly one non-style/link top-level fragment root and exactly one matching `data-sec="<sectionId>"` root;
- a full Lyceum-shaped document disguised as a section returns `section_fragment_invalid`, never assembled HTML.

- [ ] **Step 2: Run the Task 2 RED**

```powershell
npm.cmd test -- lib/curate/quick-section-composition.test.ts lib/curate/finalize-composed-document.test.ts
```

Expected: FAIL because the wrapper still returns `route: "fallback"` and the new finalizer is absent.

- [ ] **Step 3: Extract the template-free finalizer**

Implement this exact ordering:

```ts
const seeded = seedBrandIntoHtml(input.html, input.profileData, { recolor: false });
const withMeta = ensurePageMeta(seeded, {
  title: input.title,
  ...profileMeta(input.profileData),
  replaceStaleMeta: true,
});
const sanitized = sanitizeForPublish(withMeta);
return sanitized.html === null
  ? { ok: false, reasonCode: "sanitization_failed" }
  : { ok: true, html: sanitized.html };
```

Do not import `build-curated-document.ts` or `templates/store.ts`.

- [ ] **Step 4: Remove every whole-template fallback from the 2B wrapper**

Add `section_fragment_invalid` to `SectionCompositionResultCodeSchema`. In `buildSectionCompositionInventory`, freeze only records whose storage key matches the authoritative section namespace. In `fetchVerifiedSectionFragments`, validate the fragment shape after the existing content-hash check and before returning any bytes.

On `candidate.ok === false`, return its typed reason and manifest. On finalizer failure, return `sanitization_failed`. On exception, return `internal_error`. On success, seal the manifest against finalized HTML:

```ts
const compositionManifest = SectionCompositionManifestSchema.parse({
  ...candidate.manifest,
  outputHash: sha256(finalized.html),
  resultCode: "composed",
});
```

Return `templateId: null`, and place this resealed manifest in persisted Visual Engine metadata.

- [ ] **Step 5: Verify Task 2 GREEN and legacy isolation**

```powershell
npm.cmd test -- lib/curate/quick-section-composition.test.ts lib/curate/finalize-composed-document.test.ts lib/generation/compose-sections.test.ts lib/generation/section-inventory.test.ts lib/generation/section-composition-contracts.test.ts
npm.cmd run typecheck
git diff --check
```

Expected: all pass; no template loader is called or imported by the production composition wrapper.

- [ ] **Step 6: Commit Task 2**

```powershell
git add lib/curate/finalize-composed-document.ts lib/curate/finalize-composed-document.test.ts lib/curate/quick-section-composition.ts lib/curate/quick-section-composition.test.ts lib/generation/section-inventory.ts lib/generation/section-inventory.test.ts lib/generation/section-composition-contracts.ts lib/generation/section-composition-contracts.test.ts
git commit -m "fix(curate): fail closed on section composition"
```

### Task 3: Seal hybrid delivery and require a strict 2C verdict

**Files:**
- Create: `lib/curate/ai-composition-delivery.ts`
- Create: `lib/curate/ai-composition-delivery.test.ts`
- Modify: `lib/curate/quick-visual-repair.ts`
- Modify: `lib/curate/quick-visual-repair.test.ts`

**Interfaces:**
- Consumes: `SectionCompositionManifestSchema`, `CreativeDirectionSchema`, `AssetManifestSchema`, `AssetResolutionTraceSchema`, `validateAssetManifestHash`, `runClosedLoopVisualRepair`.
- Produces:

```ts
export type AiCompositionDeliveryReason =
  | "invalid_composition_metadata"
  | "invalid_composition_manifest"
  | "section_role_coverage_failed"
  | "creative_marker_invalid"
  | "output_hash_mismatch"
  | "asset_metadata_invalid";

export function sealAiCompositionOutput(
  visualEngine: Extract<VisualEngineProjectMetadata, { route: "section_composition" }>,
  html: string,
): Extract<VisualEngineProjectMetadata, { route: "section_composition" }>;

export function validateAiCompositionDelivery(input: {
  html: string;
  visualEngine: unknown;
  leaksAfter: number;
}):
  | { ok: true; visualEngine: Extract<VisualEngineProjectMetadata, { route: "section_composition" }> }
  | { ok: false; reasonCode: AiCompositionDeliveryReason };

export type QuickVisualQualityGateResult =
  | {
      ok: true;
      outcome: "healthy_keep" | "repaired";
      html: string;
      visualEngine: Extract<VisualEngineProjectMetadata, { route: "section_composition" }>;
    }
  | {
      ok: false;
      reasonCode: "visual_quality_failed";
      detailCode: string;
    };

export function runQuickVisualQualityGate(
  input: QuickVisualRepairInput & {
    visualEngine: Extract<VisualEngineProjectMetadata, { route: "section_composition" }>;
  },
  deps?: QuickVisualRepairDeps,
): Promise<QuickVisualQualityGateResult>;
```

- [ ] **Step 1: Write one RED mutation test for every delivery invariant**

Start from one valid composed document and mutate one field at a time:

```ts
it.each([
  ["template route", { route: "template_skeleton" }, "invalid_composition_metadata"],
  ["template id", { templateId: "lyceum" }, "invalid_composition_metadata"],
  ["manifest result", { resultCode: "internal_error" }, "invalid_composition_manifest"],
  ["role order", ["footer", "hero"], "section_role_coverage_failed"],
  ["missing marker", "remove-marker", "creative_marker_invalid"],
  ["changed html", "append-byte", "output_hash_mismatch"],
  ["one-sided assets", "manifest-only", "asset_metadata_invalid"],
])("rejects %s", (_name, mutation, reasonCode) => {
  expect(validateMutation(mutation)).toEqual({ ok: false, reasonCode });
});
```

Also test that `creativeDirectionHash` equals `canonicalJsonSha256(creativeDirection)`, all manifest arrays align, asset manifest hash validates, trace manifest ID matches, and final HTML contains exactly one real `<style data-openlen-visual-engine="creative-direction/1.0">`.

Require a production composition to prove at least three distinct verified fragments. Each ordered role node in final HTML must carry both `data-openlen-role="<orderedRole>"` and the matching `data-sec="<selectedSectionId>"`; reject duplicate IDs, fewer than three rows, a role/section mismatch, or a single full-page root relabeled as composition.

- [ ] **Step 2: Write RED strict-quality tests**

Assert:

```ts
expect(await gateResult("healthy_keep")).toMatchObject({ ok: true, outcome: "healthy_keep" });
expect(await gateResult("accepted")).toMatchObject({ ok: true, outcome: "repaired" });

for (const detailCode of [
  "nonrepairable",
  "timeout",
  "initial_render_failed",
  "initial_critic_failed",
  "repair_provider_failed",
  "final_render_failed",
  "final_critic_failed",
  "not_improved",
  "internal_error",
]) {
  expect(await gateResult(detailCode)).toEqual({
    ok: false,
    reasonCode: "visual_quality_failed",
    detailCode,
  });
}
```

- [ ] **Step 3: Run the Task 3 RED**

```powershell
npm.cmd test -- lib/curate/ai-composition-delivery.test.ts lib/curate/quick-visual-repair.test.ts
```

Expected: FAIL because the delivery module and strict quality function do not exist.

- [ ] **Step 4: Implement sealing and final validation**

Use `node-html-parser` to compare ordered `data-openlen-role` values with `compositionManifest.orderedRoles`. `sealAiCompositionOutput` must update the manifest output hash after finalization and again after an accepted repair:

```ts
return {
  ...visualEngine,
  compositionManifest: SectionCompositionManifestSchema.parse({
    ...visualEngine.compositionManifest,
    outputHash: sha256(html),
    resultCode: "composed",
  }),
};
```

If repair metadata exists, require `repair.outputHashAfter === sha256(html)`. Validate the incoming pre-repair chain before resealing: `repair.outputHashBefore` must equal the manifest hash that was passed into the repair boundary.

- [ ] **Step 5: Implement strict 2C without breaking pilot compatibility**

Keep `runQuickVisualRepair` for existing pilot/rollback consumers. Add `runQuickVisualQualityGate` for production AI delivery. The strict production gate invokes the underlying closed-loop review exactly once and is **not** allowed to inherit the legacy `off`/`shadow` fail-open behavior; the separate `OPENLEN_AI_CREATION` kill switch controls whether AI creation is available. It accepts the original only when `trace.resultCode === "healthy_keep"`; it accepts repaired HTML only when `accepted === true`; every other result is typed failure. Never expose the critic explanation or thrown error.

- [ ] **Step 6: Verify Task 3 GREEN**

```powershell
npm.cmd test -- lib/curate/ai-composition-delivery.test.ts lib/curate/quick-visual-repair.test.ts lib/generation/closed-loop-repair.test.ts lib/generation/apply-visual-repair.test.ts
npm.cmd run typecheck
git diff --check
```

- [ ] **Step 7: Commit Task 3**

```powershell
git add lib/curate/ai-composition-delivery.ts lib/curate/ai-composition-delivery.test.ts lib/curate/quick-visual-repair.ts lib/curate/quick-visual-repair.test.ts
git commit -m "feat(curate): gate final hybrid delivery"
```

### Task 4: Build the single hybrid orchestration boundary

**Files:**
- Create: `lib/curate/ai-creation-contracts.ts`
- Create: `lib/curate/run-ai-creation.ts`
- Create: `lib/curate/run-ai-creation.test.ts`

**Interfaces:**
- Consumes: `analyzeIntent`, `generatePageCopy`, `listSections`, `overlayProfile`, `runSectionCompositionCandidate`, `validateAiCompositionDelivery`, `runQuickVisualQualityGate`.
- Produces:

```ts
export const AI_HYBRID_POLICY_VERSION = "ai-hybrid-policy/1.0" as const;

export type AiCreationStage =
  | "intent"
  | "copy"
  | "sections"
  | "composition"
  | "delivery_gate"
  | "visual_quality";

export type AiCreationReasonCode =
  | "intent_analysis_failed"
  | "copy_generation_failed"
  | "section_inventory_unavailable"
  | "section_plan_failed"
  | "section_fragment_unavailable"
  | "composition_failed"
  | "inherited_copy_leak"
  | "creative_direction_failed"
  | "asset_resolution_failed"
  | "semantic_gate_failed"
  | "visual_quality_failed";

export type AiCreationDeliveryReasonCode =
  | AiCreationReasonCode
  | "creation_disabled"
  | "persistence_failed";

export type AiCreationResult =
  | {
      ok: true;
      route: "section_composition";
      templateId: null;
      title: string;
      html: string;
      visualEngine: Extract<VisualEngineProjectMetadata, { route: "section_composition" }>;
      copyUsage?: ModelTokenUsage;
      filled: boolean;
      appliedOps: number;
    }
  | {
      ok: false;
      stage: AiCreationStage;
      reasonCode: AiCreationReasonCode;
      retryable: boolean;
    };

export function runAiCreation(input: {
  projectId: string;
  brief: string;
  profileData: BusinessProfileData;
  assetMode: AssetPipelineMode;
  assetTraceSink?: (trace: AssetResolutionTrace) => void;
  onStage?: (stage: string) => void;
}, deps?: RunAiCreationDeps): Promise<AiCreationResult>;
```

- [ ] **Step 1: Write the orchestration RED**

Use deferred promises to prove intent and copy start before either resolves:

```ts
const resultPromise = runAiCreation(INPUT, deps);
expect(deps.analyzeIntent).toHaveBeenCalledOnce();
expect(deps.generatePageCopy).toHaveBeenCalledOnce();
expect(deps.listSections).not.toHaveBeenCalled();
intent.resolve(INTENT_OK);
copy.resolve(COPY_OK);
await resultPromise;
```

Add a failure matrix for every `AiCreationStage`. Each row asserts zero calls to later stages and an object containing only `ok`, `stage`, `reasonCode`, and `retryable`.
Assert every paid/provider boundary is called at most once and no failure path retries intent, copy, creative direction, assets, critic, or repair.

- [ ] **Step 2: Run the Task 4 RED**

```powershell
npm.cmd test -- lib/curate/run-ai-creation.test.ts
```

Expected: FAIL because the contracts and orchestrator do not exist.

- [ ] **Step 3: Implement the provider barrier and composition pipeline**

Start both paid boundaries before the first await:

```ts
const intentPromise = deps.analyzeIntent(input.brief);
const copyPromise = deps.generatePageCopy(input.brief);
const [intentResult, copyResult] = await Promise.all([intentPromise, copyPromise]);
```

Only after both succeed: overlay profile, load published sections, call `runSectionCompositionCandidate`, validate pre-repair delivery, call strict 2C, reseal, and validate post-repair delivery. Map detailed lower-level failures to the stable public reason vocabulary; do not include lower-level messages in the returned result.

- [ ] **Step 4: Verify success is composition-only**

The success assertion must be exact:

```ts
expect(result).toMatchObject({
  ok: true,
  route: "section_composition",
  templateId: null,
  visualEngine: {
    route: "section_composition",
    templateId: null,
    policyVersion: "ai-hybrid-policy/1.0",
    compositionManifest: { resultCode: "composed" },
  },
});
expect(JSON.stringify(result)).not.toMatch(/weighted|template_skeleton|template_full/i);
```

- [ ] **Step 5: Verify Task 4 GREEN**

```powershell
npm.cmd test -- lib/curate/run-ai-creation.test.ts lib/curate/quick-section-composition.test.ts lib/curate/ai-composition-delivery.test.ts lib/curate/quick-visual-repair.test.ts
npm.cmd run typecheck
git diff --check
```

- [ ] **Step 6: Commit Task 4**

```powershell
git add lib/curate/ai-creation-contracts.ts lib/curate/run-ai-creation.ts lib/curate/run-ai-creation.test.ts
git commit -m "feat(curate): orchestrate hybrid AI creation"
```

### Task 5: Cut production Quick over to the hybrid-only pipeline

**Files:**
- Create: `lib/curate/ai-creation-mode.ts`
- Create: `lib/curate/ai-creation-mode.test.ts`
- Create: `lib/curate/ai-creation-credits.ts`
- Create: `lib/curate/ai-creation-credits.test.ts`
- Create: `lib/curate/commit-ai-composition.ts`
- Create: `lib/curate/commit-ai-composition.test.ts`
- Modify: `app/api/curate/route.ts`
- Rewrite: `lib/curate/curate-route.integration.test.ts`
- Modify: `lib/use-curation.ts`

**Interfaces:**
- Consumes: `runAiCreation`, auth, rate limit, credit state, profile store, DB insert, version, thumbnail, debit.
- Produces:

```ts
export type AiCreationMode = "enabled" | "disabled";

export function aiCreationMode(raw = process.env.OPENLEN_AI_CREATION): AiCreationMode {
  return raw === "enabled" ? "enabled" : "disabled";
}

export function calculateAiCreationCredits(
  input: {
    copyUsage?: { inputTokens: number; outputTokens: number };
    filled: boolean;
  },
  usageCredits: UsageCreditCalculator,
  autofillCreditCost: number,
): number;

export async function commitAiCompositionDocument(
  document: {
    html: string;
    visualEngine: Extract<VisualEngineProjectMetadata, { route: "section_composition" }>;
  },
  deps: {
    persist(data: ProjectData): Promise<void>;
    emitPreview(html: string): void;
  },
): Promise<void>;
```

- [ ] **Step 1: Write mode and commit-order RED tests**

```ts
expect(aiCreationMode(undefined)).toBe("disabled");
expect(aiCreationMode("enabled")).toBe("enabled");
expect(aiCreationMode("ENABLED")).toBe("disabled");

await commitAiCompositionDocument(COMPOSED_DOCUMENT, {
  persist: async () => order.push("persist"),
  emitPreview: () => order.push("preview"),
});
expect(order).toEqual(["persist", "preview"]);
```

Reject missing metadata, skeleton metadata, and non-null template IDs before persistence. A thrown persist must produce zero previews.

- [ ] **Step 2: Rewrite POST integration tests to RED**

Replace template/picker/skeleton mocks with `runAiCreation`. Cover:

1. disabled kill switch: stable `creation_disabled`, zero pipeline/insert/preview/debit;
2. hybrid success: one insert, then one final preview, one debit, one `done`;
3. each typed pipeline failure: stable retry message, zero insert/preview/debit/`done`;
4. DB failure: stable `persistence_failed`, attempted insert, zero preview/debit/`done`;
5. success metadata: route composition, `templateId: null`, matching final hash;
6. no raw failure message reaches SSE;
7. copy usage drives the existing credit formula.

Expected final preview assertion:

```ts
expect(events.filter((event) => event.event === "preview")).toEqual([
  { event: "preview", data: { html: "FINAL-HYBRID-HTML" } },
]);
expect(events.at(-1)).toMatchObject({
  event: "done",
  data: { projectId: expect.any(String), route: "section_composition", templateId: null },
});
```

- [ ] **Step 3: Run the Task 5 RED**

```powershell
npm.cmd test -- lib/curate/ai-creation-mode.test.ts lib/curate/commit-ai-composition.test.ts lib/curate/curate-route.integration.test.ts
```

Expected: FAIL because production still imports and delivers legacy templates.

- [ ] **Step 4: Replace the route graph**

Remove these imports and every corresponding branch from `route.ts`:

```ts
[
  "@/lib/templates/store",
  "@/lib/curate/pick-template",
  "@/lib/generation/safe-selection",
  "@/lib/generation/shadow-selection",
  "@/lib/curate/build-curated-document",
  "runSkeletonCandidate",
  "planQuickVisualEngineRoute",
  "runSectionCompositionCandidate",
]
```

The route performs only: auth → rate → input → credit precheck → mode check → profile resolution → `runAiCreation` → commit → debit → version/thumbnail → `done`.

On pipeline failure emit:

```ts
emit("error", {
  kind: result.reasonCode,
  message: "No pudimos construir una página coherente. Reintentar.",
});
```

Log only `{ route: "curate", stage, reasonCode }`; remove `userId`, template ID, error message, brief, HTML, and copy from error context.

- [ ] **Step 5: Isolate credits and update client progress language**

Implement `calculateAiCreationCredits` in the new template-free module and have `/api/curate` import it directly. Preserve the current formula: copy model credits (or fallback `1`) plus `AUTOFILL_CREDIT_COST` when filled. Do not import or re-export production AI delivery through `quick-visual-engine.ts`; leave that module and its historical rollback consumers unchanged for legacy pilot evidence.

Update `use-curation.ts` comments and stages:

```ts
const STAGE_TEXT: Record<string, string> = {
  analyzing: "Understanding your idea…",
  writing: "Writing your content…",
  planning: "Planning the sections…",
  assembling: "Building the layout…",
  styling: "Creating the visual identity…",
  reviewing: "Reviewing visual quality…",
  persisting: "Finishing up…",
};
```

- [ ] **Step 6: Verify Task 5 GREEN**

```powershell
npm.cmd test -- lib/curate/ai-creation-mode.test.ts lib/curate/ai-creation-credits.test.ts lib/curate/commit-ai-composition.test.ts lib/curate/curate-route.integration.test.ts
npm.cmd run typecheck
git diff --check
```

- [ ] **Step 7: Commit Task 5**

```powershell
git add lib/curate/ai-creation-mode.ts lib/curate/ai-creation-mode.test.ts lib/curate/ai-creation-credits.ts lib/curate/ai-creation-credits.test.ts lib/curate/commit-ai-composition.ts lib/curate/commit-ai-composition.test.ts app/api/curate/route.ts lib/curate/curate-route.integration.test.ts lib/use-curation.ts
git commit -m "feat(curate): require hybrid AI composition"
```

### Task 6: Niche regression cohort, release gate, and operations

**Files:**
- Create: `lib/generation/ai-hybrid-niche-cohort.ts`
- Create: `lib/generation/ai-hybrid-niche-cohort.test.ts`
- Create: `lib/curate/ai-hybrid-import-boundary.test.ts`
- Create: `lib/curate/ai-hybrid-regression.test.ts`
- Create: `lib/curate/explicit-template-clone-contract.test.ts`
- Create: `docs/generation/ai-hybrid-only-runbook.md`
- Create: `lib/curate/ai-hybrid-runbook-contract.test.ts`
- Modify: `package.json`
- Modify: `infra/scripts/deploy.ps1`

**Interfaces:**
- Consumes: `IntentAnalysisSchema`, `planSectionComposition`, `runAiCreation`, production source files, npm scripts.
- Produces: `AI_HYBRID_NICHE_CASES`, `generation:ai-hybrid:gate`, operational rollback/canary instructions.

- [ ] **Step 1: Define the exact seven-case cohort**

Each immutable row contains `id`, `brief`, fully parsed `intent`, `expectedRoles`, `expectedComponents`, a schema-valid `expectedCreativeDirection`, `requiredVisualSignals`, `forbiddenVisualSignals`, and `forbiddenResidues`.

Required rows:

```ts
[
  "kids-coloring",
  "horror-experience",
  "comedy-club",
  "video-game-launch",
  "school-website",
  "cooking-publication",
  "physical-product-sale",
]
```

The coloring row must include:

```ts
forbiddenVisualSignals: [
  "saas_dashboard",
  "course_progress_ui",
  "corporate_photography",
],
forbiddenResidues: [
  "Lyceum",
  "Python",
  "JavaScript",
  "cURL",
  "Common Core",
  "IB curriculum",
  "tutoring plan",
],
```

- [ ] **Step 2: Write cohort and Mundo Pincel RED tests**

For every row, assert `planSectionComposition` produces exact ordered roles/components with no unsupported role. Run the injected `runAiCreation` success path with that row's creative-direction fixture and assert: only composition metadata, exact ordered/unique section IDs, a direction containing every required visual signal and none of the forbidden signals, a matching direction hash, and final HTML free of every forbidden residue.

For the Mundo Pincel regression, inject Lyceum-shaped legacy HTML into both a forbidden whole-template loader spy and the verified-section fetch boundary. Assert the loader remains unreachable and the disguised full-document fragment fails closed with `section_fragment_invalid`. Then run the valid injected section-composition path and assert:

```ts
expect(loadWholeTemplate).not.toHaveBeenCalled();
expect(result).toMatchObject({ ok: true, route: "section_composition", templateId: null });
for (const residue of coloring.forbiddenResidues) {
  expect(result.html).not.toContain(residue);
}
```

- [ ] **Step 3: Add the transitive production import-boundary RED**

Use the installed TypeScript compiler API in the test to parse static imports, dynamic `import()` expressions, and re-exports. Starting at `app/api/curate/route.ts`, resolve relative imports and the repository `@/` alias, recurse through repository-owned `.ts`/`.tsx` modules, stop at packages outside the repository, and fail if any reachable module or imported symbol matches:

```ts
[
  "templates/store",
  "pick-template",
  "build-curated-document",
  "quick-visual-engine",
  "safe-selection",
  "shadow-selection",
  "getTemplateHtml",
  "listTemplates",
  "pickTemplate",
  "pickWeighted",
  "runSkeletonCandidate",
  "fillAndNormalizeCuratedTemplate",
  "weightedFallback",
]
```

The test must prove the graph traversal itself with a temporary fixture graph containing a forbidden transitive import; a direct source-string scan is not sufficient. Print only repository-relative module paths on failure.

- [ ] **Step 4: Protect the explicit template-clone command**

Add a behavior-level contract test for `POST /api/projects/from-template` using mocked auth, template store, transform, profile, DB, and version boundaries. Assert that a published user-selected template calls `getTemplateHtml` with the requested ID, persists its normalized/sanitized/seeded HTML with template tags, and returns the new project ID. Also cover unauthorized, unknown template, unavailable body, and DB failure. This test protects the product distinction: **“Usar este template” clones; “Crear con IA” composes.**

- [ ] **Step 5: Run the cohort and boundary REDs, then implement only missing fixtures/contracts**

```powershell
npm.cmd test -- lib/generation/ai-hybrid-niche-cohort.test.ts lib/curate/ai-hybrid-import-boundary.test.ts lib/curate/ai-hybrid-regression.test.ts lib/curate/explicit-template-clone-contract.test.ts
```

Expected first run: FAIL because the cohort and contract tests do not exist. After adding the files, all seven rows, the transitive import boundary, the Mundo Pincel regression, and the explicit clone contract pass without network or DB.

- [ ] **Step 6: Add the focused package gate and runbook**

Add exactly one package command:

```json
"generation:ai-hybrid:gate": "vitest run lib/curate/generate-page-copy.test.ts lib/curate/finalize-composed-document.test.ts lib/curate/quick-section-composition.test.ts lib/curate/ai-composition-delivery.test.ts lib/curate/quick-visual-repair.test.ts lib/curate/run-ai-creation.test.ts lib/curate/ai-creation-mode.test.ts lib/curate/ai-creation-credits.test.ts lib/curate/commit-ai-composition.test.ts lib/curate/curate-route.integration.test.ts lib/generation/ai-hybrid-niche-cohort.test.ts lib/curate/ai-hybrid-import-boundary.test.ts lib/curate/ai-hybrid-regression.test.ts lib/curate/explicit-template-clone-contract.test.ts lib/curate/ai-hybrid-runbook-contract.test.ts"
```

The runbook must document:

- `OPENLEN_AI_CREATION=enabled|disabled`, invalid/unset → disabled;
- disabled behavior is error-only and never legacy fallback;
- `OPENLEN_PAGE_COPY_MODEL` precedence;
- no-retry and redacted telemetry policy;
- focused gate, full suite, typecheck, asset gate, rollback-check, build;
- production activation and rollback commands;
- seven-case live canary requiring one-time authorization and a positive MXN cap;
- one request per case, no automatic retry, and allowed telemetry fields only.

- [ ] **Step 7: Make deploy run the focused safety checks before build**

Invoke the checks **before** the `OPENLEN_SKIP_BUILD` conditional in `infra/scripts/deploy.ps1`, so `OPENLEN_SKIP_BUILD=1` can skip only the build and can never skip the safety gate or typecheck:

```powershell
npm.cmd run generation:ai-hybrid:gate
if ($LASTEXITCODE -ne 0) { throw "AI hybrid generation gate failed" }
npm.cmd run typecheck
if ($LASTEXITCODE -ne 0) { throw "Typecheck failed" }
```

Do not add live/provider/DB tests to deploy. In `ai-hybrid-runbook-contract.test.ts`, parse the deploy script and assert both commands occur exactly once and textually before the first `OPENLEN_SKIP_BUILD` branch; a simple presence-only assertion is insufficient.

- [ ] **Step 8: Run the complete local release verification once**

Run, without restarting a long-running command:

```powershell
npm.cmd run generation:ai-hybrid:gate
npm.cmd run generation:visual-engine-assets:gate
npm.cmd run typecheck
npm.cmd test
npm.cmd run generation:visual-engine-2a:rollback-check
npm.cmd run build
git diff --check
```

Expected: focused gates, typecheck, full suite, rollback-check, build, and diff-check all exit `0`. If `.env.local` is unavailable, run the rollback script through the existing server-only shim without copying production secrets and record the exact environmental deviation.

- [ ] **Step 9: Commit Task 6**

```powershell
git add lib/generation/ai-hybrid-niche-cohort.ts lib/generation/ai-hybrid-niche-cohort.test.ts lib/curate/ai-hybrid-import-boundary.test.ts lib/curate/ai-hybrid-regression.test.ts lib/curate/explicit-template-clone-contract.test.ts docs/generation/ai-hybrid-only-runbook.md lib/curate/ai-hybrid-runbook-contract.test.ts package.json infra/scripts/deploy.ps1
git commit -m "test(curate): gate hybrid-only AI creation"
```

## Post-Implementation Review and Live Validation

- [ ] Request an independent code review focused only on Critical/Important violations of the approved spec.
- [ ] Fix confirmed findings with one RED → GREEN cycle per root cause.
- [ ] Rerun `generation:ai-hybrid:gate`, assets gate, typecheck, full suite, rollback-check, build, and diff/privacy audits.
- [ ] Deploy with `OPENLEN_AI_CREATION=enabled` only after all local gates pass.
- [ ] Before live validation, present the estimated maximum cost and obtain an explicit MXN cap.
- [ ] Execute exactly one live creation for each of the seven synthetic cases, without automatic retries.
- [ ] Review the seven final pages for immediate theme recognition, required/forbidden signals, section coherence, mobile quality, and absence of legacy-template residue.
- [ ] If any case fails, disable `OPENLEN_AI_CREATION`; keep explicit template cloning available; diagnose before another paid run.
