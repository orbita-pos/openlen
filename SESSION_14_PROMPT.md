# Session 14 prompt — OpenLen V3 Pipeline (Phase 2: writer polish + UI + cutover)

Paste this into a fresh Claude Code session running **Opus 4.7 with max effort** at `C:\Users\jesus\desktop\inari-pages\`.

Prerequisite: Session 13 has shipped. Master should contain the V3 backend pipeline + 5 primitives + presets layer. The founder should have produced the workspace artifact in claude.ai before this session, saved as `~/Downloads/OpenLen Workspace v2.html` (or similar — confirm path with founder).

---

You are implementing **Session 14 of OpenLen** — Phase 2 of the V3 pipeline pivot. Live at https://openlen.com, repo at https://github.com/orbita-pos/openlen.

Read first (in this order):
1. `RESEARCH_FINDINGS.md` — strategic context
2. `V3_AUDIT.md` — file-by-file map
3. `WORKSPACE_DESIGN_PROMPT.md` — the workspace v2 design spec; the artifact in `~/Downloads/OpenLen Workspace v2.html` is the visual ground truth
4. `SESSION_13_PROMPT.md` — what already shipped in Phase 1
5. `CLAUDE.md` + `README.md` — current product state

## Goal

Close out the V3 pivot:

1. Streaming autofixer that catches Tailwind class errors + contrast issues + image placeholders WHILE Kimi streams TSX.
2. Unsplash API integration to replace `UNSPLASH:query=...` placeholders with real photo URLs.
3. Design panel UI ported from the founder's claude.ai artifact — the Content/Design toggle, the bg/palette/typography/density/radius/decoration knobs, the pages sidebar, the status bar, the new preview toolbar.
4. Wiring: clicking a preset thumbnail swaps CSS variables in the iframe instantly. No AI call per click. Cost $0 per knob change.
5. Eval V2: 25 briefs, Opus 4.7 judge with 7-axis rubric, run V1 vs V3 in parallel, produce a comparison report.
6. Cutover plan: when V3 wins on eval, flip the default. Document the V1 deletion path (not executed yet).

## Locked design decisions

| # | Decision | Detail |
|---|---|---|
| 1 | **Streaming autofixer is deterministic** | No LLM. Tailwind class validator + OKLCH contrast check + Unsplash placeholder rewriter + SVG decoration injection. Runs as a transform over the Kimi writer stream. |
| 2 | **Unsplash free tier** | 50 req/h dev, 5000 req/h production. Required attribution + UTM (`?utm_source=openlen&utm_medium=referral`). Implement the `download_location` ping when a photo lands on a published page. |
| 3 | **Knob switching is purely client-side** | Clicking a background thumbnail updates a CSS custom property in the iframe. The HTML in the DB stays the same; only the `designSystem` field of `LandingPageV3` changes. On publish, the chosen presets are baked into the static HTML. |
| 4 | **Design panel ports the claude.ai artifact** | The artifact is the visual spec. Don't redesign it. Decompose into React components: `DesignPanel`, `BackgroundGrid`, `PaletteGrid`, `TypographyCards`, `DensityToggle`, `RadiusToggle`, `DecorationSlider`. |
| 5 | **Content tab keeps the existing slot editor** | `components/workspace/slot-editor.tsx` works — it just renders primitive slots instead of block slots now. Schema-driven via Zod-to-form. |
| 6 | **No V1 deletion this session** | V1 stays alongside V3 until eval V2 confirms V3 wins. Phase 3 (not this session) handles deletion. |
| 7 | **Feature flag stays** | `OPENLEN_PIPELINE_V3` env + `?v=3` per-request override. After eval cutover, flip default to true. |
| 8 | **No commits, no deploys** | Founder reviews. |
| 9 | **No new schema migration** | All V3 state lives in `projects.data` jsonb. |
| 10 | **Use Unsplash, not Pexels/Pixabay** | Unsplash is the most editorial-quality. Founder may add more sources later. |

## Implementation plan — 8 phases

### Phase A — Streaming autofixer

1. **`lib/orchestrator/v3/autofixer.ts`** — new file. Exports:
   ```typescript
   export async function* autofixStream(
     kimiStream: AsyncIterable<string>,
     ctx: AutofixContext
   ): AsyncIterable<string> {
     // yields chunks with corrections applied
   }
   
   interface AutofixContext {
     designSystem: DesignSystem;
     onUnsplashQuery: (query: string) => Promise<string>;
     onContrastIssue: (pair: { fg: string; bg: string }) => void;
   }
   ```
   
   Three transforms, all running in-stream:
   
   - **Tailwind class lint**: parse emitted JSX classes. Detect invalid classes via `@tailwindcss/postcss` programmatic API (or hand-roll: regex against a known valid set). When invalid, rewrite to nearest valid neighbor (`text-22` → `text-2xl`).
   - **Contrast check**: when the writer emits OKLCH color pairs in style props or class names, run a contrast ratio check via `tokens.text` and `tokens.bg` from the active palette. If contrast < 4.5:1 for body text or 3:1 for large text, log a warning + downgrade the fg color to a higher-contrast token. Don't abort the stream — auto-correct or fall back.
   - **Image placeholder rewriter**: `<img src="UNSPLASH:query=..." />` → call `onUnsplashQuery(query)` (which hits the API, returns a photo URL + attribution payload). Replace the src + add `data-unsplash-photographer` + `data-unsplash-link` attributes for attribution display.
   
   The autofixer must work as a *transform* over the writer stream, not a post-pass. Token-by-token. Maintains a small state machine to detect when a JSX element opens, when className starts, when src starts, etc.

2. **`lib/orchestrator/v3/writer.ts`** — extend to expose a `streamWrite()` variant alongside the synchronous `write()`. The orchestrator pipes `streamWrite` → `autofixStream` → final TSX accumulator.

### Phase B — Unsplash integration

3. **`lib/images/unsplash.ts`** — new file. Exports:
   ```typescript
   export async function searchUnsplash(
     query: string,
     orientation: "landscape" | "portrait" | "squarish",
     opts?: { perPage?: number }
   ): Promise<UnsplashResult | null>;
   
   export async function trackDownload(downloadLocation: string): Promise<void>;
   
   interface UnsplashResult {
     id: string;
     url: string;
     downloadLocation: string;
     photographer: { name: string; url: string };
     alt: string;
   }
   ```
   
   Use `https://api.unsplash.com/search/photos`. Auth via `UNSPLASH_ACCESS_KEY` env var. Cache results in memory for the duration of a generation (don't double-call for the same query). Append `?utm_source=openlen&utm_medium=referral` to all returned URLs.

