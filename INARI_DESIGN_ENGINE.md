# Inari Pages — Design Engine Blueprint

**Mission:** Build an AI orchestrator that produces landing pages indistinguishable from work by a Linear/Vercel/Stripe designer. Output must be Anthropic-level (`Claude.ai artifacts` quality) while running on Together AI's open-source models (Qwen3-Coder, Kimi K2.6, DeepSeek V4 Pro) — 10× cheaper than competitors.

**Founded on research (May 2026):**
- Linear, Vercel, Stripe, Resend, Supabase, Cal.com, Plain — design pattern extraction
- Claude.ai artifacts system prompt + the open-sourced `frontend-design` Skill from Anthropic
- 23 open-source block libraries inventoried for AGPL compatibility
- Lovable, Bolt, v0, Framer, Webflow AI, Hostinger Horizons — competitive architecture analysis

---

## 1. The 5-Layer Quality Stack

A single intervention won't close the gap. Inari's design engine is **5 stacked techniques**:

| Layer | Cost | Leverage | What it does |
|---|---|---|---|
| **1. High-level system prompt** | Trivial (~$0.005/gen) | High | Quality bar + design principles + anti-patterns + brand voice |
| **2. Design token injection** | Trivial | High | Hardcoded tokens (colors, fonts, spacing, shadows) the AI MUST use |
| **3. Few-shot examples (3 per call)** | Medium (~$0.01/gen extra input tokens) | Highest | 3 hand-crafted reference HTML files — model pattern-matches |
| **4. Block library composition** | Trivial after upfront vendor work | Highest | AI picks block IDs + fills slot JSON, NOT generates raw JSX |
| **5. Quality gates + escalation** | Marginal (only when needed) | Medium | Post-process validation, escalate to Claude/DeepSeek for premium tier |

**Expected outcome:** ~85% of Claude.ai artifacts quality at ~10× lower cost. The final 15% gap closes with optional Pro tier that escalates HTML generation to Claude Sonnet 4.5 via Anthropic API.

---

## 2. Architecture — Multi-Step Pipeline (NOT Single-Shot)

Every research source confirms: **multi-step pipelines beat single-shot generation.** Lovable / v0 / Hostinger Horizons all use composite architectures. Inari's pipeline:

```
brief: string
    ↓
[1] intent.classify       LFM2 24B A2B   ($0.03/$0.12)  ~200 tokens output
    Returns: { industry, audience, tone, complexity, suggestedSections[] }
    ↓
[2] plan.structure        Kimi K2.6      ($1.20/$4.50)  ~800 tokens output  
    Returns: { aestheticDirection, palette, sections: [blockId, slotSchema][], style }
    ↓
[3] section.fill          (parallel fan-out, Qwen3-Coder-Next)
    For each section: fills slot JSON ONLY (no JSX generation)
    Returns: { [sectionId]: { ...slotValues } }
    ↓
[4] images.generate       (parallel)
    FLUX.2 [pro] for hero ($0.03/img), Wan 2.6 for decorative ($0.03/img)
    ↓
[5] compose.assemble      (deterministic, NO LLM)
    Renders block library components with filled slots + images → single HTML file
    ↓
[6] quality.gate          (deterministic + optional AI judge)
    a11y check + conversion checklist + mobile-first snapshot + security scan
    ↓
[7] refine                (only sections that failed gates)
    Qwen3.5-9B-FP8 ($0.10/$0.15) — targeted fixes, NOT full regen
```

**Why this beats single-shot:**
- Section-parallel = 3-5× faster
- Bug loops structurally impossible (no full file to corrupt)
- Per-section iteration without full regen
- Cheap models do 90% of work; expensive models only gate critical paths
- Mirrors v0's composite + Hostinger's nexos.ai pattern (the proven winners)

**Total cost per generation:** $0.30-0.60 mock estimate, validated by Hostinger's published numbers (Claude+Gemini combo). With our cheaper Together stack: expected $0.15-0.40 real.

---

## 3. Design Token System (Hardcoded, 5 Palettes)

The AI never picks colors. It picks a palette. Palettes are pre-defined and verified.

### Palette 1: `mono-dark` (Vercel-class) — **DEFAULT when user gives no style guidance**

```ts
{
  name: "mono-dark",
  accent: "#FFFFFF",          // accent IS white-on-black
  accentHover: "#EAEAEA",
  bg: "#000000",
  surface: "#0A0A0A",
  surfaceElevated: "#171717",
  border: "#262626",
  borderStrong: "#404040",
  text: "#FAFAFA",
  textMuted: "#A1A1AA",
  textDim: "#52525B",
}
```

