# OpenLen — Preset Design Prompts for claude.ai

Six prompts to design the V3 preset library in claude.ai artifacts. Each is self-contained — open a fresh chat per prompt to keep context focused. Iterate visually in each chat until you love the result.

**Order to do them in** (each unblocks the next):
1. **Backgrounds** (~1 hour) — sets brand vocabulary
2. **Palettes** (~30 min) — math-heavy, fast
3. **Typography** (~1 hour) — pairs with palettes
4. **Layout primitives — Hero** (~1 hour)
5. **Layout primitives — Stack, Split, Grid, CTA** (~2 hours, can do all in one chat or split)
6. **SVG decoration library** (~45 min)

Total: ~6 hours of focused design work in claude.ai. Output: ~50 hand-tuned design assets. Each one parameterised by brandHue so they regenerate from a single input.

---

## § 1 — Backgrounds (8 components)

**Open new claude.ai chat. Select Sonnet 4.6 or Opus 4.7. Paste:**

```
I'm building OpenLen, an open-source AI landing page generator (AGPL v3, openlen.com). I need 8 hand-tuned hero/section BACKGROUND components as a single React + Tailwind artifact. Each is parameterised by a single `brandHue` prop (number 0-360) so the same component re-skins to any brand color.

Output as ONE single .tsx artifact with all 8 components exported + a demo grid showing them all side-by-side with brandHue=12 (coral) for visual comparison.

## Spec for each component

```typescript
interface BackgroundProps {
  brandHue: number;  // 0-360
  className?: string;
}
```

Each renders a self-contained `<section>` or `<div>` with the bg effect. Pure CSS + inline SVG. No external assets. Server-renderable (no "use client", no hooks unless absolutely necessary).

## The 8 backgrounds I need

1. **MeshGrain** — 3-5 stacked radial-gradient color blobs blending via `mix-blend-mode: screen` on a near-black base, with a low-opacity SVG turbulence noise overlay at 6% opacity. The Stripe/Linear classic. Use OKLCH for the radial colors derived from brandHue.

2. **ConicSweep** — animated `conic-gradient(from var(--angle) at 50% 50%, ...)` with `@property --angle` rotating slowly (20s linear infinite). Clipped/masked by a blurred radial fade so the conic doesn't fill the whole section.

3. **HalftoneDots** — SVG `<pattern>` of `<circle r="1.5">` at 24px spacing, with a `<mask>` radial fade so dots are dense in the center and fade to nothing at edges. Color derived from brandHue but very low opacity (~15%).

4. **BlobBurst** — 2-3 organic SVG blobs (rough Bezier curves) positioned absolutely, each filled with a brand-derived gradient. Slight `filter: blur(40px)` for the dreamy effect. Z-index'd behind content.

5. **NoiseOverlay** — Solid OKLCH bg derived from brandHue, with a single SVG turbulence layer at 8% opacity. The simplest of the 8. Minimal, editorial. Like Resend.com hero.

6. **AnimatedMesh** — Same idea as MeshGrain but the radial centers are CSS-animated (using `@property --x1 --y1 --x2 --y2 ...` syntax) drifting slowly over 30s. Subtle, not jarring. Add a `prefers-reduced-motion: reduce` fallback that stops the animation.

7. **BrandPattern** — A geometric SVG pattern (e.g. tiny diamonds, plus signs, dashed lines, dot grid — pick whichever you think looks best for a tech brand) tiled across the bg, using brandHue at low opacity (~10%). Should feel like a design system stamp rather than decoration.

8. **MinimalSolid** — Just an OKLCH solid bg + a 1px horizontal hairline rule at 40% height in a slightly darker shade. Nothing else. The "we trust the typography to do the work" option. Like Stripe Press, Apple Developer.

## Visual requirements

- All 8 must look intentional at `brandHue=12` (coral), `brandHue=245` (indigo), and `brandHue=180` (cyan). Test in your head against all three before showing them.
- OKLCH only, never HSL/HEX. The chroma values matter: keep them in the 0.18-0.22 range for accents, 0.005-0.01 for neutrals.
- Each must work as a 100vh hero AND as a 50vh mid-page section (the same component rendered with a smaller container).
- No images. No external fonts. No external CDN. Pure self-contained SVG/CSS.
- Performance: combined CSS budget for all 8 = under 5KB minified.

## Demo grid

After defining the 8 components, render them all in a 4×2 grid at 320×180 each, with brandHue=12. Each tile has a small label below ("Mesh Grain", etc.). Center the grid in a dark page so the bg colors pop.

## Iteration

Show me the artifact, then iterate based on my feedback. I'll ask for tweaks like "MeshGrain feels too dense, lower the chroma on the third radial" or "BlobBurst's blobs are too symmetrical, make them more organic". Don't go beyond the spec — these are the 8, not 9, not 7.

Iterate visually until each one looks like it could ship on Linear, Stripe, Vercel, or Resend without anyone questioning the design.
```

