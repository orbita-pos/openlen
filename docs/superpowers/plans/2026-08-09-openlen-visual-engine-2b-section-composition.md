# OpenLen Visual Engine 2B Section Composition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a deterministic, atomic `section_composition` path that reuses OpenLen's section assembler and 2A visual adaptation boundary while preserving every requested semantic role.

**Architecture:** Safe Selection remains the route authority. A pure planner maps canonical required roles to audited section component capabilities, a frozen published inventory resolves deterministic variants, and the existing assembler creates one neutral skeleton with role markers. The existing 2A adaptation boundary applies the final creative identity and assets without structural mutation; Quick publishes only a fully validated candidate or the complete weighted fallback.

**Tech Stack:** TypeScript, Next.js route handlers, Vitest, Zod, Drizzle/Postgres read boundaries, `node-html-parser`, PostCSS, existing Gemini gateway, existing section storage, existing Visual Engine pilot ledger.

## Global Constraints

- Run 2B only for a Safe Selection decision whose route is exactly `section_composition`.
- Preserve `template_full` and `template_skeleton` behavior and all 2A thresholds.
- Reuse `lib/sections`, `lib/assemble/fill.ts`, `adaptTemplateSkeleton`, assets, sanitizer, critic, pilot ledger, and Quick persistence boundaries; do not rebuild them.
- Keep the legacy `buildRecipe()` out of Visual Engine 2B.
- Never substitute a merely similar visual section for an incompatible semantic role.
- Require complete role coverage before any provider call, preview, persistence, or debit.
- No retries, silent reselection, partial delivery, or second terminal ledger completion.
- `off`, `shadow`, and `skeleton` retain their current meanings; only `composition` may deliver 2B.
- No Gemini call, database pilot write, deployment, or flag activation during implementation and local qualification.
- A later paid smoke requires separate explicit authorization and is capped by design at 15 cases and a recommended 20 MXN.
- Work on local `master` as authorized; stage only exact scoped paths and preserve every unrelated tracked or untracked user artifact.

## File map

- `lib/generation/section-composition-contracts.ts`: strict schemas, versions, result codes, plan and redacted manifest types.
- `lib/generation/section-plan.ts`: pure role-to-component compatibility table, ordering, chrome, and coverage planning.
- `lib/generation/section-inventory.ts`: published inventory projection/hash, deterministic variant resolution, fragment fetch/hash verification.
- `lib/generation/compose-sections.ts`: atomic neutral stitch → fill → 2A adaptation → validation candidate pipeline.
- `lib/curate/quick-section-composition.ts`: Quick delivery/fallback and shadow 2B ledger orchestration.
- `lib/generation/visual-engine-2b-cohort.ts`: frozen 15-case local/pilot corpus.
- `scripts/visual-engine-2b-qualify.ts`: read-only reproducible local qualification CLI.
- `scripts/visual-engine-2b-eval.ts`: disabled-by-default bounded pilot CLI; implementation only, never executed by this plan.
- Existing files are modified only where their public contracts must include the new mode, metadata route, role markers, or Quick integration.

## Test fixture conventions

Each test file defines its fixtures locally. Hash constants use valid literal shapes:

```ts
const SHA_A = `sha256:${"a".repeat(64)}`;
const SHA_B = `sha256:${"b".repeat(64)}`;
const SHA_C = `sha256:${"c".repeat(64)}`;
const SHA_D = `sha256:${"d".repeat(64)}`;
const HASH_12_A = "a".repeat(12);
const HASH_12_B = "b".repeat(12);
const HASH_12_C = "c".repeat(12);
```

`COLORING_INTENT` is parsed with `IntentAnalysisSchema` and contains required roles `hero`, `coloring_gallery`, `minigames`, `stories`, and `activities`, audience `children`, domain `creative_play`, required signal `coloring_art`, and forbidden signal `corporate_dashboard`. `DIRECTION` is parsed with `CreativeDirectionSchema` using the existing cream/pastel/rounded children's fixture from `lib/curate/quick-visual-engine.test.ts`. `INVENTORY`, `SELECTION`, `ADAPTED`, and `COLORING_INPUT` are strict local fixtures built from those schemas; they never contain live provider, database, filesystem, or user data.

---

### Task 1: Versioned 2B contracts, mode, metadata, and telemetry vocabulary

**Files:**
- Create: `lib/generation/section-composition-contracts.ts`
- Create: `lib/generation/section-composition-contracts.test.ts`
- Modify: `lib/generation/visual-engine-mode.ts`
- Modify: `lib/generation/visual-engine-mode.test.ts`
- Modify: `lib/generation/visual-engine-pilot-store.ts`
- Modify: `lib/generation/visual-engine-pilot-store.test.ts`
- Modify: `lib/projects/types.ts`

