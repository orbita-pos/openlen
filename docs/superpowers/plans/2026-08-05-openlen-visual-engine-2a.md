# OpenLen Visual Engine 2A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activate Quick's `template_skeleton` route so OpenLen preserves a curated template's structure while applying a provider-generated, deterministically validated visual identity.

**Architecture:** Quick continues to own authentication, copy, profiles, normalization, sanitization, persistence, credits and SSE. A reusable safe selector chooses `template_full`, `template_skeleton` or fallback; the skeleton path builds a deterministic inventory, obtains one versioned creative response, compiles only allowlisted tokens/CSS/assets, and accepts the candidate only when its structural fingerprint is unchanged. Shadow evaluation and a persistent pilot ledger prove quality and cost before user-visible rollout.

**Tech Stack:** Next.js 15, TypeScript, Zod, Drizzle/PostgreSQL, `node-html-parser`, PostCSS, Culori, Gemini REST adapter, Puppeteer through existing render helpers, Vitest, existing `@inariwatch/capture` instrumentation.

## Global Constraints

- Implement only Visual Engine 2A for Quick; do not change Scratch, `/api/generate`, the Pro generator or the agent's full-redesign path.
- Preserve the current HTML, copy, profile, SEO, sanitization, project-version, thumbnail and credit engines; extract focused helpers only where Quick needs to reuse them.
- Do not add dependencies. Reuse Zod, PostCSS, `node-html-parser`, Culori and existing image/render infrastructure.
- Do not change `intent-analysis/1.0`, `intent-prompt/1.5`, `generation-decision/1.0`, `template-policy/1.0` or `taxonomy-compatibility/1.1` in 2A.
- Contract versions are exactly `creative-direction/1.0`, `skeleton-inventory/1.0`, `skeleton-adaptation-plan/1.0`, `skeleton-creative-response/1.0` and `visual-engine-project/1.0`.
- Model output never contains HTML, scripts, URLs, selectors or free-form CSS. CSS overrides are structured `hookId + declarations` records.
- Never change DOM structure, section order/count, forms, links, behaviors, scripts, ARIA or any `data-ol-*` attribute.
- Do not change `data-ol-mode` in 2A. `light | dark | cream` compiles through tokens.
- Precedence is explicit machine-readable user constraints > saved brand accent > creative direction > original template.
- Semantic constraints that cannot be proved deterministically remain required prompt inputs and human-evaluation criteria; do not claim a string parser proves visual semantics.
- One creative call and at most one diagnostic critic call per pilot adaptation; no creative retry.
- The Visual Engine feature flag accepts only `off | shadow | skeleton`; every other value, including `on`, is `off`.
- `OPENLEN_SAFE_TEMPLATE_PICKER=shadow` runs only when Visual Engine is `off`; never run two safe-selection analyses for one request.
- `shadow` never changes the user's preview, project, credits or chosen Quick template.
- The first preview for a user-visible `template_skeleton` result is the fully adapted, normalized and sanitized document.
- A failure discards the complete candidate and falls back to current Quick. Never persist or preview partial adaptation.
- Do not change the user's Quick credit charge in 2A. Creative and diagnostic costs are OpenLen telemetry until a separate pricing decision.
- Pilot quota is persistent and atomic: 2A reserves exactly 75 starts from the global 300-adaptation allocation; failed calls still count.
- Pilot telemetry excludes brief, copy, HTML, PII, secrets, raw provider output and raw provider errors.
- New behavior follows red-green-refactor TDD. Each task records the failing test before production code and ends in a focused commit.
- The specification is `docs/superpowers/specs/2026-08-05-openlen-visual-engine-2a-design.md`.

## File Map

| Area | Responsibility |
| --- | --- |
| `lib/generation/visual-engine-mode.ts` | Parse flags and enforce legacy-shadow precedence. |
| `lib/generation/safe-selection.ts` | Execute existing intent/ranking/decision logic without shadow-only gating. |
| `lib/generation/creative-contracts.ts` | Own all versioned 2A schemas and types. |
| `lib/generation/creative-registry.ts` | Own allowed tokens, typography mappings, hooks, properties and numeric limits. |
| `lib/generation/skeleton-inventory.ts` | Convert HTML into bounded style hooks and asset slots. |
| `lib/generation/structural-fingerprint.ts` | Prove protected DOM semantics did not change. |
| `lib/generation/creative-compiler.ts` | Merge precedence, validate contrast/CSS and serialize one Visual Engine style block. |
| `lib/generation/skeleton-assets.ts` | Resolve only catalog-backed replacements into authorized image slots. |
| `lib/generation/generate-creative-direction.ts` | Make one typed provider call and return redacted failures/usage. |
| `lib/generation/visual-engine-pilot-store.ts` | Atomically reserve pilot units and persist redacted outcomes. |
| `lib/generation/adapt-skeleton.ts` | Orchestrate the all-or-nothing adaptation transaction. |
| `lib/curate/build-curated-document.ts` | Reuse Quick fill/finalization for safe template, skeleton and fallback paths. |
| `lib/curate/quick-visual-engine.ts` | Plan Quick delivery and run shadow/user-visible skeleton work. |
| `app/api/curate/route.ts` | Thin SSE/auth/credits/persistence orchestration. |
| `lib/generation/visual-engine-2a-eval.ts` | Build blind A/B evidence and calculate approved gates. |
| `tools/visual-engine-2a-reviewer/` | Local-only blind comparison desk; never an end-user UI. |

---

### Task 1: Make safe selection reusable and define runtime modes

**Files:**
- Create: `lib/generation/visual-engine-mode.ts`
- Create: `lib/generation/visual-engine-mode.test.ts`
- Create: `lib/generation/safe-selection.ts`
- Create: `lib/generation/safe-selection.test.ts`
- Modify: `lib/generation/shadow-selection.ts`
- Modify: `lib/generation/shadow-selection.test.ts`

**Interfaces:**
- Produces: `visualEngineMode(raw?) => "off" | "shadow" | "skeleton"`.
- Produces: `shouldRunLegacySafeShadow(visualMode, safeMode) => boolean`.
- Produces: `selectGenerationRoute(brief, templates, options?) => Promise<SafeSelectionResult>`.
- Preserves: `runShadowSelection()` and its existing redacted log schema.

- [ ] **Step 1: Write failing mode tests**

```typescript
import { describe, expect, it } from "vitest";
import { shouldRunLegacySafeShadow, visualEngineMode } from "./visual-engine-mode";

describe("visualEngineMode", () => {
  it.each([undefined, "", "off", "on", "true", "SKELETON"])("maps %s to off", (raw) => {
    expect(visualEngineMode(raw)).toBe("off");
  });
  it("accepts only shadow and skeleton", () => {
    expect(visualEngineMode("shadow")).toBe("shadow");
    expect(visualEngineMode("skeleton")).toBe("skeleton");
  });
  it("suppresses the legacy shadow when Visual Engine owns selection", () => {
    expect(shouldRunLegacySafeShadow("off", "shadow")).toBe(true);
    expect(shouldRunLegacySafeShadow("shadow", "shadow")).toBe(false);
    expect(shouldRunLegacySafeShadow("skeleton", "shadow")).toBe(false);
  });
});
```

- [ ] **Step 2: Run the mode test and verify RED**

Run: `npx.cmd vitest run lib/generation/visual-engine-mode.test.ts`

Expected: FAIL because `visual-engine-mode.ts` does not exist.

- [ ] **Step 3: Implement strict mode parsing**

```typescript
export type VisualEngineMode = "off" | "shadow" | "skeleton";

export function visualEngineMode(
  raw = process.env.OPENLEN_VISUAL_ENGINE,
): VisualEngineMode {
  return raw === "shadow" || raw === "skeleton" ? raw : "off";
}

export function shouldRunLegacySafeShadow(
  visualMode: VisualEngineMode,
  safeMode: "off" | "shadow",
): boolean {
  return visualMode === "off" && safeMode === "shadow";
}
```

- [ ] **Step 4: Write failing active-selection tests**

Define the result exactly as:

