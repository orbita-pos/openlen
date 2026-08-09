# OpenLen Visual Engine 2B — Section Composition Design

Date: 2026-08-09
Status: approved for implementation planning
Owner: OpenLen

## 1. Purpose

Visual Engine 2B handles requests for which Safe Selection cannot identify a sufficiently compatible full template or template skeleton. It assembles a page from reviewed section fragments while preserving the functional intent and applying the visual identity produced by the existing Visual Engine.

2B is an extension of 2A, not a replacement. It runs only when the generation decision is `section_composition`. The `template_full` and `template_skeleton` paths keep their current behavior.

## 2. Goals

- Reuse OpenLen's existing section library, assembler, copy engine, design-token compiler, asset resolver, sanitizer, publisher, and Vision Critic.
- Separate the requested semantic role from the reusable visual component type.
- Preserve every required functional role without allowing misleading substitutions.
- Make section selection, ordering, manifests, validation, fallback, and rollout deterministic.
- Apply one creative direction across the whole page so the result reads as one product rather than unrelated fragments.
- Keep delivery atomic and preserve the current Quick fallback on every 2B failure.
- Validate locally before any paid model evaluation.

## 3. Non-goals

- Rebuilding 2A, Safe Selection, design tokens, copy generation, publication, or Vision Critic.
- Replacing the existing HTML engine or agent engine.
- Free-form page generation from scratch; that belongs to 2C.
- Activating 2B in production as part of implementation.
- Running Gemini, writing pilot telemetry, or spending a paid budget without a separate explicit authorization.
- Expanding the section library merely to make a test pass. Missing capabilities must remain typed and visible.

## 4. Existing components to reuse

- `lib/generation/analyze-intent.ts`: canonical functional, audience, domain, emotional, and constraint intent.
- `lib/generation/decide-route.ts`: chooses `section_composition` when full-template and skeleton delivery are unsafe.
- `lib/generation/generate-creative-direction.ts`: creative direction and bounded adaptation plan.
- `lib/generation/assets.ts`: controlled asset resolution.
- `lib/sections/select.ts`: deterministic section-variant ranking, to be extended rather than replaced.
- `lib/sections/assemble.ts`: deterministic token binding and fragment stitching.
- `lib/assemble/fill.ts`: copy fill and inherited-copy leak sweep.
- normalization, page metadata, sanitization, thumbnail, project-version, preview, and persistence paths already used by Quick.
- Visual Engine pilot ledger, cost accounting, privacy boundaries, and critic infrastructure.

The legacy `lib/assemble/recipe.ts` remains available to the independent `/api/assemble` product flow but is not the structural authority for Visual Engine 2B. 2B must not ask a second model call to re-decide intent, sections, palette, or typography already established by the Visual Engine.

## 5. Activation and precedence

The operational modes become:

| Mode | Delivery behavior |
| --- | --- |
| `off` or unset | Existing legacy Quick behavior. |
| `shadow` | Compute eligible Visual Engine candidates without changing the response. |
| `skeleton` | Deliver 2A `template_skeleton`; preserve the existing fallback for `section_composition`. |
| `composition` | Deliver 2A plus 2B when the route is `section_composition`. |

The mode is monotonic: enabling composition includes the already-approved skeleton path. A mode never demotes an eligible `template_full` or `template_skeleton` request into composition.

Rollback is immediate: remove the variable or set it to `off`. No existing project is rewritten.

## 6. Shared hybrid pipeline

The 2B pipeline is:

1. Receive the existing `IntentAnalysis`, Safe Selection decision, user-context allowlist, and brand context.
2. Confirm that the decision is exactly `section_composition`.
3. Load a published section inventory and freeze its canonical hash.
4. Build a deterministic `SectionPlan` from `functional.requiredSections` plus bounded page chrome.
5. Resolve every requested role to a compatible component type and published variant.
6. Fetch the selected fragments and recheck their IDs and content hashes.
7. Stitch a neutral composition skeleton, bind section token dialects to the shared `--ol-*` contract, and retain role ownership markers.
8. Fill copy with the existing user/brief context without reclassifying the product, then reject inherited copy.
9. Pass the complete neutral skeleton through the existing 2A adaptation boundary. That boundary generates `CreativeDirection`, compiles the approved identity, resolves assets, sanitizes, fingerprints, and technically renders the candidate without changing its structure.
10. Revalidate exact role coverage, token policy, HTML normalization, sanitization, and asset policy after adaptation.
11. Run Vision Critic diagnostically in shadow and pilot modes.
12. Atomically finalize preview, project data, metadata, debit, and pilot result.

