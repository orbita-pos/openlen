# Session 13 prompt — OpenLen V3 Pipeline (Phase 1: foundation + pipeline)

Paste this into a fresh Claude Code session running **Opus 4.7 with max effort** at `C:\Users\jesus\desktop\inari-pages\`.

Self-contained. Designed for a single ~8-12 hour Opus 4.7 max effort run.

---

You are implementing **Session 13 of OpenLen** — Phase 1 of the V3 pipeline pivot. The product is an open-source (AGPL v3) AI landing-page generator at https://openlen.com, repo public at https://github.com/orbita-pos/openlen, current master `1090a0d`. Read the following docs at the repo root before starting (in this order):

1. `RESEARCH_FINDINGS.md` — the strategic context. Why this pivot is happening.
2. `V3_AUDIT.md` — file-by-file map of keep / refactor / delete / add.
3. `BLOCKS_PROMPTS.md` — design exemplars (these become reference fewshot blocks for the V3 writer).
4. `WORKSPACE_DESIGN_PROMPT.md` — the workspace UI we will eventually port (Phase 2 work, not yours).
5. `CLAUDE.md` and `README.md` — current product state.

## Goal

Build the **V3 generation pipeline backend + primitives layer + presets foundation** behind a feature flag (`OPENLEN_PIPELINE_V3`). At the end of this session:

- A `/api/generate?v=3` endpoint runs the V3 pipeline end-to-end with mock presets and produces a valid HTML output indistinguishable in shape from the V1 output.
- 5 layout primitives exist as React components with typed slot bags.
- A presets layer exists with placeholder data (the founder will replace the placeholders with hand-tuned values designed in claude.ai later).
- Kimi K2.6 is wired as both planner and writer via Together AI.
- All V1 functionality (Session 11 publish, Session 12 inline edit) continues to work for users not on the V3 flag.

Phase 2 (Session 14) will add: streaming autofixer, Unsplash integration, design panel UI, eval V2, cutover. Do not do those.

## Locked design decisions

| # | Decision | Detail |
|---|---|---|
| 1 | **Models** | Kimi K2.6 for both planner and writer (NOT Sonnet, NOT Qwen). Single Together AI vendor. |
| 2 | **Architecture** | Two-stage: planner emits DesignSystem JSON, writer emits TSX. No classify / fill stages. |
| 3 | **Primitives, not blocks** | Five layout primitives: `<Hero>`, `<Stack>`, `<Split>`, `<Grid>`, `<CTA>`. Typed slot bags. Tailwind only. No business logic inside. |
| 4 | **EditableText preserved** | Session 12's `EditableText` component relocates from `lib/blocks/_editable.tsx` to `components/primitives/EditableText.tsx`. Identical behavior. Every primitive's text slot wraps in it. |
| 5 | **No AI image generation** | FLUX calls are removed from the pipeline. Image slots emit Unsplash placeholders (resolved in Phase 2 autofixer). User-uploaded images via existing `/api/upload` still work. SVG decoration is rendered server-side from preset choice. |
| 6 | **Presets layer** | Six categories (background / palette / typography / density / radius / decoration). Each is a typed registry. Placeholder values for now (8 backgrounds, 20 palettes, 6 typography, 3+3+3 modes). The founder will hand-tune in claude.ai later. |
| 7 | **CSS variables** | All presets emit a single CSS custom-property bundle inserted into the page's `<style>` tag. The HTML stays self-contained (still publishable to static disk). |
| 8 | **Feature flag** | `OPENLEN_PIPELINE_V3` env var. Default `false`. Per-request override: `?v=3` query on `/api/generate`. Both pipelines coexist; V1 stays as-is. |
| 9 | **No new schema migration** | `projects.data` jsonb continues to hold the LandingPage artifact. The internal shape changes (filledBlocks → primitives) but the column is the same. |
| 10 | **No commits, no deploys** | The founder reviews and ships. |
| 11 | **No npm install of new deps unless absolutely required** | Use what's there. Tailwind v4 is in. Drizzle is in. Together AI client is probably in. Anthropic SDK is in. Don't add new ones for this phase. |
| 12 | **Pure server-render** | Primitives + EditableText are server-rendered via the existing `renderDeterministic` (which uses `react-dom/server` via createRequire). No "use client" anywhere in the primitive chain. |

## Implementation plan — 11 phases

### Phase A — Setup + types

1. **Read every file marked KEEP/REFACTOR in V3_AUDIT.md.** Build a mental map of the import graph before changing anything.
2. **`lib/orchestrator/v3/types.ts`** — define:
   ```typescript
   export type Personality = "technical-confident" | "playful-warm" | "luxury-spare" | "warm-humanist" | "editorial-maximalist";
   export type LayoutPattern = "centered-marquee" | "split-asym" | "stacked-narrative" | "editorial-grid";
   
   export interface DesignSystem {
     brandHue: number; // 0-360
     palette: string;  // preset id (e.g. "indigo-warm")
     typography: string; // preset id (e.g. "geist-tight")
     background: string; // preset id (e.g. "mesh-grain")
     density: "compact" | "standard" | "spacious";
     radius: "sharp" | "soft" | "pill";
     decoration: "minimal" | "balanced" | "bold";
     layout: LayoutPattern;
     personality: Personality;
     sections: string[]; // e.g. ["hero", "logo-bar", "features-split", "pricing", "faq", "cta"]
   }
   
   export interface PrimitiveSlots { [key: string]: unknown }
   export interface PrimitiveInstance {
     id: string;           // unique within page, e.g. "hero-1"
     primitive: "Hero" | "Stack" | "Split" | "Grid" | "CTA";
     variant?: string;     // optional sub-variant string the writer can use
     slots: PrimitiveSlots;
     order: number;
   }
   
   export interface LandingPageV3 {
     v: 3;
     designSystem: DesignSystem;
     primitives: PrimitiveInstance[];
     tsx: string;          // the writer's raw TSX output (for re-render + diff)
     html: string;         // renderDeterministic output (clean, publishable)
     witness: { /* same shape as v1 */ };
     cost: { /* same shape as v1 */ };
   }
   ```
3. **Wire the v3 types into `lib/orchestrator/types.ts`** as a discriminated union with the existing v1 `LandingPage`. Keep both compilable side-by-side.

### Phase B — Presets layer (placeholder data, the design happens later in claude.ai)

4. **`lib/design/presets/backgrounds.ts`** — 8 preset entries:
   ```typescript
   export interface BackgroundPreset {
     id: string;
     name: string;
     style: string; // raw CSS for the section bg ::before pseudo
     cssVars: Record<string, string>; // optional custom properties
   }
   export const BACKGROUND_PRESETS: BackgroundPreset[] = [...];
   ```
   Placeholder content for each: mesh-grain, conic-sweep, halftone-dots, blob-burst, animated-mesh, brand-pattern, noise-overlay, minimal-solid. Use simple gradients and SVG turbulence patterns from the founder's `RESEARCH_FINDINGS.md` (section 4.1) as inspiration. Real beauty comes later when the founder hand-tunes; for now just need the contract to exist.

5. **`lib/design/presets/palettes.ts`** — 20 preset entries. Each is a tuple of OKLCH values for `bg, text, textMuted, surface, surfaceElevated, border, accent, accentFg`. Compute from brand hues 0, 18, 36, 54, ..., 342 (20 hues equally spaced). Use the formulas from RESEARCH_FINDINGS.md section 4.3.

6. **`lib/design/presets/typography.ts`** — 6 preset entries: `inter-tight`, `geist-editorial`, `sohne-warm`, `jetbrains-mono-accent`, `fraunces-editorial`, `crimson-print`. Each is a record of `fontFamily, displayWeight, bodyWeight, displayTracking, bodyTracking, scale (numeric)`. Use real font names; assume @font-face declarations exist in the page's `<style>` block.

7. **`lib/design/presets/density.ts`, `radius.ts`, `decoration.ts`** — 3 entries each. Each maps to a CSS custom-property bundle (e.g. `--space-section: 96px` for compact, `--space-section: 128px` for standard, `--space-section: 192px` for spacious).

8. **`lib/design/tokens.ts`** — pure function `composeDesignTokens(ds: DesignSystem): string` returns a `<style>` block string with all the CSS custom properties + any @font-face / SVG defs. This is embedded into the final HTML output by `renderDeterministic`.

### Phase C — Layout primitives

9. **`components/primitives/EditableText.tsx`** — move from `lib/blocks/_editable.tsx`. Same implementation. Same `EditorContext`. Update all imports in the 15 existing blocks (they break otherwise) — but DO NOT delete the old file yet (V1 still needs it). Re-export from the old path:
   ```typescript
   // lib/blocks/_editable.tsx (compat shim)
   export { EditableText, EditorContext } from "@/components/primitives/EditableText";
   ```

10. **`components/primitives/Hero.tsx`** — typed component:
    ```typescript
    interface HeroSlots {
      eyebrow?: string;
      headline: string;
      subhead?: string;
      ctaPrimary?: { label: string; href: string };
      ctaSecondary?: { label: string; href: string };
      mediaUrl?: string; // optional product mockup, hero illustration, etc.
    }
    interface HeroProps {
      id: string;
      variant: "centered" | "split" | "asymmetric";
      slots: HeroSlots;
    }
    export const Hero: React.FC<HeroProps> = ({ id, variant, slots }) => { ... };
    ```
    
    The variants control layout:
    - `centered`: text + CTAs centered, large headline, optional decorative bg
    - `split`: 2-col, text left + media right (7/5 ratio for asymmetric feel)
    - `asymmetric`: text large-left, media small-right tilted slightly with CSS transform
    
    Every visible text slot wrapped in `<EditableText slot={`{id}.{key}`}>`. Use Tailwind utility classes. Read decoration intensity from CSS var `--decoration-intensity` to optionally render a `<svg>` decoration via `<DecorationLayer>` (separate component below).

11. **`components/primitives/Stack.tsx`** — vertical stack of cards/sections:
    ```typescript
    interface StackSlots {
      eyebrow?: string;
      title?: string;
      sub?: string;
      items: Array<{
        title: string;
        body: string;
        icon?: string; // icon name from lucide subset
      }>;
    }
    interface StackProps {
      id: string;
      variant: "vertical-cards" | "alternating-rows" | "icon-grid";
      slots: StackSlots;
    }
    ```

12. **`components/primitives/Split.tsx`** — 2-column comparison/feature:
    ```typescript
    interface SplitSlots {
      eyebrow?: string;
      title?: string;
      left: { title: string; body: string; bullets?: string[]; mediaUrl?: string };
      right: { title: string; body: string; bullets?: string[]; mediaUrl?: string };
    }
    interface SplitProps {
      id: string;
      variant: "side-by-side" | "comparison-table" | "before-after";
      slots: SplitSlots;
    }
    ```

13. **`components/primitives/Grid.tsx`** — multi-column grid (features, testimonials, logos):
    ```typescript
    interface GridSlots {
      eyebrow?: string;
      title?: string;
      sub?: string;
      items: Array<{
        title?: string;
        body?: string;
        media?: { kind: "image"; src: string } | { kind: "icon"; name: string } | { kind: "text"; value: string };
        cta?: { label: string; href: string };
      }>;
    }
    interface GridProps {
      id: string;
      variant: "logo-bar" | "feature-3col" | "testimonial-masonry" | "stats-4-grid" | "pricing-3tier";
      slots: GridSlots;
      columns?: number;
    }
    ```
    The variant string steers the layout — e.g. `logo-bar` makes items into greyscale logos in a horizontal row; `testimonial-masonry` makes them into staggered cards; `pricing-3tier` makes them into tier cards.

14. **`components/primitives/CTA.tsx`** — call-to-action sections:
    ```typescript
    interface CTASlots {
      eyebrow?: string;
      headline: string;
      sub?: string;
      ctaPrimary: { label: string; href: string };
      ctaSecondary?: { label: string; href: string };
      footnote?: string;
    }
    interface CTAProps {
      id: string;
      variant: "centered-banner" | "card-form" | "gradient-banner";
      slots: CTASlots;
    }
    ```

15. **`components/primitives/_registry.ts`** — central registry:
    ```typescript
    import { Hero } from "./Hero";
    import { Stack } from "./Stack";
    import { Split } from "./Split";
    import { Grid } from "./Grid";
    import { CTA } from "./CTA";
    export const PRIMITIVE_REGISTRY = { Hero, Stack, Split, Grid, CTA } as const;
    export type PrimitiveName = keyof typeof PRIMITIVE_REGISTRY;
    ```

16. **`components/primitives/DecorationLayer.tsx`** — server-renders the SVG decoration chosen by `DesignSystem.background`. Reads CSS var `--decoration-intensity` and renders accordingly. Pure SVG, no JS.

17. **`components/primitives/README.md`** — authoring contract: every text slot wraps in `<EditableText>`, no lucide-react imports (use inline SVG), variants are strings the writer picks from, etc.

### Phase D — Provider routing

18. **`lib/ai/providers/kimi.ts`** — new file. Together AI client wrapper for Kimi K2.6. Exports `callKimi(prompt, opts) → { text, tokens, cost }`. Use the existing Together AI client if there is one (check `lib/ai/together.ts` or similar) — extend instead of duplicate.

19. **`lib/ai/router.ts`** — feature-flag-based switch. Reads `process.env.OPENLEN_PIPELINE_V3 === "true"` or per-request override. Returns `{ planner: kimi, writer: kimi }` for V3, the existing routing for V1.

### Phase E — V3 pipeline

20. **`lib/orchestrator/v3/planner.ts`** — `plan(brief: string): Promise<DesignSystem>`. Calls Kimi with a tightly-scoped system prompt (≥4KB so prompt caching applies). The prompt:
    - Lists the brief.
    - Lists the available preset ids (background, palette, typography options).
    - Demands JSON output matching the DesignSystem schema.
    - Provides 3 contrasting example briefs + their DesignSystem outputs as few-shot exemplars.
    Validate output with Zod. Retry once on validation failure with the error in the retry prompt. Cost target: < $0.005 per call.

21. **`lib/orchestrator/v3/writer.ts`** — `write(brief, designSystem, primitivesSpec): Promise<{ tsx, primitives }>`. Calls Kimi with:
    - The brief.
    - The DesignSystem JSON.
    - The 5 primitive types as TypeScript interface declarations.
    - 2-3 short reference exemplars (use the founder's `BLOCKS_PROMPTS.md` exemplars in the cached preamble — pull only the structural outlines, not the full block code).
    Demands TSX output that imports primitives + composes them. Output must be parse-able TypeScript. Validate by parsing with the TypeScript compiler API or a lighter regex check. Cost target: < $0.025 per call.

22. **`lib/orchestrator/v3/render.ts`** — `renderV3(landingPage: LandingPageV3): { html: string; editorHtml: string }`. 
    - Walk the `primitives` array.
    - For each `PrimitiveInstance`, look up its component in `PRIMITIVE_REGISTRY` and render with its slots.
    - Wrap the whole tree in a `<DesignTokensProvider>` that injects `composeDesignTokens(designSystem)` into a `<style>` block.
    - Pipe through the existing `react-dom/server` via `_render-element.ts` (Session 10.5 escape hatch).
    - Emit two versions: clean HTML for publish, editorHtml with `data-slot-path` for the iframe.

23. **`lib/orchestrator/v3/index.ts`** — top-level `generateV3(brief: string): Promise<LandingPageV3>` orchestrating plan → write → render. Computes cost across both calls, accumulates witness records (same shape as v1).

### Phase F — Wire into `/api/generate`

24. **`app/api/generate/route.ts`** — branch:
    ```typescript
    const useV3 = process.env.OPENLEN_PIPELINE_V3 === "true" || req.url.includes("v=3");
    if (useV3) {
      const result = await generateV3(brief);
      // stream as SSE same shape as v1
    } else {
      // existing v1 path
    }
    ```
    Keep the SSE stream contract identical so the workspace UI doesn't need to know which pipeline ran.

25. **`app/api/reassemble/route.ts`** — extend to also handle V3 input shape. When the payload has `v: 3`, walk primitives + call `renderV3` instead of `renderDeterministic` on v1 input.

26. **`lib/projects.ts`** — `updateProjectSlots` already handles arbitrary jsonb in `projects.data`. Confirm it works with the V3 shape. No code change expected.

### Phase G — Make sure V1 still works

27. **Run dev server, generate a page via V1 (no `?v=3`), verify it works exactly as before.** No regression. The 15 blocks still render. Session 12 inline edit still works. Publish still works.

28. **Run dev server, generate a page via `/api/generate?v=3`, verify**:
    - The pipeline runs end-to-end without errors.
    - The output HTML is well-formed.
    - `data-slot-path` is present in editor mode, absent in clean mode.
    - The CSS variables for the chosen presets are in the `<style>` block.
    - The page is visibly distinct from V1 (different primitives, different layout, different background).

### Phase H — Constraints + don'ts

- **DO NOT delete the 15 blocks.** Phase 2 (Session 14) handles deletion after the cutover plan is in place.
- **DO NOT update README.md or CLAUDE.md.** Phase 2 handles docs.
- **DO NOT touch infra files** (`infra/*`).
- **DO NOT run `drizzle-kit push`.** Schema is unchanged.
- **DO NOT commit, deploy, or push.** Founder reviews after the session.
- **DO NOT install Anthropic SDK.** V3 doesn't need Sonnet/Opus at runtime.
- **DO NOT touch Session 11 publish flow.** Treat it as immutable.
- **DO NOT change the `projects` schema.**

## Output format (under 600 words at end of session)

- Files created (paths only, ~25 files).
- Files edited (paths only, ~5-8 files).
- Files NOT touched even though related (auditor sanity check).
- Deviations from this brief — flag any architectural decisions you had to make on the fly, with reasoning.
- Cost benchmark: 1 generation via `?v=3` — what did Kimi planner + writer cost in tokens?
- Smoke test outcome: did `npm run dev` boot? Did `/api/generate?v=3` return a valid response? Did `view-source` on the resulting page look sane?
- Pre-existing issues noticed (don't fix unless blocking).
- What Phase 2 (Session 14) inherits: design panel UI port, streaming autofixer, Unsplash integration, expanded eval, V1 deletion + cutover.

Type-check must pass (`tsc --noEmit`). Lint should pass (`next lint`). Dev server must boot.

---

End of prompt. Pega de "You are implementing **Session 13**" hasta "Dev server must boot." en sesión fresca con Opus 4.7 max effort.
