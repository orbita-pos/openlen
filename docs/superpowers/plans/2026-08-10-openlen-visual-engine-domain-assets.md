# OpenLen Visual Engine Domain-Aware Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a provider-neutral, domain-aware hybrid asset pipeline that preserves OpenLen's template structure, prefers coherent curated packs, generates only missing identity assets, and fails closed instead of using wrong-category imagery.

**Architecture:** The existing creative direction and skeleton plan produce bounded `AssetIntent` records. A deterministic resolver hard-gates curated candidates, optionally invokes a provider-neutral generated-pack adapter, validates and stores image bytes, emits a strict `AssetManifest`, and applies only authorized image attributes before the existing sanitize/fingerprint/render/2C gates. The current asset resolver remains the exact `off` path.

**Tech Stack:** TypeScript, Zod, Vitest, `node-html-parser`, Node `crypto`/`Buffer`, existing `AssetStorage`, existing Gemini REST boundary, existing Visual Engine Quick/2B/2C pipelines.

## Global Constraints

- Follow `docs/superpowers/specs/2026-08-10-openlen-visual-engine-domain-assets-design.md` exactly.
- Do not rebuild the HTML engine, agent, selector, section composer, creative compiler, or 2C evaluator.
- Keep the shared contracts provider-neutral; Gemini is only one adapter.
- `OPENLEN_VISUAL_ENGINE_ASSETS=off` must preserve the current `resolveSkeletonAssets` behavior byte-for-byte.
- New modes are `shadow | curated | hybrid`; only `hybrid` may invoke an image provider.
- Shadow mode is curated-only and must never make a paid image call.
- Generated outputs are limited to PNG, JPEG, and WebP bytes; reject SVG and provider URLs.
- A pack contains at most three generated assets, uses no retry, and succeeds atomically only when every required result validates.
- Do not add a runtime dependency.
- Do not debit existing Quick user credits in this stage; record operational usage/cost only, matching the existing Visual Engine creative-usage policy.
- Paid calls, database mutations, deploys, and feature activation are outside implementation verification unless the user separately authorizes them.
- Preserve all user-owned untracked files and unrelated working-tree changes.
- Official provider reference, consulted 2026-08-10: https://ai.google.dev/gemini-api/docs/image-generation and https://ai.google.dev/gemini-api/docs/models/gemini-2.5-flash-image.

## File Structure

### New files

- `lib/generation/asset-contracts.ts` — strict versioned intent, manifest, provenance, and trace schemas/types.
- `lib/generation/asset-contracts.test.ts` — adversarial contract and URL-policy tests.
- `lib/generation/asset-intent.ts` — pure conversion from validated Visual Engine inputs to bounded slot intents.
- `lib/generation/asset-intent.test.ts` — intent derivation and unknown-original policy tests.
- `lib/generation/asset-catalog.ts` — curated metadata normalization, hard gates, deterministic ranking, pack selection, and winner byte verification.
- `lib/generation/asset-catalog.test.ts` — domain/audience/forbidden/style/coherence/tie-break tests.
- `lib/generation/asset-image-validation.ts` — dependency-free PNG/JPEG/WebP signature, dimensions, size, and SHA-256 validation used by both catalog and provider paths.
- `lib/generation/asset-image-validation.test.ts` — valid and malformed byte fixtures.
- `lib/generation/asset-pack-provider.ts` — provider-neutral request/result interface and budget contract.
- `lib/generation/gemini-asset-pack-provider.ts` — configurable Gemini text-to-image/reference adapter with injected transport.
- `lib/generation/gemini-asset-pack-provider.test.ts` — request allowlist, sequential consistency, usage, errors, budget, and no-retry tests.
- `lib/generation/asset-pipeline.ts` — hybrid orchestration, storage, manifest/trace construction, and safe optional fallback.
- `lib/generation/asset-pipeline.test.ts` — curated/generated/fallback/atomicity/storage tests.
- `lib/generation/apply-asset-manifest.ts` — authorized DOM application only.
- `lib/generation/apply-asset-manifest.test.ts` — structural and attribute-policy tests.
- `lib/generation/asset-pipeline-mode.ts` — `off | shadow | curated | hybrid` parser.
- `lib/generation/asset-pipeline-mode.test.ts` — fail-closed mode parsing.
- `public/openlen-assets/placeholders/neutral-abstract.svg` — trusted, non-semantic optional-slot placeholder.
- `docs/generation/visual-engine-assets-runbook.md` — configuration, budget, privacy, incidents, and rollback.

### Modified files

- `lib/imagery/manifest.ts` — validate optional reviewed domain/audience/signal/license/checksum metadata while preserving old rows.
- `lib/generation/imagery-manifest.test.ts` — collected legacy and enriched imagery-manifest compatibility coverage.
- `lib/generation/adapt-skeleton.ts` and `.test.ts` — call the new pipeline in enabled modes and return manifest/trace.
- `lib/generation/compose-sections.ts` and `.test.ts` — pass asset context into the shared adaptation path.
- `lib/generation/apply-visual-repair.ts` and `.test.ts` — use the same pipeline and return a replacement manifest only on success.
- `lib/generation/closed-loop-repair.ts` and `.test.ts` — carry an accepted repair manifest atomically.
- `lib/curate/quick-visual-engine.ts` and `.test.ts` — pass project asset context and persist manifest/trace metadata.
- `lib/curate/quick-section-composition.ts` and `.test.ts` — same for 2B.
- `lib/curate/quick-visual-repair.ts` and `.test.ts` — preserve or replace manifest according to repair acceptance.
- `lib/projects/types.ts` — add optional `assetManifest` and redacted `assetTrace` to Visual Engine project metadata.
- `app/api/curate/route.ts` and `lib/curate/curate-route.integration.test.ts` — allocate the final project ID before candidate construction and pass mode/context without changing off delivery.
- `package.json` — add one non-live deterministic assets gate command.

