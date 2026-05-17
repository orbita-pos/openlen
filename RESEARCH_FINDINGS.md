# OpenLen Architecture Research — Findings (May 2026)

Full research output from background investigation. Source: deep-research agent
with web search across model leaderboards, v0/Lovable/Bolt/Claude Artifacts
public technical posts, CSS technique guides from Linear/Stripe/Vercel
references, and current model pricing.

---

## Top 5 strong recommendations

1. **Switch primary model: Qwen3-235B → Claude Sonnet 4.6 (writer) + Kimi K2.6 (planner) + Opus 4.7 (premium fallback).** Qwen is the single biggest contributor to "feels templated." Sonnet leads WebDev Arena ELO 1148, Opus 4.7 leads at 1569. Gemini 3.1 Pro is the dark-horse alternative ($2/$12 vs $3/$15 Sonnet, BenchLM 91/100). GPT-5.5 has no quality lead, double price — skip.

2. **Architecture: TWO-stage hybrid orchestrator** — NOT catalog, NOT pure single-shot.
   - Stage 1 (planner, Kimi K2.6, ~$0.002): emits a `DesignSystem` JSON (brandHue, typography family/scale/tracking, decoration choice, layout type, section list, personality).
   - Stage 2 (writer, Sonnet 4.6, ~$0.075): one call emits the entire page as TSX, conditioned on the DesignSystem + 5 layout primitives + cached system prompt.
   - Plus streaming autofixer (v0 pattern) — Tailwind class lint + contrast check + Unsplash refs while model streams. No LLM in this layer.

3. **Kill the 15-block catalog. Replace with 5 LAYOUT PRIMITIVES.** `<Hero>`, `<Stack>`, `<Split>`, `<Grid>`, `<CTA>`. Typed slot bags. The model controls layout via these + design tokens. Catalog approach was wrong abstraction level — it freezes too much, prevents the model from moving dividers, breaking grids, picking tracking values. Primitives give the model leverage; blocks remove it.

4. **Kill ALL AI image generation. Replace with:**
   - Unsplash API (free tier, 50 req/h dev, 5000/h production; attribution + UTM required)
   - 5 hand-tuned SVG decoration primitives (mesh+grain, conic-sweep, halftone, blob, minimal)
   - CSS mesh gradients + noise overlay
   - User uploads as before
   This is the #1 contributor to "feels designed" — FLUX outputs "scream AI-generated stock" because they have neither editorial intent nor product specificity. Linear, Stripe, Vercel, Resend, Neon use ZERO AI imagery.

5. **Cost lands at ~$0.077/gen** (cheaper than current $0.13) with Anthropic prompt caching. Latency ~5s first paint vs current 42s (3x faster). Quality ceiling lifts to claude.ai-tier.

---

## Model leaderboard for design (May 2026)

| Rank | Model | $/M in | $/M out | Best for | Evidence |
|------|-------|--------|---------|----------|----------|
| 1 | **Claude Opus 4.7** (thinking) | $5 (90% cache) | $25 | Hero pages, premium tier, single-shot artifacts | WebDev Arena 1569 ELO #1 React/HTML |
| 2 | **Claude Sonnet 4.6** | ~$3 | ~$15 | **Default writer** — best $/quality | WebDev Arena 1148. Base of v0-1.5-md. |
| 3 | **Gemini 3.1 Pro** | $2 (≤200k) / $4 | $12 / $18 | Cost-sensitive fallback, very long context | BenchLM 91.0/100 #1 overall |
| 4 | **GPT-5.5** | $5 | $30 | **Avoid for design** — no quality lead, double price |
| 5 | **Kimi K2.6** | $0.60 | $2.50 | **Planner role only** — UI eval is mid | DeepLearning.ai: 80.2% SWE-bench |
| 6 | Qwen3-Coder-480B | $0.50 | $1.20 | **Reject for design** — your current bottleneck | 38.7% SWE-Bench-Pro |
| 7 | DeepSeek V4 Pro | $2.10 | $4.40 | Server logic, not design | 89/100 coding, weak aesthetic |

**Verdict:** Qwen3-235B-Instruct on the writer call IS the issue. Produces *correct* JSX; Claude Sonnet produces *intentional* JSX. The difference is spacing decisions, color stop choices, where to put a divider, when to break the grid. Cannot be patched with prompts at the Qwen level.

---

## How best products actually work

### v0 (Vercel) — public docs
- Composite model: **RAG over docs/examples** + frontier base (Claude Sonnet 4) + **`vercel-autofixer-01`** (Fireworks-fine-tuned correction model that runs streaming, catches errors AS they emit, repairs in flight)
- 93.87% error-free generations
- Autofix 10-40× faster than post-hoc fixers
- React + Tailwind + shadcn/ui only

### Claude.ai Artifacts (leaked system prompt, March 2026)
- Single-file artifact constraint forces whole-page thinking — no compositional seams
- Quality driven by base model + tight system-prompt scaffolding (not autofix layer)
- This is why claude.ai "feels designed" — no compositional seams