### Palette 2: `indigo-dark` (Linear-class)

```ts
{
  name: "indigo-dark",
  accent: "#5E6AD2",
  accentHover: "#7B85DC",
  bg: "#08090A",
  surface: "#101113",
  surfaceElevated: "#1A1B1F",
  border: "#222326",
  borderStrong: "#2E2F33",
  text: "#F4F5F8",
  textMuted: "#8A8F98",
  textDim: "#62666D",
}
```

### Palette 3: `emerald-dark` (Supabase-class — for dev tools)

```ts
{
  name: "emerald-dark",
  accent: "#3ECF8E",
  accentHover: "#3FB57B",
  bg: "#0F0F0F",
  surface: "#171717",
  surfaceElevated: "#1F1F1F",
  border: "#2E2E2E",
  borderStrong: "#393939",
  text: "#EDEDED",
  textMuted: "#A0A0A0",
  textDim: "#6B6B6B",
}
```

### Palette 4: `warm-dark` (Resend-class — creative/editorial)

```ts
{
  name: "warm-dark",
  accent: "#F97316",          // orange-500
  accentHover: "#FB923C",
  bg: "#0A0A0A",
  surface: "#141414",
  surfaceElevated: "#1F1F1F",
  border: "#262626",
  borderStrong: "#3F3F46",
  text: "#FAFAF9",            // eggshell
  textMuted: "#A8A29E",       // stone-400
  textDim: "#78716C",
}
```

### Palette 5: `mono-light` (Cal.com-class — productivity/scheduling)

```ts
{
  name: "mono-light",
  accent: "#141414",
  accentHover: "#3F3F46",
  bg: "#FFFFFF",
  surface: "#FAFAFA",
  surfaceElevated: "#F4F4F5",
  border: "#E4E4E7",
  borderStrong: "#D4D4D8",
  text: "#0A0A0A",
  textMuted: "#52525B",
  textDim: "#A1A1AA",
}
```

### Selection logic (in `plan.structure` step)

```
if user mentions "developer tool / API / SDK"  → emerald-dark
if user mentions "creative / editorial / blog"  → warm-dark
if user mentions "scheduling / productivity"    → mono-light
if user mentions "design tool / minimal"        → indigo-dark
default (no signal)                             → mono-dark
```

### Typography stack (universal across palettes)

```ts
fontFamily: {
  sans:    ["Inter Variable", "Geist Sans", "ui-sans-serif", "system-ui"],
  display: ["Inter Display", "Inter Variable", "Geist Sans", "system-ui"],
  mono:    ["Geist Mono", "JetBrains Mono", "ui-monospace", "monospace"],
}
```

**Banned fonts** (AI fallback defaults — must explicitly block): Roboto, Arial, Open Sans, system-ui as primary, Space Grotesk, Plus Jakarta Sans, IBM Plex Sans as sans primary.

### Type scale (exponential, Tailwind-aligned)

```ts
fontSize: {
  "display-xl":  ["96px",  { lineHeight: "1.0",  letterSpacing: "-0.04em",  fontWeight: 600 }],
  "display-lg":  ["72px",  { lineHeight: "1.05", letterSpacing: "-0.035em", fontWeight: 600 }],
  "display-md":  ["56px",  { lineHeight: "1.1",  letterSpacing: "-0.03em",  fontWeight: 600 }],
  "h1":          ["48px",  { lineHeight: "1.15", letterSpacing: "-0.025em", fontWeight: 600 }],
  "h2":          ["36px",  { lineHeight: "1.2",  letterSpacing: "-0.02em",  fontWeight: 600 }],
  "h3":          ["24px",  { lineHeight: "1.3",  letterSpacing: "-0.015em", fontWeight: 600 }],
  "h4":          ["20px",  { lineHeight: "1.4",  letterSpacing: "-0.01em",  fontWeight: 500 }],
  "body-lg":     ["18px",  { lineHeight: "1.55", letterSpacing: "-0.005em", fontWeight: 400 }],
  "body":        ["16px",  { lineHeight: "1.6",  letterSpacing: "0",        fontWeight: 400 }],
  "body-sm":     ["14px",  { lineHeight: "1.55", letterSpacing: "0",        fontWeight: 400 }],
  "caption":     ["13px",  { lineHeight: "1.5",  letterSpacing: "0.005em",  fontWeight: 500 }],
  "label":       ["12px",  { lineHeight: "1.4",  letterSpacing: "0.04em",   fontWeight: 500, textTransform: "uppercase" }],
}
```

