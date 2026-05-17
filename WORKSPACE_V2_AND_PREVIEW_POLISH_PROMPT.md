# Prompt for fresh Opus 4.7 max effort session

Two tasks: (A) polish the V3 preview page to match the artifact chrome, (B) port the workspace v2 artifact to a new `/new-v2` route. Self-contained brief.

---

## Paste this into a fresh Claude Code session at `C:\Users\jesus\desktop\inari-pages\`

You are working on **OpenLen** — an open-source AGPL v3 AI landing-page generator (live at openlen.com, repo at github.com/orbita-pos/openlen). Current state: V3 design system (8 backgrounds, 20 palettes, 5 SVG decorations, 6 typography systems, 17 layout primitive variants) is already ported and renders at `/preview-v3`. Sessions 11 (subdomain publish) and 12 (inline editing) are live in V1 at `/new`.

Two tasks for this session. Do BOTH. Take your time — Opus 4.7 max effort, ~12-16 hours of agent work is appropriate scope.

## Required reads before coding (in this order)

1. `RESEARCH_FINDINGS.md` — strategic context for V3
2. `V3_AUDIT.md` — file-by-file map of preservation/refactor/delete/add
3. `WORKSPACE_DESIGN_PROMPT.md` — original spec for workspace v2 (what the user asked claude.ai to design)
4. `app/preview-v3/page.tsx` — what's already in the preview
5. `components/primitives/*` — V3 primitive components (DO NOT re-port)
6. `lib/design/presets/*` — V3 design system (DO NOT re-port)
7. `app/new/page.tsx` — current V1 workspace (read for reference; do not modify)
8. `components/workspace/*` — current V1 workspace components