---

## § 2 — Palettes (20 OKLCH palettes)

**Open new claude.ai chat. Paste:**

```
I'm building OpenLen, an open-source AI landing page generator. I need 20 hand-curated OKLCH color palettes for landing pages, each parameterised from a single brandHue input (so the palette regenerates if the user picks a different brand color).

Output as ONE single artifact: a React component that renders a grid of 20 palette cards, each showing 8 color swatches (bg, fg, fgMuted, fgDim, surface, surfaceElevated, border, accent, accentFg) computed via OKLCH math from a base hue. Below the grid, render an export-ready TypeScript file as a `<pre>` block that I can copy directly into `lib/design/presets/palettes.ts`.

## The math (use this exact formula)

For each palette, derive all colors from a single `brandHue` (0-360):

```typescript
function generatePalette(brandHue: number, mode: "light" | "dark" = "light"): Palette {
  if (mode === "light") {
    return {
      bg:              `oklch(98% 0.005 ${brandHue})`,
      fg:              `oklch(15% 0.01  ${brandHue})`,
      fgMuted:         `oklch(45% 0.01  ${brandHue})`,
      fgDim:           `oklch(60% 0.02  ${brandHue})`,
      surface:         `oklch(96% 0.008 ${brandHue})`,
      surfaceElevated: `oklch(94% 0.012 ${brandHue})`,
      border:          `oklch(85% 0.008 ${brandHue} / 0.6)`,
      borderStrong:    `oklch(70% 0.012 ${brandHue} / 0.8)`,
      accent:          `oklch(58% 0.22  ${brandHue})`,
      accentFg:        `oklch(98% 0.005 ${brandHue})`,
    };
  } else {
    return {
      bg:              `oklch(11% 0.01  ${brandHue})`,
      fg:              `oklch(95% 0.005 ${brandHue})`,
      fgMuted:         `oklch(70% 0.012 ${brandHue})`,
      fgDim:           `oklch(55% 0.01  ${brandHue})`,
      surface:         `oklch(15% 0.015 ${brandHue})`,
      surfaceElevated: `oklch(18% 0.018 ${brandHue})`,
      border:          `oklch(25% 0.012 ${brandHue} / 0.6)`,
      borderStrong:    `oklch(40% 0.015 ${brandHue} / 0.8)`,
      accent:          `oklch(68% 0.22  ${brandHue})`,
      accentFg:        `oklch(15% 0.01  ${brandHue})`,
    };
  }
}
```

## The 20 palettes — named, with brandHue + mode + personality

Generate these EXACTLY:

| #  | Name              | brandHue | Mode  | Personality       |
|----|-------------------|----------|-------|-------------------|
| 1  | Coral Editorial   | 12       | light | warm, editorial   |
| 2  | Coral Midnight    | 12       | dark  | bold, premium     |
| 3  | Indigo Classic    | 245      | light | technical, calm   |
| 4  | Indigo Slate      | 245      | dark  | Linear/Vercel feel|
| 5  | Emerald Fresh     | 145      | light | clean, hopeful    |
| 6  | Emerald Forest    | 145      | dark  | grounded, trust   |
| 7  | Violet Editorial  | 285      | light | refined, creative |
| 8  | Violet Night      | 285      | dark  | luxury, late-night|
| 9  | Amber Warm        | 38       | light | inviting, sunset  |
| 10 | Amber Espresso    | 38       | dark  | warm, intimate    |
| 11 | Rose Light        | 350      | light | playful, soft     |
| 12 | Rose Dusk         | 350      | dark  | sultry, romantic  |
| 13 | Cyan Crisp        | 195      | light | modern, dev-tool  |
| 14 | Cyan Deep         | 195      | dark  | aquatic, calm     |
| 15 | Lime Pop          | 90       | light | energetic, young  |
| 16 | Lime Vintage      | 90       | dark  | retro, terminal   |
| 17 | Slate Mono        | 220      | light | neutral, business |
| 18 | Carbon Mono       | 220      | dark  | premium tech      |
| 19 | Magenta Vivid     | 320      | light | bold, fashion     |
| 20 | Magenta Vinyl     | 320      | dark  | club, music       |

## Each card in the grid should show

- Palette name + brandHue value
- 4×2 grid of color swatches (the 8 colors), each labeled
- A small "preview" rectangle inside the card showing what a hero might look like: bg + text + accent button. Lo-fi but readable.

## Validation

- All palettes must meet WCAG AA contrast (4.5:1) between `bg` and `fg`. Check with a contrast function in the same artifact. Flag any palette that fails.
- The `accent` must meet 3:1 against `bg` (for large text / button viability).
- The `accentFg` must meet 4.5:1 against `accent` (for button label readability).

## Export block

Below the grid, render a `<pre>` block with:

```typescript
// lib/design/presets/palettes.ts
import type { PalettePreset } from "./types";