4. **`.env.example`** — append `UNSPLASH_ACCESS_KEY=` placeholder. Document the free tier sign-up in a brief comment.

5. **Attribution UI** — published HTML needs a footer line crediting any Unsplash photos used. The autofixer accumulates a list of photographer credits during a generation; the footer primitive (if used) reads from a `designSystem.attributions` field.

### Phase C — Design panel UI

The founder has produced a single-file claude.ai artifact at `~/Downloads/OpenLen Workspace v2.html`. **Open this file first.** It's the visual ground truth.

6. **Decompose the artifact** into React components mirroring its structure:
   - `components/workspace/design-panel.tsx` — top-level Design tab container
   - `components/workspace/design/background-grid.tsx` — 4×2 thumbnail grid
   - `components/workspace/design/palette-grid.tsx` — 4×5 color swatch grid
   - `components/workspace/design/typography-cards.tsx` — 6 stacked typography cards
   - `components/workspace/design/density-toggle.tsx` — 3-way segmented
   - `components/workspace/design/radius-toggle.tsx` — 3-way segmented
   - `components/workspace/design/decoration-slider.tsx` — 3-way slider
   - `components/workspace/design/custom-hue-picker.tsx` — HSL bar with draggable dot

7. **`components/workspace/header.tsx`** — extend with the Content/Design segmented toggle in the center. Match the artifact's styling pixel-for-pixel.

8. **`components/workspace/preview-toolbar.tsx`** — new file. Viewport switcher (Desktop/Tablet/Mobile), zoom controls (50/75/100/Fit), "..." menu with grid overlay toggle. Sits above the iframe.

9. **`components/workspace/pages-sidebar.tsx`** — new file. Right sidebar with project list. Thumbnail, title, last-edited, status pill. "+ New page" button at top.

10. **`components/workspace/status-bar.tsx`** — new file. Bottom bar with spent ($) + time + gates-passed + latest-action log + ⌘K hint.

11. **`app/new/page.tsx`** — workspace shell. Add state:
    ```typescript
    const [mode, setMode] = useState<"content" | "design">("content");
    const [designSystem, setDesignSystem] = useState<DesignSystem>(...);
    ```
    Wire the Content/Design toggle to swap between `<SlotEditor>` and `<DesignPanel>`. Wire `<DesignPanel>` to update `designSystem` state. On `designSystem` change, recompose CSS variables and update the iframe's `srcDoc` (cheap — just re-renders the `<style>` block, no AI call).

### Phase D — CSS variable hot-swap in the iframe

12. **`lib/design/tokens.ts`** — `composeDesignTokens` already exists from Session 13. Confirm it produces a deterministic `<style>` block.

13. **`components/workspace/preview-panel.tsx`** — update so that when the parent's `designSystem` changes, the iframe re-renders with new tokens. Two approaches; pick the faster one:
    - (a) Re-set `srcDoc` to a new full HTML with updated tokens. Page reloads. ~50ms.
    - (b) `postMessage` to the iframe with the new token block; an in-iframe script updates `<style>` inline. ~5ms but more code.
    Start with (a). If it feels janky, swap to (b) in a follow-up.

### Phase E — Persistence of design choices