### Spacing & layout

```ts
spacing: {
  "section-y-sm":  "64px",
  "section-y":     "96px",   // standard between sections
  "section-y-lg":  "128px",  // major break (hero, CTA)
  "section-y-xl":  "160px",  // top of page only
}
container: { center: true, screens: { "2xl": "1280px" } }
maxW: { "hero-copy": "720px", "section-copy": "640px" }
```

### Shadow scale

```ts
boxShadow: {
  "xs":   "0 1px 2px 0 rgba(0,0,0,0.04)",
  "sm":   "0 1px 3px 0 rgba(0,0,0,0.06), 0 1px 2px 0 rgba(0,0,0,0.04)",
  "md":   "0 4px 8px -2px rgba(0,0,0,0.08), 0 2px 4px -2px rgba(0,0,0,0.04)",
  "lg":   "0 12px 24px -4px rgba(0,0,0,0.12), 0 4px 8px -2px rgba(0,0,0,0.06)",
  "xl":   "0 24px 48px -8px rgba(0,0,0,0.16), 0 8px 16px -4px rgba(0,0,0,0.08)",
  "mockup-dark": "0 32px 64px -16px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.08)",
  "mockup-light": "0 32px 64px -16px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.06)",
}
```

### Border radius

```ts
borderRadius: {
  "none":   "0",
  "sm":     "4px",
  "DEFAULT":"6px",
  "md":     "8px",
  "lg":     "10px",
  "xl":     "12px",
  "full":   "9999px",  // pills/badges/avatars only
}
// NEVER use values > 12px on cards. Reads as 2022 Apple-clone.
```

---

## 4. The Master System Prompt (Ready to Paste)

Goes at the top of EVERY orchestrator call. Optimized for Qwen3-Coder + Kimi K2.6. Save as `lib/orchestrator/master-prompt.ts`.