Then briefly skim:
9. `C:\Users\jesus\Downloads\Design foundations\js\app.jsx` — original chrome for foundations gallery
10. `C:\Users\jesus\Downloads\Typography Systems.html` — original chrome for typography gallery (lines 405-510 in particular)
11. `C:\Users\jesus\Downloads\Inari Workspace v2 _bundled_.html` — the workspace v2 artifact (2.1 MB, 180 lines; mostly compiled JS bundled into a few long lines — you'll need a structural exploration strategy, not a full read)

---

## TASK A — Polish `/preview-v3` to match the artifact chrome

The current `/preview-v3` page has all the design assets but a generic header. Enhance to match the original artifacts more closely.

### A.1 — Hero with MeshGrain bg

Replace the current header section in `app/preview-v3/page.tsx` with one mirroring `Design foundations/js/app.jsx` Hero:

- Full-width header section, `px-12 pt-16 pb-20`, with `border-b` using `--color-border`
- Absolute-positioned `<MeshGrain brandHue={12} />` covering top 420px at `opacity: 0.6`, with a `linear-gradient(to bottom, transparent 60%, var(--color-bg) 100%)` overlay fading the MeshGrain into the page bg
- Small wordmark row: brand badge (7×7 rounded coral square with the wedge icon — recreate the SVG from app.jsx line 35-38), "OpenLen", "·", "design foundations", "·", "v0.1.0", `openlen.com / foundations` (right-aligned in font-mono)
- Eyebrow: `AGPL v3 · OKLCH · server-renderable` (uppercase mono, accent color)
- Headline: `text-[88px]` `leading-[0.95]` `tracking-[-0.04em]` font-display, in 3 lines:
  ```
  The visual primitives
  behind every OpenLen
  landing page.
  ```
- Sub paragraph: `text-[17px]` max-w-xl, body text, with an inline `<code>` chip styling around `brandHue`. Use the same copy from app.jsx line 56-60.
- Stats grid: 4-column grid, max-w-3xl, with these stats:
  - **8** — Background components
  - **20** — Palettes · 10 hues × 2 modes
  - **5** — SVG decorations
  - **10** — Tokens per palette
  Each stat: `text-[40px]` font-semibold leading-none tracking-tight tabular-nums font-display + label below in `text-[11px]` muted

### A.2 — Update foundations gallery section headers

Each of `BackgroundsGallery`, `DecorationsGallery`, `PalettesGallery` currently has its own ad-hoc header. Replace with a unified `<SectionHeader>` component matching `app.jsx` line 3-18:

```tsx
function SectionHeader({ eyebrow, title, meta, description }: {
  eyebrow: string;
  title: string;
  meta?: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 max-w-6xl mb-10">
      <div>
        <div className="text-[11px] font-mono uppercase tracking-[0.18em] mb-2" style={{ color: "var(--color-text-dim)" }}>
          {eyebrow}
        </div>
        <h2 className="text-[42px] leading-[1.02] tracking-[-0.025em] font-semibold font-display" style={{ color: "var(--color-fg)" }}>
          {title}
        </h2>
        {meta && <div className="text-[12px] font-mono mt-2" style={{ color: "var(--color-text-muted)" }}>{meta}</div>}
      </div>
      {description && (
        <p className="text-[14px] leading-relaxed max-w-md" style={{ color: "var(--color-text-muted)" }}>
          {description}
        </p>
      )}
    </div>
  );
}
```

Use this for:
- Backgrounds: eyebrow `Part 01`, title `Backgrounds`, meta `8 components · brandHue parameterised · <5KB combined`, description `Each background is self-contained and renders identically on the server. Pass any hue 0–360 and the math takes care of the rest.`
- Palettes: eyebrow `Part 02`, title `Palettes`, meta `20 systems · OKLCH · WCAG AA validated`, description `Every palette is generated by pure math from a single brandHue input. Ten tokens, two modes, ten hues — composable, predictable, server-renderable.`
- Decorations: eyebrow `Part 03`, title `Decorations`, meta `5 SVG overlays · drop-in · onLight ready`, description `Self-contained SVG you stack on top of any solid background. Three intensity steps per overlay — restraint, balance, or bold.`
- Typography (NEW): eyebrow `Part 04`, title `Typography Systems`, meta `6 systems · one intentional rule-break each · same sample copy`, description `Each system applies a complete type stack — families, weights, tracking, leading, modular scale — to the same six lines of marketing copy.`
- Variants (NEW): eyebrow `Part 05`, title `Layout Primitives`, meta `17 variants · 5 primitives · brandHue 12`, description `Every layout OpenLen can compose, rendered with the same demo content, against the same OKLCH token system.`

### A.3 — Typography First-pass notes section

After the typography systems gallery, add a section mirroring `Typography Systems.html` lines 456-468:

- Title: `What to flag before we commit.`
- Eyebrow: `First-pass notes`
- 4 bullet points (preserve verbatim from the artifact):
  1. **JetBrains Mono at 52px H1** — readable, but the mono glyph rhythm fights long display lines. If headlines push past 8 words, I'd cap H1 at ~44px or break to two lines. The smaller-than-others H1 is intentional.
  2. **Crimson Pro** reads *print-essay* more than *SaaS landing*. Best for OpenLen *blog* / launch *essay*, not the marketing surface. Recommend demoting to a "Long-form" preset.
  3. **Söhne Warm uses Inter as a substitute.** Inter's larger x-height makes the 1.333 scale feel slightly more boisterous than Söhne would. If a Söhne license is available, swap in — the rule-break (italic aside) carries either way.
  4. **Fraunces opsz=144** applied only to display — body Inter handles the small-size reading. Italic-H2 rule-break feels strongest when surrounded by upright H1/H3.

Use `<b>` for the bold lead and inline `<i>` for italic terms. Max width `72ch`. Style matches the artifact's section: `border-t` divider, generous padding, max-w-[1180px].

### A.4 — Footer update

Replace the current footer with one mirroring the artifact tone:
- Left: `OpenLen design foundations · AGPL v3 · v0.1.0` (font-mono, muted text-color)
- Right: italic `"restraint over decoration · OKLCH math over guesswork"` (font-mono, dimmer color)
- Border-top + generous padding

### A.5 — Verify

Run `npm run dev`, visit `/preview-v3`. The page should now have:
- Polished hero with MeshGrain bg fading to white
- Unified `<SectionHeader>` on all 5 sections
- Typography first-pass notes after the 6 systems
- Branded footer

Type-check (`npx tsc --noEmit --skipLibCheck`) must pass clean.

---

## TASK B — Port the workspace v2 artifact to `/new-v2`

The user designed the workspace v2 in claude.ai. The bundle lives at `C:\Users\jesus\Downloads\Inari Workspace v2 _bundled_.html` (2.1 MB, 180 lines — single bundled file, mostly compiled JS in long lines).

Goal: mount the design at `app/new-v2/page.tsx` as a parallel route alongside the existing `/new` (V1 workspace). Don't replace `/new` — V1 generation still uses the catalog, the V2 UI is designed for V3 primitives which aren't pipeline-wired yet.

### B.1 — Read the bundled HTML

The file is too large to read in full. Use a structural exploration strategy:

```bash
# Find component function definitions
grep -oE 'function [A-Z][a-zA-Z]+|const [A-Z][a-zA-Z]+ ?=' "C:/Users/jesus/Downloads/Inari Workspace v2 _bundled_.html" | sort -u

# Find the React root render or top-level App
grep -n 'ReactDOM' "C:/Users/jesus/Downloads/Inari Workspace v2 _bundled_.html"

# Find CSS classes used (sample of patterns)
grep -oE 'className="[^"]{1,80}"' "C:/Users/jesus/Downloads/Inari Workspace v2 _bundled_.html" | head -100

# Find inline styles
grep -oE 'style=\{[^}]{1,200}\}' "C:/Users/jesus/Downloads/Inari Workspace v2 _bundled_.html" | head -50

# Read header/style block (likely the first ~500 chars are <head><style>)
head -c 5000 "C:/Users/jesus/Downloads/Inari Workspace v2 _bundled_.html"

# Read the end (likely contains the ReactDOM.render call)
tail -c 5000 "C:/Users/jesus/Downloads/Inari Workspace v2 _bundled_.html"
```

Open the file in a browser first to see what the design looks like. Then read selectively.

### B.2 — Decompose into React components

The artifact should map to roughly these files:

- `app/new-v2/page.tsx` — top-level workspace shell
- `app/new-v2/layout.tsx` (if needed) — for fonts + tokens.css
- `app/new-v2/tokens.css` (or reuse from preview-v3) — design tokens
- `components/workspace-v2/header.tsx` — top bar with Content/Design toggle + edit pencil + publish button + avatar
- `components/workspace-v2/design-panel.tsx` — Design mode sidebar (8 background thumbs + 20 palette swatches + 6 typography cards + density/radius/decoration toggles)
- `components/workspace-v2/sections-panel.tsx` — Content mode sidebar (section accordions with slot editor)
- `components/workspace-v2/preview-panel.tsx` — central iframe + tool bar above (zoom + viewport switcher) + floating regenerate pill
- `components/workspace-v2/pages-sidebar.tsx` — right sidebar with project list (thumbnails, titles, last-edited, status pill)
- `components/workspace-v2/status-bar.tsx` — bottom bar (spent + time + gates passed + ⌘K hint)

The artifact may use different component names internally — preserve the visual design but map to clean, typed component names.

### B.3 — Wire to existing systems

The new workspace v2 should:

- **Read** from existing project state via `lib/projects.ts` (same as V1 `app/new/page.tsx`)
- **Render** the preview iframe with the current project's HTML (V1 output for now, V3 later when pipeline lands)
- **Design panel knobs** update local React state only. Clicking a background thumb swaps the iframe's bg via CSS variable hot-swap (see how `composeDesignTokens` from `lib/design/tokens.ts` will eventually work — for now, hardcode a `<style>` block that updates per knob selection)
- **Content tab** renders the existing slot editor (`components/workspace/slot-editor.tsx` from V1) for parity with current functionality
- **Publish button** opens the existing `components/workspace/publish-modal.tsx` (Session 11)
- **Edit pencil** toggle wires to the same `editMode` flag from V1 — uses the existing iframe-editor.js (Session 12)
- **Use V3 design tokens** for the workspace chrome itself: import `lib/design/presets/*` and emit CSS variables (brandHue 12 default), use `<Slot>` placeholder elsewhere matching the artifact

Don't refactor anything in `app/new/page.tsx` or `components/workspace/*` — leave V1 alone.

### B.4 — Routing

- `/new` continues to be the V1 workspace (unchanged)
- `/new-v2` is the new V2 workspace (added by this session)
- Update `app/projects/projects-view.tsx` to add a small "Try the V2 workspace →" link near the top, pointing to `/new-v2?project=<existing-id>` (only if a project is selected). This makes it easy for the user to test.

### B.5 — Visual fidelity

Match the artifact pixel-for-pixel where possible. Specifically:
- Spacing and rhythm of the three columns (left sidebar, center preview, right pages-sidebar)
- The Content/Design toggle in the header (segmented chip)
- The thumbnail grid layout for backgrounds (2 columns × 4 rows or 4 × 2 depending on what the artifact shows)
- The palette swatches grid (small color-bar cards)
- The typography preview cards (Aa preview in the system's font)
- Density/radius toggles (3-way segmented buttons)
- Status bar at bottom with tabular-nums

### B.6 — What to defer to a follow-up session

- AI generation via V3 pipeline (Kimi planner + writer) — Session 13/14 separate brief
- Real EditableText wiring to V3 primitives (currently V3 primitives have a Slot stub) — separate brief
- Eval V2 (25 briefs, Opus 4.7 judge) — separate brief
- Unsplash integration / SVG decoration injection at generate-time — separate brief

The goal of THIS session is: visually faithful V2 workspace mounted at `/new-v2`, talking to existing V1 generation behind the scenes. The user can click design panel knobs and SEE the preview change colors/typography/bg — that's the wow moment we want.

---

## Constraints (locked)

1. **Don't touch V1 workspace.** `app/new/page.tsx` and `components/workspace/*` stay as-is. The V2 workspace is parallel at `/new-v2`.
2. **Don't push, don't commit, don't deploy.** The user reviews + commits + ships.
3. **Don't break the existing `/preview-v3` route.** Task A enhances it; the existing primitive variants section must keep working.
4. **Don't touch `lib/design/presets/*` or `components/primitives/*`.** Those are already ported; only consume them.
5. **Don't add new dependencies.** Tailwind, React, drizzle, NextAuth are already in.
6. **Server-renderable.** Primitives + design components stay server-side. Workspace v2 itself MAY use "use client" for the design panel interactions (knob clicks need state).
7. **Don't run `drizzle-kit push`.** No schema changes.
8. **Type-check + lint must pass.** `npx tsc --noEmit --skipLibCheck` and `next lint` should both be clean.

## Output format when done

Under 800 words total:

1. **Files created** (paths only — likely 8-12 new files in `components/workspace-v2/` + `app/new-v2/`)
2. **Files edited** for Task A (paths only — should be just `app/preview-v3/page.tsx`)
3. **Files edited** for Task B (paths only — should be just `app/projects/projects-view.tsx` for the V2 link)
4. **Deviations from this brief** — anywhere you had to make a judgment call (especially around the V2 artifact decomposition, since the bundled HTML may not map cleanly to my proposed file structure)
5. **What the V2 workspace renders against today** — confirm the iframe still shows V1 generation, that publish + inline edit + slot editor still work, and that the design panel knobs visibly update the preview
6. **Smoke test result** — paste the exact URLs to visit:
   - `/preview-v3` (after Task A)
   - `/new-v2?project=<existing-id>` (after Task B)
   What works, what doesn't
7. **Pre-existing issues noticed** (don't fix unless blocking)
8. **Recommended next session focus** (V3 pipeline wiring is the obvious next step)

End with a one-line confirmation that `npx tsc --noEmit --skipLibCheck` passed.

---

End of prompt. Pega de "You are working on **OpenLen**" hasta "passed." en sesión fresca con Opus 4.7 max effort.