---

### Task 1: Strict asset contracts and deterministic intent builder

**Files:**
- Create: `lib/generation/asset-contracts.ts`
- Create: `lib/generation/asset-contracts.test.ts`
- Create: `lib/generation/asset-intent.ts`
- Create: `lib/generation/asset-intent.test.ts`

**Interfaces:**
- Consumes: `IntentAnalysis`, `CreativeDirection`, `SkeletonInventory`, and `SkeletonAdaptationPlan`.
- Produces: `AssetIntentSchema`, `AssetManifestSchema`, `AssetResolutionTraceSchema`, and `buildAssetIntents(input): AssetIntent[]`.

- [ ] **Step 1: Write failing strict-schema tests**

Cover a valid children's-coloring manifest and reject unknown keys, duplicate slot indexes, more than 12 intents, more than 3 generated resolutions, arbitrary remote URLs, provider URLs, invalid checksums, unbounded alt/prompts, mixed consistency groups, missing provenance, and a required unresolved slot represented as success.

```ts
expect(AssetManifestSchema.parse(COLORING_MANIFEST).slots).toHaveLength(2);
expect(() => AssetManifestSchema.parse({ ...COLORING_MANIFEST, privateHtml: "<main>secret</main>" })).toThrow();
expect(() => AssetManifestSchema.parse(withUrl(COLORING_MANIFEST, "https://evil.example/a.png"))).toThrow();
expect(() => AssetManifestSchema.parse(withDuplicateSlot(COLORING_MANIFEST))).toThrow();
```

- [ ] **Step 2: Run the contract test and confirm RED**

Run: `npm.cmd test -- lib/generation/asset-contracts.test.ts`

Expected: FAIL because `./asset-contracts` does not exist.

- [ ] **Step 3: Implement strict bounded contracts**

Define these exact public shapes:

```ts
const SafeAssetTextSchema = z.string().min(1).max(240).refine(
  (value) => !/<\/?[a-z]|\b(?:https?|data|javascript|file):|[{}]/i.test(value),
  "must not contain HTML, URLs, scripts, or free-form CSS",
);
const SafePromptSchema = z.string().min(1).max(1200).refine(
  (value) => !/<\/?[a-z]|\b(?:https?|data|javascript|file):|[{}]/i.test(value),
  "must not contain HTML, URLs, scripts, or free-form CSS",
);
const TaxonomyListSchema = z.array(TaxonomySlugSchema).max(12).superRefine((values, ctx) => {
  if (new Set(values).size !== values.length) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "must be unique" });
});

export type AssetMediaType = "photo" | "illustration" | "texture";
export type AssetSlotRole = "hero" | "section" | "card";
export type AssetResolutionSource = "template" | "curated" | "generated" | "abstract" | "placeholder";

export const AssetIntentSchema = z.object({
  slotIndex: z.number().int().min(0).max(255),
  role: z.enum(["hero", "section", "card"]),
  required: z.boolean(),
  identityBearing: z.boolean(),
  mediaType: z.enum(["photo", "illustration", "texture"]),
  subjects: TaxonomyListSchema,
  domains: TaxonomyListSchema.min(1),
  audiences: TaxonomyListSchema.min(1),
  visualArchetype: TaxonomySlugSchema,
  emotionalTone: TaxonomyListSchema,
  aspectRatio: z.enum(["1:1", "4:3", "3:2", "16:9", "9:16", "21:9"]),
  focalPoint: z.enum(["center", "top", "bottom", "left", "right"]),
  alt: SafeAssetTextSchema.max(240),
  requiredSignals: TaxonomyListSchema,
  forbiddenSignals: TaxonomyListSchema,
}).strict();

const HashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const CommonResolutionSchema = z.object({
  slotIndex: z.number().int().min(0).max(255),
  assetId: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/),
  url: z.string().min(1).max(512),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]),
  checksum: HashSchema,
  width: z.number().int().min(1).max(4096).nullable(),
  height: z.number().int().min(1).max(4096).nullable(),
  domainMatch: z.literal(true),
  audienceMatch: z.literal(true),
  styleMatch: z.literal(true),
});
const CatalogResolutionSchema = CommonResolutionSchema.extend({
  source: z.literal("curated"),
  provenance: z.object({ catalogVersion: z.string().min(1).max(96), license: z.literal("openlen_catalog") }).strict(),
}).strict();
const AbstractResolutionSchema = CommonResolutionSchema.extend({
  source: z.literal("abstract"),
  provenance: z.object({ catalogVersion: z.string().min(1).max(96), license: z.literal("openlen_catalog") }).strict(),
}).strict();
const GeneratedResolutionSchema = CommonResolutionSchema.extend({
  source: z.literal("generated"),
  mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  provenance: z.object({ provider: z.string().min(1).max(64), model: z.string().min(1).max(96), requestVersion: z.literal("asset-pack-request/1.0"), prompt: SafePromptSchema, promptSha256: HashSchema }).strict(),
}).strict();
const TemplateResolutionSchema = CommonResolutionSchema.extend({
  source: z.literal("template"),
  provenance: z.object({ templateId: z.string().min(1).max(180), metadataVersion: z.string().min(1).max(96) }).strict(),
}).strict();
const PlaceholderResolutionSchema = CommonResolutionSchema.extend({
  source: z.literal("placeholder"),
  mimeType: z.literal("image/svg+xml"),
  provenance: z.object({ placeholderVersion: z.literal("neutral-abstract/1.0") }).strict(),
}).strict();
export const AssetResolutionSchema = z.discriminatedUnion("source", [
  CatalogResolutionSchema,
  AbstractResolutionSchema,
  GeneratedResolutionSchema,
  TemplateResolutionSchema,
  PlaceholderResolutionSchema,
]);
export const AssetManifestSchema = z.object({
  schemaVersion: z.literal("asset-manifest/1.0"),
  manifestId: HashSchema,
  consistencyGroup: z.object({ id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,95}$/), mediaType: z.enum(["photo", "illustration", "texture"]), artDirection: TaxonomySlugSchema, paletteHints: TaxonomyListSchema, styleLock: TaxonomySlugSchema }).strict(),
  slots: z.array(z.object({ slotIndex: z.number().int().min(0).max(255), role: z.enum(["hero", "section", "card"]), required: z.boolean(), identityBearing: z.boolean(), intent: AssetIntentSchema, resolution: AssetResolutionSchema }).strict()).max(12),
  fallbackPolicy: z.literal("fail_closed_on_required_identity_asset"),
}).strict();
export const AssetResolutionTraceSchema = z.object({
  schemaVersion: z.literal("asset-resolution-trace/1.0"),
  manifestId: HashSchema.nullable(),
  consistencyGroupCount: z.number().int().min(0).max(1),
  curatedCount: z.number().int().min(0).max(12),
  generatedCount: z.number().int().min(0).max(3),
  abstractCount: z.number().int().min(0).max(12),
  placeholderCount: z.number().int().min(0).max(12),
  requiredUnresolvedCount: z.number().int().min(0).max(12),
  rejectionCounts: z.record(z.string().regex(/^[a-z0-9_]+$/), z.number().int().nonnegative()),
  provider: z.string().max(64).nullable(),
  modelId: z.string().max(96).nullable(),
  promptSha256: z.array(HashSchema).max(3),
  usage: z.object({ inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(), cachedTokens: z.number().int().nonnegative(), thinkingTokens: z.number().int().nonnegative() }).strict().optional(),
  estimatedCostMicromxn: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
  resultCode: z.string().regex(/^[a-z0-9_]+$/).max(64),
}).strict();
export type AssetResolution = z.infer<typeof AssetResolutionSchema>;
export type AssetIntent = z.infer<typeof AssetIntentSchema>;
export type AssetManifest = z.infer<typeof AssetManifestSchema>;
export type AssetResolutionTrace = z.infer<typeof AssetResolutionTraceSchema>;
```

Add a manifest `superRefine` that enforces unique slot indexes, matching `slot.slotIndex`, `slot.intent.slotIndex`, and `slot.resolution.slotIndex`, a maximum of three generated resolutions, one primary consistency group, and placeholder use only when `required=false && identityBearing=false`. Implement `validateAssetManifestHash` by hashing the canonical manifest without `manifestId` and comparing the result to `manifestId`.

Use discriminated provenance schemas for catalog, generated, template, and placeholder records. Generated provenance contains bounded private `prompt`, `promptSha256`, provider, model, and request version; `AssetResolutionTrace` contains only `promptSha256`. Add source-specific URL refinement: catalog/abstract only under `https://images.openlen.com/`, placeholder only under `/openlen-assets/`, and generated only under `/api/projects/<safe-id>/assets/<content-hash>.<png|jpg|jpeg|webp>` or the configured `OPENLEN_APP_BASE_URL` with that exact pathname. Never accept a provider URL.

- [ ] **Step 4: Write failing intent-builder tests**

Test exact slot ordering, required/identity-bearing hero behavior, domains/audiences from intent, media type from the validated plan, bounded subjects/signals, deterministic aspect defaults by role, omission of `keep` instructions for verified-compatible originals only, and rejection of a plan referencing an absent/nonreplaceable slot.

```ts
expect(buildAssetIntents(INPUT)).toEqual([
  expect.objectContaining({ slotIndex: 0, role: "hero", required: true, identityBearing: true, mediaType: "illustration" }),
  expect.objectContaining({ slotIndex: 1, role: "card", identityBearing: false }),
]);
```

- [ ] **Step 5: Implement `buildAssetIntents`**

Use this exact input boundary:

```ts
export interface BuildAssetIntentsInput {
  intent: IntentAnalysis;
  direction: CreativeDirection;
  inventory: SkeletonInventory;
  plan: Pick<SkeletonAdaptationPlan, "assets">;
  originalProvenance?: ReadonlyMap<number, AssetResolution>;
}
```

Use only validated input fields. Sort by `slotIndex`. Hero replacements and instructions whose query/alt contain required signals are identity-bearing. A `keep` instruction produces no intent only when `originalProvenance` is explicitly supplied and verified compatible; otherwise required unknown imagery remains an intent. Throw `AssetIntentError("asset_slot_unavailable", slotIndex)` for missing or nonreplaceable slots.