**Interfaces:**
- Consumes: `CanonicalSectionRole`, `SectionType`, `CreativeDirection`.
- Produces: `SECTION_PLAN_VERSION`, `SECTION_COMPOSITION_MANIFEST_VERSION`, `SectionPlanSchema`, `SectionCompositionManifestSchema`, `SectionCompositionResultCode`, and `VisualEngineMode = "off" | "shadow" | "skeleton" | "composition"`.
- Produces project metadata as a discriminated union on `route`, preserving the current skeleton shape unchanged.

- [ ] **Step 1: Write failing contract and mode tests**

```ts
it("accepts composition as the only new delivery mode", () => {
  expect(visualEngineMode("composition")).toBe("composition");
  expect(visualEngineMode("COMPOSITION")).toBe("off");
});

it("rejects prose and content from the redacted manifest", () => {
  expect(SectionCompositionManifestSchema.safeParse({
    schemaVersion: "section-composition-manifest/1.0",
    intentHash: SHA_A,
    creativeDirectionHash: SHA_B,
    inventoryHash: SHA_C,
    orderedRoles: ["hero", "activities", "footer"],
    selectedSectionIds: ["hero-01", "features-02", "footer-01"],
    selectedContentHashes: [HASH_12_A, HASH_12_B, HASH_12_C],
    compatibilityRuleIds: ["section_component:exact:hero", "section_component:structural:activities>features", "section_component:exact:footer"],
    outputHash: SHA_D,
    resultCode: "composed",
    html: "<html>secret</html>",
  }).success).toBe(false);
});
```

Test these exact result codes: `composed`, `route_ineligible`, `unsupported_section_role`, `section_inventory_stale`, `section_fragment_unavailable`, `section_fragment_stale`, `section_role_coverage_failed`, `inherited_copy_leak`, `provider_timeout`, `provider_error`, `invalid_provider_response`, `model_incompatible`, `css_policy_violation`, `contrast_violation`, `required_asset_unavailable`, `sanitization_failed`, `technical_render_failed`, `internal_error`.

- [ ] **Step 2: Run the RED tests**

Run:

```powershell
npm.cmd test -- lib/generation/section-composition-contracts.test.ts lib/generation/visual-engine-mode.test.ts lib/generation/visual-engine-pilot-store.test.ts
```

Expected: FAIL because the contract module and `composition` mode do not exist.

- [ ] **Step 3: Implement strict contracts and extend the discriminated metadata union**

Use strict schemas and hash patterns:

```ts
export const SECTION_PLAN_VERSION = "section-plan/1.0" as const;
export const SECTION_COMPOSITION_MANIFEST_VERSION = "section-composition-manifest/1.0" as const;
const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const ContentHashSchema = z.string().regex(/^[a-f0-9]{12}$/);

export const SectionPlanRowSchema = z.object({
  ordinal: z.number().int().min(0).max(31),
  requestedRole: z.enum(CANONICAL_SECTION_ROLES),
  componentType: z.enum(SECTION_TYPES),
  compatibilityKind: z.enum(["exact", "alias", "structural"]),
  compatibilityScore: z.number().min(0).max(1),
  compatibilityRuleId: z.string().regex(/^section_component:[a-z0-9_>:-]+$/).max(120),
  required: z.literal(true),
}).strict();
```

Add the six section-specific failure codes to `PilotReasonCode`. Change `VisualEngineProjectMetadata` into:

```ts
export type VisualEngineProjectMetadata =
  | {
      schemaVersion: "visual-engine-project/1.0";
      route: "template_skeleton";
      templateId: string;
      creativeDirection: CreativeDirection;
      promptVersion: string;
      policyVersion: string;
      contractVersion: "creative-direction/1.0";
      structuralFingerprintBefore: string;
      structuralFingerprintAfter: string;
    }
  | {
      schemaVersion: "visual-engine-project/1.0";
      route: "section_composition";
      templateId: null;
      creativeDirection: CreativeDirection;
      promptVersion: string;
      policyVersion: string;
      contractVersion: "creative-direction/1.0";
      compositionManifest: SectionCompositionManifest;
    };
```

- [ ] **Step 4: Run focused tests and typecheck**

```powershell
npm.cmd test -- lib/generation/section-composition-contracts.test.ts lib/generation/visual-engine-mode.test.ts lib/generation/visual-engine-pilot-store.test.ts
npm.cmd run typecheck
```

Expected: all pass; existing skeleton metadata fixtures still compile without casts.

- [ ] **Step 5: Commit Task 1**