```typescript
export type SafeSelectionResult =
  | {
      ok: true;
      intent: IntentAnalysis;
      decision: GenerationDecision;
      ranked: ScoredTemplate[];
      promptVersion: typeof INTENT_PROMPT_VERSION;
      policyVersion: typeof DECISION_POLICY_VERSION;
      modelId: string;
      usage?: { inputTokens: number; outputTokens: number };
      durationMs: number;
    }
  | {
      ok: false;
      errorKind: string;
      durationMs: number;
    };
```

Tests inject `analyzeIntentImpl` and prove success, typed model failure, unexpected exception, deterministic ranking and unchanged duration clamping. Add a regression test proving `runShadowSelection(..., { mode: "off" })` still returns `null` and `mode: "shadow"` maps the active result back to `safe-selection-shadow/1.0`.

- [ ] **Step 5: Run selection tests and verify RED**

Run: `npx.cmd vitest run lib/generation/safe-selection.test.ts lib/generation/shadow-selection.test.ts`

Expected: FAIL because `selectGenerationRoute` is not implemented.

- [ ] **Step 6: Extract the existing core without changing policy**

Move only the analyze → `rankTemplates` → `decideGenerationRoute` sequence into `safe-selection.ts`. Make `runShadowSelection()` call it after its existing flag gate and map the result to its current log DTO. Do not change thresholds, sorting, prompts, error names or score contents.

- [ ] **Step 7: Verify GREEN and commit**

Run:

```powershell
npx.cmd vitest run lib/generation/visual-engine-mode.test.ts lib/generation/safe-selection.test.ts lib/generation/shadow-selection.test.ts lib/generation/decide-route.test.ts lib/generation/score-template.test.ts
git diff --check
```

Expected: all tests PASS and diff check exits 0.

Commit:

```powershell
git add lib/generation/visual-engine-mode.ts lib/generation/visual-engine-mode.test.ts lib/generation/safe-selection.ts lib/generation/safe-selection.test.ts lib/generation/shadow-selection.ts lib/generation/shadow-selection.test.ts
git commit -m "refactor(generation): reuse safe template selection"
```

---

### Task 2: Add provider-independent creative contracts and registries

**Files:**
- Create: `lib/generation/creative-contracts.ts`
- Create: `lib/generation/creative-contracts.test.ts`
- Create: `lib/generation/creative-registry.ts`
- Create: `lib/generation/creative-registry.test.ts`
- Create: `lib/generation/creative-fixtures.test-support.ts`

**Interfaces:**
- Produces: Zod schemas and inferred types for all 2A contracts.
- Produces: `CREATIVE_TOKEN_ALLOWLIST`, `CREATIVE_FONT_MOODS`, `HOOK_PROPERTY_POLICY`.
- Produces: `SkeletonAdaptationFailureCode` shared by compiler, provider, pilot store and Quick.
- Produces test-only exports: `COLORING_INTENT`, `COLORING_DIRECTION`, `COLORING_PLAN`, `COLORING_TEMPLATE_METADATA`, `SKELETON_HTML`, `NORMALIZED_SKELETON_HTML` and `FIXTURE_IMAGES`.

- [ ] **Step 1: Write failing schema tests using one complete valid fixture**

Create `creative-fixtures.test-support.ts` with the complete coloring example from the spec and no secrets, network calls or runtime side effects. Every later generation test imports these same fixtures instead of creating incompatible near-duplicates. Tests must prove:

```typescript
expect(CreativeDirectionSchema.parse(COLORING_DIRECTION)).toEqual(COLORING_DIRECTION);
expect(SkeletonCreativeResponseSchema.parse({
  schemaVersion: "skeleton-creative-response/1.0",
  status: "incompatible",
  reasonCode: "cannot_remove_forbidden_signal",
})).toMatchObject({ status: "incompatible" });
expect(() => CreativeDirectionSchema.parse({ ...COLORING_DIRECTION, extra: true })).toThrow();
expect(() => CreativeDirectionSchema.parse({
  ...COLORING_DIRECTION,
  palette: { ...COLORING_DIRECTION.palette, accent: "pink" },
})).toThrow();
expect(() => SkeletonAdaptationPlanSchema.parse({
  schemaVersion: "skeleton-adaptation-plan/1.0",
  tokens: { "--evil": "red" },
  cssOverride: [],
  assets: [],
})).toThrow();
```

Also test max list lengths, strict objects, duplicate asset indices, invalid hook IDs, invalid versions and all four incompatibility reason codes.

- [ ] **Step 2: Run contract tests and verify RED**

Run: `npx.cmd vitest run lib/generation/creative-contracts.test.ts lib/generation/creative-registry.test.ts`

Expected: FAIL because both modules are missing.

- [ ] **Step 3: Implement exact registries**

```typescript
export const CREATIVE_TOKEN_ALLOWLIST = new Set([
  "--ol-bg", "--ol-surface", "--ol-surface-2", "--ol-fg",
  "--ol-fg-muted", "--ol-fg-faint", "--ol-border",
  "--ol-border-strong", "--ol-accent", "--ol-accent-ink",
  "--ol-radius", "--ol-r-scale", "--ol-space-scale",
  "--ol-text-scale", "--ol-font-display", "--ol-font-body",
  "--ol-font-mono",
]);

export const CREATIVE_FONT_MOODS = {
  rounded_playful: { display: "'Plus Jakarta Sans', sans-serif", body: "'Plus Jakarta Sans', sans-serif" },
  friendly_high_legibility: { display: "'Manrope', sans-serif", body: "'Inter', sans-serif" },
  modern_geometric: { display: "'Space Grotesk', sans-serif", body: "'Inter', sans-serif" },
  editorial_warm: { display: "'Fraunces', serif", body: "'Inter', sans-serif" },
  literary: { display: "'Crimson Pro', serif", body: "'Crimson Pro', serif" },
  elegant_editorial: { display: "'Playfair Display', serif", body: "'Inter', sans-serif" },
  technical: { display: "'Geist', sans-serif", body: "'Inter', sans-serif" },
} as const;

export const HOOK_PROPERTY_POLICY = {
  page: ["background-color", "color", "font-family"],
  navigation: ["background-color", "color", "border-color", "border-radius", "padding", "gap", "box-shadow"],
  hero: ["background-color", "color", "border-color", "border-radius", "padding", "gap", "box-shadow", "text-align"],
  section: ["background-color", "color", "border-color", "border-radius", "padding", "gap"],
  cards: ["background-color", "color", "border-color", "border-radius", "padding", "gap", "box-shadow"],
  buttons: ["background-color", "color", "border-color", "border-radius", "padding", "box-shadow"],
  icons: ["color", "fill", "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin", "border-radius"],
} as const;
```

Use only families already included by OpenLen's normalization font link. Do not emit font URLs.

- [ ] **Step 4: Implement strict Zod contracts**

Use `.strict()` at every object level. `CreativeDirectionSchema` must contain every field approved in the spec. `SkeletonAdaptationPlanSchema` must use:

```typescript
export interface CreativeDirection {
  schemaVersion: "creative-direction/1.0";
  mode: "light" | "dark" | "cream";
  visualArchetype: string;
  emotionalTone: string[];
  palette: {
    background: string;
    surface: string;
    surfaceAlt: string;
    foreground: string;
    foregroundMuted: string;
    accent: string;
    accentInk: string;
    border: string;
  };
  typography: {
    display: keyof typeof CREATIVE_FONT_MOODS;
    body: keyof typeof CREATIVE_FONT_MOODS;
    mono: "ui_monospace" | null;
    scale: "compact" | "balanced" | "expressive";
  };
  geometry: {
    radius: "square" | "soft" | "round" | "extra_round";
    radiusScale: number;
    spacingScale: number;
    density: "low" | "low_medium" | "medium" | "high";
  };
  imagery: {
    strategy: "photo_first" | "illustration_first" | "mixed" | "texture_first";
    artDirection: string;
    subjects: string[];
    avoid: string[];
  };
  iconography: {
    style: "rounded_outline" | "rounded_filled" | "geometric_outline" | "minimal_outline";
    strokeWeight: "light" | "medium" | "bold";
    cornerStyle: "round" | "soft" | "square";
  };
  componentTreatment: {
    cards: string;
    buttons: string;
    navigation: string;
    sections: string;
  };
  requiredVisualSignals: string[];
  forbiddenVisualSignals: string[];
}

export interface SkeletonInventory {
  schemaVersion: "skeleton-inventory/1.0";
  templateId: string;
  availableTokens: string[];
  styleHooks: Array<{
    id: string;
    selector: string;
    allowedProperties: string[];
  }>;
  assetSlots: Array<{
    slotIndex: number;
    kind: "image";
    role: "hero" | "section" | "card";
    currentAlt: string;
    replaceable: boolean;
  }>;
  structuralFingerprint: string;
}
```

