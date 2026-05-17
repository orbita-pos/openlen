# OpenLen — Block design prompts for claude.ai

6 new blocks worth pulling via claude.ai artifacts while Session 12 runs.

## How to use

For each block: open a new claude.ai chat. Paste **Master spec** (§ A) first to set context. Then paste **the block-specific prompt** (§ B.1–B.6). Claude returns a `.tsx` artifact. Save to the listed path. Iterate visually in the artifact until you're happy. Then integrate (§ C).

Order to do them in (impact-sorted):
1. **hero/split-screen** — alt hero used in ~60% of landings
2. **social-proof/logo-bar** — almost every B2B SaaS has one
3. **testimonials/masonry** — upgrade from single-quote
4. **stats/four-grid** — traction metrics row
5. **how-it-works/three-steps** — common pattern, currently missing
6. **features/comparison-table** — competitive landings

---

## § A. Master spec — paste first

```
I'm building an open-source AI landing page generator (OpenLen, AGPL v3). I need a single React + TypeScript + Tailwind block component that drops into our existing block library. Output as an artifact — a single `.tsx` file, no extra files.

### File format (mandatory)

```typescript
/**
 * Source: [Project] (LICENSE) — [layout pattern name]
 *   [original URL]
 * License: MIT/ISC/etc — see /LICENSES/[name].LICENSE.txt
 *
 * Adapted: tokens substituted, slots schema added, [other changes].
 */
import { z } from "zod";
import { EditableText } from "../_editable";
import { /* inline icons if needed */ } from "../_icons";
import type {
  BlockComponent,
  BlockComponentProps,
  BlockMeta,
} from "../types";

export const slotsSchema = z.object({
  // Every visible text slot is z.string().max(N).
  // Arrays use z.array(z.object({...})).min(N).max(M) or z.tuple([...]).
  // Optional slots use z.optional().
});

export type Slots = z.infer<typeof slotsSchema>;

export const meta: BlockMeta<typeof slotsSchema> = {
  id: "category/variant",
  displayName: "Human-readable name (≤60 chars)",
  description: "When the planner should pick this block (≤200 chars)",
  aesthetics: [/* 2-5 from the enum below */],
  slotsSchema,
  exampleSlots: { /* full realistic example, OpenLen brand voice */ },
};

export const Component: BlockComponent<typeof slotsSchema> = ({
  slots,
  tokens,
}: BlockComponentProps<typeof slotsSchema>) => {
  return (
    <section
      style={{
        background: tokens.bg,
        color: tokens.text,
        fontFamily: tokens.fontBody,
      }}
      className="relative w-full"
    >
      {/* layout */}
    </section>
  );
};
```

### Tokens available (object passed in via `tokens` prop)

| Token | Use for |
|---|---|
| `tokens.bg` | Section background |
| `tokens.text` | Primary text color |
| `tokens.textMuted` | Secondary text |
| `tokens.textDim` | Tertiary / caption text |
| `tokens.surface` | Card background |
| `tokens.surfaceElevated` | Elevated card / highlight |
| `tokens.border` | Subtle 1px border |
| `tokens.borderStrong` | More visible border (e.g., button outline) |
| `tokens.accent` | Brand accent color (used sparingly — buttons, highlights) |
| `tokens.accentFg` | Text on accent background |
| `tokens.fontDisplay` | Display/heading font |
| `tokens.fontBody` | Body font |
| `tokens.radius` | Border radius string (e.g., "12px") |
| `tokens.shadow` | Box shadow string |

### Aesthetics enum (pick 2-5 that fit your block)

- `technical-minimal` — Linear / Vercel style, tight whitespace, mono accents
- `refined-editorial` — Stripe / Apple style, generous spacing, serif accents OK
- `warm-humanist` — Notion / Cal style, rounded, friendly
- `editorial-maximalist` — graphic-heavy, big numbers, colored sections
- `brutalist-technical` — raw, monospace-heavy, sharp edges

### EditableText wrapping (Session 12 requirement)

Every visible text slot MUST wrap:

```tsx
<EditableText slot="headline">{slots.headline}</EditableText>
```

For array items, use bracketed indices:

```tsx
{slots.tiers.map((tier, i) => (
  <EditableText slot={`tiers[${i}].name`}>{tier.name}</EditableText>
))}
```

Do NOT wrap: image URLs, enum values, booleans, href values.

### Rules

1. NO `"use client"` — must server-render.
2. NO `lucide-react` imports — if you need icons, ask me to add them to `lib/blocks/_icons.tsx` first, then import from `../_icons`. (Available now: Sparkles, Code, Zap, Shield, Rocket, Globe, Layers, Wand, Gauge, Check, Star, CircuitBoard, Cloud, Lock, Compass, Plus.)
3. NO external deps beyond what's listed.
4. Tailwind utility classes for layout (`max-w`, `mx-auto`, `grid`, `flex`, `gap`, `px`, `py`).
5. Inline `style={{ ... }}` for token-driven properties (background, color, font, border, radius).
6. Mobile-first responsive: `sm:`, `md:`, `lg:` breakpoints.
7. Source attribution from MIT/ISC layouts is OK and encouraged — cite top comment.
8. Brand voice for `exampleSlots`: confident, technical, slightly playful. Specific numbers. No vague marketing fluff. Examples: "Pay for the work, not the seats" / "Quality gates on every output" / "Every plan includes unlimited projects."

Ready? Here's the block I need:
```