- [ ] **Step 6: Run Task 1 GREEN and typecheck**

Run:

```powershell
npm.cmd test -- lib/generation/asset-contracts.test.ts lib/generation/asset-intent.test.ts
npm.cmd run typecheck
git diff --check
```

Expected: all tests PASS; typecheck and diff check exit 0.

- [ ] **Step 7: Commit Task 1**

```powershell
git add lib/generation/asset-contracts.ts lib/generation/asset-contracts.test.ts lib/generation/asset-intent.ts lib/generation/asset-intent.test.ts
git commit -m "feat(generation): define domain asset contracts"
```

---

### Task 2: Curated catalog hard gates and coherent pack selection

**Files:**
- Create: `lib/generation/asset-catalog.ts`
- Create: `lib/generation/asset-catalog.test.ts`
- Create: `lib/generation/asset-image-validation.ts`
- Create: `lib/generation/asset-image-validation.test.ts`
- Modify: `lib/imagery/manifest.ts`
- Create: `lib/generation/imagery-manifest.test.ts`

**Interfaces:**
- Consumes: `AssetIntent[]`, `CreativeDirection`, and `CuratedImage[]`.
- Produces: `resolveCuratedAssetPack(input, deps): Promise<CuratedAssetPackResult>` and `verifyCuratedAssetBytes(url, deps)`.

- [ ] **Step 1: Write RED byte-validation tests**

Use minimal valid fixtures for PNG IHDR, JPEG SOF0, WebP VP8X, VP8, and VP8L. Reject declared/actual MIME mismatch, SVG/XML, truncated structures, zero/oversized dimensions, decompression-bomb dimensions, empty bytes, and bytes over 6 MiB.

```ts
expect(validateGeneratedImage(PNG_1200_630, "image/png")).toEqual(expect.objectContaining({ width: 1200, height: 630, ext: "png" }));
expect(() => validateGeneratedImage(Buffer.from("<svg/>"), "image/svg+xml")).toThrow("unsupported_image_type");
```

- [ ] **Step 2: Implement dependency-free validation**

Read PNG dimensions from IHDR, JPEG dimensions by bounded SOF-marker traversal, and WebP dimensions from VP8X/VP8/VP8L headers. Require width and height in `64..4096`, total pixels at most `16_777_216`, and SHA-256 of exact bytes. Return `{ mimeType, ext, width, height, checksum }`.

- [ ] **Step 3: Write RED tests for enriched and legacy catalog rows**

Add optional reviewed fields to fixtures: `domains`, `audiences`, `visualSignals`, `negativeTags`, `mediaType`, `license`, and `checksum`. Assert malformed optional fields are removed/rejected rather than trusted, while every current legacy row still loads.

```ts
expect(loadFixture([{ ...legacyImage }])).toHaveLength(1);
expect(loadFixture([{ ...legacyImage, domains: ["children_entertainment"], audiences: ["children"], license: "openlen_catalog" }])[0])
  .toMatchObject({ domains: ["children_entertainment"], audiences: ["children"] });
```

- [ ] **Step 4: Implement backwards-compatible manifest parsing**

Keep existing required fields unchanged. Normalize hyphenated legacy `family` values to snake-case domain tags only inside the resolver. Treat absent audience metadata as `unknown`; for sensitive `children` intents, `unknown` is not eligible. Preserve the existing exclusions and memoization.

- [ ] **Step 5: Write RED hard-gate and ranking tests**

For each required fixture domain (coloring, hotel, observability, restaurant, portfolio), include:

- an exact compatible candidate;
- a tone-similar wrong-domain candidate;
- a forbidden-signal candidate;
- a correct-domain wrong-media candidate;
- two equal candidates with reverse lexical IDs;
- multiple compatible slots that can and cannot share one style lock.

Assert zero wrong-category winners and deterministic IDs.

```ts
const result = await resolveCuratedAssetPack(
  { intents: COLORING_INTENTS, direction: COLORING_DIRECTION, images: IMAGES, catalogVersion: "fixture/1" },
  fixtureDeps(),
);
expect(result).toMatchObject({ status: "complete", consistencyGroup: { mediaType: "illustration" } });
expect(result.assignments.map((x) => x.assetId)).toEqual(["coloring-crayons", "friendly-animal-art"]);
expect(result.rejections.wrong_domain).toBeGreaterThan(0);
```

- [ ] **Step 6: Implement hard gates before scoring**

Normalize tokens with NFD accent stripping and snake-case boundaries. Reject candidates on domain, sensitive audience, media type, forbidden signals, license/provenance, and trusted URL policy before computing any score. Then score subject, role, archetype/style, tone, and stable ID. Primary slots must share one normalized style lock; search style groups before choosing individual winners.

- [ ] **Step 7: Verify only selected curated bytes**

Implement `verifyCuratedAssetBytes` with injected `fetchImpl`, `redirect: "error"`, exact host allowlist, a 6 MiB cap, and `validateGeneratedImage`. Fetch only ranked winners; on invalid bytes, continue to the next eligible winner. Use an in-process promise cache keyed by trusted URL. `checksum` metadata, when present, must equal the actual bytes hash.

- [ ] **Step 8: Run Task 2 GREEN**