Use `TaxonomySlugSchema` for archetype, tone, art direction, subjects, avoid, component treatments and visual signals. Arrays are deduplicated and capped at 12; `radiusScale`, `spacingScale` and typography scales use closed numeric/enumerated ranges from the registry. Every palette value uses `^#[0-9A-Fa-f]{6}$`.

`SkeletonAdaptationPlanSchema` must use:

```typescript
const CssOverrideSchema = z.object({
  hookId: z.string().regex(/^[a-z0-9]+(?:[-_:][a-z0-9]+)*$/).max(96),
  declarations: z.record(z.string().min(1).max(180)),
}).strict();

const AssetInstructionSchema = z.object({
  slotIndex: z.number().int().min(0).max(255),
  action: z.enum(["keep", "replace"]),
  mediaType: z.enum(["photo", "illustration", "texture"]),
  query: z.string().min(1).max(180).nullable(),
  alt: z.string().min(1).max(240).nullable(),
  required: z.boolean(),
}).strict();
```

Add `superRefine` rules: replace requires query+alt, keep requires both null, asset indices are unique, token keys are allowlisted and output is either `ready` with both objects or `incompatible` with one approved reason.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```powershell
npx.cmd vitest run lib/generation/creative-contracts.test.ts lib/generation/creative-registry.test.ts
git diff --check
```

Commit:

```powershell
git add lib/generation/creative-contracts.ts lib/generation/creative-contracts.test.ts lib/generation/creative-registry.ts lib/generation/creative-registry.test.ts lib/generation/creative-fixtures.test-support.ts
git commit -m "feat(generation): add creative direction contracts"
```

---

### Task 3: Build deterministic skeleton inventories and structural fingerprints

**Files:**
- Create: `lib/generation/skeleton-inventory.ts`
- Create: `lib/generation/skeleton-inventory.test.ts`
- Create: `lib/generation/structural-fingerprint.ts`
- Create: `lib/generation/structural-fingerprint.test.ts`

**Interfaces:**
- Consumes: registries and `SkeletonInventory` from Task 2.
- Produces: `buildSkeletonInventory(html, templateId) => SkeletonInventory`, throwing only typed `SkeletonInventoryError` failures.
- Produces: `fingerprintStructure(html, options?) => string`.
- Produces: `structureIsPreserved(before, after, options?) => boolean`.

- [ ] **Step 1: Write failing inventory tests**

Use a fixture containing `nav`, four sections, repeated `.activity-card` elements, buttons, a logo, content images, a form, links, scripts and `data-ol-*`. Assert stable output:

```typescript
const inventory = buildSkeletonInventory(HTML, "color-base");
expect(inventory.schemaVersion).toBe("skeleton-inventory/1.0");
expect(inventory.templateId).toBe("color-base");
expect(inventory.styleHooks.map((hook) => hook.id)).toEqual([
  "page", "navigation", "hero", "section-1", "section-2",
  "section-3", "cards-activity-card", "buttons", "icons",
]);
expect(inventory.assetSlots).toEqual([
  { slotIndex: 0, kind: "image", role: "hero", currentAlt: "Classroom", replaceable: true },
  { slotIndex: 1, kind: "image", role: "card", currentAlt: "Workbook", replaceable: true },
]);
```

Prove logo/nav/footer images, data URIs and images carrying behavior `data-ol-*` are not replaceable. Prove malformed HTML throws a typed inventory error rather than returning an empty permissive inventory.

- [ ] **Step 2: Write failing fingerprint tests**

```typescript
const before = fingerprintStructure(HTML, { allowedAssetSlots: [0, 1] });
expect(fingerprintStructure(changeOnlyRootTokens(HTML), { allowedAssetSlots: [0, 1] })).toBe(before);
expect(fingerprintStructure(addVisualEngineStyle(HTML), { allowedAssetSlots: [0, 1] })).toBe(before);
expect(fingerprintStructure(changeAuthorizedImage(HTML), { allowedAssetSlots: [0, 1] })).toBe(before);
expect(fingerprintStructure(changeHref(HTML), { allowedAssetSlots: [0, 1] })).not.toBe(before);
expect(fingerprintStructure(changeFormAction(HTML), { allowedAssetSlots: [0, 1] })).not.toBe(before);
expect(fingerprintStructure(changeDataOl(HTML), { allowedAssetSlots: [0, 1] })).not.toBe(before);
expect(fingerprintStructure(changeScript(HTML), { allowedAssetSlots: [0, 1] })).not.toBe(before);
expect(fingerprintStructure(reorderSections(HTML), { allowedAssetSlots: [0, 1] })).not.toBe(before);
```

- [ ] **Step 3: Run both tests and verify RED**

Run: `npx.cmd vitest run lib/generation/skeleton-inventory.test.ts lib/generation/structural-fingerprint.test.ts`

Expected: FAIL because both modules are missing.

- [ ] **Step 4: Implement bounded inventory extraction**

Parse with `node-html-parser`. Generate selectors in code; never copy a selector from the model. Rules:

- `page` targets `body`.
- `navigation` targets the first `nav`, otherwise the first `header`.
- `hero` targets the first `section`.
- Remaining section hooks use deterministic `section:nth-of-type(N)` selectors.
- Repeated safe class names (`^[a-zA-Z][a-zA-Z0-9_-]{0,63}$`, at least two matches) create a single cards hook; choose the largest repeated group and break ties lexicographically.
- `buttons` targets only existing `button` and anchor class selectors found in the document.
- `icons` targets existing non-logo `svg[data-lucide]`, `.icon svg` or `svg[aria-hidden="true"]` elements; it is absent when none exist.
- Each hook receives properties from `HOOK_PROPERTY_POLICY` by role.
- `availableTokens` is the sorted 2A token allowlist because `applyThemeTokensToHtml()` may add a missing canonical token to normalized HTML.
- Asset indices enumerate replaceable content `<img>` elements only, in document order.

Throw `SkeletonInventoryError` with code `insufficient_style_hooks` when there is no body, no section or no safe hook beyond page. The atomic adapter maps that code to fallback.

- [ ] **Step 5: Implement semantic fingerprinting**

Walk the parsed tree and hash canonical JSON with `node:crypto.createHash("sha256")`. Exclude text nodes, root style tokens, the single style element with `data-openlen-visual-engine`, and `src/srcset/alt` only for authorized slot indices. Include tag hierarchy, element order, non-exempt attributes, scripts and script text. Sort attribute names but never sort elements.

```typescript
export interface StructuralFingerprintOptions {
  allowedAssetSlots?: readonly number[];
}

export function fingerprintStructure(
  html: string,
  options: StructuralFingerprintOptions = {},
): string {
  return `sha256:${createHash("sha256").update(canonicalTree).digest("hex")}`;
}
```

- [ ] **Step 6: Verify GREEN and commit**

Run:

```powershell
npx.cmd vitest run lib/generation/skeleton-inventory.test.ts lib/generation/structural-fingerprint.test.ts
git diff --check
```

Commit:

```powershell
git add lib/generation/skeleton-inventory.ts lib/generation/skeleton-inventory.test.ts lib/generation/structural-fingerprint.ts lib/generation/structural-fingerprint.test.ts
git commit -m "feat(generation): inventory safe template skeletons"
```

---

### Task 4: Compile creative tokens and CSS under deterministic policy

**Files:**
- Create: `lib/generation/creative-compiler.ts`
- Create: `lib/generation/creative-compiler.test.ts`
- Modify: `lib/agent/theme-apply.test.ts`