```powershell
git add -- lib/generation/section-composition-contracts.ts lib/generation/section-composition-contracts.test.ts lib/generation/visual-engine-mode.ts lib/generation/visual-engine-mode.test.ts lib/generation/visual-engine-pilot-store.ts lib/generation/visual-engine-pilot-store.test.ts lib/projects/types.ts
git diff --cached --check
git commit -m "feat(generation): add section composition contracts"
```

---

### Task 2: Deterministic semantic section planner

**Files:**
- Create: `lib/generation/section-plan.ts`
- Create: `lib/generation/section-plan.test.ts`
- Modify: `lib/generation/taxonomy-compatibility.ts`
- Modify: `lib/generation/taxonomy-compatibility.test.ts`

**Interfaces:**
- Consumes: `IntentAnalysis`, `SectionPlan`, canonical roles, and an `inventoryHash`.
- Produces: `sectionComponentCompatibility(requestedRole, componentType)`, `planSectionComposition(input)`, and `SectionPlanningResult`.

- [ ] **Step 1: Write RED tests for the audited compatibility table**

```ts
it.each([
  ["hero", "hero", "exact", 1],
  ["header", "navbar", "alias", 1],
  ["call_to_action", "cta", "alias", 1],
  ["coloring_gallery", "gallery", "structural", 0.85],
  ["minigames", "features", "structural", 0.85],
  ["stories", "features", "structural", 0.85],
  ["activities", "features", "structural", 0.85],
  ["reservations", "contact", "structural", 0.85],
  ["clients", "logos", "alias", 1],
  ["membership", "pricing", "structural", 0.85],
])("maps %s to %s", (role, type, kind, score) => {
  expect(sectionComponentCompatibility(role, type)).toMatchObject({ kind, score });
});

it.each([
  ["stories", "testimonials"],
  ["minigames", "pricing"],
  ["activities", "logos"],
])("rejects misleading substitution %s → %s", (role, type) => {
  expect(sectionComponentCompatibility(role, type)).toEqual({ kind: "none", score: 0, ruleId: null });
});
```

The audited structural table is fixed to:

- neutral cards (`features`): `services`, `programs`, `menu`, `events`, `schedule`, `profile_summary`, `link_list`, `featured_content`, `content_list`, `minigames`, `stories`, `activities`, `use_cases`, `case_studies`, `blog`, `news`, `newsletter`;
- visual collection (`gallery`): `coloring_gallery`, `products`;
- contact surface (`contact`): `reservations`, `booking`, `location`, `social_links`;
- trust logos (`logos`): `clients`;
- tier cards (`pricing`): `membership`.

- [ ] **Step 2: Write RED planner tests**

```ts
it("plans the coloring platform without losing role identity", () => {
  const result = planSectionComposition({
    intent: COLORING_INTENT,
    intentHash: SHA_A,
    inventoryHash: SHA_B,
    availableTypes: new Set(["navbar", "hero", "gallery", "features", "footer"]),
  });
  expect(result).toMatchObject({ ok: true });
  if (!result.ok) throw new Error(result.code);
  expect(result.plan.rows.map(({ requestedRole, componentType }) => [requestedRole, componentType])).toEqual([
    ["header", "navbar"],
    ["hero", "hero"],
    ["coloring_gallery", "gallery"],
    ["minigames", "features"],
    ["stories", "features"],
    ["activities", "features"],
    ["footer", "footer"],
  ]);
});
```

Also test: duplicate input roles rejected; absent `navbar`/`footer` leaves chrome unadded rather than failing; a required unsupported role returns `unsupported_section_role`; rows are stable; repeated component types keep distinct roles and ordinals.

- [ ] **Step 3: Run RED**

```powershell
npm.cmd test -- lib/generation/section-plan.test.ts lib/generation/taxonomy-compatibility.test.ts
```

Expected: FAIL because the planner and component compatibility function are missing.

- [ ] **Step 4: Implement the pure planner**

Use an explicit table, never fuzzy matching:

```ts
export function planSectionComposition(input: PlanSectionCompositionInput): SectionPlanningResult {
  const roles = addAvailableChrome(input.intent.functional.requiredSections, input.availableTypes);
  if (new Set(roles).size !== roles.length) return { ok: false, code: "section_role_coverage_failed" };
  const rows = roles.map((requestedRole, ordinal) => {
    const match = bestAuditedComponent(requestedRole, input.availableTypes);
    return match === null ? null : { ordinal, requestedRole, ...match, required: true as const };
  });
  if (rows.some((row) => row === null)) return { ok: false, code: "unsupported_section_role" };
  return { ok: true, plan: SectionPlanSchema.parse({
    schemaVersion: SECTION_PLAN_VERSION,
    intentHash: input.intentHash,
    inventoryHash: input.inventoryHash,
    rows,
  }) };
}
```