---

## § B. The 6 block prompts

### B.1 — hero/split-screen

```
Block: `lib/blocks/hero/split-screen.tsx`

Layout: 2-column on desktop, stacked on mobile.
- LEFT column: eyebrow (optional pill) + huge headline (text-balance, 3-line max) + sub copy + 2 CTAs (primary solid, secondary outline) + optional small social proof line (e.g., "Trusted by 1,400 teams").
- RIGHT column: hero image, full-bleed inside the column, cropped to fit, aspect ratio ~ 4:5. On mobile, image goes BELOW the copy, 16:9.

Inspiration: linear.app home, vercel.com home, stripe.com home. Generous whitespace, headline takes ~50% of left column height. Image has a subtle 1px border + `tokens.radius` rounded corners. Mobile: stack with image below, smaller headline.

Slots schema:
- `eyebrow?: string ≤ 40`
- `headline: string ≤ 100`
- `sub?: string ≤ 240`
- `ctaPrimary: { label: string ≤ 24, href: string }`
- `ctaSecondary?: { label: string ≤ 24, href: string }`
- `socialProof?: string ≤ 80`
- `heroImageKey: string`  // path/URL to image, render as <img src={slots.heroImageKey} />

exampleSlots:
{
  eyebrow: "New",
  headline: "Ship a landing page in 42 seconds, not 42 days.",
  sub: "OpenLen turns a 50-word brief into a self-contained HTML page — typography, copy, images, quality gates included.",
  ctaPrimary: { label: "Generate yours", href: "#start" },
  ctaSecondary: { label: "See examples", href: "#examples" },
  socialProof: "1,400+ pages shipped this month",
  heroImageKey: "/uploads/example-hero.png",
}

Aesthetics: ["technical-minimal", "refined-editorial", "warm-humanist"]

displayName: "Split-screen hero — copy left, image right"
description: "Two-column hero with copy on the left and a hero image on the right. Use for product launches where the visual carries weight. Stacks on mobile."
```

### B.2 — social-proof/logo-bar

```
Block: `lib/blocks/social-proof/logo-bar.tsx`

Layout: single horizontal row of 5-8 client/integration logos.
- Optional small intro line above the row, centered ("Trusted by teams at" / "Powering products at" / "Used by builders at").
- Logos in greyscale (`filter: grayscale(1) opacity(0.6)` via inline style), height ~32px, even spacing.
- On mobile: 2 rows of 3-4 logos, smaller (~24px).

Inspiration: vercel.com customer strip, stripe.com clients row.

Slots schema:
- `intro?: string ≤ 40`  // "Trusted by"
- `logos: array(min 4, max 8) of { name: string ≤ 30, src: string }`  // src = image URL/path

For each logo, render <img src={logo.src} alt={logo.name} style={{ height: 32, filter: "grayscale(1) opacity(0.6)" }} />.

exampleSlots:
{
  intro: "Trusted by teams at",
  logos: [
    { name: "Linear", src: "/uploads/logos/linear.svg" },
    { name: "Vercel", src: "/uploads/logos/vercel.svg" },
    { name: "Notion", src: "/uploads/logos/notion.svg" },
    { name: "Cal.com", src: "/uploads/logos/cal.svg" },
    { name: "Raycast", src: "/uploads/logos/raycast.svg" },
    { name: "Resend", src: "/uploads/logos/resend.svg" },
  ],
}

Aesthetics: ["technical-minimal", "refined-editorial", "warm-humanist", "editorial-maximalist", "brutalist-technical"] (all 5 — universally useful)

displayName: "Client logo bar (greyscale strip)"
description: "Horizontal row of client/customer logos in greyscale. Sits between hero and features. Use whenever the page has real social proof to show."
```