**Interfaces:**
- Consumes: `CreativeDirection`, `SkeletonAdaptationPlan`, `SkeletonInventory`.
- Reuses: `applyThemeTokensToHtml()` and `deriveContractColors()`.
- Produces: `compileSkeletonIdentity(input) => CreativeCompileResult`.

- [ ] **Step 1: Write failing precedence and happy-path tests**

```typescript
const inventory = buildSkeletonInventory(NORMALIZED_SKELETON_HTML, "color-base");
const result = compileSkeletonIdentity({
  html: NORMALIZED_SKELETON_HTML,
  inventory,
  direction: COLORING_DIRECTION,
  plan: COLORING_PLAN,
  brand: { accent: "#0057B8" },
  explicitOverrides: { accent: "#E6007E" },
});
expect(result).toMatchObject({ ok: true });
if (result.ok) {
  expect(readThemeTokenFromHtml(result.html, "--ol-accent")).toBe("#E6007E");
  expect(result.html.match(/data-openlen-visual-engine/g)).toHaveLength(1);
  expect(result.html).not.toContain("data-ol-mode=");
}
```

Also prove: brand wins over creative when no explicit accent; creative wins over original; exact unambiguous `modo oscuro`, `dark mode`, registered font names and role-labelled hex constraints become machine overrides; ambiguous prose remains unparsed and is not falsely reported as deterministically enforced.

Assert iconography is compiled through the generated `icons` hook: rounded styles set round line caps/joins, weight maps only to allowed numeric stroke widths, and the compiler never replaces SVG markup or changes a logo.

- [ ] **Step 2: Write failing adversarial CSS and contrast tests**

Use `it.each` for values containing `url(`, `@import`, `expression(`, `behavior`, `-moz-binding`, non-OpenLen `var()`, `display:none`, `position`, `z-index`, `overflow`, `pointer-events`, `content`, semicolon declaration injection and unmatched functions. Assert typed `css_policy_violation`. Assert unknown hook/property rejection and `contrast_violation` for foreground/background, foreground/surface and accent/accentInk below 4.5.

- [ ] **Step 3: Run compiler tests and verify RED**

Run:

```powershell
npx.cmd vitest run lib/generation/creative-compiler.test.ts
npx.cmd tsx --test lib/agent/theme-apply.test.ts
```

Expected: FAIL because the compiler is missing.

- [ ] **Step 4: Implement token compilation and precedence**

Map direction roles to canonical tokens, derive missing dependent roles with `deriveContractColors()`, map typography moods through `CREATIVE_FONT_MOODS`, clamp scale/radius values to contract ranges, then merge:

```typescript
const finalTokens = {
  ...originalTokens,
  ...creativeTokens,
  ...brandTokens,
  ...explicitTokens,
};
```

Only pass allowlisted keys to `applyThemeTokensToHtml`. Never pass `data-ol-mode`. Validate every final token before applying it.

- [ ] **Step 5: Implement structured CSS validation and serialization**

For each override, resolve `hookId` through the inventory, reject properties absent from its `allowedProperties`, parse a temporary rule through PostCSS, require exactly one rule and the expected declaration count, then apply property-specific validators:

- colors: hex or `rgba()` with numeric bounds;
- spacing/radius: `px | rem | em`, `calc()` or `clamp()` with no custom properties outside `--ol-*`;
- shadow: at most four comma-separated shadows, maximum 240 characters;
- `text-align`: `left | center | right | start | end`;
- font family: exact value from the registry.
- icon stroke/fill: exact registry-derived values only; model declarations cannot introduce arbitrary SVG paint values.

Serialize selectors from inventory into one style block immediately before `</head>`:

```html
<style data-openlen-visual-engine="creative-direction/1.0">...</style>
```

Strip an earlier Visual Engine block before insertion so compilation is idempotent.

- [ ] **Step 6: Verify GREEN and commit**

Run:

```powershell
npx.cmd vitest run lib/generation/creative-compiler.test.ts lib/theme-derive.test.ts
npx.cmd tsx --test lib/agent/theme-apply.test.ts
git diff --check
```

Commit:

```powershell
git add lib/generation/creative-compiler.ts lib/generation/creative-compiler.test.ts lib/agent/theme-apply.test.ts
git commit -m "feat(generation): compile bounded creative identity"
```

---

### Task 5: Resolve catalog-backed skeleton assets without another model call

**Files:**
- Create: `lib/generation/skeleton-assets.ts`
- Create: `lib/generation/skeleton-assets.test.ts`
- Reuse without modification: `lib/imagery/manifest.ts`

**Interfaces:**
- Consumes: HTML, `SkeletonInventory`, asset instructions and `CreativeDirection.imagery`.
- Produces: `resolveSkeletonAssets(input, deps?) => Promise<SkeletonAssetResult>`.
- Uses: `loadCuratedImages()` as the default catalog source.

- [ ] **Step 1: Write failing deterministic-ranking tests**

Inject a small `CuratedImage[]` fixture containing a classroom photo, corporate dashboard, crayons, coloring pages and friendly animal illustration. Prove query/subject overlap, mode compatibility and avoid/forbidden tokens rank the coloring assets first and never return forbidden dashboard/classroom assets.

```typescript
expect(rankSkeletonAssets({
  query: "soft storybook children coloring crayons friendly animals pastel",
  direction: COLORING_DIRECTION,
  images: FIXTURE_IMAGES,
})).toEqual(["coloring-crayons", "friendly-animal-art"]);
```

- [ ] **Step 2: Write failing application/failure tests**

Prove only `replaceable: true` slots can change, replacements set catalog `hero/tablet/thumb` URLs and validated alt text, required misses return `required_asset_unavailable`, optional misses keep the original only when its alt/style has no forbidden token, and duplicate use is avoided across slots.

- [ ] **Step 3: Run asset tests and verify RED**

Run: `npx.cmd vitest run lib/generation/skeleton-assets.test.ts`

Expected: FAIL because the resolver does not exist.

- [ ] **Step 4: Implement deterministic catalog ranking**

Normalize accents and snake_case, remove generic stop words, score exact/prefix token overlap, add a small mode bonus from `imageTone()`, subtract an infinite penalty for any token in `direction.imagery.avoid` or `forbiddenVisualSignals`, then sort by score descending and image ID ascending. Require positive subject signal; visual tone alone never makes an asset eligible.

Do not call Gemini here. The creative call already supplied the query and art direction.

- [ ] **Step 5: Apply authorized image attributes and reparse**

Use `node-html-parser`, locate content images by the same slot enumeration as the inventory, change only `src`, `srcset` and `alt`, and return the serialized document. The structural fingerprint in Task 8 is the final authority on unintended changes.

- [ ] **Step 6: Verify GREEN and commit**

Run:

```powershell
npx.cmd vitest run lib/generation/skeleton-assets.test.ts
npx.cmd tsx --test lib/imagery/photograph.test.ts
git diff --check
```

Commit:

```powershell
git add lib/generation/skeleton-assets.ts lib/generation/skeleton-assets.test.ts
git commit -m "feat(generation): resolve skeleton visual assets"
```

---

### Task 6: Generate one strict creative response through a replaceable provider

**Files:**
- Create: `lib/generation/generate-creative-direction.ts`
- Create: `lib/generation/generate-creative-direction.test.ts`

**Interfaces:**
- Consumes: `IntentAnalysis`, reviewed template metadata, `SkeletonInventory`, normalized brand constraints.
- Produces: `generateCreativeDirection(request, options?) => Promise<GenerateCreativeDirectionResult>`.
- Produces: `CreativeDirectionProvider` and default `GeminiCreativeDirectionProvider` adapter.
- Produces: `CREATIVE_PROMPT_VERSION = "creative-prompt/1.0"`.

- [ ] **Step 1: Write failing transport tests**

Inject `fetchImpl` and fake time. Assert one POST, one system instruction, JSON-only generation config, response schema, default model, timeout signal and no HTML in the request body.

