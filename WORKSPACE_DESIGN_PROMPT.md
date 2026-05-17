# OpenLen — Workspace v2 Design Prompt for claude.ai

Paste this into a new claude.ai conversation. Iterate visually until you love the result. Save the .tsx artifact.

---

```
I'm building OpenLen — an open-source (AGPL v3) AI landing page generator at openlen.com. I need a single-artifact React + TypeScript + Tailwind v4 design for the /new workspace page. This is where the user lands after generating, edits the page, and publishes to <subdomain>.openlen.com.

Output as a single self-contained artifact: one .tsx file. No npm install required. Use Tailwind via CDN (or inline `<script src="https://cdn.tailwindcss.com"></script>`). Use Inter for body, Geist for display (Geist via `<link>`). Inline lucide-react icons via CDN if needed, or hand-rolled SVGs.

## Brand

- Brand: OpenLen
- Accent color: coral `#FF5A36`
- Fonts: Inter (body), Geist (display)
- Vibe: technical-minimal, slightly editorial, Linear/Vercel/Stripe aesthetic
- Dark mode first, light mode supported

## The workspace layout

Three regions, full viewport:

### Top bar (60px tall)
- Left: OpenLen wordmark + small project name in a editable-looking pill ("Acme — Untitled" with chevron, suggesting click to rename)
- Center: a segmented toggle with two states:
  - "Content" (default) — sidebar shows section editor
  - "Design" — sidebar shows design tokens panel
  - Each tab has an icon: pencil for content, palette for design
- Right (in order):
  - Save status pill ("Saved 2s ago" in muted text, faint pulsing dot when saving)
  - "Edit inline" toggle (pencil icon, ghost button that becomes filled when ON)
  - Primary "Publish" button (coral accent solid, slight shadow, with chevron for dropdown options: Re-publish / Open published page / Unpublish)
  - Avatar (32px round)

### Left sidebar (320px wide, collapsible to icons)
This is the DUAL-MODE panel. Top bar toggle switches between two modes:

**MODE A — "Content" tab** (default):
- A scrollable list of section accordions. Each section has:
  - Drag handle (4 dots)
  - Section icon (12px)
  - Section name ("Hero", "Pricing", "FAQ", etc.) with a "variant" pill ("centered" / "split" / "asymmetric")
  - Chevron to expand
- When expanded, the section shows its slots as form fields:
  - Heading (textarea, 2 rows)
  - Subheading (textarea, 3 rows)
  - CTA label (text input with adjacent URL input)
  - Items array (each item with its own mini-form)
- Footer of the sidebar: a small "+ Add section" button (ghost)

**MODE B — "Design" tab**:
This is the design knobs panel. Sub-sections, each collapsible:

1. **Background** (label small, uppercase muted)
   - 4×2 grid of 80×60px thumbnail previews. Each thumb shows a miniature of the actual background (mesh gradient, conic, halftone dots, blob, noise, animated mesh, brand pattern, minimal solid)
   - Active one has 2px coral ring around it + filled checkmark in top-right corner
   - Each thumb has a tiny label below ("Mesh", "Conic", etc.) in 10px muted