### B.3 — testimonials/masonry

```
Block: `lib/blocks/testimonials/masonry.tsx`

Layout: masonry-style grid of 6 testimonial cards, slightly staggered heights to avoid a perfect grid feel.
- Desktop: 3 columns. Mobile: 1 column.
- Each card: small avatar (40px round), quote (text-pretty), author name + role/company on a single line below quote.
- Cards have `tokens.surface` background, `tokens.border` 1px border, `tokens.radius` corners.
- Use CSS columns (`columns-3 md:columns-3 columns-1`) or grid with `grid-auto-rows: auto` so cards don't all align to the same baseline.

Inspiration: linear.app/customers, testimonials sections on stripe.com, vercel.com customer stories.

Slots schema:
- `eyebrow?: string ≤ 40`
- `title: string ≤ 80`
- `sub?: string ≤ 200`
- `testimonials: array(min 4, max 8) of { quote: string ≤ 280, authorName: string ≤ 40, authorRole: string ≤ 60, avatarSrc?: string }`

When avatarSrc is missing, render initials in a colored circle (use `tokens.accent` bg + `tokens.accentFg` text).

exampleSlots:
{
  eyebrow: "Loved by builders",
  title: "Real teams. Real pages shipped.",
  sub: "OpenLen replaced 3 days of Lovable iteration with one prompt and a Together AI bill of $0.12.",
  testimonials: [
    { quote: "I shipped my Show HN landing in the time it took to write the first version of the brief. The output didn't need any post-editing.", authorName: "Mei Tanaka", authorRole: "Solo founder, Sumi.dev" },
    { quote: "Honestly the cost is what sold me. $0.13 per page vs $6.6B for a Lovable seat.", authorName: "Jordan Park", authorRole: "Indie hacker" },
    { quote: "AGPL plus my code in my repo. Nobody else gets to lock me in.", authorName: "Pia Reyes", authorRole: "CTO at Glide Labs" },
    { quote: "Quality gates on every output is the killer feature — no random hallucinated Lorem ipsum.", authorName: "Marcus Brenner", authorRole: "Eng lead at Volta" },
    { quote: "We tried v0, Lovable, and Framer. OpenLen is the only one where I own the output.", authorName: "Lin Wei", authorRole: "Designer at Heron Studio" },
    { quote: "Generation in 42 seconds. Edits land instantly. This is what I wanted Lovable to be.", authorName: "Aria Singh", authorRole: "Founder, Cardamom" },
  ],
}

Aesthetics: ["technical-minimal", "refined-editorial", "warm-humanist"]

displayName: "Testimonials — masonry grid"
description: "Six testimonial cards in a slightly staggered grid. Use whenever you have ≥4 customer quotes. Stacks vertically on mobile."
```

### B.4 — stats/four-grid

