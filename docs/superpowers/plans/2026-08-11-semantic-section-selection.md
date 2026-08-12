# Semantic Section Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make OpenLen choose section variants that semantically fit the requested niche, so a children’s coloring page cannot silently receive dashboard, analytics, course-UI, or software-mockup layouts.

**Architecture:** Add a deterministic, closed-vocabulary semantic profiler for curated section metadata (`name` and `variantLabel`). Persist that bounded profile in the immutable section inventory, derive a semantic policy from the already-validated intent and deterministic creative direction, and apply hard forbidden gates before existing visual/tie-break ranking. No section HTML or model output participates in selection. Real verification uses the existing hybrid asset pipeline only after all local gates pass.

**Tech Stack:** TypeScript, Zod-backed OpenLen contracts, Vitest, existing deterministic creative-direction builder, existing section composition inventory and renderer, Google Gemini only for the final authorized visual verification.

## Global Constraints

- Do not restore any whole-template fallback or clone path.
- Do not add a model call, retry, database migration, or mutable AI-authored catalog metadata.
- Semantic inputs are only the validated `IntentAnalysis`, deterministic `CreativeDirection`, and allowlisted `SectionRecord.name` / `variantLabel` / `id`.
- Never inspect raw section HTML, user copy, URLs, prompts, provider responses, or private metadata to profile a section.
- Forbidden semantic overlap is a hard rejection and cannot be overcome by score, mode, radius, density, or seed.
- Unknown catalog metadata is `neutral` and remains eligible unless its reviewed ID override is forbidden.
- If a required component type exists but every unused candidate is forbidden, return `section_role_coverage_failed` atomically.
- Preserve current storage-hash, fragment-grammar, sanitizer, structural-fingerprint, mobile, asset, visual-quality, and delivery gates.
- Run the real Mundo Pincel verification first. Do not run the other six niches unless Mundo Pincel passes deterministic and visual review.
- Keep every paid run single-attempt and sequential. Stop at the first failure.
- Preserve all pre-existing user changes and scratch files. Stage only files named by the current task.

---

## Task 1: Add the closed semantic vocabulary and profiler

**Files:**

- Create: `lib/generation/section-variant-semantics.ts`
- Create: `lib/generation/section-variant-semantics.test.ts`

### Step 1: Write the failing profiler and policy tests

Cover the public contract, not private helpers:

```ts
import { describe, expect, it } from "vitest";
import { AI_HYBRID_NICHE_CASES } from "./ai-hybrid-niche-cohort";
import {
  profileSectionVariant,
  buildSectionSemanticPolicy,
  scoreSectionSemanticProfile,
} from "./section-variant-semantics";

describe("profileSectionVariant", () => {
  it("uses reviewed overrides for ambiguous legacy dashboard variants", () => {
    expect(profileSectionVariant({
      id: "hero-01",
      name: "Hero 01",
      variantLabel: "Default",
    })).toEqual({
      tags: ["analytics", "dashboard", "software_mockup"],
      source: "reviewed_override",
    });
  });

  it("derives only closed tags from allowlisted catalog words", () => {
    expect(profileSectionVariant({
      id: "hero-11",
      name: "Illustrated Creator Playground",
      variantLabel: "Playful",
    })).toEqual({
      tags: ["creator", "illustrated", "playful"],
      source: "catalog_tokens",
    });
  });

  it("keeps unknown metadata neutral instead of guessing", () => {
    expect(profileSectionVariant({
      id: "hero-12",
      name: "Aurora",
      variantLabel: "Variant Twelve",
    })).toEqual({ tags: ["neutral"], source: "neutral" });
  });
});

describe("semantic compatibility", () => {
  it.each(AI_HYBRID_NICHE_CASES)(
    "builds a deterministic bounded policy for $id",
    (row) => {
      const first = buildSectionSemanticPolicy(row.intent, row.expectedCreativeDirection);
      const second = buildSectionSemanticPolicy(row.intent, row.expectedCreativeDirection);
      expect(first).toEqual(second);
      expect(first.preferred.length).toBeGreaterThan(0);
      expect(new Set(first.preferred).size).toBe(first.preferred.length);
      expect(new Set(first.forbidden).size).toBe(first.forbidden.length);
    },
  );

  it("never lets positive overlap override a forbidden tag", () => {
    const coloring = AI_HYBRID_NICHE_CASES[0];
    const policy = buildSectionSemanticPolicy(
      coloring.intent,
      coloring.expectedCreativeDirection,
    );
    expect(scoreSectionSemanticProfile(
      { tags: ["playful", "illustrated", "dashboard"], source: "catalog_tokens" },
      policy,
    )).toEqual({ eligible: false, score: 0, forbiddenMatches: ["dashboard"] });
  });
});
```