export const PALETTE_PRESETS: PalettePreset[] = [
  {
    id: "coral-editorial",
    name: "Coral Editorial",
    brandHue: 12,
    mode: "light",
    personality: "warm, editorial",
    colors: { ... },
  },
  // ... all 20
];
```

This should be copy-pasteable directly into the repo.

Iterate: if any palette looks muddy or fails contrast, tell me which and what tweak fixes it. We may swap brandHue values if needed.
```

---

## § 3 — Typography systems (6 systems)

**Open new claude.ai chat. Paste:**

```
I'm building OpenLen, an open-source AI landing page generator. I need 6 hand-tuned typography systems for landing pages, each with intentional rule-breaks that make the page feel hand-designed (not template-generated).

Output as ONE single React + Tailwind artifact rendering all 6 systems side-by-side, each applied to the same sample landing snippet (eyebrow + headline + sub + body paragraph + button label + section title) so I can compare them visually.

## The 6 systems

Each system specifies: display family, body family, weight scale, size scale, tracking values, leading values, optical-sizing usage.

### 1. Inter Tight (Linear/Vercel pattern)
- Display: Inter Variable, weight 600, tracking `-0.025em`
- Body: Inter Variable, weight 400, tracking default, leading `1.5`
- Scale: 1.25 modular (12/15/19/24/30/37.5/47/58/73)
- Optical sizing: `font-optical-sizing: auto`
- **Rule-break:** display has tracking `-0.04em` for the H1 only (one outlier)
- One-line personality: "Confident, technical, breath-tight"

### 2. Geist Editorial (Vercel's own)
- Display: Geist Variable, weight 500, tracking `-0.02em`
- Body: Geist Sans, weight 400, leading `1.6`
- Scale: 1.2 modular
- **Rule-break:** display H2s are weight 700 (one weight outlier)
- One-line personality: "Modern, slightly editorial, dev-tool credible"

### 3. Söhne Warm (Stripe/Resend pattern)
- Display: Söhne (or Söhne fallback to Inter), weight 600, tracking `-0.015em`
- Body: Söhne, weight 400, leading `1.55`
- Scale: 1.333 modular (more dramatic size jumps)
- **Rule-break:** body italic for one outlier element per section (a quote or aside)
- One-line personality: "Refined, editorial, premium"

### 4. JetBrains Mono Accent
- Display: JetBrains Mono, weight 500, tracking `-0.01em`
- Body: Inter Variable, weight 400, leading `1.55`
- Scale: 1.2 modular
- **Rule-break:** display uses mono — that IS the rule-break. Mono headlines on a non-mono body is the dev-tool signature.
- One-line personality: "Terminal-honest, developer-respect"

### 5. Fraunces Editorial (luxury + warm)
- Display: Fraunces Variable, weight 500, tracking `-0.02em`, optical-sizing `opsz` axis to 144 for display sizes
- Body: Inter Variable, weight 400, leading `1.6`
- Scale: 1.25 modular
- **Rule-break:** italic display for one tier of headings — adds magazine feel
- One-line personality: "Editorial, slightly haute, magazine-cover energy"

### 6. Crimson Print (long-form, considered)
- Display: Crimson Pro, weight 600, tracking `0em`
- Body: Crimson Pro, weight 400, leading `1.7` (more generous than the others)
- Scale: 1.2 modular
- **Rule-break:** body has tracking `+0.005em` for better long-form readability — opposite direction from the other 5
- One-line personality: "Print-magazine, considered, long-read"

## Demo layout

Render all 6 systems in a vertical stack. For each:
- Header chip with system name + key fonts
- Sample content rendered in the system's styles:
  - Eyebrow (small uppercase tracking) — "Now in private beta"
  - H1 — "Ship beautiful landing pages, before lunch."
  - Sub — "OpenLen turns a 50-word brief into a self-contained HTML page that lives at your own subdomain."
  - Body — "Every output passes six quality gates before it ships. No bug loops, no $50/month minimums."
  - Button label (small caps) — "Try it free"
  - Section title — "How it works"
- Below the sample: 3 lines of metadata showing tracking + leading + size values

## Constraints

- Load fonts via Google Fonts `<link>` tags inline in the artifact
- Use CSS variables for the scale: `--text-xs`, `--text-sm`, `--text-base`, `--text-lg`, `--text-xl`, `--text-2xl`, `--text-3xl`, etc. Each system overrides them.
- All 6 must remain readable at 14px body (don't sacrifice legibility for style)
- All 6 must remain accessible (don't use `font-weight: 100` on body text or any anti-pattern)

## Export block

At the bottom, render an export block:

```typescript
// lib/design/presets/typography.ts
export const TYPOGRAPHY_PRESETS: TypographyPreset[] = [
  {
    id: "inter-tight",
    name: "Inter Tight",
    displayFamily: "Inter",
    bodyFamily: "Inter",
    displayWeight: 600,
    bodyWeight: 400,
    displayTracking: "-0.025em",
    bodyTracking: "0",
    leading: 1.5,
    scale: 1.25,
    opticalSizing: true,
    googleFontsLink: "https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..700&display=swap",
  },
  // ... all 6
];
```

Iterate: if Crimson Pro feels too newspapery, or JetBrains Mono headlines hurt at 60px, tell me what to swap. We're optimizing for `feels intentional` not `feels safe`.
```