Canonical order is navbar, hero, logos, features/card roles in original relative order, how-it-works, testimonials, pricing, integrations, gallery, faq, about, team, contact, cta, footer. A repeated component type never collapses rows.

- [ ] **Step 5: Run GREEN and typecheck**

```powershell
npm.cmd test -- lib/generation/section-plan.test.ts lib/generation/taxonomy-compatibility.test.ts lib/generation/score-template.test.ts
npm.cmd run typecheck
```

- [ ] **Step 6: Commit Task 2**

```powershell
git add -- lib/generation/section-plan.ts lib/generation/section-plan.test.ts lib/generation/taxonomy-compatibility.ts lib/generation/taxonomy-compatibility.test.ts
git diff --cached --check
git commit -m "feat(generation): plan compatible page sections"
```

---

### Task 3: Frozen published inventory, deterministic variants, and verified fragment fetch

**Files:**
- Create: `lib/generation/section-inventory.ts`
- Create: `lib/generation/section-inventory.test.ts`
- Modify: `lib/sections/select.ts`
- Modify: `lib/sections/select.test.ts`

**Interfaces:**
- Consumes: `SectionRecord[]`, `SectionPlan`, `CreativeDirection | null` for selection signals, and injected fragment fetch.
- Produces: `buildSectionCompositionInventory(records)`, `resolveSectionPlan(plan, inventory, direction)`, `fetchVerifiedSectionFragments(selection, inventory, deps)`.

- [ ] **Step 1: Write RED inventory allowlist and determinism tests**

```ts
it("projects only published scalar metadata and hashes canonically", () => {
  const first = buildSectionCompositionInventory([DRAFT, PUBLISHED_B, PUBLISHED_A]);
  const second = buildSectionCompositionInventory([PUBLISHED_A, DRAFT, PUBLISHED_B]);
  expect(first).toEqual(second);
  expect(first.entries.map((row) => row.id)).toEqual(["features-01", "hero-01"]);
  expect(JSON.stringify(first)).not.toContain("storageUrl");
  expect(JSON.stringify(first)).not.toContain("<html");
});
```

Inventory entries contain only `id`, `type`, `mode`, `contentHash`, `radiusBucket`, `density`, `needsJs`, and `assetCapability`. `density` may be `unknown`; it must never be guessed from prose.

- [ ] **Step 2: Write RED selection and fetch-integrity tests**

```ts
it("selects repeatable but distinct card variants for repeated semantic roles", () => {
  const selected = resolveSectionPlan(COLORING_PLAN, INVENTORY, DIRECTION);
  expect(selected.map((row) => row.requestedRole)).toEqual(["header", "hero", "coloring_gallery", "minigames", "stories", "activities", "footer"]);
  expect(selected.filter((row) => row.componentType === "features").map((row) => row.sectionId)).toEqual([
    "features-01", "features-02", "features-03",
  ]);
});

it("rejects fetched bytes whose 12-char content hash changed", async () => {
  const result = await fetchVerifiedSectionFragments(SELECTION, INVENTORY, {
    fetchText: async () => "changed bytes",
  });
  expect(result).toEqual({ ok: false, code: "section_fragment_stale" });
});
```

Also test missing bytes, an inventory hash changed after planning, unpublished entries, JS rejection when the plan does not allow interaction, exact tie order, and no silent alternate selection after a fetch failure.

- [ ] **Step 3: Run RED**

```powershell
npm.cmd test -- lib/generation/section-inventory.test.ts lib/sections/select.test.ts
```

- [ ] **Step 4: Implement pure inventory and seeded ranking**

Use `canonicalJsonSha256()` and a stable seed derived from `intentHash + inventoryHash + ordinal + requestedRole`. Extend variant ranking with optional density/radius signals, while preserving current `scoreVariant()` behavior for `/api/assemble` callers.

```ts
export function resolveSectionPlan(
  plan: SectionPlan,
  inventory: SectionCompositionInventory,
  direction: CreativeDirection | null,
): SectionSelectionRow[] {
  return plan.rows.map((row) => selectOne(row, inventory, direction, stableSeed(row, plan)));
}
```

Verified fetching uses the frozen record's storage URL internally but never places it in the inventory or manifest. Hash `html` with the same `sha256(...).slice(0, 12)` rule used by `upsertSection`.

- [ ] **Step 5: Run GREEN and regression**

```powershell
npm.cmd test -- lib/generation/section-inventory.test.ts lib/sections/select.test.ts lib/sections/assemble.test.ts
npm.cmd run typecheck
```

- [ ] **Step 6: Commit Task 3**

```powershell
git add -- lib/generation/section-inventory.ts lib/generation/section-inventory.test.ts lib/sections/select.ts lib/sections/select.test.ts
git diff --cached --check
git commit -m "feat(generation): freeze section composition inventory"
```