Add a table test for every forbidden family in the approved design:

- `saas_dashboard` → dashboard, analytics, software mockup, corporate
- `course_progress_ui` / `adult_course_saas` → course UI, dashboard, analytics
- `abstract_software_mockup` → software mockup, dashboard
- `developer_tool_ui` / `documentation_layout` → developer tool, terminal, documentation
- `generic_game_ui` → game UI
- `generic_ecommerce_grid` → commerce grid
- `wellness_dashboard` → wellness dashboard treatment
- `corporate_photography` / `corporate_event_branding` / `conference_agenda` → corporate treatment

Run the focused RED:

```powershell
npm.cmd test -- lib/generation/section-variant-semantics.test.ts
```

Expected: FAIL because `section-variant-semantics.ts` does not exist.

### Step 2: Implement the bounded profiler

Create the exact public types and make all returned arrays sorted and frozen:

```ts
export const SECTION_SEMANTIC_TAGS = [
  "neutral", "playful", "creator", "illustrated", "editorial",
  "cinematic", "event", "marquee", "school", "community", "warm",
  "photographic", "tactile", "wellness", "commerce", "commerce_grid",
  "product", "dashboard", "analytics", "software_mockup", "course_ui",
  "corporate", "developer_tool", "documentation", "game_ui", "terminal",
] as const;

export type SectionSemanticTag = typeof SECTION_SEMANTIC_TAGS[number];

export interface SectionVariantSemanticProfile {
  readonly tags: readonly SectionSemanticTag[];
  readonly source: "reviewed_override" | "catalog_tokens" | "neutral";
}

export interface SectionSemanticPolicy {
  readonly preferred: readonly SectionSemanticTag[];
  readonly forbidden: readonly SectionSemanticTag[];
}
```

Use ASCII-normalized catalog tokens and a closed mapping. The implementation must never copy an unknown token into the profile:

```ts
function asciiTokens(values: readonly string[]): string[] {
  return values.flatMap((value) => value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean));
}
```

Include reviewed overrides for the verified misleading legacy variants:

```ts
const REVIEWED_OVERRIDES = Object.freeze({
  "hero-01": ["analytics", "dashboard", "software_mockup"],
  "hero-03": ["analytics", "dashboard"],
  "features-01": ["analytics", "dashboard", "developer_tool"],
  "features-03": ["analytics", "dashboard", "software_mockup"],
} satisfies Record<string, readonly SectionSemanticTag[]>);
```

Map the seven approved cohorts positively:

- creative play → `creator`, `illustrated`, `playful`, `warm`
- horror → `cinematic`, `editorial`
- comedy → `event`, `marquee`, `photographic`, `playful`
- video games → `cinematic`, `game_ui`, `illustrated`
- school → `community`, `editorial`, `photographic`, `school`, `warm`
- cooking → `editorial`, `photographic`, `tactile`, `warm`
- physical product → `commerce`, `photographic`, `product`, `tactile`

Implement hard eligibility before score:

```ts
export function scoreSectionSemanticProfile(
  profile: SectionVariantSemanticProfile,
  policy: SectionSemanticPolicy,
): { eligible: boolean; score: number; forbiddenMatches: SectionSemanticTag[] } {
  const tags = new Set(profile.tags);
  const forbiddenMatches = policy.forbidden.filter((tag) => tags.has(tag));
  if (forbiddenMatches.length > 0) {
    return { eligible: false, score: 0, forbiddenMatches: [...forbiddenMatches] };
  }
  const score = policy.preferred.reduce(
    (total, tag) => total + (tags.has(tag) ? 25 : 0),
    0,
  );
  return { eligible: true, score, forbiddenMatches: [] };
}
```

### Step 3: Verify and commit Task 1

```powershell
npm.cmd test -- lib/generation/section-variant-semantics.test.ts lib/generation/ai-hybrid-niche-cohort.test.ts
npm.cmd run typecheck
git diff --check
```