---

## § 4 — Layout primitive: Hero (3 variants)

**Open new claude.ai chat. Paste:**

```
I'm building OpenLen, an AI landing page generator (AGPL OSS at openlen.com). The runtime composes pages from 5 layout primitives. I need the **Hero** primitive designed with 3 variants. Output as one React + Tailwind artifact showing all 3.

## Common spec

All variants accept:

```typescript
interface HeroSlots {
  eyebrow?: string;
  headline: string;
  subhead?: string;
  ctaPrimary?: { label: string; href: string };
  ctaSecondary?: { label: string; href: string };
  mediaUrl?: string; // optional product mockup or photo
  socialProof?: string; // optional small line like "1,400+ teams trust us"
}

interface HeroProps {
  id: string;
  variant: "centered" | "split" | "asymmetric";
  slots: HeroSlots;
}
```

All variants render text via `<EditableText slot={`${id}.${key}`}>{value}</EditableText>` placeholders — for the artifact you can render them as plain `<span data-slot-path={...}>` for visual purposes.

Use OKLCH tokens that come from CSS variables: `--color-bg`, `--color-fg`, `--color-text-muted`, `--color-accent`, `--font-display`, `--font-body`, `--space-section`. Don't hardcode colors. Tailwind utility classes for layout, inline `style={{ ... }}` for token-driven colors.

Server-renderable: no `"use client"`, no hooks.

## The 3 variants

### Variant 1: Centered
- Eyebrow chip at top center
- Headline `text-5xl md:text-7xl` `font-display`, text-balance, 1-3 lines
- Subhead below, max-w-`prose`, centered, `text-muted`
- Two CTAs side-by-side: primary solid coral, secondary ghost outline. Spacing `gap-3`
- Optional social-proof line under CTAs, small + muted
- Decoration: subtle `<BackgroundLayer>` placeholder (a div that absorbs the brand bg from CSS vars)
- Vertical padding: `--space-section`

Think: Linear's homepage hero, Vercel's home.

### Variant 2: Split
- 2-column on desktop, 50/50 grid
- LEFT: eyebrow + headline + subhead + CTAs + socialProof (stacked, left-aligned)
- RIGHT: media (image, screenshot, or placeholder) — `aspect-[4/5]`, rounded `--radius`, subtle `box-shadow: 0 60px 100px -40px oklch(0% 0 0 / 0.2)`
- On mobile: stack vertically, text first, media below
- Use grid with explicit gap (not flex) so spacing is rhythmic

Think: Stripe payments page, Vercel `/products` pages.

### Variant 3: Asymmetric
- 12-col grid: text in cols 1-7, media in cols 8-12 (7/5 split — NOT symmetric)
- Headline allowed to bleed past the grid edge (negative margin) for "art-directed" feel
- Media has `transform: rotate(-2deg)` and `box-shadow: 0 40px 80px -30px oklch(0% 0 0 / 0.3)` — feels tilted, intentional
- A decorative "label" element near the top — small text rotated 90deg in the left gutter, like an editorial magazine
- Bg has a gradient blob behind the headline (using `--color-accent` at low opacity)

Think: Apple product launches, agency landing pages, fashion lookbooks.

## Demo layout

Render all 3 variants stacked vertically, each with the same demo content:
- eyebrow: "New in v3"
- headline: "Beautiful landing pages, your code, $19 a month."
- subhead: "OpenLen turns a 50-word brief into a self-contained HTML page that you own. No platform lock-in, no $6 billion valuation. Just code."
- ctaPrimary: { label: "Generate yours", href: "#" }
- ctaSecondary: { label: "See examples", href: "#" }
- socialProof: "1,400+ landings shipped this week"
- mediaUrl: placeholder gradient div

Show each on a different `brandHue` (centered=12 coral, split=245 indigo, asymmetric=320 magenta) so I can see them under different palettes.

## Iteration constraints

- Don't add gimmicks (3D, video bg, parallax). All 3 should feel restrained.
- Type hierarchy must be obvious within 0.5s of glancing — eyebrow → headline → sub → CTA pyramid.
- Match the 60-30-10 color rule: most of the section is bg + fg, accent appears once or twice max.

Iterate until each looks like it could be the hero of a real product (Linear, Stripe, Vercel, Cal.com) without me cringing.
```