```typescript
expect(calls).toHaveLength(1);
expect(body.generationConfig).toMatchObject({
  responseMimeType: "application/json",
  temperature: 0.2,
  thinkingConfig: { thinkingBudget: 512 },
});
expect(JSON.stringify(body)).not.toContain("<!doctype html>");
```

Assert usage maps `promptTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount` and `cachedContentTokenCount` into non-negative integers.

- [ ] **Step 2: Write failing typed-failure tests**

Cover missing key, timeout, abort, HTTP error, invalid JSON, schema failure, future version, incompatible response and unexpected exception. Confirm raw response text and provider error bodies never appear in returned messages.

- [ ] **Step 3: Run provider tests and verify RED**

Run: `npx.cmd vitest run lib/generation/generate-creative-direction.test.ts`

Expected: FAIL because the provider module is missing.

- [ ] **Step 4: Implement the provider-independent surface**

```typescript
export interface CreativeDirectionProvider {
  generate(
    request: CreativeDirectionRequest,
    options: { signal: AbortSignal },
  ): Promise<CreativeProviderResponse>;
}

export interface CreativeDirectionRequest {
  intent: IntentAnalysis;
  template: Pick<TemplateVisualMetadata, "domains" | "audiences" | "visualSignals" | "negativeTags" | "themeability">;
  inventory: SkeletonInventory;
  brand: { accent: string | null };
}
```

The default Gemini adapter may use direct REST like `analyze-intent.ts`, but no orchestration code may depend on Gemini payload shapes.

- [ ] **Step 5: Implement the approved system prompt and strict parser**

Copy the non-negotiable contract from spec section 18. Serialize the user payload as JSON under one user message. Use `OPENLEN_VISUAL_ENGINE_MODEL` with default `gemini-2.5-flash`, a 15-second timeout, `maxOutputTokens: 4096`, temperature `0.2`, and `OPENLEN_VISUAL_ENGINE_THINKING_BUDGET` clamped to `0..2048` with default `512`.

Parse the provider text once with `JSON.parse`; do not salvage fenced or prose-wrapped output. Validate with `SkeletonCreativeResponseSchema`.

- [ ] **Step 6: Verify GREEN and commit**

Run:

```powershell
npx.cmd vitest run lib/generation/generate-creative-direction.test.ts lib/generation/analyze-intent.test.ts
git diff --check
```

Commit:

```powershell
git add lib/generation/generate-creative-direction.ts lib/generation/generate-creative-direction.test.ts
git commit -m "feat(generation): generate creative direction contracts"
```

---

### Task 7: Add an atomic 75-run pilot ledger and redacted cost telemetry

**Files:**
- Modify: `lib/db/schema.ts`
- Create: `drizzle/migrations/0005_visual_engine_pilot.sql`
- Create: `lib/generation/visual-engine-pilot-store.ts`
- Create: `lib/generation/visual-engine-pilot-store.test.ts`
- Create: `lib/generation/model-cost.ts`
- Create: `lib/generation/model-cost.test.ts`

**Interfaces:**
- Produces: `reserveVisualEnginePilotRun(input, deps?) => Promise<PilotReservationResult>`.
- Produces: `completeVisualEnginePilotRun(id, outcome, deps?) => Promise<void>`.
- Produces: `recordVisualEnginePilotComparison(id, { verdict, acceptedForbiddenSignalCount }, deps?) => Promise<void>`.
- Produces: `markStaleVisualEnginePilotRuns(now, deps?) => Promise<number>`.
- Produces: `calculateModelCostMicros(usage, rateCard, mxnPerUsd) => CostBreakdown`.

- [ ] **Step 1: Write the migration and failing schema/SQL tests**

Add two tables:

```sql
CREATE TABLE "visualEnginePilotBudgets" (
  "phase" text PRIMARY KEY,
  "limit" integer NOT NULL,
  "used" integer DEFAULT 0 NOT NULL,
  "updatedAt" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "visualEnginePilotBudgets_nonnegative" CHECK ("limit" >= 0 AND "used" >= 0 AND "used" <= "limit")
);

INSERT INTO "visualEnginePilotBudgets" ("phase", "limit", "used") VALUES
  ('2a', 75, 0), ('2b', 75, 0), ('2c', 150, 0)
ON CONFLICT ("phase") DO NOTHING;
```

`visualEnginePilotRuns` has: id, phase, ordinal, mode, route, templateId, status, reasonCode, prompt/contract/policy/taxonomy/model/rateCard versions, input/output/thinking/cached tokens, productionEquivalentCostMicromxn, observedPilotCostMicromxn, durationMs, critic scores/fallback, fingerprints, comparisonVerdict, acceptedForbiddenSignalCount, createdAt and completedAt. It has unique `(phase, ordinal)` and indexes on `(phase, status)` and `createdAt`. It has no userId, projectId, brief, HTML or generic JSON payload column.

Add `candidatePersisted boolean DEFAULT false NOT NULL` and `structuralInvariantPassed boolean` so the scorecard can prove shadow candidates were never saved and accepted candidates preserved structure without storing project identifiers.

- [ ] **Step 2: Write failing reservation tests around compiled SQL**

The reservation is one PostgreSQL statement:

```sql
WITH reserved AS (
  UPDATE "visualEnginePilotBudgets"
  SET "used" = "used" + 1, "updatedAt" = now()
  WHERE "phase" = $phase AND "used" < "limit"
  RETURNING "used"
)
INSERT INTO "visualEnginePilotRuns" ("id", "phase", "ordinal", "mode", "route", "templateId", "status")
SELECT $id, $phase, "used", $mode, $route, $templateId, 'started'
FROM reserved
RETURNING "id", "ordinal";
```

Compile with `PgDialect().sqlToQuery()` in the test and assert the update and insert stay in one statement. Fake `execute` results prove reservation success, quota exhaustion and no retry. Completion must update allowlisted columns only and never accept arbitrary payloads.

- [ ] **Step 3: Write failing cost tests**

Define a versioned rate-card type with input, cached input, output and thinking USD per million tokens. Test integer micro-MXN arithmetic, inclusion of failed calls, zero usage and explicit FX validation. Do not fetch prices at runtime.

- [ ] **Step 4: Run ledger tests and verify RED**

Run: `npx.cmd vitest run lib/generation/visual-engine-pilot-store.test.ts lib/generation/model-cost.test.ts`

Expected: FAIL because the store and cost modules are missing.

- [ ] **Step 5: Implement schema, atomic store and redaction boundary**

Mirror the SQL columns in `lib/db/schema.ts`. Use `db.execute(sql\`...\`)` for the CTE reservation so Neon HTTP and node-postgres both execute one atomic statement. Completion accepts a typed DTO with scalar metrics only. Map all provider failures to reason codes before calling the store.

`markStaleVisualEnginePilotRuns` changes `started` rows older than one hour to `abandoned`; it never decrements budget usage.

- [ ] **Step 6: Implement versioned cost calculation**

Store the exact rate-card values and FX rate used by the pilot report. The CLI requires `OPENLEN_VISUAL_ENGINE_RATE_CARD_VERSION`, `OPENLEN_VISUAL_ENGINE_INPUT_USD_PER_MILLION`, `OPENLEN_VISUAL_ENGINE_CACHED_INPUT_USD_PER_MILLION`, `OPENLEN_VISUAL_ENGINE_OUTPUT_USD_PER_MILLION`, `OPENLEN_VISUAL_ENGINE_THINKING_USD_PER_MILLION` and `OPENLEN_VISUAL_ENGINE_MXN_PER_USD`; reject an absent, non-finite or non-positive numeric value. Production Quick does not depend on these variables.

Use integer micro-currency at the boundary. Billable input is `max(0, inputTokens - cachedTokens)`; USD cost is the sum of each token bucket multiplied by its per-million rate and divided by one million; micro-MXN is `round(usdCost * mxnPerUsd * 1_000_000)`. `productionEquivalentCostMicromxn` includes the creative and one critic call. `observedPilotCostMicromxn` additionally includes the duplicate shadow candidate fill; neither includes the baseline Quick call that would exist without 2A.

- [ ] **Step 7: Verify GREEN and commit**

Run:

```powershell
npx.cmd vitest run lib/generation/visual-engine-pilot-store.test.ts lib/generation/model-cost.test.ts
npm.cmd run typecheck
git diff --check
```

Commit:

```powershell
git add lib/db/schema.ts drizzle/migrations/0005_visual_engine_pilot.sql lib/generation/visual-engine-pilot-store.ts lib/generation/visual-engine-pilot-store.test.ts lib/generation/model-cost.ts lib/generation/model-cost.test.ts
git commit -m "feat(generation): persist Visual Engine pilot telemetry"
```

---

### Task 8: Orchestrate one all-or-nothing skeleton adaptation

**Files:**
- Create: `lib/generation/adapt-skeleton.ts`
- Create: `lib/generation/adapt-skeleton.test.ts`

**Interfaces:**
- Consumes: Tasks 2–7.
- Produces: `adaptTemplateSkeleton(input, deps?) => Promise<SkeletonAdaptationResult>`.
- Guarantees: one creative call, no partial HTML on failure, equal before/after fingerprint on success.

- [ ] **Step 1: Write the failing success-path test**

```typescript
const input = {
  html: NORMALIZED_SKELETON_HTML,
  templateId: "color-base",
  intent: COLORING_INTENT,
  templateMetadata: COLORING_TEMPLATE_METADATA,
  brand: { accent: null },
};
const readyResponse = {
  ok: true as const,
  response: {
    schemaVersion: "skeleton-creative-response/1.0" as const,
    status: "ready" as const,
    creativeDirection: COLORING_DIRECTION,
    adaptationPlan: COLORING_PLAN,
  },
  promptVersion: "creative-prompt/1.0" as const,
  modelId: "test-model",
  usage: { inputTokens: 100, outputTokens: 50, thinkingTokens: 10, cachedTokens: 0 },
  durationMs: 25,
};
const result = await adaptTemplateSkeleton(input, {
  generateCreativeDirection: vi.fn().mockResolvedValue(readyResponse),
  loadCuratedImages: async () => FIXTURE_IMAGES,
  technicalRender: async () => true,
});
expect(result).toMatchObject({
  ok: true,
  status: "adapted",
  creativeDirectionVersion: "creative-direction/1.0",
  planVersion: "skeleton-adaptation-plan/1.0",
  creativeDirection: COLORING_DIRECTION,
});
if (result.ok) {
  expect(result.structuralFingerprintAfter).toBe(result.structuralFingerprintBefore);
  expect(result.html).toContain('data-openlen-visual-engine="creative-direction/1.0"');
}
```

- [ ] **Step 2: Write the failing fallback matrix**

Use `it.each` to force: inventory error, provider timeout, invalid response, model incompatibility, CSS policy violation, contrast violation, required asset miss, sanitizer rejection, technical render failure, structural mismatch and unexpected exception. Assert each returns `{ ok: false, status: "fallback", reasonCode }`, never returns candidate HTML and calls the provider exactly once or zero times when failure precedes the call.

Add a test where an image resolver mutates an href and prove the final fingerprint rejects the entire candidate.

- [ ] **Step 3: Run adapter tests and verify RED**

Run: `npx.cmd vitest run lib/generation/adapt-skeleton.test.ts`

Expected: FAIL because the adapter does not exist.

- [ ] **Step 4: Implement the atomic sequence**

```typescript
export async function adaptTemplateSkeleton(
  input: AdaptTemplateSkeletonInput,
  deps: AdaptTemplateSkeletonDeps = DEFAULT_DEPS,
): Promise<SkeletonAdaptationResult> {
  const inventory = buildSkeletonInventory(input.html, input.templateId);
  const before = inventory.structuralFingerprint;
  const creative = await deps.generateCreativeDirection({
    intent: input.intent,
    template: input.templateMetadata,
    inventory,
    brand: input.brand,
  });
  if (!creative.ok || creative.response.status === "incompatible") return typedFallback(creative);
  const compiled = compileSkeletonIdentity({ ...input, inventory, ...creative.response });
  if (!compiled.ok) return compiled;
  const assets = await deps.resolveSkeletonAssets({ ...input, inventory, html: compiled.html, ...creative.response });
  if (!assets.ok) return assets;
  const sanitized = deps.sanitize(assets.html);
  if (sanitized.html === null) return fallback("sanitization_failed");
  const after = fingerprintStructure(sanitized.html, { allowedAssetSlots: inventory.assetSlots.map((slot) => slot.slotIndex) });
  if (after !== before) return fallback("structural_invariant_failed");
  if (!(await deps.technicalRender(sanitized.html))) return fallback("technical_render_failed");
  return success(sanitized.html, before, after, creative);
}
```

The default `technicalRender` uses the existing SSRF-guarded `renderHtmlToInlineImage()` as a renderability probe and discards its bytes. Keep the original input immutable. Catch only at the outer boundary and map unexpected failures to `internal_error` without logging raw provider content.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```powershell
npx.cmd vitest run lib/generation/adapt-skeleton.test.ts lib/generation/creative-compiler.test.ts lib/generation/skeleton-assets.test.ts
git diff --check
```

Commit:

```powershell
git add lib/generation/adapt-skeleton.ts lib/generation/adapt-skeleton.test.ts
git commit -m "feat(generation): adapt template skeletons atomically"
```

---

### Task 9: Integrate safe full/skeleton/fallback paths into Quick

**Files:**
- Create: `lib/curate/build-curated-document.ts`
- Create: `lib/curate/build-curated-document.test.ts`
- Create: `lib/curate/quick-visual-engine.ts`
- Create: `lib/curate/quick-visual-engine.test.ts`
- Modify: `app/api/curate/route.ts`
- Modify: `lib/projects/types.ts`

**Interfaces:**
- Produces: `fillAndNormalizeCuratedTemplate()` and `finalizeCuratedDocument()`.
- Produces: `planQuickVisualEngineRoute()` and `runSkeletonCandidate()`.
- Adds: optional `ProjectData.generation.visualEngine: VisualEngineProjectMetadata`.

- [ ] **Step 1: Extract current Quick document building under tests**

Write tests that inject template HTML, fill, profile and metadata dependencies. Assert the extracted helpers preserve the current order:

```text
getTemplateHtml → fillAssembled → normalizeBornCanonical → seedBrandIntoHtml → ensurePageMeta → sanitizeForPublish
```

`fillAndNormalizeCuratedTemplate()` returns normalized HTML plus `filled`, `appliedOps`, usage and leak counts. `finalizeCuratedDocument()` accepts `brandRecolor: boolean`, applies profile/SEO/sanitize and returns either clean HTML or typed failure. Current Quick and `template_full` pass `true`; an adapted skeleton passes `false` because the compiler already enforced explicit-user > brand > creative precedence. `seedBrandIntoHtml(..., { recolor: false })` still adds the existing profile/contact surfaces without overwriting the final accent.

- [ ] **Step 2: Run extraction tests and verify RED**

Run: `npx.cmd vitest run lib/curate/build-curated-document.test.ts`

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement the extraction and re-run GREEN**

Keep behavior byte-equivalent with Visual Engine `off`. Do not move credit debit or database writes into the helper.

- [ ] **Step 4: Write failing route-planning tests**

Cover this table exactly:

| Mode | Safe result | Delivery | Shadow candidate |
| --- | --- | --- | --- |
| off | any | current weighted Quick | none |
| shadow | `template_skeleton` | current weighted Quick | safe skeleton ID |
| shadow | other/error | current weighted Quick | none |
| skeleton | `template_full` | safe template ID | none |
| skeleton | `template_skeleton` | adapted safe template ID | none |
| skeleton | composition/error | current weighted Quick | none |

Also prove a failed user-visible adaptation selects the original weighted Quick ID as fallback and never the unadapted safe skeleton.

- [ ] **Step 5: Add project metadata types**

```typescript
export interface VisualEngineProjectMetadata {
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

export interface ProjectData {
  html: string;
  generation?: { visualEngine?: VisualEngineProjectMetadata };
}
```

Add the optional `generation` property to the existing `ProjectData` interface without changing its current `settings`, `pages` or `preview` properties. Use a type-only import from generation contracts.