Run:

```powershell
npm.cmd test -- lib/generation/asset-image-validation.test.ts lib/generation/imagery-manifest.test.ts lib/generation/asset-catalog.test.ts lib/generation/skeleton-assets.test.ts
npm.cmd run typecheck
git diff --check
```

Expected: all tests PASS and the legacy skeleton-assets tests remain unchanged.

- [ ] **Step 9: Commit Task 2**

```powershell
git add lib/generation/asset-image-validation.ts lib/generation/asset-image-validation.test.ts lib/imagery/manifest.ts lib/generation/imagery-manifest.test.ts lib/generation/asset-catalog.ts lib/generation/asset-catalog.test.ts
git commit -m "feat(generation): resolve coherent curated asset packs"
```

---

### Task 3: Validated generated-pack provider boundary

**Files:**
- Create: `lib/generation/asset-pack-provider.ts`
- Create: `lib/generation/gemini-asset-pack-provider.ts`
- Create: `lib/generation/gemini-asset-pack-provider.test.ts`

**Interfaces:**
- Consumes: unresolved required `AssetIntent[]`, a shared consistency group, operational budget, and injected storage/transport boundaries.
- Produces: `validateGeneratedImage(bytes, declaredMime)`, `parseAssetGenerationBudget(env)`, and `createGeminiAssetPackProvider(options): AssetPackProvider`.

- [ ] **Step 1: Write RED provider and budget tests**

Assert:

- text-only first request;
- later requests include only the first generated image as visual reference;
- every request repeats the same art direction, palette hints, and style lock;
- at most three slots and no retry;
- request contains no HTML, private copy, URLs, secrets, or unallowlisted fields;
- provider URL/text-only/blocked/HTTP/network/invalid bytes fail with typed codes;
- usage survives paid malformed responses when reported;
- missing or invalid budget configuration disables generation before transport;
- estimated `assetCount * unitMicromxn` above the cap makes zero calls.

- [ ] **Step 2: Implement the provider-neutral budget boundary and interface**

```ts
export interface AssetGenerationBudget {
  version: string;
  maxCostMicromxn: number;
  estimatedImageCostMicromxn: number;
}

export function parseAssetGenerationBudget(env: NodeJS.ProcessEnv): AssetGenerationBudget | null;

export interface AssetPackProvider {
  capabilities(): { generate: boolean; editFromReference: boolean; maxAssets: number };
  createPack(request: AssetPackRequest): Promise<AssetPackResult>;
}

export interface AssetPackRequest {
  schemaVersion: "asset-pack-request/1.0";
  consistencyGroup: AssetManifest["consistencyGroup"];
  assets: readonly AssetIntent[];
  budget: AssetGenerationBudget;
}

export type AssetPackResult =
  | {
      ok: true;
      provider: string;
      modelId: string;
      images: Array<{
        slotIndex: number;
        bytes: Buffer;
        mimeType: "image/png" | "image/jpeg" | "image/webp";
        prompt: string;
        promptSha256: `sha256:${string}`;
      }>;
      usage?: { inputTokens: number; outputTokens: number; cachedTokens: number; thinkingTokens: number };
      estimatedCostMicromxn: number;
      durationMs: number;
    }
  | {
      ok: false;
      code: "provider_unavailable" | "provider_timeout" | "provider_error" | "provider_blocked" | "invalid_provider_response" | "invalid_image" | "budget_exhausted";
      provider: string;
      modelId: string;
      usage?: { inputTokens: number; outputTokens: number; cachedTokens: number; thinkingTokens: number };
      durationMs: number;
    };
```

Read exact positive integers from:

- `OPENLEN_VISUAL_ENGINE_ASSET_RATE_CARD_VERSION`;
- `OPENLEN_VISUAL_ENGINE_ASSET_MAX_MICROMXN`;
- `OPENLEN_VISUAL_ENGINE_ASSET_ESTIMATED_IMAGE_MICROMXN`.

Return `null` if any field is missing. Throw for malformed present values. Never hardcode provider pricing.

- [ ] **Step 3: Implement the Gemini adapter with injected transport**

Use `OPENLEN_ASSET_IMAGE_MODEL`, falling back to the existing `OPENLEN_IMAGE_EDIT_MODEL`, then `gemini-2.5-flash-image`. Call the official `generateContent` image model with `responseModalities: ["IMAGE"]`; the first request contains only a bounded text prompt, and subsequent calls contain the first validated image plus a new bounded slot prompt. Parse inline image bytes and `usageMetadata`; ignore response text and never accept response URLs. Abort on the first failed slot and return no partial pack. Do not retry.

- [ ] **Step 4: Run Task 3 GREEN**

Run:

```powershell
npm.cmd test -- lib/generation/asset-image-validation.test.ts lib/generation/gemini-asset-pack-provider.test.ts lib/ai/image-edit-core.test.ts
npm.cmd run typecheck
git diff --check
```

Expected: all tests PASS; no network call occurs.

- [ ] **Step 5: Commit Task 3**

```powershell
git add lib/generation/asset-pack-provider.ts lib/generation/gemini-asset-pack-provider.ts lib/generation/gemini-asset-pack-provider.test.ts
git commit -m "feat(generation): add validated asset pack provider"
```

---

### Task 4: Hybrid orchestration, optional placeholder, and DOM application