---

## § 5 — Layout primitives: Stack, Split, Grid, CTA (in one chat or split into 4)

**Open new claude.ai chat. Paste:**

```
I'm building OpenLen, an open-source AI landing page generator. I need 4 layout primitives designed: Stack, Split, Grid, CTA. Each has 2-5 variants. Output as one React + Tailwind artifact showing all of them.

This is a LARGE artifact. If you'd prefer to do it in chunks, start with Stack + Split (4 components total), then I'll ask for Grid + CTA in follow-up turns.

Common requirements (apply to all):
- Use OKLCH CSS variables: `--color-bg`, `--color-fg`, `--color-text-muted`, `--color-surface`, `--color-surface-elevated`, `--color-border`, `--color-accent`, `--color-accent-fg`, `--font-display`, `--font-body`, `--space-section`, `--radius`
- Server-renderable: no `"use client"`, no hooks
- Text slots wrap in `<span data-slot-path={...}>` placeholders
- Tailwind utility classes for layout, inline `style={{ ... }}` for token colors

## Stack — 3 variants

```typescript
interface StackSlots {
  eyebrow?: string;
  title?: string;
  sub?: string;
  items: Array<{
    title: string;
    body: string;
    icon?: string;       // lucide name (or inline svg path)
    accent?: boolean;
  }>;
}
interface StackProps {
  id: string;
  variant: "vertical-cards" | "alternating-rows" | "icon-grid-3col";
  slots: StackSlots;
}
```

### Stack.vertical-cards
- 3 cards stacked vertically (centered, max-w-`prose`)
- Each card: padding, `--radius` corners, `--color-surface` bg, subtle border
- Card has icon top-left, title, body
- The `accent: true` card has `--color-accent` left-border 3px wide

### Stack.alternating-rows
- For 4-6 items, render full-width rows alternating left/right alignment
- Row content: icon, title, body. Width-constrained.
- Visual rhythm: zig-zag effect creates editorial feel

### Stack.icon-grid-3col
- 3-column grid on desktop, 1-col mobile
- Each cell: icon (24-32px, accent color), title, body
- Tight, info-dense. Linear features pattern.

## Split — 3 variants

```typescript
interface SplitSlots {
  eyebrow?: string;
  title?: string;
  sub?: string;
  left:  { title: string; body: string; bullets?: string[]; mediaUrl?: string };
  right: { title: string; body: string; bullets?: string[]; mediaUrl?: string };
}
interface SplitProps {
  id: string;
  variant: "side-by-side" | "comparison-table" | "before-after";
  slots: SplitSlots;
}
```

### Split.side-by-side
- 2 columns 50/50 each with title + body + optional bullets
- Subtle divider line between them
- Used for "this OR that" framing

### Split.comparison-table
- 2-column comparison with shared feature rows
- Left column = competitor (greyed out, X marks)
- Right column = your product (`--color-accent`, checkmarks)
- Tabular look but Tailwind not HTML table

### Split.before-after
- 2 panels with explicit "Before" / "After" labels
- Each panel could be image OR text description
- Slight horizontal slider hint in the middle (visual only, decorative)

## Grid — 5 variants

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
    accent?: boolean;
  }>;
}
interface GridProps {
  id: string;
  variant: "logo-bar" | "feature-3col" | "testimonial-masonry" | "stats-4-grid" | "pricing-3tier";
  slots: GridSlots;
  columns?: number;
}
```