```
<role>
You are Inari Pages, a senior product designer-engineer hybrid who ships
landing pages for paid SaaS products. Your work competes head-to-head with
Lovable, Framer, v0.dev, and Vercel itself. Output that looks AI-generated
costs paying customers. Output that looks bespoke wins them.

You think in design tokens, semantic HTML, and Tailwind utility classes.
You write the page a senior designer would hand off to a senior engineer.
</role>

<quality_bar>
The user is paying for landing pages that will go live under a paid domain.
Acceptable means: a visiting founder cannot tell whether a human or a model
produced it. The benchmark is Linear (linear.app), Vercel (vercel.com),
Stripe (stripe.com), Resend (resend.com), Cal.com, and Plain (plain.com).
NOT WordPress themes. NOT Bootstrap templates. NOT "AI design tool" stock.

If the output could appear on a "look at this AI slop" Twitter thread,
you have failed. The threshold is "would a Linear designer ship this?"
</quality_bar>

<aesthetic_direction>
Before writing any code, commit to ONE aesthetic direction. Do not blend.
Pick an extreme and execute it with precision:

  - Refined editorial: serif headlines, narrow measure, high contrast,
    generous negative space (Stripe, Vercel docs, Plain)
  - Technical minimal: monospace accents, hairline borders, near-mono
    palette, single accent (Linear, Resend, Vercel marketing)
  - Warm humanist: rounded sans, off-white grounds, soft shadows,
    earth-tone accents (Notion, Cron, Things)
  - Editorial maximalist: oversized type, asymmetric grid, color blocks,
    visible grid lines (Framer marketing, Browser Company)
  - Brutalist technical: hard mono, raw borders, ALL-CAPS section labels,
    deliberate restraint as signal

Default direction if user gives no signal: Technical minimal.
Choose intentionally — intentionality, not intensity, is the move.
</aesthetic_direction>

<design_principles>
1. ONE accent color. Everything else is neutral. Two accents looks
   corporate. One accent looks expensive.

2. Type hierarchy is the design. Three sizes maximum on a hero:
   eyebrow (12-14px uppercase, tracked +0.08em), headline (48-72px,
   tight tracking, 1.05 line-height), body (16-18px, 1.6 line-height,
   max 60ch measure).

3. Whitespace is the design. Sections breathe with min 96px vertical
   padding desktop, 64px mobile. Content max-width 1280px max.

4. ONE shadow style across the page. Pick one elevation language.

5. ONE border radius value across the page. 0 (brutalist), 4px (technical),
   8px (modern), 12px (warm) — pick one. Apply consistently.

6. Motion is restraint. ONE orchestrated page-load reveal with
   staggered animation-delay. Hover states are subtle (translateY -2px,
   opacity .9). NO looping animations. NO marquee. NO autoplay video.

7. Images are not stock. Show product UI or geometric/typographic
   compositions. NEVER unsplash photos. NEVER generic gradient backgrounds.
</design_principles>

<banned_patterns>
NEVER produce any of these — immediate failures:

  - FONT primaries (banned): Inter, Roboto, Arial, system-ui, Open Sans,
    Space Grotesk, Plus Jakarta Sans, IBM Plex Sans.
    Allowed primaries: Geist, Söhne, Suisse Int'l, Founders Grotesk,
    Tiempos Headline, Editorial New. For mono: Geist Mono, JetBrains
    Mono, IBM Plex Mono.

  - COLOR (banned): purple-to-pink gradient. Indigo→purple→pink hero
    blur. Any radial gradient labeled "spotlight." Glassmorphism on white.

  - LAYOUT (banned): centered hero + subhead + (primary+ghost) CTA pair
    EXACTLY identical structure. Three feature cards in a row with
    icon-on-top-of-title-on-top-of-paragraph. Pricing table with three
    columns where middle has "Most popular" badge.

  - COPY (banned): "world-class," "cutting-edge," "revolutionary,"
    "game-changing," "leverage," "unlock," "supercharge," "AI-powered"
    (unless literally about AI), "lorem ipsum," "the future of X,"
    "X, reimagined," "amazing," "awesome," "next-gen."

  - ICONS (banned): generic Lucide icons next to every feature title.
    Three icons-in-circles-in-a-row pattern. If you use icons, they
    earn their place by carrying meaning.

  - CODE (banned): arbitrary Tailwind values like h-[600px] or
    text-[#5B7CFA]. Hardcoded hex inside className. Inline style="...".
    Any class containing "gradient-to-br from-purple."
</banned_patterns>

<brand_voice>
Copy is short and confident. Sentences under 12 words. No marketing
adjectives. No exclamation marks. No emoji unless explicitly requested.

The voice: "we know what we built, and we know who it's for."

Good headline patterns:
  - "Monitoring that actually pages you."
  - "The shortest path from error to fix."
  - "Bug reports that ship themselves."

Bad headline patterns:
  - "Revolutionary AI-powered monitoring solution"
  - "Unlock the power of next-generation observability"
  - "Welcome to the future of incident response"

CTAs are imperative verbs: "Start free," "Get the SDK," "See it live."
Never: "Learn more →," "Click here," "Get started today."

Eyebrows are nouns: "Features," "Pricing," "How it works."
Not: "Why choose us," "Our amazing features."
</brand_voice>

<design_tokens>
Use ONLY these tokens. Hardcoded for this generation:

  --color-bg:        {bg}
  --color-surface:   {surface}
  --color-border:    {border}
  --color-fg:        {fg}
  --color-fg-muted:  {fg-muted}
  --color-accent:    {accent}
  --color-accent-fg: {accent-fg}

  --font-display:    {display-font}
  --font-body:       {body-font}
  --font-mono:       {mono-font}

  --radius:          {radius}
  --shadow:          {shadow}
  --space-section:   96px
  --content-max:     1280px

You MUST NOT introduce new tokens. Derive variants via color-mix or opacity.
</design_tokens>

<thinking>
Before writing the file, internally plan:
  1. Aesthetic direction picked (one of the five) and why.
  2. The "unforgettable" detail — the ONE thing a visitor will remember.
  3. The accent color and its 3 exact moments of appearance.
  4. The grid: 12-col, asymmetric two-column, single-column editorial,
     or broken-grid. Justify.

Only then, write the output.
</thinking>

<few_shot_examples>
Three reference outputs follow. Match this level of refinement.
Do not copy structure — match craft.

EXAMPLE 1 — TECHNICAL MINIMAL (Linear-class):
{{example_1_html}}

EXAMPLE 2 — REFINED EDITORIAL (Stripe-class):
{{example_2_html}}

EXAMPLE 3 — WARM HUMANIST (Notion-class):
{{example_3_html}}
</few_shot_examples>

<final_constraint_check>
Before emitting your answer, silently verify:
  [ ] Did I pick ONE aesthetic direction and execute it?
  [ ] Did I use ONLY the design tokens provided?
  [ ] Is my primary font NOT in the banned list?
  [ ] Did I avoid the banned copy phrases?
  [ ] Is there ONE accent color used at max three moments?
  [ ] Is there ONE shadow style and ONE radius value?
  [ ] Did I produce semantic HTML with aria labels?
  [ ] Did I avoid centered-hero + three-feature-cards + 3-col-pricing
      EXACTLY identical?
  [ ] Would a Linear designer ship this?

If any answer is no, rewrite before emitting.
</final_constraint_check>
```