### Lovable.dev
- Vite + React + Tailwind + Supabase, Plan Mode (Feb 2026)
- **Known anti-pattern:** over-engineers small pages (one user: 90 files + 67 deps for a landing that Claude Code did in 4 files + 100/100 PageSpeed)
- Don't copy

### Bolt.new
- WebContainers + multi-model routing (Sonnet for quality, Gemini Flash for speed)
- Worth copying: model-routing per task

### Shared pattern from winners
1. Tight system prompt with explicit design constraints
2. Modern strongly-typed base model (Claude/Sonnet, not Qwen)
3. Tailwind + fixed component library (shadcn/ui) to constrain output space
4. Streaming + autofix layer
5. Single-file artifact rather than multi-block assembly

---

## Beautiful-without-images: concrete CSS patterns

### Background decoration (replaces hero images)

| Technique | CSS | Used by |
|---|---|---|
| Mesh gradient + grain | 3-5 stacked `radial-gradient`s + `feTurbulence` overlay at 0.06 opacity | Linear, Stripe, Vercel, Resend |
| Conic gradient sweep | `conic-gradient(from var(--angle))` + `@property --angle` animated | linear.app hero, supabase |
| Halftone dot grid | SVG `<pattern>` circles 24px, mask-image radial fade | GitHub Universe, Cal.com |
| Single mesh + product mockup | Mesh as above + product screenshot with `box-shadow: 0 80px 200px -40px rgba(brand,0.3)` + `transform: rotateX(8deg)` | Stripe, Linear, Vercel |
| CSS grain only | Solid bg + SVG turbulence at 4-8% opacity (~0.4KB) | Resend, Cal.com |

### Typography
- **Variable Inter** + 3-5 weights + huge leading rhythm = Linear/Vercel/Resend pattern
- **Modular scale 1.2-1.333**, 6 sizes max across page
- **ONE intentional rule-break**: tracking outlier (display -0.04em, body +0.005em) OR weight outlier OR size outlier — three rule-breaks = mess, one = signature
- `font-optical-sizing: auto` + variable font `opsz` axis — cheapest "designed" cue LLMs forget
- Webflow 2026 State of Web: **41% of high-conversion sites use single family + two weights**

### Color
- One brand hue + one accent (60-90° on wheel) — never more
- OKLCH neutrals not HSL greys (Linear, Vercel migrated 2025)
- **60-30-10 distribution**: ~60% surface, ~30% foreground, ~10% accent
- Suggested token shape:
  ```css
  @theme {
    --color-bg: oklch(98% 0.005 var(--brand-hue));
    --color-fg: oklch(15% 0.01 var(--brand-hue));
    --color-brand: oklch(58% 0.22 var(--brand-hue));
    --color-accent: oklch(75% 0.18 calc(var(--brand-hue) + 60));
  }
  ```
  LLM emits just `--brand-hue` (single number 0-360), rest is math.

### Motion (cheapest "designed" signals)
1. `@property --angle` animated conic gradient — Stripe/Linear shimmer for 12 lines, 0 JS
2. CSS `view-timeline` scroll-driven animations — no IntersectionObserver
3. `transition-timing-function: cubic-bezier(0.22, 1, 0.36, 1)` — Apple/Vercel curve; default `ease`/`ease-out` is the cheap-page giveaway

---

## Architecture recommendation — concrete sketch

```
Brief
  │
  ▼
[Stage 1: Planner — Kimi K2.6, ~$0.002/run]
  emits DesignSystem JSON:
    {
      brandHue: 245,
      typography: { family: "Inter", scale: "1.25", display_tracking: "-0.04em" },
      decoration: "mesh-grain" | "conic-sweep" | "halftone" | "minimal",
      layout: "centered-marquee" | "split-asym" | "stacked-narrative" | "editorial-grid",
      personality: "technical-confident" | "playful-warm" | "luxury-spare",
      sections: ["hero","social-proof","features-split","testimonials","pricing","faq","cta"]
    }
  │
  ▼
[Stage 2: Writer — Claude Sonnet 4.6, ~$0.075/run with caching]
  Single call. Inputs:
    - DesignSystem JSON
    - Brief text
    - CACHED system prompt (4KB layout primitives + Tailwind constraints)
    - CACHED design-token CSS preamble
  Emits ONE TSX file using 5 layout primitives.
  │
  ▼
[Streaming Autofixer — deterministic, no LLM]
  Runs while Sonnet streams:
    - Tailwind class lint
    - A11y contrast check on emitted color pairs
    - Image refs: rewrite Unsplash placeholders
    - SVG decoration injection
  │
  ▼
[Quality gates: existing 6, kept]
  │
  ▼
HTML output via renderToStaticMarkup
```

### Cost breakdown

| Stage | Model | In | Out | $/run |
|---|---|---|---|---|
| Planner | Kimi K2.6 | 1500 | 400 | $0.0019 |
| Writer | Sonnet 4.6 | 4000 (3500 cached) | 4500 | ~$0.075 |
| Autofix | none | — | — | $0 |
| Unsplash | API free tier | — | — | $0 |
| **Total** | | | | **~$0.077** |

vs OpenLen current ~$0.13. Cheaper AND better.