### Grid.logo-bar
- Single row of 5-8 logos (or labeled cells if no media), greyscale + 60% opacity
- Optional intro line above: "Trusted by"
- Spacing: justify-between or evenly distributed

### Grid.feature-3col
- 3 columns, each cell: icon, title, body
- 1 cell can be `accent: true` to highlight it
- Used for "3 things we do"

### Grid.testimonial-masonry
- 6 cards staggered (CSS columns or grid with row-spans)
- Each card: quote, author name, role/company, optional avatar
- Cards have subtle shadow + `--color-surface` bg

### Grid.stats-4-grid
- 4 stat cells in a single row on desktop, 2×2 on tablet, 1-col mobile
- Each: HUGE number (`text-5xl` `font-display`) + small label + optional caption
- Vertical divider lines between cells on desktop

### Grid.pricing-3tier
- 3 pricing tier cards
- Middle one is `accent: true` — different bg, accent border, "Popular" pill at top
- Each card: tier name, price/period, blurb, feature list, CTA button

## CTA — 3 variants

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

### CTA.centered-banner
- Full-width section with centered text + CTAs
- Min-height-`screen` no — keep it tight, just enough to feel like a moment
- Background uses `--color-surface-elevated`

### CTA.card-form
- A card centered on the page with form fields built into it (email input + submit button)
- Used for newsletter / "join the waitlist"
- Border, padding, shadow

### CTA.gradient-banner
- Full-width, brand-gradient background (using `--color-accent` to a darker shade)
- White text, contrasted CTAs
- The "big closer" CTA before footer

## Demo

Render all 14 components (3+3+5+3) in a vertical stack with section dividers showing each component name. Use brandHue=12 (coral) for the whole demo. Same sample content per primitive.

Iterate visually. If any variant feels weak or generic, tell me and we'll redesign it. We're going for "looks intentional", not "looks ok".
```

---

## § 6 — SVG decoration library (5 components)

**Open new claude.ai chat. Paste:**

```
I'm building OpenLen, an open-source AI landing page generator. I need 5 SVG decoration components that can be layered onto any section as a background or accent element. Output as ONE React + Tailwind artifact with all 5 + a demo grid.

## Common spec

Each is a pure SVG component:

```typescript
interface DecorationProps {
  brandHue: number;       // 0-360
  intensity?: "minimal" | "balanced" | "bold";  // default "balanced"
  className?: string;
}
```

Server-renderable. Self-contained SVG. No external fonts, images, scripts.

## The 5 decorations