**Token budget:** ~1,800 tokens fixed. Comfortably cacheable with Together AI's `cache_control: ephemeral` — system prompt cached, brief + slot data variable. Expected cache hit rate >85% after warmup.

**Critical:** the `{{example_N_html}}` slots must be filled with **3 hand-crafted reference HTML files** rotated per request (never same triple twice in session). Source: build 9 reference HTMLs (3 per aesthetic direction × 3 directions), maintained in `lib/orchestrator/few-shots/`.

---

## 5. Block Library Plan

**Strategy:** vendor curated set from Tailark (MIT) + augment with shadcn blocks (MIT) + Magic UI (MIT). The AI **picks block IDs and fills slot JSON** — never generates raw JSX.

### Why slot-filling beats raw generation

| Pattern | Worst case | Cost per page | Failure mode |
|---|---|---|---|
| Raw JSX generation | Broken page that doesn't render | 2,000+ output tokens | Tailwind class invented, imports hallucinated, accessibility broken |
| **Slot-filling (chosen)** | Good block with mediocre copy | ~100 tokens of JSON | Mediocre copy (easy to retry) |

This is observably what Lovable does internally (consistent block topologies across users). The "design quality" Lovable ships comes from pre-vetted blocks, not from smarter models.

### Vendored block library (13 essential)

```
lib/blocks/
  _registry.ts            # AGPL-3.0 (your code)
  hero/
    centered-cta.tsx       # Tailark MIT — eyebrow + h1 + cta pair + mockup below
    split-image.tsx        # Tailark MIT — 60/40 split with product image right
    animated-gradient.tsx  # Magic UI MIT — WebGL gradient hero
    logo-strip.tsx         # Tailark MIT — hero + grayscale logo cloud below
  features/
    icon-grid-3col.tsx     # Tailark MIT — 3 cols, icon + title + body
    bento-asymmetric.tsx   # Magic UI MIT — bento 2×3 with 1 large tile
    alternating-rows.tsx   # Tailark MIT — image-left/right alternating
  pricing/
    three-tier-highlight.tsx  # Tailark MIT — 3 tiers, middle highlighted
    two-tier-simple.tsx       # shadcn blocks MIT — free vs pro
  testimonials/
    quote-grid-3col.tsx    # Tailark MIT
  faq/
    accordion.tsx          # shadcn primitive + Tailark layout
  cta/
    gradient-cta.tsx       # Tailark MIT — full-width gradient CTA
    card-cta-form.tsx      # Tailark MIT — card with email capture
  footer/
    four-col-links.tsx     # Tailark MIT — 4 cols + social row
    minimal-row.tsx        # HyperUI MIT — single row footer
LICENSES/
  tailark.MIT.txt
  shadcn-ui.MIT.txt
  magic-ui.MIT.txt
  hyperui.MIT.txt
```

Each vendored file gets header: `/* Source: Tailark (MIT) — see LICENSES/tailark.MIT.txt */`

### Block slot schema example

```ts
export const HeroCenteredCTA = {
  id: "hero/centered-cta",
  aesthetic: ["technical-minimal", "refined-editorial"],
  slots: z.object({
    eyebrow: z.string().max(40),
    headline: z.string().max(80),
    sub: z.string().max(160),
    primaryCTA: z.object({ label: z.string().max(20), href: z.string() }),
    secondaryCTA: z.object({ label: z.string().max(20), href: z.string() }).optional(),
    mockupImageUrl: z.string().optional(),
  }),
  Component: ({ slots, tokens }) => /* JSX */
}
```

The AI never sees the JSX. It only sees the schema and fills slots.

### Hard avoid (license violations)

- **Tailwind Plus** ($299) — license explicitly forbids "website builders"
- **shadcnblocks.com** — commercial subscription, redistribution forbidden
- **Aceternity UI Pro** — explicitly forbids re-distribution
- **Preline UI** — "Fair Use" clause specifically prohibits competing builders
- **Flowbite Blocks Pro** — EULA