**Files:**
- Create: `lib/generation/asset-pipeline.ts`
- Create: `lib/generation/asset-pipeline.test.ts`
- Create: `lib/generation/apply-asset-manifest.ts`
- Create: `lib/generation/apply-asset-manifest.test.ts`
- Modify: `lib/generation/asset-contracts.ts`
- Modify: `lib/generation/asset-contracts.test.ts`
- Modify: `lib/projects/assets.ts`
- Create: `lib/generation/project-asset-storage-contract.test.ts`
- Create: `public/openlen-assets/placeholders/neutral-abstract.svg`

**Interfaces:**
- Consumes: asset intents, curated resolver, optional generated provider, project ID, storage, and mode.
- Produces: `resolveDomainAssetManifest(input, deps): Promise<AssetPipelineResult>` and `applyAssetManifest(input): AppliedAssetManifestResult`.

```ts
export type AssetPipelineResult =
  | { ok: true; manifest: AssetManifest; trace: AssetResolutionTrace }
  | { ok: false; code: "required_asset_unavailable" | "asset_slot_unavailable" | "provider_error" | "storage_error" | "invalid_asset"; slotIndex?: number; trace: AssetResolutionTrace };

export type AppliedAssetManifestResult =
  | { ok: true; html: string; manifest: AssetManifest }
  | { ok: false; code: "asset_slot_unavailable" | "structural_invariant_failed" };
```

- [ ] **Step 1: Align the shared storage identity contract with RED coverage**

Add a regression proving newly stored image filenames use the full 64-character SHA-256 while legacy shorter filenames remain readable/listable. Change only new-write naming in `lib/projects/assets.ts`; do not migrate, delete, or rename existing assets.

Extend `AssetResolutionTraceSchema` with one optional strict `usage` object containing only nonnegative integer `inputTokens`, `outputTokens`, `cachedTokens`, and `thinkingTokens`. Add contract tests proving valid usage is accepted and unknown/private usage fields are rejected.

- [ ] **Step 2: Write RED hybrid-order and atomicity tests**

Cover these exact paths:

1. all required slots curated: zero provider/storage calls;
2. partial curated: provider receives only unresolved compatible slots;
3. generated complete: every byte validates and every stored URL is project-scoped;
4. provider or storage fails after one result: no success manifest and no partial HTML;
5. optional unresolved: trusted neutral placeholder;
6. required unresolved: `required_asset_unavailable`;
7. generated assets never mix consistency groups;
8. every success has canonical manifest hash, checksum, provenance, and redacted trace.

- [ ] **Step 3: Implement the hybrid resolver**

Use this exact order:

```ts
const curated = await resolveCuratedAssetPack(
  { intents: input.intents, direction: input.direction, images: await deps.loadCuratedImages(), catalogVersion: deps.catalogVersion },
  { fetchImpl: deps.fetchImpl },
);
const unresolved = requiredAndOptionalIntentsNotAssigned(curated);
const generated = mode === "hybrid" && unresolved.some((x) => x.required)
  ? await provider.createPack(generatedRequest(unresolved, consistencyGroup, budget))
  : null;
const finalAssignments = mergeWithoutChangingSlotOrder(curated, generated, optionalPlaceholders);
```

Store generated bytes only after the full provider pack validates. Inject `AssetStorage.put`; verify the returned filename is the exact full content hash plus the validated extension, ignore the backend public URL, and construct the canonical `/api/projects/<safe-id>/assets/<content-hash>.<ext>` route. Hash the canonical unsigned manifest, then set `manifestId` to that SHA-256. Build a trace containing counts, reason codes, provider/model, usage, estimated cost, duration, and manifest hash—never bytes, prompts, raw copy, backend public URLs, or response bodies.

- [ ] **Step 4: Add the trusted optional placeholder**

Create a static decorative SVG with no script, external references, text, metadata, animation, or event attributes. Use only fixed geometric shapes and currentColor-independent neutral fills. Record its repository checksum in placeholder provenance. It is allowed only for `required=false && identityBearing=false`.

- [ ] **Step 5: Write RED DOM-policy tests**

Assert the applier changes only `src`, `srcset`, and `alt` for exact replaceable slot indexes; rejects duplicate/missing slots, script/style/form/href/data attribute changes, more than one assignment per slot, and an asset manifest whose input fingerprint does not match.

- [ ] **Step 6: Implement `applyAssetManifest`**

Parse the original HTML once, derive replaceable image nodes using the same ordering as `structural-fingerprint.ts`, set only approved attributes, serialize, and prove `structureIsPreserved(before, after, { allowedAssetSlots })`. Return `structural_invariant_failed` rather than HTML when the proof fails.

- [ ] **Step 7: Run Task 4 GREEN**

Run:

```powershell
npm.cmd test -- lib/generation/asset-contracts.test.ts lib/generation/project-asset-storage-contract.test.ts lib/generation/asset-pipeline.test.ts lib/generation/apply-asset-manifest.test.ts lib/generation/structural-fingerprint.test.ts
npm.cmd run typecheck
git diff --check
```

Expected: all tests PASS and no provider/storage/network call escapes test doubles.

- [ ] **Step 8: Commit Task 4**