Premium tier (Opus 4.7 writer): ~$0.20/run. Under $0.50 ceiling.

---

## 3-week migration plan

### Week 1: Kill image gen, swap models, ship planner
- D1-2: Delete FLUX.2 calls. Add Unsplash service (with attribution + UTM). Add `svgDecoration` service (5 SVG primitives).
- D3-4: Add Claude Sonnet 4.6 to provider router. Wire prompt caching (need ≥4096 tokens; combine system + layout primitives doc into one cached block).
- D5: Build Stage 1 Planner (Kimi K2.6 single call → validated DesignSystem JSON via Zod).

### Week 2: Replace catalog with primitives
- D6-8: Build 5 layout primitives: `<Hero>`, `<Stack>`, `<Split>`, `<Grid>`, `<CTA>`. Typed slot bags. Tailwind only. No business logic.
- D9-10: Build Stage 2 Writer prompt. Show model the 5 primitives as TS types (not JSX examples — overfit risk). DesignSystem JSON inline. Single-file output. 3 contrasting exemplars in cached preamble.
- **DELETE the 15 hand-crafted React blocks.** Keep eval set as inspiration source.

### Week 3: Autofix, WYSIWYG, ship
- D11-12: Streaming autofix layer. Tailwind v4 class validator (via `@tailwindcss/postcss`). Contrast check (OKLCH math is cheap). Unsplash placeholder rewriting. SVG decoration injection. Pure TS, parallel to stream, 0 latency cost.
- D13-15: WYSIWYG on primitives (much easier than on arbitrary HTML — each primitive has named slots). Click text → contenteditable. Click media → upload/Unsplash modal. Click section → swap primitive (LLM regens one section using same DesignSystem).
- D16-21: Quality gates verified. Eval re-run on expanded ~25-brief corpus across 3 personality axes × 2 layout axes, with Opus 4.7 as judge on 7-axis rubric. Must beat 4.8/5 average or abort. Ship behind `OPENLEN_PIPELINE_V2=true`. Run both pipelines 2 days. Cut over.

### Files most likely to change
- `app/api/generate/route.ts` — new orchestrator entry
- `lib/orchestrator/{planner,writer,autofix}.ts` — new
- `components/primitives/*.tsx` — new (5 files)
- `lib/blocks/*` — **DELETE** (15 files)
- `lib/storage/image.ts` — replace FLUX with Unsplash + SVG
- `lib/ai/prompts.ts` — full rewrite

---

## The 3-5 things that make a page feel hand-designed

1. **Typography hierarchy with ONE intentional rule-break.** One variable family, 6 sizes max, ratio 1.2-1.333. One outlier: tracking OR weight OR size. Three outliers = mess, one = signature.
2. **Rhythmic spacing with ONE breathing moment.** 8pt vertical rhythm. One section gets ~50% more vertical breathing room — "hero gravity" trick from Linear.
3. **One decorative idea executed with conviction.** Mesh OR noise OR conic OR blob — never all four. Cohesion = cheapest premium signal.
4. **Asymmetric layout.** 12-col grid. Never 6/6 or 4/4/4 for hero. Use 7/5, 8/4, 5/7. Asymmetry alone exits "Bootstrap-y" territory.
5. **60-30-10 color distribution.** Accent reserved for ONE thing per section max (CTA button OR underline OR mesh). Templated pages distribute accent uniformly.

---

## Pushbacks on the original brief constraints

1. **"Catalog of 15 blocks"** — wrong abstraction. Model wants primitives, not blocks. Recommend killing catalog entirely.
2. **"Together AI relationship exists"** — keep for Kimi (planner) and open-source fallbacks. Go Anthropic direct for Sonnet (writer).
3. **"Inline WYSIWYG editing must work"** — EASIER with primitives than blocks. Each primitive is typed component with named slots; editor renders outline of primitives.
4. **"Quality gates must remain enforceable"** — gates become MORE enforceable in v2 because autofix layer runs gates WHILE model streams (fail contrast in 200ms, patch cheaply).
5. **"4.8/5 on 5-brief eval"** — too small. After migration, expand to ~25 briefs across 3 personality × 2 layout axes with Opus 4.7 as 7-axis judge.
6. **"Drop AI image gen"** — agreed. Non-AI alternatives beat FLUX on aesthetic quality, not just price. Rare quality+cost win.

---

## Key sources

- benchlm.ai/best/frontend-app-dev (model rankings)
- arena.ai/leaderboard/code + web.lmarena.ai/leaderboard (WebDev Arena)
- vercel.com/blog/v0-composite-model-family
- vercel.com/blog/how-we-made-v0-an-effective-coding-agent
- fireworks.ai/blog/vercel (autofixer architecture)
- kevinhufnagl.com/how-to-stripe-website-gradient-effect (Stripe gradient technique)
- css-tricks.com/grainy-gradients
- platform.claude.com/docs/en/build-with-claude/prompt-caching
- platform.claude.com/docs/en/about-claude/pricing
- unsplash.com/documentation
- deeplearning.ai/the-batch (Kimi K2.6 benchmark)
- apidog.com/blog/gemini-3-0-api-cost