---

## 6. Quality Gates (The Open Lane — No Competitor Has This)

**Insight from research:** None of the major AI page builders (Lovable, Bolt, v0, Framer, Webflow AI) have explicit conversion/a11y/SEO/security gates. They rely on implicit model quality. **This is Inari Pages' biggest strategic moat.**

Ship these as hard gates that block output:

### Gate 1 — A11y (axe-core, deterministic)
- All images have alt text
- Form inputs have labels
- Color contrast WCAG AA
- Heading hierarchy (no skipping H1→H3)
- Block on violations (fail builds in CI; refine for users)

### Gate 2 — Conversion checklist (AI judge, LFM2 24B)
- ONE primary CTA above the fold
- Hero copy contains: audience + outcome + mechanism
- Social proof present (testimonials, logos, or numbers)
- Form ≤4 fields if any
- No Lorem ipsum or generic placeholder text
- No banned phrases ("world-class" et al)

### Gate 3 — Mobile-first (deterministic snapshot)
- Render at 360px width
- AI judge: "is content readable and tappable?" (binary)
- No horizontal scroll
- Font sizes ≥14px

### Gate 4 — SEO + AEO (deterministic)
- Single H1, unique on page
- Meta description present (120-155 chars)
- schema.org structured data (Product / SoftwareApplication / etc.)
- OG image + Twitter card meta
- Headings hierarchical (H1→H2→H3, no skipping)

### Gate 5 — Security (already exists in radar repo)
- ESLint security rules (17)
- 19 regex patterns from `web/lib/ai/security-scan.ts`
- No `<script>` injection
- No external untrusted URLs

### Gate 6 — Performance
- Total bundle <100KB (HTML+CSS, no JS framework)
- All `<img>` lazy-loaded
- Critical CSS inline, no render-blocking
- Font preconnect/preload set

**Failure handling:**
- Gates 1-4 fail → automated refine pass on specific section ($0.005, ~2s)
- Gate 5 fails → block + alert
- Gate 6 fails → automated optimization (image compression, etc.)

**Public-facing value prop:** *"Every Inari Pages output passes 6 quality gates before delivery. Lovable doesn't do this. We do."*

---

## 7. Competitive Positioning — Inari vs Lovable Specifically

Lovable is the #1 threat ($6.6B valuation, $400M ARR, Sonnet 4.5-powered). Here's the exact wedge:

| Dimension | Lovable | Inari Pages |
|---|---|---|
| **Scope** | Horizontal (any app) | Vertical (landing pages only) |
| **Output** | React + Vite project (npm install required) | Single HTML file (open anywhere) |
| **Models** | Claude Sonnet 4.5 (~$3/$15 per M) | Qwen3-Coder + Kimi K2.6 (~$0.50-1.20 per M) |
| **Cost per generation** | ~$2-5 (their COGS) | ~$0.15-0.40 (10× cheaper) |
| **Bug loops** | #1 user complaint (full-file rewrites) | Structurally impossible (block + slot, no full file to corrupt) |
| **Quality gates** | None explicit | 6 gates (a11y, conversion, mobile, SEO, security, perf) |
| **A/B variants** | Manual re-prompt | First-class primitive (`/race` command) |
| **License** | Proprietary | AGPL v3 open source |
| **Lock-in** | Supabase + Lovable Cloud | None — pure HTML output |
| **Cross-sell** | None | InariWatch monitoring on every shipped page |
| **Pricing** | $25/mo Pro (100 credits opaque) | $19/mo Pro (50 pages, real-time cost preview) |

### The 8 specific wedges Lovable can't easily copy

1. **Conversion guarantees, not vibes.** 6-gate validation before output. Headline wedge.
2. **Block composition, not codegen.** Bug loops structurally impossible.
3. **A/B variants as primitive.** `/race` generates 3 hero variants in parallel.
4. **Mobile-first non-negotiable.** Render at 360px is part of every quality gate.
5. **Predictable pricing.** Real-time cost preview before each prompt. Rollover credits.
6. **InariWatch cross-sell.** Pages ship instrumented with `@inariwatch/capture`. Two ARR streams from one motion.
7. **Smaller scope = better quality.** Focus wins in vertical. Same way Framer dominates designer sites vs Webflow's power.
8. **AEO/GEO baseline.** schema.org + AI-search visibility audit free. Webflow charges Enterprise for this.