```powershell
git add lib/generation/asset-contracts.ts lib/generation/asset-contracts.test.ts lib/projects/assets.ts lib/generation/project-asset-storage-contract.test.ts lib/generation/asset-pipeline.ts lib/generation/asset-pipeline.test.ts lib/generation/apply-asset-manifest.ts lib/generation/apply-asset-manifest.test.ts public/openlen-assets/placeholders/neutral-abstract.svg
git commit -m "feat(generation): orchestrate hybrid asset manifests"
```

---

### Task 5: Integrate assets into skeleton, composition, repair, and Quick atomically

**Files:**
- Create: `lib/generation/asset-pipeline-mode.ts`
- Create: `lib/generation/asset-pipeline-mode.test.ts`
- Modify: `lib/generation/adapt-skeleton.ts`
- Modify: `lib/generation/adapt-skeleton.test.ts`
- Modify: `lib/generation/compose-sections.ts`
- Modify: `lib/generation/compose-sections.test.ts`
- Modify: `lib/generation/apply-visual-repair.ts`
- Modify: `lib/generation/apply-visual-repair.test.ts`
- Modify: `lib/generation/closed-loop-repair.ts`
- Modify: `lib/generation/closed-loop-repair.test.ts`
- Modify: `lib/curate/quick-visual-engine.ts`
- Modify: `lib/curate/quick-visual-engine.test.ts`
- Modify: `lib/curate/quick-section-composition.ts`
- Modify: `lib/curate/quick-section-composition.test.ts`
- Modify: `lib/curate/quick-visual-repair.ts`
- Modify: `lib/curate/quick-visual-repair.test.ts`
- Modify: `lib/projects/types.ts`
- Modify: `app/api/curate/route.ts`
- Modify: `lib/curate/curate-route.integration.test.ts`

**Interfaces:**
- Consumes: the Task 4 pipeline and existing Quick/2B/2C seams.
- Produces: one accepted HTML candidate plus optional `assetManifest`/`assetTrace` metadata, or the existing typed fallback.

- [ ] **Step 1: Write RED mode tests**

```ts
expect(parseAssetPipelineMode(undefined)).toBe("off");
expect(parseAssetPipelineMode("shadow")).toBe("shadow");
expect(parseAssetPipelineMode("curated")).toBe("curated");
expect(parseAssetPipelineMode("hybrid")).toBe("hybrid");
expect(parseAssetPipelineMode("on")).toBe("off");
```

Implement `assetPipelineMode()` from `OPENLEN_VISUAL_ENGINE_ASSETS`.

- [ ] **Step 2: Write RED adaptation ordering and off-parity tests**

Assert:

- `off` calls only the legacy `resolveSkeletonAssets` path and returns the exact old result shape;
- `curated` runs intent → manifest → apply before sanitize/fingerprint/render;
- `hybrid` receives project ID and provider/budget dependencies;
- `shadow` delivers legacy HTML, performs a curated-only manifest attempt, and cannot call provider/storage;
- a manifest/apply failure maps to the existing exact reason code and exposes no candidate HTML;
- success returns `assetManifest` and redacted `assetTrace`.

- [ ] **Step 3: Integrate the shared pipeline in `adaptTemplateSkeleton`**

Add this bounded input without changing required legacy callers:

```ts
assetContext?: {
  mode: AssetPipelineMode;
  projectId: string;
};
```

Keep the current compiler order. In `off`, execute existing code unchanged. In `curated|hybrid`, replace the legacy resolver call with `resolveDomainAssetManifest` plus `applyAssetManifest`. In `shadow`, use legacy HTML for delivery and invoke only an injected curated resolver; swallow its failure after emitting a redacted trace. Maintain the existing final sanitize, marker, fingerprint, and technical-render gates.

- [ ] **Step 4: Propagate context through 2B and Quick**

Add `projectId` and `assetMode` to `SkeletonCandidateInput`, `SectionCompositionCandidateInput`, and `ComposeSectionCandidateInput`. Allocate `projectId = crypto.randomUUID()` once in `app/api/curate/route.ts` after credit validation but before route construction; use the same ID in final database persistence. Pass the context through skeleton and composition to the shared adapter. Prove route `off` has the same preview count/order, project data, credit debit, and HTML fixture as before.

- [ ] **Step 5: Persist manifest and trace only with accepted candidates**

Extend both variants of `VisualEngineProjectMetadata` with:

```ts
assetManifest?: AssetManifest;
assetTrace?: AssetResolutionTrace;
```

Do not add database columns; these fields live inside existing `ProjectData.generation.visualEngine`. Fallback delivery contains neither field. Shadow delivery never persists its candidate manifest.

- [ ] **Step 6: Integrate the same pipeline into 2C repair**

Pass project asset context into `ApplyVisualRepairInput`. A successful `applyVisualRepairPlan` returns the replacement manifest/trace. `runClosedLoopVisualRepair` carries them only on an accepted final improvement. `runQuickVisualRepair` replaces prior manifest/trace only when the repair is accepted; otherwise it returns original HTML and original metadata exactly.

- [ ] **Step 7: Run focused integration GREEN**

Run:

```powershell
npm.cmd test -- lib/generation/asset-pipeline-mode.test.ts lib/generation/adapt-skeleton.test.ts lib/generation/compose-sections.test.ts lib/generation/apply-visual-repair.test.ts lib/generation/closed-loop-repair.test.ts lib/curate/quick-visual-engine.test.ts lib/curate/quick-section-composition.test.ts lib/curate/quick-visual-repair.test.ts lib/curate/curate-route.integration.test.ts
npm.cmd run typecheck
git diff --check
```

