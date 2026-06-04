# OpenLen

> Beautiful landing pages. AI-built. Open source.
> Lovable quality. Your code. Your subdomain. $19 / month.

[![Live](https://img.shields.io/badge/Live-openlen.com-FF5A36)](https://openlen.com)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)
[![Quality: 4.8/5](https://img.shields.io/badge/Eval%20quality-4.8%2F5-brightgreen)](./EVAL_PHASE_2.md)
[![Cost: $0.13/gen](https://img.shields.io/badge/Avg%20cost-%240.13%2Fgen-brightgreen)](./EVAL_PHASE_2.md)

---

## What this is

OpenLen is an open-source AI landing page generator. Describe what you
want; we produce a complete, **conversion-validated** landing page in under
60 seconds — pure HTML + Tailwind, no platform lock-in, no npm install on
the output. Generated pages publish to `<your-name>.openlen.com` with one
click; you can also export the HTML and host it anywhere.

Try it live at [openlen.com](https://openlen.com). First user-published
landing: [inari.openlen.com](https://inari.openlen.com).

**Key differentiators:**

- **Quality gates built in.** Every output passes six validation gates
  (a11y · conversion · mobile · SEO + brief-fidelity · security · performance)
  before delivery. No other AI page builder does this.
- **Code you own.** Single HTML file + Tailwind via CDN. Deploy to Vercel,
  Netlify, Cloudflare, GitHub Pages, your own server — anywhere static
  hosting works.
- **10× cheaper than Lovable.** Smart routing across 7+ models on
  [Google Gemini](https://ai.google.dev) keeps real cost at **~$0.13/generation**
  (measured across 5 representative briefs — see [EVAL_PHASE_2.md](./EVAL_PHASE_2.md)).
- **Slot-filling architecture.** The AI picks block IDs from a curated 15-block
  library and fills slot JSON. Code assembles HTML deterministically. Bug
  loops (Lovable's #1 user complaint) are structurally impossible.
- **Open source from day one.** AGPL v3. Self-host, fork, modify.

## Quick start — hosted (when public)

Visit [openlen.com](https://openlen.com) → describe your landing →
your generated HTML downloads.

## Quick start — self-host

```bash
git clone https://github.com/orbita-pos/openlen
cd openlen
npm install
cp .env.local.example .env.local
# Add GEMINI_API_KEY, DATABASE_URL (Neon), NEXTAUTH_SECRET
# Or leave MOCK_MODE=1 for offline dev (no DB/API needed)
npm run dev
```

For self-hosted production deployment (Hetzner box + nginx wildcard +
Let's Encrypt + systemd), see [`infra/SETUP.md`](./infra/SETUP.md).

Then in another terminal:

```bash
curl -N -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -d '{"brief":"Landing page for FlowDeck, a Kanban tool for designers. Pricing: Free, Pro $29/mo, Team $99/mo."}'
```

The endpoint streams Server-Sent Events: `progress` events per pipeline step,
then a final `result` event with the HTML, CSS, image URLs, cost breakdown,
gate verdicts, and witness path.

## Environment variables

| Variable               | Default | Purpose                                                          |
|------------------------|---------|------------------------------------------------------------------|
| `GEMINI_API_KEY`       | _none_  | Required when `MOCK_MODE` is off. Get one at ai.google.dev.     |
| `MOCK_MODE`            | _off_   | Set to `1` to use canned responses (no API spend, no key needed). |
| `OPENLEN_DOMAIN`       | _none_  | Optional. Canonical URL used in generated meta tags.            |
| `INARIWATCH_DSN`       | _none_  | Optional. Error monitoring DSN; auto-local in dev when blank.    |

See [`.env.local.example`](./.env.local.example) for the full list.

## Architecture

```
brief
  ↓  classify           LFM2-24B-A2B          ($0.03 / $0.12 per M)
intent
  ↓  plan + factsLedger Kimi-K2.6             ($1.20 / $4.50)
plan + ledger
  ├─  fill (parallel)   Qwen3-235B-tput       ($0.20 / $0.60)  ← slot JSON only
  └─  images            FLUX.2-pro / -flex    ($0.03 / image)
filled blocks + images
  ↓  assemble (deterministic React SSR — NO LLM)
html
  ↓  6 quality gates    (parallel)
    a11y       (axe-core)
    conversion (Kimi K2.6 judge + banned-phrase regex)
    mobile     (360 px puppeteer + AI judge)
    seo+aeo    (cheerio + brief-fidelity regex)
    security   (regex + ESLint security rules)
    performance(cheerio bundle/lazy-load)
  ↓  refine (only if critical violations remain — max 2 attempts)
LandingPage { html, css, images, meta, cost, witnessPath, qualityGrade }
```

### Why this beats single-shot

- **Section-parallel** — fill + image generation overlap. Wall time ~42 s
  on a typical 6-block brief vs minutes for single-shot competitors.
- **Bug loops impossible** — there is no markup-generating model in the pipeline.
  The AI never writes JSX or HTML. Lovable's #1 user complaint
  ("the AI keeps breaking my page") can't happen here by construction.
- **Per-section iteration** — `/api/regenerate-section` re-runs the fill step
  for one block, splices it back in, re-assembles. ~$0.001 per regeneration.
- **Cheap models do 90 % of the work** — expensive models gate only the
  critical paths.

## Quality gates — the open lane

None of the major AI page builders (Lovable, Bolt, v0, Framer AI, Webflow AI)
ship explicit gates. They rely on implicit model quality. OpenLen enforces:

1. **A11y** — axe-core: alt text, labels, WCAG AA contrast, heading hierarchy
2. **Conversion** — banned-phrase regex + AI judge for primary CTA / hero
   outcome language / placeholder detection
3. **Mobile** — 360 px Puppeteer snapshot, no horizontal scroll, tap targets ≥ 44 px
4. **SEO + AEO + brief-fidelity** — single H1, meta description, OG tags,
   schema.org JSON-LD, brief fact preservation (prices, dates, named people)
5. **Security** — 19 regex patterns + 17 ESLint security rules
6. **Performance** — bundle size budget, lazy-load enforcement

Pages that fail critical violations get one targeted refine pass. If they
still fail, they ship with `qualityGrade: needs_review` — no surprises.

See [INARI_DESIGN_ENGINE.md § 6](./INARI_DESIGN_ENGINE.md) for the full design.

## Project layout

```
inari-pages/
├── app/
│   ├── api/generate/route.ts        # POST endpoint (SSE streaming)
│   ├── api/regenerate-section/      # one-block regen endpoint
│   ├── layout.tsx
│   └── page.tsx                     # marketing landing
├── components/marketing/            # marketing site components
├── lib/
│   ├── orchestrator/
│   │   ├── index.ts                 # generateLandingPage() main
│   │   ├── classify.ts plan.ts fill.ts images.ts assemble.tsx refine.ts
│   │   ├── routing.ts               # central routing table + fallbacks
│   │   ├── master-prompt.ts         # high-level system prompt
│   │   ├── design-tokens.ts         # 5 palettes (mono-dark, indigo, emerald, ...)
│   │   ├── few-shots/               # hand-crafted reference HTMLs
│   │   └── types.ts                 # Zod schemas + TS types
│   ├── blocks/                      # 15 vendored Tailark/Magic UI/shadcn blocks
│   │   ├── hero/      features/     pricing/     testimonials/
│   │   ├── faq/       cta/          footer/
│   │   ├── _registry.ts             # block ID → component map
│   │   └── types.ts
│   ├── gates/                       # 6 quality gates
│   │   ├── a11y.ts conversion.ts mobile.ts seo.ts security.ts performance.ts
│   │   ├── brief-fidelity.ts        # brief fact verification
│   │   └── _browser.ts              # shared puppeteer instance
│   ├── together/                    # SDK wrapper + pricing + mock dispatch
│   ├── witness/                     # JSONL audit trail per generation
│   └── budget.ts                    # cost cap + per-step accounting
├── evals/                           # eval harness + per-brief outputs
├── LICENSES/                        # vendored block-library MIT licenses
└── LICENSE                          # AGPL-3.0 (this repo's code)
```

## Eval

Five representative briefs run end-to-end against real Gemini calls.
Per-brief outputs, witness JSONL, cost breakdowns, and honest scoring live
in [`evals/`](./evals/) and [`EVAL_PHASE_2.md`](./EVAL_PHASE_2.md):

| Brief                | Quality | Cost      | Wall    | Refines |
|----------------------|---------|-----------|---------|---------|
| 01-saas-launch       | 4.5 / 5 | $0.0812   | 50.1 s  | 0       |
| 02-portfolio         | 5 / 5   | $0.1376   | 41.6 s  | 0       |
| 03-event-conference  | 5 / 5   | $0.0522   | 44.9 s  | 0       |
| 04-ecommerce         | 5 / 5   | $0.2201   | 44.3 s  | 0       |
| 05-agency            | 4.5 / 5 | $0.1382   | 29.0 s  | 0       |

**Averages:** $0.126/gen · 42.0 s · 4.8/5 quality · 100 % gates pass first try.

To re-run:

```bash
MOCK_MODE=1 npm run eval        # offline pass against mocks
GEMINI_API_KEY=… npm run eval # real run, ~$0.50–1.40 total
```

## Witness recordings

Every generation writes a JSONL audit trail to `recordings/<generationId>.jsonl`.
Each line is a fully-typed `WitnessRecord`:

```json
{"ts":"2026-05-15T18:42:11.213Z","generationId":"...","step":"classify",
 "decision":{"model":"lfm2-24b-a2b","reason":"Cheap classifier — small structured I/O.","isFallback":false,"fallbackChain":[]},
 "inputTokens":78,"outputTokens":52,"latencyMs":98,"costUsd":0.0000086,"mocked":false}
```

These are the audit trail for any output — open the path referenced by
`page.witnessPath` and you see exactly which model produced what, why, at
what cost, and on which fallback.

## Roadmap

### Shipped

- **Sessions 1–7** — slot-filling pipeline + 6 quality gates + 5-brief eval (4.8/5 avg, $0.126/gen)
- **Session 8** — sidebar slot editor (non-devs edit generated copy without prompting)
- **Session 9** — image upload + cropping for hero/decorative slots
- **Sessions 10 + 10.5** — Hetzner self-host deploy (nginx wildcard + Let's Encrypt wildcard cert + systemd + Kamal-less). Live at [openlen.com](https://openlen.com).
- **Session 11** — per-user subdomain publish flow. Click "Publish" → page lives at `<sub>.openlen.com` via atomic filesystem write + nginx wildcard. First user page: [inari.openlen.com](https://inari.openlen.com).
- **Session 12** — in-iframe WYSIWYG text editing. Click any text in the preview, type, hit Enter — instant update, sidebar reflects, debounced reassemble persists to DB.

### In progress (V3 pivot)

Architecture research ([`RESEARCH_FINDINGS.md`](./RESEARCH_FINDINGS.md))
identified that the catalog approach has a ceiling. V3 pivots to:

- **Curated design system** (8 backgrounds + 20 palettes + 6 typography systems + 5 layout primitives) hand-tuned in claude.ai
- **AI runtime composes from menu** (Gemini planner + writer, single Google Gemini vendor, ~$0.015/gen — 8× cheaper than V1)
- **Visual design knobs in the workspace** — click thumbnails to swap bg/palette/typography/density/radius/decoration instantly. Zero AI call per knob change.
- **No more AI image gen** — replaced with Unsplash API + SVG decoration primitives + user uploads. Editorial photo quality, no FLUX cost or hallucinations.

See [`V3_AUDIT.md`](./V3_AUDIT.md) for the file-by-file pivot plan,
[`SESSION_13_PROMPT.md`](./SESSION_13_PROMPT.md) and
[`SESSION_14_PROMPT.md`](./SESSION_14_PROMPT.md) for the implementation
sessions. Both pipelines coexist behind feature flag `OPENLEN_PIPELINE_V3`
during the rollout window.

### After V3

- Custom domains (CNAME `mydomain.com` → openlen.com via dynamic certbot)
- Multi-page support (linked landings, shared design system)
- Per-tier image upload caps (free 5/page, pro unlimited)
- Stripe billing
- Show HN launch

## Contributing

PRs welcome. AGPL v3 means your modifications stay open-source — including
hosted modifications (the "network use" clause is the whole point of
AGPL over GPL). By submitting code you agree to license it under the same
terms.

Issues for bug reports, feature requests, and brief-fidelity false-positives
all go to [github.com/orbita-pos/openlen/issues](https://github.com/orbita-pos/openlen/issues).

## License

[AGPL-3.0-only](./LICENSE) for the codebase. Vendored block libraries
([Tailark](https://tailark.com/), [shadcn/ui](https://ui.shadcn.com/),
[Magic UI](https://magicui.design/), [HyperUI](https://www.hyperui.dev/)) keep
their original MIT licenses — see [`LICENSES/`](./LICENSES/).