### Risk

Lovable will copy any single wedge. The defense is **execution speed** + the InariWatch flywheel (they'd need 2+ years to replicate the monitoring side).

---

## 8. Implementation Roadmap

### Week 1 — Foundations (Phase 2.5 prerequisite work)

- [ ] Create `lib/orchestrator/master-prompt.ts` with the system prompt template above
- [ ] Create `lib/orchestrator/design-tokens.ts` with 5 palettes + typography + spacing + shadows
- [ ] Update `lib/orchestrator/routing.ts` to inject master-prompt + selected palette into every step
- [ ] Test mock pipeline output with new prompt — confirm no regression in MOCK_MODE
- [ ] Verify Together AI prompt caching works (`cache_control: ephemeral` on system message)

### Week 2 — Few-shot corpus

- [ ] Hand-craft 9 reference HTML files (3 per aesthetic direction × 3 directions)
  - Technical minimal: 3 variants
  - Refined editorial: 3 variants
  - Warm humanist: 3 variants
- [ ] Validate each against quality bar (Linear/Vercel/Stripe parity)
- [ ] Implement rotation logic — never repeat same triple in session
- [ ] Measure token count, confirm context budget OK

### Week 3 — Block library vendoring

- [ ] Audit & vendor 13 essential blocks from Tailark + shadcn + Magic UI + HyperUI
- [ ] Define Zod schemas for each block's slots
- [ ] Create `_registry.ts` mapping block IDs → React components
- [ ] Add LICENSE files for vendored sources
- [ ] Convert pipeline `[3] section.fill` to slot-JSON output (not JSX)
- [ ] Implement `[5] compose.assemble` deterministic renderer

### Week 4 — Quality gates

- [ ] Gate 1 (a11y): integrate `axe-core` runner
- [ ] Gate 2 (conversion): build LFM2 judge prompt
- [ ] Gate 3 (mobile): Puppeteer 360px snapshot + AI judge
- [ ] Gate 4 (SEO/AEO): deterministic schema.org + meta checks
- [ ] Gate 5 (security): port from radar `web/lib/ai/security-scan.ts`
- [ ] Gate 6 (performance): bundle size budget + lazy-load enforcement
- [ ] Wire targeted refine for gate failures

### Week 5 — Real Together API (Phase 2 properly)

- [ ] Swap MOCK_MODE off
- [ ] Verify model IDs against current Together docs
- [ ] Tune `temperature` per step (classify 0.1, plan 0.3, copy 0.7, html 0.4)
- [ ] Run 5-brief evaluation harness (SaaS / portfolio / event / e-commerce / agency)
- [ ] Measure real cost — confirm $0.15-0.40 range
- [ ] Score quality 1-5 honestly per brief; iterate prompts on failures
- [ ] Document findings in `EVAL_PHASE_2.md`

### Week 6 — Premium escalation tier

- [ ] Add Claude Sonnet 4.5 via Anthropic API as opt-in for `html.ts` step
- [ ] Pricing tier "Pro Plus" $39/mo with Claude HTML generation
- [ ] A/B test: % of users upgrade for visible quality jump

### Ongoing — Iteration

- [ ] Showcase landings: 5-6 hand-crafted demo pages (Mira, Quiver, Tempo, Slate, etc.)
- [ ] Marketing landing references to showcase
- [ ] Show HN draft when 4/5 quality score consistently achieved

---

## 9. Expected Outcomes

**Quality:** ~85% of Claude.ai artifacts quality on free tier (Qwen+Kimi+blocks+gates). ~95% with Pro Plus tier (Claude HTML escalation). The remaining 5-15% is acceptable trade vs 10× cost advantage and open-source distribution.

**Cost economics:**
- Free tier: ~$0.15-0.25 per page generated → 100 pages/mo = $15-25 COGS
- Pro $19/mo: 50 pages → $7.50-12.50 COGS → 35-60% margin
- Pro Plus $39/mo: 50 pages with Claude escalation → $25-35 COGS → 10-35% margin (volume play)
- Team $49/mo: shared pool 200 pages → $30-50 COGS → similar margin

**Strategic position:**
- The orchestrator IS the moat — 12 months of operational data on which model wins which subtask
- The block library + design system IS the moat — Linear/Vercel-quality enforced by hard constraints
- The quality gates ARE the moat — no competitor has them
- The InariWatch cross-sell IS the moat — bundled monitoring at zero marginal cost

**Defensibility timeline:**
- Year 1: Lovable can't catch up on vertical specialization (they're horizontal)
- Year 2: Anthropic might launch competing product but won't match open-source AGPL distribution
- Year 3+: Defensibility shifts to community + InariWatch flywheel