```
Block: `lib/blocks/stats/four-grid.tsx`

Layout: 4 stat cells in a single row on desktop, 2×2 on tablet, stacked on mobile.
- Optional eyebrow + title + sub above the grid.
- Each cell: huge number (text-5xl on desktop, text-4xl mobile, `tokens.fontDisplay`, font-weight 600, `tokens.text` color) + small label below in `tokens.textMuted` + optional 1-line caption in `tokens.textDim`.
- Divider line BETWEEN cells (only on desktop): 1px vertical line in `tokens.border` using `border-r` on the first 3 cells. None on mobile.

Inspiration: vercel.com/customers stats row, linear.app traction page, notion.so/customers.

Slots schema:
- `eyebrow?: string ≤ 40`
- `title?: string ≤ 80`
- `sub?: string ≤ 200`
- `stats: array(exactly 4) of { value: string ≤ 8, label: string ≤ 30, caption?: string ≤ 80 }`

For values, the AI fills in things like "42s", "$0.13", "1,400", "99.9%". Keep them visually punchy — 1-4 chars + unit symbol.

exampleSlots:
{
  eyebrow: "By the numbers",
  title: "Quality gates aren't a slogan.",
  sub: "Every published page passes six automated checks before it goes live — a11y, conversion, mobile, SEO, security, performance.",
  stats: [
    { value: "42s", label: "Generation wall time", caption: "From brief to live page, including image generation." },
    { value: "$0.13", label: "Average cost per page", caption: "Together AI smart-routing across 7 models." },
    { value: "6/6", label: "Quality gates passed first-try", caption: "On 100% of our 5-brief eval suite." },
    { value: "1,400+", label: "Pages shipped this month", caption: "Across solo founders and small teams." },
  ],
}

Aesthetics: ["technical-minimal", "refined-editorial", "editorial-maximalist"]

displayName: "Four-stat grid (traction row)"
description: "Four big numbers in a row, each with a label + optional caption. Use to surface traction metrics, performance claims, or product specs. Drops to 2×2 on tablet."
```

### B.5 — how-it-works/three-steps

```
Block: `lib/blocks/how-it-works/three-steps.tsx`

Layout: 3 numbered steps, horizontal on desktop, vertical on mobile.
- Optional eyebrow + title + sub at the top.
- Each step: large numeral ("01", "02", "03" in `tokens.fontDisplay`, font-weight 500, `tokens.accent` color, ~text-2xl) + step title + step body + optional icon (from `../_icons`).
- Connecting line BETWEEN steps on desktop (dashed 1px `tokens.border`, horizontal). None on mobile.
- Each step in its own div with `flex flex-col gap-3`.

Inspiration: stripe.com onboarding flows, "How it works" sections on cal.com / loom.com.

Slots schema:
- `eyebrow?: string ≤ 40`
- `title: string ≤ 80`
- `sub?: string ≤ 200`
- `steps: array(exactly 3) of { iconName?: string, title: string ≤ 60, body: string ≤ 200 }`

iconName is one of the icon names available in `../_icons`: "sparkles" | "code" | "zap" | "shield" | "rocket" | "globe" | "layers" | "wand" | "gauge" | "check" | "star" | "circuit" | "cloud" | "lock" | "compass" | "plus". Render via `getIcon(name)` from `../_icons`.

exampleSlots:
{
  eyebrow: "How it works",
  title: "From idea to live page in three steps.",
  steps: [
    { iconName: "wand", title: "Write a brief", body: "50 words. The kind of thing you'd send a designer at midnight. Tell us what you sell and who you sell it to." },
    { iconName: "sparkles", title: "Watch it generate", body: "OpenLen picks a layout, fills in copy, generates a hero image, runs six quality gates — all in 42 seconds." },
    { iconName: "rocket", title: "Click publish", body: "Pick a subdomain at <name>.openlen.com. Page goes live behind our wildcard TLS cert. Edit any text inline whenever you want." },
  ],
}

Aesthetics: ["technical-minimal", "refined-editorial", "warm-humanist"]

displayName: "How it works — three numbered steps"
description: "Three steps with numerals + icons + body, connected by a dashed line on desktop. Use for product explainers / onboarding sections."
```

### B.6 — features/comparison-table