---

### Task 4: Atomic composition candidate using the existing 2A adaptation boundary

**Files:**
- Create: `lib/generation/compose-sections.ts`
- Create: `lib/generation/compose-sections.test.ts`
- Modify: `lib/sections/assemble.ts`
- Modify: `lib/sections/assemble.test.ts`
- Modify: `lib/assemble/fill.ts`
- Modify: `lib/assemble/fill.test.ts`
- Modify: `lib/style-match/autofill/fill-template.ts`
- Modify: `lib/style-match/autofill/fill-template.test.ts`

**Interfaces:**
- Consumes: `IntentAnalysis`, frozen inventory, `ExtractedBusinessData`, brand accent, policy version, and injectable planner/fetch/stitch/fill/adapt/finalize functions.
- Produces: `composeSectionCandidate(input, deps): Promise<SectionCompositionResult>`.

- [ ] **Step 1: Write RED role-marker and assembler tests**

```ts
it("marks every fragment with its semantic owner without changing its component type", () => {
  const html = assembleDocument([
    { slug: "features-01", type: "features", requestedRole: "minigames", html: FEATURE_HTML },
    { slug: "features-02", type: "features", requestedRole: "stories", html: FEATURE_HTML_2 },
  ], COMPOSITION_BASE_THEME);
  expect(html).toContain('data-openlen-role="minigames"');
  expect(html).toContain('data-openlen-role="stories"');
  expect(html).not.toContain('data-openlen-role="features"');
});
```

`requestedRole` is optional on `SectionFragment` so current assembler callers remain source-compatible. Insert it only on the fragment's single root element; fail with `section_role_coverage_failed` when a fragment has zero or multiple roots.

- [ ] **Step 2: Write RED candidate success and failure-matrix tests**

```ts
it("stitches, fills, adapts, validates and returns one redacted manifest", async () => {
  const result = await composeSectionCandidate(COLORING_INPUT, deps({ adaptation: ADAPTED }));
  expect(result).toMatchObject({
    ok: true,
    status: "composed",
    creativeDirection: DIRECTION,
    manifest: {
      schemaVersion: "section-composition-manifest/1.0",
      orderedRoles: ["header", "hero", "coloring_gallery", "minigames", "stories", "activities", "footer"],
      resultCode: "composed",
    },
  });
  expect(result.ok && result.html).toContain('data-openlen-role="stories"');
  expect(JSON.stringify(result)).not.toContain(COLORING_INPUT.brief);
});
```

Table-test every first-failure boundary: route, unsupported role, stale inventory, missing fragment, stale fragment, malformed root, fill leak, provider timeout/error/schema/incompatible, token/contrast/asset/sanitizer/render failure, post-adaptation role mismatch, and unexpected exception. Assert no later dependency runs after the first failure.

- [ ] **Step 3: Run RED**

```powershell
npm.cmd test -- lib/generation/compose-sections.test.ts lib/sections/assemble.test.ts lib/assemble/fill.test.ts lib/style-match/autofill/fill-template.test.ts
```

- [ ] **Step 4: Implement the neutral skeleton and role-aware copy instruction**

Add a fixed, non-brand `COMPOSITION_BASE_THEME` used only to bind fragment dialects. Do not derive it from the brief. Extend the cloned fill message only when `data-openlen-role` exists:

```ts
const ROLE_MARKER_ADDENDUM = `Elements inside data-openlen-role must describe that exact role.
Do not rename minigames as features, stories as testimonials, activities as services,
or any other role as the source component's original business purpose.`;
```

The marker is input structure, not user instruction. It never changes the allowed leaf-op protocol.

- [ ] **Step 5: Implement `composeSectionCandidate` as one in-memory transaction**

```ts
export async function composeSectionCandidate(input: ComposeSectionCandidateInput, deps: ComposeSectionCandidateDeps = {}): Promise<SectionCompositionResult> {
  if (input.route !== "section_composition") return fail("route_ineligible");
  const inventory = await loadFrozenInventory(deps);
  const planning = planSectionComposition({ intent: input.intent, intentHash: input.intentHash, inventoryHash: inventory.hash, availableTypes: inventory.availableTypes });
  if (!planning.ok) return fail(planning.code);
  const selection = resolveSectionPlan(planning.plan, inventory, null);
  const fetched = await fetchVerifiedSectionFragments(selection, inventory, deps);
  if (!fetched.ok) return fail(fetched.code);
  const stitched = assembleDocument(fetched.fragments, COMPOSITION_BASE_THEME);
  const fill = await fillAssembled(stitched, input.copy, { onStage: input.onStage });
  if ((fill.leaksAfter ?? 0) > 0) return fail("inherited_copy_leak");
  const adapted = await adaptTemplateSkeleton({
    html: normalizeBornCanonical(fill.html),
    templateId: `composition:${inventory.hash}`,
    intent: input.intent,
    templateMetadata: metadataFromIntent(input.intent),
    brand: input.brand,
  });
  if (!adapted.ok) return fail(mapAdaptationReason(adapted.reasonCode), adapted);
  return validateAndBuildSuccess(adapted, planning.plan, selection, inventory, fill, input);
}
```

Build the manifest only from hashes, roles, IDs, 12-char content hashes, rule IDs, and result code. Reparse the final HTML and require exactly one marker for every planned row in ordinal order.

- [ ] **Step 6: Run GREEN, compiler/assets regression, and typecheck**

```powershell
npm.cmd test -- lib/generation/compose-sections.test.ts lib/sections/assemble.test.ts lib/assemble/fill.test.ts lib/style-match/autofill/fill-template.test.ts lib/generation/adapt-skeleton.test.ts lib/generation/creative-compiler.test.ts lib/generation/skeleton-assets.test.ts
npm.cmd run typecheck
```

- [ ] **Step 7: Commit Task 4**

```powershell
git add -- lib/generation/compose-sections.ts lib/generation/compose-sections.test.ts lib/sections/assemble.ts lib/sections/assemble.test.ts lib/assemble/fill.ts lib/assemble/fill.test.ts lib/style-match/autofill/fill-template.ts lib/style-match/autofill/fill-template.test.ts
git diff --cached --check
git commit -m "feat(generation): compose themed section candidates"
```

---

### Task 5: Quick delivery, shadow pilot, atomic fallback, and route integration

**Files:**
- Create: `lib/curate/quick-section-composition.ts`
- Create: `lib/curate/quick-section-composition.test.ts`
- Modify: `lib/curate/quick-visual-engine.ts`
- Modify: `lib/curate/quick-visual-engine.test.ts`
- Modify: `app/api/curate/route.ts`
- Modify: `lib/curate/curate-route.integration.test.ts`

**Interfaces:**
- Consumes: `composeSectionCandidate`, weighted fallback builder, pilot reserve/complete, current Quick commit seam.
- Produces: composition-aware `QuickVisualEngineRoutePlan`, `runSectionCompositionCandidate`, and `launchShadowSectionCompositionCandidate`.

- [ ] **Step 1: Write RED route-precedence tests**

```ts
it.each([
  ["off", "section_composition", "weighted"],
  ["shadow", "section_composition", "weighted"],
  ["skeleton", "section_composition", "weighted"],
  ["composition", "section_composition", "section_composition"],
  ["composition", "template_skeleton", "template_skeleton"],
  ["composition", "template_full", "template_full"],
])("maps %s / %s to %s", (mode, safeRoute, expected) => {
  expect(planQuickVisualEngineRoute({ mode, weightedTemplateId: "weighted", safeResult: safe(safeRoute, templateIdFor(safeRoute)) }).delivery.kind).toBe(expected);
});
```

For shadow, assert a typed `shadowCandidate` union (`template_skeleton` or `section_composition`) replaces the skeleton-only `shadowTemplateId` without delaying baseline delivery.

- [ ] **Step 2: Write RED atomic delivery/fallback tests**

Cover success, every typed composition failure, fallback build failure, preview/persist order, project metadata, credit invariants, no intermediate preview, and no creative charge to the existing Quick user debit.

```ts
expect(events).toEqual(["preview:weighted-complete", "persist"]);
expect(JSON.stringify(events)).not.toContain("neutral-skeleton");
expect(JSON.stringify(events)).not.toContain("partially-adapted");
```

- [ ] **Step 3: Write RED shadow ledger tests**

Assert phase `2b`, mode `shadow`, route `section_composition`, a redacted non-null surrogate template ID such as `section-composition`, reserve immediately before the first creative call, completion exactly once, `candidatePersisted: false`, safe usage propagation, and no candidate preview/persistence capability.

- [ ] **Step 4: Run RED**

```powershell
npm.cmd test -- lib/curate/quick-section-composition.test.ts lib/curate/quick-visual-engine.test.ts lib/curate/curate-route.integration.test.ts
```

- [ ] **Step 5: Implement Quick composition wrappers**

`runSectionCompositionCandidate` returns either a finalized composition result or a fully rebuilt weighted fallback. It never returns intermediate HTML. `launchShadowSectionCompositionCandidate` owns reservation/completion and catches only redacted errors.

In `route.ts`:

- await Safe Selection for `skeleton` and `composition` delivery modes;
- keep `shadow` Safe Selection and candidate outside the SSE critical path;
- send `recipe`/`selecting`/`stitching`/`filling` progress stages without exposing fragment IDs;
- call `commitQuickVisualEngineDocument` once with final HTML and metadata;
- preserve raw-template immediate preview only on existing weighted/full paths, never on composition.

- [ ] **Step 6: Run GREEN and off/skeleton regression**

```powershell
npm.cmd test -- lib/curate/quick-section-composition.test.ts lib/curate/quick-visual-engine.test.ts lib/curate/curate-route.integration.test.ts lib/curate/build-curated-document.test.ts
npm.cmd run typecheck
```

- [ ] **Step 7: Commit Task 5**

```powershell
git add -- lib/curate/quick-section-composition.ts lib/curate/quick-section-composition.test.ts lib/curate/quick-visual-engine.ts lib/curate/quick-visual-engine.test.ts app/api/curate/route.ts lib/curate/curate-route.integration.test.ts
git diff --cached --check
git commit -m "feat(curate): deliver section composition safely"
```

---

### Task 6: Frozen 15-case qualification, bounded pilot tooling, runbook, and final gate

**Files:**
- Create: `lib/generation/visual-engine-2b-cohort.ts`
- Create: `lib/generation/visual-engine-2b-cohort.test.ts`
- Create: `lib/generation/visual-engine-2b-qualification.ts`
- Create: `lib/generation/visual-engine-2b-qualification.test.ts`
- Create: `lib/generation/visual-engine-2b-qualify-cli.test.ts`
- Create: `scripts/visual-engine-2b-qualify.ts`
- Create: `lib/generation/visual-engine-2b-eval-cli.integration.test.ts`
- Create: `scripts/visual-engine-2b-eval.ts`
- Modify: `package.json`
- Modify: `scripts/visual-engine-2a-rollback-check.ts`
- Modify: `lib/generation/visual-engine-2a-eval.test.ts`
- Modify: `docs/generation/visual-engine-2a-runbook.md`

**Interfaces:**
- Consumes: the production planner/inventory/composer through injected boundaries.
- Produces: `VISUAL_ENGINE_2B_CASES`, `qualifyVisualEngine2BCohort`, `generation:visual-engine-2b:qualify`, and a disabled-unless-authorized `generation:visual-engine-2b:eval` command.

- [ ] **Step 1: Write the frozen cohort test**

Create exactly 15 synthetic briefs/intents across:

- 3 children/creative cases: coloring platform, stories club, printable activities;
- 2 restaurant/hospitality cases;
- 2 wellness/local-business cases;
- 2 technical SaaS cases;
- 2 editorial/portfolio cases;
- 2 content/community cases;
- 2 deliberately unsupported cases that must produce exact typed fallback.

Each case contains only synthetic brief, expected canonical intent, expected ordered roles, expected component types or expected fallback code, required visual signals, and forbidden visual signals. Assert 15 distinct IDs and no email, key, URL, absolute path, or real user data.

- [ ] **Step 2: Write RED qualification tests**

```ts
it("qualifies all 15 rows without provider or persistence capabilities", async () => {
  const deps = {
    loadPublishedSections: async () => SECTION_RECORD_FIXTURES,
    qualifyCase: async (row: VisualEngine2BCase) => LOCAL_RESULTS_BY_ID[row.id],
    commitSha: async () => "a".repeat(40),
  };
  const result = await qualifyVisualEngine2BCohort(deps);
  expect(result).toMatchObject({ ok: true, counts: { total: 15, qualified: 13, typedFallback: 2 } });
  expect(deps).not.toHaveProperty("generateCreativeDirection");
  expect(deps).not.toHaveProperty("persist");
});
```

The ignored manifest path is `scratch/visual-engine-2b/qualification.json`. It contains versions, commit hash, inventory hash, case IDs, plan/result hashes, result codes, counts, and canonical self-hash only.

- [ ] **Step 3: Write RED CLI and paid-guard tests**

Qualification must be read-only and atomically write its ignored manifest. Eval must refuse unless all are true:

- `OPENLEN_VISUAL_ENGINE=shadow`;
- qualification is current and self-hash-valid;
- current HEAD and inventory match the qualification;
- phase 2b quota is unused and sufficient for exactly 15 starts;
- a complete rate card is present;
- `OPENLEN_VISUAL_ENGINE_2B_PILOT_BUDGET_MICROMXN` is an integer from 1 through `20000000`;
- an explicit CLI confirmation token equals `AUTHORIZED_2B_SMOKE_ONCE`.

The integration test injects provider, DB, renderer, critic, and filesystem boundaries. It proves 15 sequential starts, no retry, complete cost rows, redacted terminal output, and no work before every preflight check passes.

- [ ] **Step 4: Run RED**

```powershell
npm.cmd test -- lib/generation/visual-engine-2b-cohort.test.ts lib/generation/visual-engine-2b-qualification.test.ts lib/generation/visual-engine-2b-qualify-cli.test.ts lib/generation/visual-engine-2b-eval-cli.integration.test.ts
```

- [ ] **Step 5: Implement qualification and pilot tooling without executing the pilot**

Add scripts:

```json
{
  "generation:visual-engine-2b:qualify": "tsx --env-file=.env.local --tsconfig tsconfig.eval.json --require ./scripts/test-node-server-only-shim.cjs scripts/visual-engine-2b-qualify.ts",
  "generation:visual-engine-2b:eval": "tsx --env-file=.env.local --tsconfig tsconfig.eval.json --require ./scripts/test-node-server-only-shim.cjs scripts/visual-engine-2b-eval.ts"
}
```

Do not invoke the eval command in this plan. The eval source must lazy-import provider/DB modules only after all pure artifact, HEAD, inventory, mode, quota, and cost gates pass.

- [ ] **Step 6: Extend rollback and runbook**

Rollback fixture must capture `unset`, `off`, `shadow`, `skeleton`, and `composition`. Assert unset/off delivery equivalence, shadow non-delivery, skeleton 2A-only delivery, composition 2A+2B delivery, and restoration of the original environment in `finally`.

Document exact commands, the 20 MXN recommended cap, separate authorization, privacy allowlist, immediate kill switch, no 75-case requirement, and the boundary to 2C.

- [ ] **Step 7: Run the complete non-live gate**

```powershell
npm.cmd test -- lib/generation/section-composition-contracts.test.ts lib/generation/visual-engine-mode.test.ts lib/generation/visual-engine-pilot-store.test.ts lib/generation/section-plan.test.ts lib/generation/taxonomy-compatibility.test.ts lib/generation/section-inventory.test.ts lib/sections/select.test.ts lib/generation/compose-sections.test.ts lib/sections/assemble.test.ts lib/assemble/fill.test.ts lib/style-match/autofill/fill-template.test.ts lib/curate/quick-section-composition.test.ts lib/curate/quick-visual-engine.test.ts lib/curate/curate-route.integration.test.ts lib/generation/visual-engine-2b-cohort.test.ts lib/generation/visual-engine-2b-qualification.test.ts lib/generation/visual-engine-2b-qualify-cli.test.ts lib/generation/visual-engine-2b-eval-cli.integration.test.ts lib/generation/analyze-intent.test.ts lib/generation/safe-selection.test.ts lib/generation/adapt-skeleton.test.ts
npm.cmd run typecheck
npm.cmd run generation:visual-engine-2a:rollback-check
npm.cmd run generation:visual-engine-2b:qualify
```

Run qualification twice on the same clean committed candidate and compare SHA-256 of `scratch/visual-engine-2b/qualification.json`; both hashes must match.

- [ ] **Step 8: Audit privacy, scope, and staged diff**

```powershell
git diff --check
git status --short --untracked-files=no
git check-ignore -v scratch/visual-engine-2b/qualification.json
git diff --cached --check
git diff --cached --name-only
```

Reject the commit if staged paths include `.env*`, `scratch/`, screenshots, HTML evidence, raw responses, generated native bindings, reviewer identity, emails, keys, or unrelated user files.

- [ ] **Step 9: Commit Task 6**

```powershell
git add -- lib/generation/visual-engine-2b-cohort.ts lib/generation/visual-engine-2b-cohort.test.ts lib/generation/visual-engine-2b-qualification.ts lib/generation/visual-engine-2b-qualification.test.ts lib/generation/visual-engine-2b-qualify-cli.test.ts scripts/visual-engine-2b-qualify.ts lib/generation/visual-engine-2b-eval-cli.integration.test.ts scripts/visual-engine-2b-eval.ts package.json scripts/visual-engine-2a-rollback-check.ts lib/generation/visual-engine-2a-eval.test.ts docs/generation/visual-engine-2a-runbook.md
git diff --cached --check
git commit -m "test(generation): qualify Visual Engine 2B composition"
```

## Final completion gate

Before claiming 2B implementation complete:

1. Confirm all six commits exist and tracked status is clean.
2. Confirm focused 2A + 2B regression, typecheck, rollback, and qualification are fresh and green.
3. Confirm two qualification artifact hashes match on the exact final HEAD.
4. Confirm no paid eval, Gemini request, DB pilot write, deployment, or flag activation occurred.
5. Request an independent code review limited to Critical/Important correctness, security, privacy, atomicity, and rollout findings.
6. Fix only confirmed release blockers with TDD, rerun the affected focused gate once, and stop rather than opening optional hardening work.