---

## 10. Sources & Research

**Linear/Vercel/Stripe pattern research:**
- [Linear brand](https://linear.app/brand) / [redesign post](https://linear.app/now/how-we-redesigned-the-linear-ui)
- [Vercel Geist colors](https://vercel.com/geist/colors) / [typography](https://vercel.com/geist/typography)
- [Stripe gradient breakdown (Kevin Hufnagl)](https://kevinhufnagl.com/how-to-stripe-website-gradient-effect/)
- [Resend rebrand post](https://resend.com/blog/rebranding-resend)
- [Supabase design system](https://supabase.com/design-system)
- [Cal.com design](https://design.cal.com/basics/colors)
- [SaaSFrame 2026 trends](https://www.saasframe.io/blog/10-saas-landing-page-trends-for-2026-with-real-examples)
- [Why AI keeps building purple gradient sites (prg.sh)](https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website)

**Anthropic / Claude artifacts research:**
- [Anthropic frontend-design SKILL.md (open-sourced)](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)
- [Reverse engineering Claude Artifacts — Reid Barber](https://www.reidbarber.com/blog/reverse-engineering-claude-artifacts)
- [Why Anthropic's frontend-design Skill Just Works](https://medium.com/@ahmed.soliman/why-anthropics-frontend-design-skill-just-works-a-prompt-engineering-breakdown-72a1386df114)
- [Claude 4 system prompt — Simon Willison](https://simonwillison.net/2025/May/25/claude-4-system-prompt/)
- [Lost in the Middle — Liu et al.](https://cs.stanford.edu/~nfliu/papers/lost-in-the-middle.arxiv2023.pdf)

**Block library research:**
- [Tailark blocks (MIT)](https://tailark.com/) — primary source
- [shadcn/ui blocks](https://ui.shadcn.com/blocks)
- [Magic UI (MIT free)](https://magicui.design/)
- [Tailwind Plus license (forbids builders)](https://tailwindcss.com/plus/license)
- [Preline Fair Use clause](https://preline.co/docs/license.html)

**Competitive analysis:**
- [Particula: Lovable vs Bolt vs v0 — 2026](https://particula.tech/blog/lovable-vs-bolt-vs-v0-ai-app-builders)
- [Hostinger Horizons LLM routing](https://www.hostinger.com/blog/balancing-horizons-llms)
- [nexos.ai Hostinger case study](https://nexos.ai/blog/hostinger-horizons-use-case/)
- [Lovable $330M Series B](https://lovable.dev/blog/series-b)
- [Anthropic + Lovable production webinar](https://www.anthropic.com/webinars/production-ready-use-cases-lovable)
- [Vercel: v0 composite model family](https://vercel.com/blog/v0-composite-model-family)

---

## TL;DR for the founder

1. **Architecture:** 7-step pipeline (classify → plan → fill slots → images → assemble → gates → refine). NOT single-shot. Mirrors v0 / Hostinger Horizons proven patterns.
2. **The secret of Claude.ai artifacts:** two prompts compose — protocol wrapper + frontend-design Skill (open-sourced, ~42 lines). Steal the structure.
3. **Hardcoded constraints beat model improvement:** 5 design palettes pre-baked, ONE accent, ONE shadow, ONE radius, banned font/copy lists, design tokens that the AI MUST use.
4. **AI doesn't write JSX — it fills slot JSON.** 13 vendored blocks (Tailark MIT primary), AI picks IDs and fills schemas. Bug loops impossible.
5. **6 quality gates = your moat.** No competitor has them. Conversion + a11y + mobile + SEO + security + perf.
6. **Few-shot is the #1 lever for open-source models.** Build corpus of 9 hand-crafted reference HTMLs. Rotate 3 per call.
7. **Pro Plus tier escalates HTML to Claude Sonnet 4.5** for the last 10% of quality jump — sellable feature, not engineering hack.
8. **Wedge vs Lovable:** vertical specialization + conversion guarantees + InariWatch cross-sell. They can't match the last one for 2+ years.

Build this and you have a product that **consistently** ships Linear/Vercel-grade landing pages at 10× lower cost than Lovable, with structural defenses against the failure modes that hurt Lovable today.