```
Block: `lib/blocks/features/comparison-table.tsx`

Layout: feature comparison table, 4 columns: feature name + 3 product columns (your product + 2 competitors).
- Header row: empty cell, then product name on top of each column. Your product column has `tokens.surfaceElevated` bg + `tokens.accent` 1px top border to highlight.
- Each data row: feature name on left, then for each product: a check mark (`Check` from `../_icons` with `tokens.accent` color) OR an em-dash (—) in `tokens.textDim`, OR a short value (e.g., "$19" or "5 pages") in `tokens.text`.
- Striped rows: even rows have `tokens.surface` background.
- On mobile: hide competitor columns, show only feature name + your product column. (Or stack vertically — pick what reads best.)

Inspiration: stripe.com/pricing comparison, linear.app/vs-other-tools, framer.com vs comparison pages.

Slots schema:
- `eyebrow?: string ≤ 40`
- `title: string ≤ 80`
- `sub?: string ≤ 200`
- `yourProductName: string ≤ 30`
- `competitors: array(exactly 2) of { name: string ≤ 30 }`
- `rows: array(min 5, max 12) of { feature: string ≤ 60, yourValue: string ≤ 20, competitorValues: array(exactly 2) of (string ≤ 20) }`

For value strings, the AI fills "✓" for "has it", "—" for "no", or a specific value like "$19" / "5 pages" / "Unlimited". The component renders ✓ as the `Check` icon, "—" as the em-dash.

exampleSlots:
{
  eyebrow: "Comparison",
  title: "OpenLen vs the landing-page generators that lock you in.",
  sub: "We started OpenLen because every other tool either hides your code or charges per seat. Here's the side-by-side.",
  yourProductName: "OpenLen",
  competitors: [{ name: "Lovable" }, { name: "v0" }],
  rows: [
    { feature: "Code ownership (AGPL)", yourValue: "✓", competitorValues: ["—", "—"] },
    { feature: "Subdomain hosting included", yourValue: "✓", competitorValues: ["—", "—"] },
    { feature: "Inline WYSIWYG editing", yourValue: "✓", competitorValues: ["✓", "✓"] },
    { feature: "Quality gates on every page", yourValue: "✓", competitorValues: ["—", "—"] },
    { feature: "Together AI smart routing", yourValue: "✓", competitorValues: ["—", "—"] },
    { feature: "Pages per month (free tier)", yourValue: "5", competitorValues: ["3", "Limited"] },
    { feature: "Cost per page (Pro)", yourValue: "$0.13", competitorValues: ["$0.50+", "Bundled" ] },
    { feature: "Self-host option", yourValue: "✓", competitorValues: ["—", "—"] },
  ],
}

Aesthetics: ["technical-minimal", "brutalist-technical"]

displayName: "Feature comparison table (vs competitors)"
description: "Side-by-side feature matrix with your product highlighted vs 2 named competitors. Use when the page is making an explicit competitive claim."
```

---

## § C. How to integrate each block

After claude.ai returns the artifact and you save it to disk:

### Step 1. Save the file
Drop the .tsx into the right path, e.g. `lib/blocks/hero/split-screen.tsx`. Create the directory if it doesn't exist (e.g., `lib/blocks/social-proof/`, `lib/blocks/stats/`, `lib/blocks/how-it-works/`).

### Step 2. Register it in `lib/blocks/_registry.ts`
Find the section for that category (or add a new section) and add:

```typescript
// Near the top, with the other imports:
import {
  meta as heroSplitScreenMeta,
  Component as HeroSplitScreen,
} from "./hero/split-screen";

// In the BLOCK_REGISTRY object literal:
"hero/split-screen": { meta: heroSplitScreenMeta, Component: HeroSplitScreen },
```

### Step 3. Verify it compiles
```powershell
npm run build
```
If TypeScript complains about `BlockMeta` / `BlockComponent` types, the artifact didn't match the format. Iterate in claude.ai with the error message.

### Step 4. Smoke test locally
```powershell
$env:DATABASE_URL = (Select-String -Path .env.local -Pattern '^DATABASE_URL=(.*)$').Matches[0].Groups[1].Value
npm run dev
```
Visit `http://localhost:3000/preview-blocks` (assumes that route exists — it does per the existing routes) and verify the new block renders with its `exampleSlots`.

### Step 5. Commit
```powershell
git add lib/blocks/<category>/<variant>.tsx lib/blocks/_registry.ts
git commit -m "feat(blocks): add <category>/<variant> — <one-line description>"
```

Do all 6, push once at the end.

---

## § D. Why these 6 specifically

- **Catalog growth.** 15 → 21 blocks (+40% variety). Each new block compounds across every future generation.
- **Coverage of common patterns.** Stats grid, logo bar, masonry testimonials, comparison table, "how it works" — these are in 80%+ of SaaS landings. Currently OpenLen has 0 of them.
- **Aesthetic spread.** Each block targets different aesthetics, so the planner has real choice across the variety enum.
- **No Together AI cost.** Pure design work via claude.ai (your 20× Max plan covers all 6 with iteration headroom).
- **Forward-compatible with Session 12.** Every prompt includes the `EditableText` wrapping convention, so the moment Session 12 lands, these blocks already support inline editing.

Time estimate: 30-45 min per block in claude.ai (mostly visual iteration). 15 min integration each. **Total: ~4-6 hours focused work.** Fits inside the Session 12 runtime window.