2. **Palette** (label)
   - 4×5 grid of color swatches. Each swatch is a 36×36px rounded square showing 3 stacked color bars (the palette's brand, accent, neutral)
   - Active one has the coral ring + checkmark
   - Below grid: "Custom hue" input — a horizontal HSL color picker bar with a draggable dot

3. **Typography** (label)
   - 6 cards stacked vertically, each ~64px tall:
     - Left side: "Aa" preview in that font system at large size with its tracking/weight
     - Right side: small label ("Inter Tight", "Geist Editorial", "Söhne Warm", "JetBrains Mono Accent", "Fraunces Editorial", "Crimson Print")
   - Active one has coral left border 3px wide + background slight tint

4. **Density** (label)
   - 3-way segmented toggle: "Compact | Standard | Spacious"
   - Visual: each segment shows a tiny diagram of section spacing (lines closer/farther apart)

5. **Radius** (label)
   - 3-way segmented toggle: "Sharp | Soft | Pill"
   - Visual: each shows a tiny rectangle with the matching corner style

6. **Decoration intensity** (label)
   - 3-way slider: "Minimal — Balanced — Bold"
   - Slider has tick marks; behind it a tiny SVG showing decoration density growing

### Center — Preview iframe (flexible width, takes remaining space)
- The generated landing page renders here, in a sandboxed iframe with rounded corners (16px) and a 1px subtle border
- Outside the iframe, around it:
  - Top: a thin tool bar (32px) with: zoom controls (50% / 75% / 100% / Fit), viewport switcher (Desktop / Tablet / Mobile with icons), a hidden "..." menu with grid overlay toggle
  - Bottom-right: a floating "Quick generate" pill — coral, says "↻ Regenerate" (idle) or "Generating..." with spinner; click expands a small popover with options (full page, hero only, pricing only, etc.)
- When "Edit inline" is ON:
  - Show a thin top-banner above the iframe: "Click any text in the page to edit it inline · ESC to cancel"
  - The iframe content has spans highlighted on hover with a coral 1px dashed border

### Right sidebar (260px wide, collapsible)
**Pages tab** (small icon nav at top: Pages / Versions / Comments — only Pages is implemented now):
- A small list of the user's projects (4-5 recent), each with:
  - 80×60 thumbnail (rendered miniature of the project)
  - Title ("Acme — Pricing Page")
  - Last edited ("2m ago")
  - Status pill ("Draft" amber dot / "Published at acme.openlen.com" green dot)
- "+ New page" button at top

### Bottom status bar (24px, full width)
- Left: "$0.014 spent on this page · 12s generation time · 6/6 quality gates passed"
- Center: a single-line latest action log ("Hero regenerated · 4s ago")
- Right: keyboard shortcut hint ("⌘K for command palette")

## Visual treatment

- Use OKLCH-based color tokens defined in `:root`. Brand hue 12 (coral). Generate a 5-step neutral scale from `oklch(98% 0.005 12)` → `oklch(15% 0.01 12)`.
- Backgrounds: workspace bg is `oklch(99% 0.003 12)` light / `oklch(11% 0.01 12)` dark. Sidebar bg is `oklch(97% 0.005 12)` slightly different to create separation. Preview area bg is `oklch(98% 0.003 12)` so iframe pops.
- Borders: 1px `oklch(85% 0.005 12 / 0.6)` light / `oklch(25% 0.01 12 / 0.6)` dark
- Coral accent used ONLY for: active state indicators, primary CTAs, the inline edit highlight, the spent-budget number — never for backgrounds or large text
- Shadows: subtle, `0 1px 3px 0 oklch(0% 0 0 / 0.04)` for cards; `0 12px 32px -8px oklch(0% 0 0 / 0.12)` for elevated (the Publish button, popovers)
- Typography:
  - Display (h1-h3): Geist, 600 weight, -0.025em tracking
  - Body: Inter, 400 weight, default tracking, 1.5 leading
  - Small UI text: Inter, 500 weight, 0.005em positive tracking for readability at small sizes
  - Tabular numbers (in spent budget, time): `font-variant-numeric: tabular-nums`
- Buttons:
  - Primary: coral bg, white fg, 1.5px border same coral, 8px radius, 36px tall, font-weight 500
  - Ghost: transparent bg, fg muted, 1px border subtle, becomes 1px border bold on hover
  - Icon ghost: 32px square, just an icon, 6px radius, hover bg tint

## Interactions

- Sidebar collapse: 200ms ease-out, sidebar slides to 56px icon-only mode
- Tab switch (Content ↔ Design): 150ms fade + 8px x-translate
- Preset thumb click: instant visual swap of active ring, 100ms scale 1.0→1.04→1.0
- Inline edit toggle: 200ms; pencil icon rotates 12deg when on
- "Regenerate" click: spinner spins, button becomes faint, "Generating..." text fades in

## Mobile

Below 768px: top bar stays, sidebars collapse to bottom sheets triggered by their respective icon buttons in a bottom nav. Iframe fills viewport. Tap a section in the bottom sheet to edit. This is secondary — design desktop first.

## What I want from this artifact

1. A SINGLE pixel-perfect React component (`function WorkspaceV2() { return ... }`) that renders this whole workspace
2. Use ALL the visual details above — don't sacrifice them
3. Demo data: 5 fake sections (Hero, Logo Bar, Features Split, Pricing 3-tier, FAQ), 8 background thumbs (placeholder gradients OK), 20 palette swatches (computed via OKLCH math from 20 hue values 0-360), 6 typography cards with real font choices
4. The iframe content can be a static screenshot of any beautiful landing — just show what the preview looks like with the editor on
5. Show the layout in BOTH "Content" and "Design" modes — use a `useState` toggle at the top of the component so you can show both
6. Include a one-line comment at the top explaining: "This is the design artifact. Real implementation in components/workspace/*.tsx will use this as visual spec."

Lay out everything in pixel-precise Tailwind. Inline all SVGs needed. Self-contained. Beautiful.

Iterate on this until it really looks like a tool you'd want to use yourself. Then I'll port it to OpenLen's actual codebase.
```

---

## After claude.ai delivers the artifact

1. Save to `~/Downloads/OpenLen Workspace v2.html` (or wherever).
2. Open in browser, validate visually with the founder (Jesus).
3. If you want to iterate: chat with Claude further until it's right.
4. Once locked: port to OpenLen as multiple React components:
   - `components/workspace/header.tsx` (already exists — extend with Content/Design toggle)
   - `components/workspace/design-panel.tsx` (NEW — the Design mode sidebar)
   - `components/workspace/sections-panel.tsx` (REFACTOR — the Content mode sidebar, already mostly exists)
   - `components/workspace/preview-panel.tsx` (already exists — add the tool bar above iframe)
   - `components/workspace/pages-sidebar.tsx` (NEW — right sidebar with project list)
   - `components/workspace/status-bar.tsx` (NEW — bottom bar)

Each component reads from a unified `WorkspaceState` zustand store (or similar), wires up the actual preset switching logic + AI generation + publish flow. The claude.ai artifact is the visual ground truth.