14. **`lib/projects.ts`** — extend `updateProjectSlots` (or add `updateProjectDesignSystem`) to also persist the `designSystem` field of `LandingPageV3`. Same auth check, same debounce flow as Session 13's slot persistence.

15. **`app/api/projects/[id]/route.ts`** — PATCH handler should accept `designSystem` updates. Validate via Zod.

16. **`app/new/page.tsx`** — debounce (500ms) and PATCH on design-system changes so a hard reload sees the user's knob choices.

### Phase F — Eval V2

17. **`evals/v3/briefs/`** — 25 briefs total: 5 personality axes (technical-confident, playful-warm, luxury-spare, warm-humanist, editorial-maximalist) × 5 layout pattern intents. Founder will hand-edit some; you generate placeholder stubs.

18. **`evals/v3/judge.ts`** — Opus 4.7 judge harness:
    ```typescript
    interface EvalRubric {
      typography: 1 | 2 | 3 | 4 | 5;
      color: 1 | 2 | 3 | 4 | 5;
      hierarchy: 1 | 2 | 3 | 4 | 5;
      whitespace: 1 | 2 | 3 | 4 | 5;
      decoration: 1 | 2 | 3 | 4 | 5;
      copy: 1 | 2 | 3 | 4 | 5;
      conversion: 1 | 2 | 3 | 4 | 5;
      notes: string;
    }
    
    export async function judgePage(brief: string, html: string): Promise<EvalRubric>;
    ```
    Calls Anthropic Claude Opus 4.7 with the brief + the rendered HTML and a strict rubric prompt. Returns scores.

19. **`evals/v3/run.ts`** — generates each of the 25 briefs through BOTH V1 and V3, judges both with Opus 4.7, produces a markdown comparison report at `evals/v3/RESULTS.md`. Compute average score per axis + total. The cutover criterion: V3 average ≥ V1 average on every axis AND V3 total ≥ V1 total + 0.5.

### Phase G — Cutover plan (document, don't execute)

20. **`MIGRATION_V3_CUTOVER.md`** — new file at repo root. Document:
    - Current state: V3 behind feature flag, V1 default
    - Eval results from Phase F (insert numbers when available)
    - Cutover steps:
      1. Set `OPENLEN_PIPELINE_V3=true` as default in `.env.example` and production env
      2. Run for 1 week, monitor error rates + user feedback
      3. Phase 3 session: delete V1 code (the 15 blocks, classify, fill, regenerate-section)
      4. Update README.md + CLAUDE.md to reflect V3 as the only pipeline
    - Rollback: flip the flag back to false; V1 still works. The two pipelines coexist until Phase 3 confirms V3 is stable.

### Phase H — Smoke test + verify

21. **Open `/new?project=<existing-project-id>` in dev.** Toggle Content/Design. Verify both panels render correctly. Click a background thumbnail. Verify the preview iframe updates within ~50ms. Hard-reload. Verify the chosen preset persisted (came back from DB).

22. **Generate a fresh page via `/api/generate?v=3`** with a representative brief. Verify:
    - Kimi planner returned a valid DesignSystem JSON
    - Kimi writer streamed TSX
    - Autofixer caught + fixed at least one issue (log it)
    - Unsplash photo lookups returned real URLs (check `data-unsplash-photographer` in source)
    - Editor mode toggles correctly
    - Publish writes clean HTML (zero `data-slot-path`) to `/var/www/openlen/<sub>/` (or local equivalent)

23. **Run `evals/v3/run.ts`** with a small subset (3 briefs) to confirm the eval harness works end-to-end. Output goes to `evals/v3/RESULTS_smoke.md`. Founder will run the full 25-brief eval later.

24. **Type-check + lint** must be green. `tsc --noEmit` clean. `next lint` clean.

## Constraints

- **DO NOT delete V1 code.** V1 must keep working behind the feature flag.
- **DO NOT change the publish flow** (Session 11). The published HTML must continue to be a single self-contained file with zero `data-slot-path` attributes.
- **DO NOT touch infra** (`infra/*`).
- **DO NOT commit, deploy, or push.** Founder ships.
- **DO NOT install Anthropic SDK** if it's already there (it is — used for the BYOK path). If somehow not, install it for the eval judge only.
- **DO use prompt caching** for the eval judge: the 7-axis rubric is constant; cache it.

## Output format (under 700 words)

- Files created (paths only).
- Files edited (paths only).
- Whether the claude.ai workspace artifact was at the expected path; if not, where you found it.
- Decomposition decisions you made when porting the artifact (any deviation from the spec).
- Cost benchmark: full generation with autofixer running — what did it cost in tokens + Unsplash API calls?
- Smoke test result for each of the 4 sub-tests above (Phase H steps 21-24).
- Eval V2 smoke output (the 3-brief subset RESULTS_smoke.md).
- Pre-existing issues found (don't fix unless blocking).
- What Phase 3 will inherit (the V1 deletion + final README/CLAUDE.md update).

---

End of prompt.