Review the diff for raw-input leakage and open-ended tags. Commit only the two Task 1 files:

```powershell
git add lib/generation/section-variant-semantics.ts lib/generation/section-variant-semantics.test.ts
git commit -m "feat(generation): profile section semantics"
```

---

## Task 2: Integrate semantic profiles into inventory and deterministic selection

**Files:**

- Modify: `lib/generation/section-inventory.ts`
- Modify: `lib/generation/section-inventory.test.ts`
- Modify: `lib/generation/compose-sections.ts`
- Modify: `lib/generation/compose-sections.test.ts`
- Modify: `lib/generation/visual-engine-2b-qualification.ts`
- Modify: `lib/generation/visual-engine-2b-qualification.test.ts`

### Step 1: Write RED inventory and selection tests

Extend inventory assertions so the inventory hash commits to the semantic profile and raw names never appear:

```ts
expect(frozen.entries[0]).toMatchObject({
  semanticProfile: {
    tags: ["analytics", "dashboard", "software_mockup"],
    source: "reviewed_override",
  },
});
expect(JSON.stringify(frozen)).not.toContain("private catalog wording");
```

Replace all `resolveSectionPlan(plan, inventory, null)` fixtures with an explicit validated selection context:

```ts
const coloring = AI_HYBRID_NICHE_CASES[0];
const context = {
  intent: coloring.intent,
  direction: coloring.expectedCreativeDirection,
};
```

Add exact regressions:

```ts
it("rejects dashboard hero/features for Mundo Pincel", () => {
  const inventory = buildSectionCompositionInventory([
    record("hero-01", "hero", "Default analytics dashboard", "Software mockup"),
    record("hero-11", "hero", "Illustrated creator playground", "Playful"),
    record("features-01", "features", "Analytics code metrics", "Dashboard"),
    record("features-11", "features", "Creative activity cards", "Illustrated playful"),
  ]);
  const selection = resolveSectionPlan(coloringPlan(inventory.hash), inventory, context);
  expect(selection.map((row) => row.sectionId)).toEqual(["hero-11", "features-11"]);
});

it("fails closed when every candidate for a required role is forbidden", () => {
  const inventory = buildSectionCompositionInventory([
    record("hero-01", "hero", "Analytics dashboard", "Software mockup"),
  ]);
  expect(() => resolveSectionPlan(coloringPlan(inventory.hash), inventory, context))
    .toThrow(expect.objectContaining({ code: "section_role_coverage_failed" }));
});
```

Also retain tests for stale inventory, fragment absence, unique selection, stable repeatability, and unknown-neutral fallback.

Run RED:

```powershell
npm.cmd test -- lib/generation/section-inventory.test.ts lib/generation/compose-sections.test.ts lib/generation/visual-engine-2b-qualification.test.ts
```

Expected: semantic fields/context are absent and dashboard candidates still win or compile signatures fail.

### Step 2: Extend the immutable inventory

Add the profile to each entry:

```ts
export interface SectionCompositionInventoryEntry {
  // existing fields stay unchanged
  semanticProfile: SectionVariantSemanticProfile;
}
```

Build it only from allowlisted metadata:

```ts
semanticProfile: profileSectionVariant({
  id: record.id,
  name: record.name,
  variantLabel: record.variantLabel,
}),
```

Because `semanticProfile` is inside `entries`, the existing canonical inventory hash automatically detects profile/catalog drift. Do not add raw names or labels to the inventory.

### Step 3: Require semantic selection context and rank in the approved order

Change the resolver signature:

```ts
export interface SectionSelectionContext {
  readonly intent: IntentAnalysis;
  readonly direction: CreativeDirection;
}

export function resolveSectionPlan(
  plan: SectionPlan,
  inventory: SectionCompositionInventory,
  context: SectionSelectionContext,
): SectionSelectionRow[]
```

For each row:

1. filter by component type, `needsJs === false`, and unused ID;
2. score semantic compatibility;
3. remove forbidden candidates;
4. order first by semantic score descending;
5. use existing `rankCompositionVariants` result as the second key;
6. keep the existing stable seed and ID tie-break.

Use a visual-rank index so existing visual ranking remains unchanged:

```ts
const policy = buildSectionSemanticPolicy(context.intent, context.direction);
const evaluated = eligible
  .map((entry) => ({ entry, semantic: scoreSectionSemanticProfile(entry.semanticProfile, policy) }))
  .filter((row) => row.semantic.eligible);
const visual = rankCompositionVariants(
  evaluated.map((row) => row.entry),
  context.direction,
  { seed: stableSeed(plan, row) },
);
const visualIndex = new Map(visual.map((entry, index) => [entry.id, index]));
const selected = evaluated.sort((left, right) =>
  right.semantic.score - left.semantic.score ||
  (visualIndex.get(left.entry.id) ?? Number.MAX_SAFE_INTEGER) -
    (visualIndex.get(right.entry.id) ?? Number.MAX_SAFE_INTEGER) ||
  left.entry.id.localeCompare(right.entry.id)
)[0]?.entry;
```

If `eligible` is nonempty but `evaluated` is empty, throw `section_role_coverage_failed`. If no candidate of that component type exists at all, retain `section_fragment_unavailable`.

### Step 4: Pass deterministic direction from composition and qualification

In `compose-sections.ts`, compute direction before selection without a provider call:

```ts
const deterministic = buildDeterministicCreativeDirection(input.intent);
selection = (deps.resolvePlan ?? resolveSectionPlan)(
  planning.plan,
  inventory,
  { intent: input.intent, direction: deterministic.direction },
);
```

Add a test spy proving the resolver receives Mundo Pincel’s `illustrated_activity_book` direction and never receives `null`.

In `visual-engine-2b-qualification.ts`, derive the same deterministic direction for each cohort row and pass the same explicit context. Qualification must therefore validate the real selection policy, not only role availability.

### Step 5: Verify and commit Task 2

```powershell
npm.cmd test -- lib/generation/section-variant-semantics.test.ts lib/generation/section-inventory.test.ts lib/generation/compose-sections.test.ts lib/generation/visual-engine-2b-qualification.test.ts
npm.cmd run typecheck
git diff --check
```

Commit only Task 2 files:

```powershell
git add lib/generation/section-inventory.ts lib/generation/section-inventory.test.ts lib/generation/compose-sections.ts lib/generation/compose-sections.test.ts lib/generation/visual-engine-2b-qualification.ts lib/generation/visual-engine-2b-qualification.test.ts
git commit -m "feat(generation): select semantically compatible sections"
```

---

## Task 3: Gate all seven niches and exact Mundo Pincel originality

**Files:**

- Modify: `lib/generation/ai-hybrid-niche-cohort.test.ts`
- Modify: `lib/curate/ai-hybrid-regression.test.ts`
- Modify: `package.json`
- Modify: `docs/generation/ai-hybrid-only-runbook.md`

### Step 1: Add RED cohort assertions

Build a small reviewed fixture catalog containing, for every component type used by the seven cohorts:

- at least one positive semantic variant;
- at least one neutral variant;
- at least one forbidden variant for the relevant cohort.

For each cohort, run the real plan + inventory + deterministic selector and assert:

```ts
expect(new Set(selection.map((row) => row.contentHash)).size).toBeGreaterThanOrEqual(3);
expect(selection.every((row) => {
  const entry = inventory.entries.find((candidate) => candidate.id === row.sectionId)!;
  return scoreSectionSemanticProfile(entry.semanticProfile, policy).eligible;
})).toBe(true);
expect(selection.map((row) => row.sectionId).every((id) => id.endsWith("-01"))).toBe(false);
```

For Mundo Pincel, assert exact negative and positive evidence:

```ts
expect(ids).not.toContain("hero-01");
expect(ids).not.toContain("features-01");
expect(selectedTags).toEqual(expect.arrayContaining([
  expect.stringMatching(/creator|illustrated|playful/),
]));
```

In the end-to-end hybrid regression, switch the injected asset mode from `off` to `hybrid` and assert the mode reaches composition. Keep provider/storage mocked in local tests; this does not make a paid call.

Run RED:

```powershell
npm.cmd test -- lib/generation/ai-hybrid-niche-cohort.test.ts lib/curate/ai-hybrid-regression.test.ts
```

### Step 2: Add the semantic selector to the release gate and runbook

Add the two new semantic test files and inventory/qualification coverage to `generation:ai-hybrid:gate` exactly once. Update the runbook to state:

- section selection is deterministic and model-free;
- forbidden section semantics fail closed;
- asset mode `hybrid` is required for visual acceptance runs;
- `off` remains rollback-only for this test;
- Mundo Pincel passes before the other six niche runs;
- no retries and stop on first failure.

### Step 3: Run local release verification

```powershell
npm.cmd run generation:ai-hybrid:gate
npm.cmd run generation:visual-engine-assets:gate
npm.cmd run typecheck
git diff --check
```

Also run the relevant compositor/visual regressions explicitly:

```powershell
npm.cmd test -- lib/generation/section-variant-semantics.test.ts lib/generation/section-inventory.test.ts lib/generation/compose-sections.test.ts lib/generation/visual-engine-2b-qualification.test.ts lib/generation/closed-loop-repair.test.ts lib/generation/composition-mobile-safety.test.ts lib/curate/ai-composition-delivery.test.ts
```

Inspect the staged diff for raw prompts, provider bodies, URLs, credentials, email, screenshots, generated HTML, and scratch paths. None may be committed.

### Step 4: Commit Task 3

```powershell
git add lib/generation/ai-hybrid-niche-cohort.test.ts lib/curate/ai-hybrid-regression.test.ts package.json docs/generation/ai-hybrid-only-runbook.md
git commit -m "test(generation): gate semantic niche composition"
```

---

## Task 4: Run the bounded real visual verification

**Files:**

- No tracked production files expected.
- Ignored evidence only under `scratch/semantic-section-selection/`.

### Step 1: Verify runtime prerequisites without making a paid call

Read-only checks:

- current branch/commit and clean tracked diff;
- required model/rate-card/assets environment variables are present, without printing values;
- `OPENLEN_VISUAL_ENGINE=enabled` and `OPENLEN_VISUAL_ENGINE_ASSETS=hybrid` for the diagnostic process;
- native HTML/image/rate-limit bindings resolve for the chosen Node runner;
- published section catalog inventory can be loaded and hashed;
- provider budget guard is positive and bounded.

Do not start localhost/Turbopack. Use the existing direct Node/tsx diagnostic seam with the repository’s `server-only` shim.

### Step 2: Run Mundo Pincel once

Use the exact approved brief and `assetMode: "hybrid"`. No retry.

Required machine-readable acceptance:

- final result `ok: true`;
- route `section_composition`;
- `templateId: null`;
- at least three distinct section content hashes;
- selected IDs exclude `hero-01` and `features-01`;
- selected semantic profiles have zero forbidden matches;
- required role order remains exact;
- asset manifest/trace pair is valid and resolved;
- inherited-copy leaks are zero;
- structural fingerprint and sanitizer gates pass;
- deterministic mobile overflow, weak hierarchy, and square-treatment diagnostics are all false;
- no whole-template import or fallback is reachable.

Save only redacted manifest/trace, selected IDs/tags, and local screenshots. Do not save model response bodies, prompts, user data, secrets, or provider URLs.

### Step 3: Perform desktop and mobile visual review

Render at desktop and mobile widths and reject if any of these remain:

- analytics/dashboard metrics, charts, or software mockups;
- school/course/dashboard appearance;
- generic gradients where illustration/image assets were required;
- clipped, overflowing, unreadable, or overly square mobile treatment;
- fewer than three visually distinct section fragments;
- a page that looks like one intact donor template.

If rejected, stop. Report the selected section IDs, bounded semantic tags, deterministic diagnostics, and the precise visual reason. Do not run another paid attempt automatically.

### Step 4: Run the remaining six niches sequentially only after Mundo passes

Order:

1. horror experience;
2. comedy club;
3. video-game launch;
4. school website;
5. cooking publication;
6. physical-product sale.

Each case receives one request, uses `assetMode: "hybrid"`, applies the same deterministic and visual gates, and stops the sequence at the first failure.

### Step 5: Final release evidence

After the real checks, rerun only the non-paid local gates:

```powershell
npm.cmd run generation:ai-hybrid:gate
npm.cmd run generation:visual-engine-assets:gate
npm.cmd run typecheck
git diff --check
```

Record pass/fail, bounded cost/usage totals, reason codes, selected IDs/tags, and screenshot paths in an ignored report. Do not commit generated pages or evidence.