- [ ] **Step 6: Integrate the route behind flags**

Change `/api/curate` in these bounded steps:

1. Read `visualEngineMode()` once.
2. Start `pickTemplate()` and `selectGenerationRoute()` in parallel when mode is not off.
3. Run legacy `runShadowSelection()` only when `shouldRunLegacySafeShadow()` is true.
4. Resolve profile/copy once.
5. Deliver current Quick unchanged for `off` and every fallback route.
6. For safe `template_full`, load/fill/finalize the safe ID.
7. For user-visible `template_skeleton`, load/fill/normalize, adapt, then profile/meta/sanitize; emit no raw preview before success.
8. On adaptation failure, load/fill/finalize the original weighted Quick ID and emit that complete result.
9. In `shadow`, deliver baseline immediately and launch one redacted candidate job without awaiting it on the SSE critical path.
10. Persist `generation.visualEngine` only for an accepted user-visible skeleton project.

The shadow job must call `reserveVisualEnginePilotRun()` immediately before `adaptTemplateSkeleton()`, complete the run for every success/fallback path, record `candidatePersisted: false`, and do nothing when quota is exhausted. User-visible `skeleton` runs occur only after the pilot gate and therefore do not reserve from the 75-run pilot budget.

Map every background-job exception to a typed reason code, call existing `captureException()` with only route/stage/templateId/reasonCode, and complete the reserved row. Never attach brief, HTML, model text, profile data or raw provider errors to InariWatch context.

Keep the existing title, tags, version, thumbnail and debit behavior. Creative cost does not alter user credits.

- [ ] **Step 7: Test preview and atomic persistence seams**

In `quick-visual-engine.test.ts`, inject an event recorder and project writer. Prove skeleton success emits exactly one final preview before persistence, failure persists only fallback HTML, shadow persists baseline only, and `off` never calls creative code.

- [ ] **Step 8: Verify GREEN and commit**

Run:

```powershell
npx.cmd vitest run lib/curate/build-curated-document.test.ts lib/curate/quick-visual-engine.test.ts lib/curate/pick-template.test.ts lib/generation/shadow-selection.test.ts
npm.cmd run typecheck
git diff --check
```

Commit:

```powershell
git add lib/curate/build-curated-document.ts lib/curate/build-curated-document.test.ts lib/curate/quick-visual-engine.ts lib/curate/quick-visual-engine.test.ts app/api/curate/route.ts lib/projects/types.ts
git commit -m "feat(curate): run Visual Engine skeleton route"
```

---

### Task 10: Add one diagnostic review and a reproducible 75-adaptation pilot

**Files:**
- Modify: `crates/ai-gateway/src/gemini/sse.rs`
- Modify: `crates/ai-gateway/src/gemini/mod.rs`
- Modify: `crates/ai-gateway/src/types.rs`
- Modify: `crates/ai-gateway/src/napi.rs`
- Regenerate ignored local binding: `crates/ai-gateway/index.d.ts`
- Modify: `crates/ai-gateway/__test__/mock.test.mjs`
- Modify: `lib/ai-gateway.ts`
- Modify: `lib/ai/vision-critique.ts`
- Modify: `lib/ai/vision-critique.test.ts`
- Create: `lib/generation/visual-engine-2a-eval.ts`
- Create: `lib/generation/visual-engine-2a-eval.test.ts`
- Create: `lib/generation/visual-engine-2a-review-session.ts`
- Create: `lib/generation/visual-engine-2a-review-session.test.ts`
- Create: `tools/visual-engine-2a-reviewer/server.ts`
- Create: `tools/visual-engine-2a-reviewer/server.test.ts`
- Create: `tools/visual-engine-2a-reviewer/app.tsx`
- Create: `tools/visual-engine-2a-reviewer/app.test.tsx`
- Create: `scripts/visual-engine-2a-eval.ts`
- Create: `scripts/visual-engine-2a-review.ts`
- Create: `scripts/visual-engine-2a-scorecard.ts`
- Create: `scripts/visual-engine-2a-rollback-check.ts`
- Modify: `package.json`
- Modify: `vitest.config.ts`

**Interfaces:**
- Extends: `CritiqueVerdict.usage?` without changing critic fail-open behavior.
- Produces: deterministic eligible-case selection before creative output is observed.
- Produces: blind local A/B review with append-only decisions and a gate scorecard.

- [ ] **Step 1: Expose Gemini thinking usage through the existing gateway**

Write Rust and Node binding tests proving `usageMetadata.thoughtsTokenCount` becomes `StreamEvent::Usage.thinking_tokens` in Rust and `thinkingTokens` in JavaScript, with `0` when absent. Keep every current input/output/cached field backward-compatible.

Update `GeminiUsageMetadata`, the pending-usage tuple, `StreamEvent::Usage`, the N-API DTO, generated TypeScript declaration and `lib/ai-gateway.ts` narrowing. Add to the public TypeScript union:

```typescript
| {
    type: "usage";
    inputTokens: number;
    outputTokens: number;
    cachedTokens: number;
    thinkingTokens: number;
  }
```

Run:

```powershell
npm.cmd --prefix crates/ai-gateway run test:rust
npm.cmd --prefix crates/ai-gateway run build:debug
npm.cmd --prefix crates/ai-gateway run test:node
```

Expected before implementation: Rust/Node assertions fail because thinking usage is absent. Expected after implementation: all gateway tests pass.

- [ ] **Step 2: Add critic usage without changing its authority**

Write node tests proving the critic accumulates one `usage` event, returns it on a valid verdict, returns no usage when no call starts, and still never regenerates or throws. Add:

```typescript
usage?: {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  thinkingTokens: number;
};
```

Run: `npx.cmd tsx --test lib/ai/vision-critique.test.ts`

Expected before implementation: FAIL on missing usage.

- [ ] **Step 3: Write failing pilot-case and scorecard tests**

Build a deterministic pool from the 20 development and 10 holdout selector cases crossed with five pre-output scenarios: plain, saved-brand accent, identity-before-copy emphasis, explicit anti-generic styling and accessible-generous spacing. This creates 150 candidates before any creative call.

Sort by `caseId/scenarioId`, run safe selection, keep only `template_skeleton`, and stop reserving after 75. If fewer than 75 are eligible, emit the complete preflight counts and stop before making any creative call; do not lower the route threshold, duplicate rows or consume 2B quota. That result returns the design to user review because it demonstrates the catalog cannot support the planned 2A sample safely.

Scorecard tests cover:

```typescript
expect(scorecard).toMatchObject({
  started: 75,
  technicalSuccessRate: 0.96,
  visuallyPreferredRate: 0.90,
  structuralFailures: 0,
  partialPersistenceFailures: 0,
  acceptedForbiddenSignals: 0,
  rollbackVerified: true,
});
```

Assert minimum technical success is 72/75, visual preference uses `ceil(0.90 * comparable)`, ties are not wins, every failure remains in its denominator, and mean production-equivalent cost must be below 400,000 micro-MXN.

- [ ] **Step 4: Write failing blind-review domain tests**

Each row stores hashes and randomized labels `left/right`, never semantic labels in the browser DTO. Decisions are exactly `left | right | tie | invalid`, plus required/forbidden-signal checks and one short note. Reviewer name/email are runtime inputs saved only under ignored `scratch/`; they are never committed.

Use `writeJsonAtomic()` for session persistence. Prove resume, source SHA mismatch refusal, duplicate-decision idempotency and completed-session immutability.

- [ ] **Step 5: Implement evidence generation**

For each reserved case:

1. Produce baseline Quick and adapted skeleton HTML using injected production helpers.
2. Run at most one `critiqueGeneratedPage()` on the candidate; record diagnostics only.
3. Render desktop full-page evidence through the existing SSRF-guarded renderer.
4. Produce a copy-neutralized evidence variant by replacing visible text nodes in an evaluation-only copy; never alter persisted HTML.
5. Write JPEGs and a hash-addressed manifest under `scratch/visual-engine-2a/`.
6. Complete the pilot run with usage, production-equivalent cost, observed duplicated-shadow spend, latency, critic fields, `candidatePersisted: false` and fingerprints.