No partially assembled result is deliverable.

## 7. Section-plan contract

The planner emits a strict versioned structure similar to:

```ts
interface SectionPlan {
  schemaVersion: "section-plan/1.0";
  intentHash: string;
  inventoryHash: string;
  rows: Array<{
    ordinal: number;
    requestedRole: CanonicalSectionRole;
    componentType: SectionType;
    compatibilityKind: "exact" | "alias" | "structural";
    compatibilityScore: number;
    compatibilityRuleId: string;
    required: true;
  }>;
}
```

The model does not author this plan. It is derived from canonical intent and an audited compatibility table.

### 7.1 Role and component separation

`requestedRole` records what the product must communicate. `componentType` records the reusable geometry used to render it. Copy, validation, manifests, and telemetry continue to refer to `requestedRole`.

Examples:

- `hero → hero` is exact.
- `header → navbar` is an alias.
- `call_to_action → cta` is an alias.
- `how_it_works → how-it-works` is an alias.
- `coloring_gallery → gallery` is structural.
- a reviewed neutral card section may structurally support `activities`, `programs`, `minigames`, or a collection of stories while preserving the requested role and role-specific copy.

Explicitly forbidden examples include `stories → testimonials`, `minigames → pricing`, and any substitution based solely on similar visual shape.

### 7.2 Coverage and ordering

- Every required role must resolve exactly once unless the intent explicitly repeats it.
- At most one navbar and one footer are allowed.
- Navbar and footer are bounded page chrome; no other functional role may be invented.
- Required-role order is stable and follows the canonical page-order policy while preserving intentional same-role order.
- A component type may repeat for different requested roles.
- Unsupported or ambiguous roles produce a typed incompatibility and stop composition before provider, persistence, or debit.

## 8. Section inventory and selection

The inventory exposes only published section metadata needed for planning and selection. At minimum it includes ID, component type, mode, content hash, theme tokens, radius/density signals, JavaScript requirement, asset capability, and status.

Selection is deterministic:

- exact or audited semantic compatibility is mandatory;
- theme mode and safe token adoption dominate layout preference;
- density, radius, media geometry, and interaction requirements refine the choice;
- unsafe JavaScript and unresolved asset dependencies are penalized or rejected;
- ties use a stable seed derived from approved hashes, never runtime randomness;
- unpublished or stale rows are ineligible.

The inventory hash is checked after planning and again before assembly. Selected fragment IDs and content hashes are checked after fetch. Drift produces a typed fallback; it never triggers silent reselection.

## 9. Creative direction and copy

2B reuses the 2A creative contract for palette, typography, radii, shapes, density, iconography, imagery, and emotional tone. The assembler first uses a fixed neutral `AssembleTheme` only to normalize each fragment's token dialect. The resulting complete document is then adapted by the existing 2A compiler, which owns the final `--ol-*` values and cannot change the section plan.

All fragments bind to a single page-level token source. Section-local hardcoded theme definitions are rebound through the existing `--ol-*` contract. Tokens outside the allowlist are rejected or left non-controllable according to the current compiler rules.

Copy fill receives the original brief, approved user/profile fields, requested role for each section, and bounded brand context. It must not infer private facts or reclassify the site. Existing cloned-template behavior and leak sweeping remain mandatory.

For a children's coloring platform, a valid plan can use:

```text
hero              → hero
coloring_gallery  → gallery
minigames         → neutral cards
stories           → neutral cards
activities        → neutral cards
footer            → footer
```

The card geometry may be reused, but role-specific copy and markers keep minigames, stories, and activities distinct. One pastel, illustrated, rounded creative direction applies to every section.

## 10. Composition manifest

Every attempt produces an internal redacted manifest containing only bounded identifiers and hashes:

```ts
interface SectionCompositionManifest {
  schemaVersion: "section-composition-manifest/1.0";
  intentHash: string;
  creativeDirectionHash: string;
  inventoryHash: string;
  orderedRoles: CanonicalSectionRole[];
  selectedSectionIds: string[];
  selectedContentHashes: string[];
  compatibilityRuleIds: string[];
  outputHash: string | null;
  resultCode: SectionCompositionResultCode;
}
```

The manifest contains no brief, full intent, HTML, copy, user profile, prompt, provider body, image bytes, secret, email, reviewer identity, or absolute path.

## 11. Hard validation and failure behavior

The following are hard failures:

- route is not `section_composition`;
- required role is missing, duplicated, reordered illegally, or mapped by an unapproved rule;
- inventory or fragment hash changes;
- a selected fragment is unpublished, missing, malformed, or unsafe;
- inherited brand/copy remains after the sweep;
- controlled tokens escape their allowlist;
- required asset cannot be resolved safely;
- normalization, editor-marker guard, or publish sanitizer fails;
- atomic finalization fails.

The first typed failure ends the attempt. No retry, silent replacement, partial HTML, preview, project mutation, or creative debit occurs. Quick returns the existing fallback.

Provider and critic failures preserve safe usage metadata when supplied. Errors are redacted before logs or pilot telemetry. Vision Critic is fail-open only as a diagnostic during shadow/pilot; it cannot override a hard structural failure.

## 12. Atomic delivery

2B follows the existing Quick atomicity boundary. Candidate HTML and metadata remain in memory until all hard checks pass. Preview, persisted project HTML, Visual Engine metadata, version snapshot, creative debit, and pilot completion are finalized once. Terminal ledger completion uses compare-and-set semantics and cannot be attempted twice.

If delivery finalization fails, legacy Quick output remains authoritative.

## 13. Local qualification and tests

No paid call is needed to qualify implementation. Required local coverage includes:

- planner tests for exact, alias, structural, forbidden, duplicate, missing, and unsupported roles;
- deterministic selection and tie-breaking;
- published-only inventory and staleness barriers;
- fragment fetch/content-hash drift;
- token binding and visual-theme coherence;
- requested-role markers and exact coverage;
- inherited-copy leak detection;
- malformed HTML, sanitizer, asset, and controlled-token failures;
- Quick integration for `off`, `shadow`, `skeleton`, `composition`, success, and every typed fallback class;
- atomic preview/project/debit/ledger behavior;
- redacted manifest allowlist and cost accounting;
- rollback equivalence;
- a deterministic 15-case corpus containing children's coloring, stories, restaurants, wellness, SaaS, portfolio, and intentionally unsupported compositions.

The local gate requires 15/15 valid plans or correctly typed fallbacks, zero missing roles, zero inherited-copy leaks, stable manifests across two identical runs, full focused regression, typecheck, rollback, diff check, and privacy audit.

## 14. Paid pilot and rollout gate

Implementation does not authorize the pilot. After local qualification, a new explicit authorization may allow:

- at most 15 smoke cases;
- a maximum recommended budget of 20 MXN;
- redacted telemetry only;
- blind human comparison between 2B composition and the current Quick fallback;
- no 75-adaptation run at this stage.

Recommended promotion thresholds are:

- 100% technical integrity among started cases;
- zero missing required roles;
- zero inherited-copy or identity leakage;
- immediate theme recognition for the requested domain/audience;
- composition preferred or tied against fallback in at least 70% of comparable blind reviews;
- complete cost records for every started case.

If any hard gate fails, `composition` remains disabled and 2A continues unchanged. These thresholds are product recommendations, not verified facts about model quality; the pilot must validate them.

## 15. Scope boundary with 2C

2B assembles only from compatible reviewed section capabilities. When no safe composition covers all required roles, it returns a typed result intended for the future 2C controlled-scratch path. 2B never weakens its compatibility rules to avoid that boundary.

## 16. Completion definition

2B implementation is complete when:

1. `section_composition` is connected to the shared hybrid pipeline behind the new delivery mode.
2. The deterministic plan, inventory, manifest, validation, fallback, atomicity, and cost contracts are implemented and tested.
3. The 15-case local qualification is reproducible on a clean committed HEAD.
4. The existing 2A paths and legacy Quick delivery remain regression-clean.
5. Runbook and rollback instructions are current.
6. No live model, database pilot, deploy, or production flag change was performed without separate authorization.