Expected: all focused tests PASS; off parity is exact.

- [ ] **Step 8: Commit Task 5**

Stage only the files listed in this task and commit:

```powershell
git add lib/generation/asset-pipeline-mode.ts lib/generation/asset-pipeline-mode.test.ts lib/generation/adapt-skeleton.ts lib/generation/adapt-skeleton.test.ts lib/generation/compose-sections.ts lib/generation/compose-sections.test.ts lib/generation/apply-visual-repair.ts lib/generation/apply-visual-repair.test.ts lib/generation/closed-loop-repair.ts lib/generation/closed-loop-repair.test.ts lib/curate/quick-visual-engine.ts lib/curate/quick-visual-engine.test.ts lib/curate/quick-section-composition.ts lib/curate/quick-section-composition.test.ts lib/curate/quick-visual-repair.ts lib/curate/quick-visual-repair.test.ts lib/curate/curate-route.integration.test.ts lib/projects/types.ts app/api/curate/route.ts
git commit -m "feat(generation): integrate domain asset pipeline"
```

---

### Task 6: Adversarial release gate and operations documentation

**Files:**
- Create: `docs/generation/visual-engine-assets-runbook.md`
- Modify: `package.json`
- Test: all Task 1–5 test files and existing Visual Engine regressions.

**Interfaces:**
- Consumes: the complete local asset pipeline.
- Produces: one deterministic non-live release command and an operator-ready runbook.

- [ ] **Step 1: Add the deterministic gate script**

Add one package script that invokes Vitest with every new asset test plus the existing skeleton, composition, repair, route, fingerprint, image-edit, and project metadata tests:

```json
"generation:visual-engine-assets:gate": "vitest run lib/generation/asset-contracts.test.ts lib/generation/asset-intent.test.ts lib/generation/asset-catalog.test.ts lib/generation/asset-image-validation.test.ts lib/generation/imagery-manifest.test.ts lib/generation/project-asset-storage-contract.test.ts lib/generation/gemini-asset-pack-provider.test.ts lib/generation/asset-pipeline.test.ts lib/generation/apply-asset-manifest.test.ts lib/generation/asset-pipeline-mode.test.ts lib/generation/skeleton-assets.test.ts lib/generation/adapt-skeleton.test.ts lib/generation/compose-sections.test.ts lib/generation/apply-visual-repair.test.ts lib/generation/closed-loop-repair.test.ts lib/curate/quick-visual-engine.test.ts lib/curate/quick-section-composition.test.ts lib/curate/quick-visual-repair.test.ts lib/curate/curate-route.integration.test.ts"
```

- [ ] **Step 2: Write the operator runbook**

Document exact meanings and precedence for:

- `OPENLEN_VISUAL_ENGINE_ASSETS=off|shadow|curated|hybrid`;
- `OPENLEN_ASSET_IMAGE_MODEL`;
- the three required asset budget variables;
- `OPENLEN_APP_BASE_URL` behavior for existing storage metadata, while generated manifests use the canonical same-origin `/api/projects/<id>/assets/<hash>.<ext>` route;
- curated host allowlist and generated MIME/size/dimension bounds;
- redacted trace fields and forbidden telemetry;
- provider, validation, storage, required-slot, and structural failures;
- rollback to `off` without changing other Visual Engine modes;
- no-retry/max-three behavior;
- separately authorized paid canary of at most three synthetic cases.

- [ ] **Step 3: Run the focused deterministic gate**

Run:

```powershell
npm.cmd run generation:visual-engine-assets:gate
npm.cmd run typecheck
npm.cmd run generation:visual-engine-2a:rollback-check
git diff --check
```

Expected: all exit 0 and rollback reports `verified=true`.

- [ ] **Step 4: Run the complete repository suite once**

Run: `npm.cmd test -- --reporter=dot`

Expected: exit 0. Do not restart merely because output is quiet; wait on the same process up to the repository's established full-suite timeout.

- [ ] **Step 5: Perform privacy and scope audit**

Verify staged files contain no `.env`, API keys, emails, absolute local paths, image bytes, provider bodies, raw HTML fixtures from users, screenshots, generated evidence, or reviewer identity. Verify all user-owned untracked files remain untouched.

Run:

```powershell
git diff --cached --check
git diff --cached --name-only
git status --short
```

- [ ] **Step 6: Commit Task 6**

```powershell
git add package.json docs/generation/visual-engine-assets-runbook.md
git commit -m "docs(generation): operationalize domain asset pipeline"
```

## Self-Review Results

- Spec coverage: contracts, hybrid order, curated compatibility, generated packs, byte validation, provenance, storage, atomic application, 2B/2C integration, privacy, feature modes, rollback, and acceptance gates each map to a task.
- Scope: this is one testable subsystem. Plan 6 learning/enterprise rollout remains a separate final program block and is not mixed into this plan.
- Placeholder scan: the plan contains no deferred implementation markers or unspecified error-handling steps.
- Type consistency: `AssetIntent`, `AssetManifest`, `AssetResolutionTrace`, `AssetPackProvider`, `resolveDomainAssetManifest`, `applyAssetManifest`, and `AssetPipelineMode` names remain consistent across all tasks.
- External behavior: `off` preserves the existing resolver; shadow makes no paid calls; user Quick credit semantics do not change.