Do not write brief, copy, HTML or raw model output into the run table.

- [ ] **Step 6: Implement the local blind reviewer**

Bind only `127.0.0.1`. Require a random launch token on every API request. Serve one pair at a time with normal and copy-neutralized tabs, randomized sides, template/case identifiers hidden until after decision, and buttons for left, right, tie and invalid. Show progress and gate-impact summary; do not include an approve-all control.

The server persists decisions through `VisualEngine2AReviewSession`, then calls `recordVisualEnginePilotComparison()` with only the verdict enum and accepted-forbidden-signal count. The React app receives safe relative evidence URLs and no absolute source paths, API keys or reviewer email.

- [ ] **Step 7: Add exact commands**

```json
{
  "generation:visual-engine-2a:eval": "tsx --env-file=.env.local --tsconfig tsconfig.eval.json scripts/visual-engine-2a-eval.ts",
  "generation:visual-engine-2a:review": "tsx --env-file=.env.local --tsconfig tsconfig.eval.json scripts/visual-engine-2a-review.ts",
  "generation:visual-engine-2a:scorecard": "tsx --env-file=.env.local --tsconfig tsconfig.eval.json scripts/visual-engine-2a-scorecard.ts",
  "generation:visual-engine-2a:rollback-check": "tsx --env-file=.env.local --tsconfig tsconfig.eval.json scripts/visual-engine-2a-rollback-check.ts"
}
```

The eval command requires `OPENLEN_VISUAL_ENGINE=shadow`, a database, Gemini key, explicit rate-card version and `OPENLEN_VISUAL_ENGINE_MXN_PER_USD`. It refuses to start if mode is `skeleton` or quota state is not consistent.

The rollback command executes the same Quick fixture with Visual Engine unset, `off` and `shadow`; it writes a hash-addressed `scratch/visual-engine-2a/rollback-evidence.json` only when unset/off delivery artifacts are byte-equal and shadow delivery is equal while one candidate job is isolated. The scorecard requires this evidence file and verifies its fixture/output hashes.

Add `"tools/visual-engine-2a-reviewer/**/*.test.ts"` and `"tools/visual-engine-2a-reviewer/**/*.test.tsx"` to Vitest's existing include list so the reviewer tests run under both explicit commands and `npm test`.

- [ ] **Step 8: Verify tests and commit**

Run:

```powershell
npx.cmd tsx --test lib/ai/vision-critique.test.ts
npx.cmd vitest run lib/generation/visual-engine-2a-eval.test.ts lib/generation/visual-engine-2a-review-session.test.ts tools/visual-engine-2a-reviewer/server.test.ts tools/visual-engine-2a-reviewer/app.test.tsx
npm.cmd --prefix crates/ai-gateway run test:rust
npm.cmd --prefix crates/ai-gateway run test:node
npm.cmd run typecheck
git diff --check
```

Commit:

```powershell
git add crates/ai-gateway/src/gemini/sse.rs crates/ai-gateway/src/gemini/mod.rs crates/ai-gateway/src/types.rs crates/ai-gateway/src/napi.rs crates/ai-gateway/__test__/mock.test.mjs lib/ai-gateway.ts lib/ai/vision-critique.ts lib/ai/vision-critique.test.ts lib/generation/visual-engine-2a-eval.ts lib/generation/visual-engine-2a-eval.test.ts lib/generation/visual-engine-2a-review-session.ts lib/generation/visual-engine-2a-review-session.test.ts tools/visual-engine-2a-reviewer scripts/visual-engine-2a-eval.ts scripts/visual-engine-2a-review.ts scripts/visual-engine-2a-scorecard.ts scripts/visual-engine-2a-rollback-check.ts package.json vitest.config.ts
git commit -m "test(generation): add Visual Engine 2A pilot gate"
```

---

### Task 11: Document operations and run the pre-pilot release gate

**Files:**
- Create: `docs/generation/visual-engine-2a-runbook.md`

**Interfaces:**
- Produces: exact enable, migration, pilot, review, scorecard, rollback and incident commands.
- Produces: fresh verification evidence before spending the first of 75 adaptations.

- [ ] **Step 1: Write the runbook**

Document:

- required environment variables and allowed values;
- flag precedence with `OPENLEN_SAFE_TEMPLATE_PICKER`;
- migration application and budget-row inspection;
- how to run eval, resume review and calculate scorecard;
- the exact 75/72/90%/zero-failure/MXN 0.40 gates;
- how `productionEquivalentCost` differs from duplicated shadow-evaluation spend;
- how to mark stale starts abandoned without reclaiming quota;
- how to verify no brief/HTML/PII appears in the pilot table;
- `OPENLEN_VISUAL_ENGINE=off` rollback;
- why `skeleton` is not enabled globally by the implementation commit;
- why `section_composition` still uses current Quick until 2B.

- [ ] **Step 2: Run the focused Visual Engine suite**

```powershell
npx.cmd vitest run lib/generation lib/curate lib/theme-derive.test.ts tools/visual-engine-2a-reviewer
npx.cmd tsx --test lib/ai/vision-critique.test.ts lib/imagery/photograph.test.ts lib/agent/theme-apply.test.ts
```

Expected: 0 failed tests.

- [ ] **Step 3: Run baseline selection regression and typecheck**

```powershell
npx.cmd vitest run lib/templates/visual-metadata.test.ts lib/templates/suggest-visual-metadata.test.ts lib/generation/selector-scorecard.test.ts
npm.cmd run typecheck
git diff --check
```

Expected: 0 failed tests, typecheck exit 0 and diff check exit 0.

- [ ] **Step 4: Verify off-mode equivalence and kill switch**

Run the Quick integration fixture twice with `OPENLEN_VISUAL_ENGINE` unset and `off`. Assert identical selected ID, preview sequence, persisted `ProjectData`, user credits and no creative/pilot calls. Then set `shadow` and prove the delivered project remains identical while only the redacted candidate path runs.

- [ ] **Step 5: Audit the staged diff**

```powershell
git status --short
git diff --stat
git diff --check
```

Confirm no `.env*`, `scratch/`, screenshots, reviewer identity, provider responses or local audit JSON are staged.

- [ ] **Step 6: Commit the runbook and pre-pilot gate**

```powershell
git add docs/generation/visual-engine-2a-runbook.md
git commit -m "docs(generation): operate Visual Engine 2A pilot"
```

- [ ] **Step 7: Request code review before any paid pilot call**

Invoke `superpowers:requesting-code-review` against the complete 2A diff. Fix every blocking correctness, privacy, quota, fallback or structural-invariant finding with its own tested commit. Re-run Steps 2–5 after the final fix.

Do not run `generation:visual-engine-2a:eval` and do not consume any of the 75 adaptations until that review passes and the user explicitly authorizes the paid pilot.

## Execution Checkpoints

- **Checkpoint A — after Task 3:** contracts, mode, reusable safe selection and DOM invariants exist; no creative call or Quick behavior change.
- **Checkpoint B — after Task 6:** a complete provider response can compile into a safe in-memory candidate; still no Quick behavior change.
- **Checkpoint C — after Task 8:** atomic adaptation and persistent quota are testable end to end; still behind `off` by default.
- **Checkpoint D — after Task 9:** Quick integration exists behind flags; `off` is equivalent and `skeleton` remains disabled operationally.
- **Checkpoint E — after Task 11:** code review and verification pass; user decides whether to authorize the 75-call pilot.

## Definition of Done for Implementation, Not Pilot Success

Implementation is complete only when Tasks 1–11 are committed, focused tests and typecheck pass, `off` equivalence is demonstrated, migration/rollback are documented, no sensitive artifacts are staged, code review passes and no paid pilot call has been made without separate user authorization.

Pilot success is a later evidence event: exactly 75 starts, at least 72 technical successes, at least 90% blind preference among comparable candidates, zero protected-structure changes, zero partial persistence, zero forbidden signals in accepted results, mean production-equivalent cost below MXN 0.40 and verified rollback. Only then may the user decide to enable `skeleton` or proceed to 2B.