### 1. MeshOverlay
- 4 stacked radial gradients positioned absolutely
- Colors derived from `oklch(60% 0.18 brandHue)`, `oklch(70% 0.20 brandHue+30)`, etc.
- `mix-blend-mode: screen` on dark bg, `multiply` on light bg
- Intensity affects opacity: minimal=20%, balanced=40%, bold=70%

### 2. GrainNoise
- Single SVG turbulence layer (`<feTurbulence baseFrequency="0.85" />`)
- `<rect width="100%" height="100%" filter="url(#noise)" opacity="..."`
- Intensity controls opacity: minimal=3%, balanced=6%, bold=12%
- Used as an overlay on top of solid bgs or other decorations

### 3. HalftoneGrid
- SVG `<pattern>` with `<circle r="1">` at 24px spacing
- Color derived from brandHue at low chroma
- A `<mask>` radial fade so the pattern is dense in one corner and fades to edges
- Intensity controls the dot size: minimal r=0.8, balanced r=1.2, bold r=1.8

### 4. ConicSweep
- SVG with `<defs>` containing a `conicGradient` at 50% 50%
- Colors cycle through brandHue → brandHue+120 → brandHue+240 → brandHue
- A `<mask>` blurred radial so the conic is feathered, not a hard sweep
- Intensity affects the masking aggressiveness

### 5. BlobBurst
- 2-3 organic blobs (irregular bezier paths) absolutely positioned
- Each blob fills with a `<radialGradient>` derived from brandHue
- `filter: blur(40px)` on each (set in style or in SVG filter)
- Intensity controls blob count: minimal=1, balanced=2, bold=3

## Demo grid

5 cells in a 5-col grid (or 3+2 layout). Each cell is 240×180. Each shows the decoration with brandHue=12 at "balanced" intensity. Below each: name + 3-pip intensity preview (3 mini versions of the same decoration at minimal/balanced/bold).

## Export

Below the demo, render a `<pre>` export block:

```typescript
// lib/images/svg-decoration.tsx
export function MeshOverlay({ brandHue, intensity = "balanced", className }: DecorationProps) { ... }
export function GrainNoise({ ... }) { ... }
// etc
```

Self-contained, drop-in, copy-paste into the OpenLen repo.

Iterate until each one feels like a deliberate design choice, not a generic AI gradient.
```

---

## § 7 (bonus) — Background variant comparator

If you want a single "design system overview" artifact for documentation, run this prompt after the others:

```
I have 8 backgrounds, 20 palettes, 6 typography systems, and 5 decoration components designed for OpenLen. Compose a single React artifact that renders a "Design System Overview" page showing:

1. A header with the OpenLen logo + tagline
2. Sections for each preset category, each showing all variants in a compact grid
3. A "combinations" section that mounts a fake landing hero with random combinations (refresh button regenerates)
4. A footer with the brand voice + when to use which preset

Use the artifact as both a reference doc and a Show HN gallery piece. Lo-fi enough to scan in 30 seconds, hi-fi enough to be a screenshot.
```

This last one is optional but it gives you a single image you can put in the README / launch tweet showing "here's the design surface."

---

## Total work + estimates

| Prompt | Output | Claude.ai time |
|---|---|---|
| § 1 Backgrounds | 8 components + demo grid | ~1h |
| § 2 Palettes | 20 OKLCH palettes + export block | ~30 min |
| § 3 Typography | 6 systems + side-by-side comparison | ~1h |
| § 4 Hero | 3 variants + demo | ~1h |
| § 5 Stack/Split/Grid/CTA | 14 variants total | ~2h |
| § 6 SVG Decoration | 5 components + demo grid | ~45 min |
| § 7 Overview (optional) | Documentation artifact | ~30 min |
| **Total** | **~56 design assets** | **~5-7h** |

When you're done with each artifact, save it locally (`~/Downloads/openlen-backgrounds.html`, etc.). The Session 13 agent will read them and port them to the repo as TypeScript modules at `lib/design/presets/*` and `components/primitives/*`.

These prompts produce **the entire visual design surface of OpenLen V3**. After Session 13 + 14 ship, the AI runtime (Kimi K2.6) just composes from this catalog. The "wow" lives in this directory, not in the model.
