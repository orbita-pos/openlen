# Semantic Section Selection Design

## Problem

The real Mundo Pincel run completed the hybrid route but produced dashboard-like sections. The catalog contains 204 published variants, yet `buildSectionCompositionInventory` discards `name` and `variantLabel`, and `composeSectionCandidate` calls `resolveSectionPlan(..., null)`. With no creative direction or semantic profile, ties fall back to lexical IDs and repeatedly choose `navbar-01`, `hero-01`, `gallery-01`, `features-01..03`, and `footer-01`.

Gemini did not choose those dashboard fragments. OpenLen selected them before the creative direction was applied.

The diagnostic also ran with `assetMode: "off"`, so gallery placeholders remained gradients. Production asset activation is a separate runtime control and must be enabled during the final visual test.

## Selected Design

### Reviewed semantic profile

Add a pure `section-variant-semantics` module. It will produce a bounded, deterministic profile from allowlisted catalog metadata:

```ts
type SectionSemanticTag =
  | "neutral" | "playful" | "creator" | "illustrated" | "editorial"
  | "cinematic" | "event" | "marquee" | "school" | "community"
  | "warm" | "photographic" | "tactile" | "wellness" | "commerce"
  | "commerce_grid"
  | "product" | "dashboard" | "analytics" | "software_mockup"
  | "course_ui" | "corporate" | "developer_tool" | "documentation"
  | "game_ui" | "terminal";

interface SectionVariantSemanticProfile {
  tags: readonly SectionSemanticTag[];
  source: "reviewed_override" | "catalog_tokens" | "neutral";
}
```

Profiles use lowercase ASCII tokens from `name` and `variantLabel`, not raw HTML or model output. A small reviewed override table covers ambiguous legacy variants whose neutral names hide strong structure, including the verified dashboard/software mockup in `hero-01` and the code/analytics treatment in `features-01`. Unknown variants are `neutral`; they are never guessed into a niche.

### Intent compatibility

Normalize intent and creative-direction signals into the same bounded vocabulary. Examples:

- `saas_dashboard`, `course_progress_ui`, and `abstract_software_mockup` reject dashboard, analytics, course UI, and software mockups.
- `developer_tool_ui` and `documentation_layout` reject developer-tool, terminal, and documentation variants.
- `generic_game_ui` rejects game-UI variants while allowing cinematic/editorial dark layouts.
- `generic_ecommerce_grid` rejects commerce-grid treatment for editorial food pages.
- `creative_play` and illustrated/playful signals prefer creator, playful, illustrated, and visual-first variants.
- horror prefers cinematic/editorial treatment without SaaS or game UI.
- comedy prefers event, marquee, performer, playful treatment without corporate conference treatment.
- school prefers warm, editorial, community treatment without course dashboards.
- cooking prefers editorial, warm, photographic treatment without commerce/wellness dashboards.
- physical products prefer product, commerce, tactile, and photographic treatment without software mockups.

Forbidden compatibility is a hard gate. Positive compatibility is a score. Neutral variants remain eligible but rank below a positive match.

### Direction-aware deterministic ranking

Before resolving the section plan, call the existing `buildDeterministicCreativeDirection(input.intent)` and pass its direction into `resolveSectionPlan`. Extend inventory entries with their semantic profile. Rank each eligible candidate by:

1. rejection when semantic tags intersect normalized forbidden signals;
2. positive semantic overlap with intent/direction;
3. existing mode, radius, density, and no-JS score;
4. the existing stable seed and section ID tie-break.

The selector remains deterministic, makes no provider call, and never sees template HTML. If a required component type has candidates but all are forbidden, return `section_role_coverage_failed`; do not silently choose a contradictory fragment.

### Assets during real verification

The semantic selector controls layout choice; the domain-assets engine controls imagery. The final Mundo Pincel diagnostic will run with `assetMode: "hybrid"` and the existing bounded provider/storage policies. `off` remains valid rollback behavior but is not a meaningful visual acceptance test for an illustration-first brief.

## Safety Invariants

- No whole-template fallback or clone path.
- No Gemini call for section selection.
- No raw HTML, copy, prompt, URL, or private metadata enters the semantic profile.
- Semantic tags and mappings are closed enums with strict tests.
- Forbidden matches cannot be overcome by positive score or seeded tie-breaking.
- Existing storage hash, fragment grammar, role coverage, sanitizer, structural fingerprint, mobile, and delivery gates remain unchanged.
- Required-role failure remains atomic: no partial HTML is delivered.

## Verification

- Unit tests for token normalization, reviewed overrides, unknown-neutral behavior, and every forbidden-signal family.
- Ranking tests proving forbidden candidates never win and stable ties remain deterministic.
- Seven-case cohort test proving each selected set has at least three distinct fragments, no forbidden semantic tag, and no forced `-01` pattern.
- Exact Mundo Pincel regression rejecting `hero-01` and `features-01`, and preferring at least one creator/playful/illustrated variant.
- Existing composition, qualification, delivery, visual-quality, asset, typecheck, and diff gates.
- One real Mundo Pincel run with `assetMode: "hybrid"`, followed by full desktop/mobile review and deterministic geometry checks.
- Only after Mundo Pincel passes visual review, run the remaining six niches sequentially.

## Non-Goals

- Generating new section HTML with Gemini.
- Adding a database migration or mutable AI-authored section metadata.
- Treating catalog names as user-facing copy.
- Accepting a forbidden variant because no positive match exists.
- Running the other six paid niche tests before Mundo Pincel is visually accepted.
