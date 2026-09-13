# OpenLen

> Beautiful landing pages. AI-built. Open source.
> Lovable quality. Your code. Your subdomain.

[![Live](https://img.shields.io/badge/Live-openlen.com-FF5A36)](https://openlen.com)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](./LICENSE)
[![Quality: 4.8/5](https://img.shields.io/badge/Eval%20quality-4.8%2F5-brightgreen)](./EVAL_PHASE_2.md)
[![Cost: $0.01/gen](https://img.shields.io/badge/Avg%20cost-%240.01%2Fgen-brightgreen)](./lib/credits.ts)

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

- **The generator looks at its own work.** Every document is normalized on the
  way in (`lib/normalize.ts`), rendered in headless Chromium and inspected —
  broken layout and unreadable contrast are measured on the real render, not
  guessed from the source — then sanitized and CSP-sealed on the way out.
- **Code you own.** Single HTML file + Tailwind via CDN. Deploy to Vercel,
  Netlify, Cloudflare, GitHub Pages, your own server — anywhere static
  hosting works.
- **A page costs about a cent.** Everything runs on
  [Fireworks](https://fireworks.ai); which model plays which role lives in one
  table ([`lib/generation/model-policy.ts`](./lib/generation/model-policy.ts)),
  never in prose that goes stale. At the rates in
  [`lib/credits.ts`](./lib/credits.ts) a typical page (~22k tokens in, ~9k out)
  is **~$0.011** of model cost.
- **Free-form, then repaired.** The model writes a complete HTML document
  instead of filling slots in a template — that is where the visual quality
  comes from. Later edits are surgical ops against the document that exists,
  so changing one section does not rewrite the page around it.
- **Open source from day one.** AGPL v3. Self-host, fork, modify.

## Quick start — hosted (when public)

Visit [openlen.com](https://openlen.com) → describe your landing →
your generated HTML downloads.

## Quick start — self-host

```bash
git clone https://github.com/orbita-pos/openlen
cd openlen
npm install
# Create .env.local with at least:
#   FIREWORKS_API_KEY  — the only credential generation needs
#   DATABASE_URL       — any Postgres (a local one is fine)
#   NEXTAUTH_SECRET    — openssl rand -base64 32
# Optional: OPENAI_API_KEY, used only by AI image editing.
# Full annotated list: infra/app/env.example
npm run dev
```

For self-hosted production deployment (Hetzner box + Caddy wildcard +
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
| `FIREWORKS_API_KEY`    | _none_  | **Required.** Every AI surface runs on Fireworks.                 |
| `OPENAI_API_KEY`       | _none_  | Optional. Instruction-based image editing only (gpt-image-2).    |
| `OPENLEN_DOMAIN`       | _none_  | Optional. Canonical URL used in generated meta tags.            |
| `INARIWATCH_DSN`       | _none_  | Optional. Error monitoring DSN; auto-local in dev when blank.    |

See [`infra/app/env.example`](./infra/app/env.example) for the full annotated list.

## Architecture

One model writes the whole document. There is no slot-filling, no section
assembler, no template engine — the page you get is the page the model wrote,
and that is where the visual quality comes from.

```
brief  (+ an optional reference image)
  ↓
  one write call ─────────── a complete HTML document, streamed to the
                             browser over SSE as it is written
  ↓
  measured in a real browser (Chromium — no model, no credit)
      contrast      read off the pixel, not deduced from CSS
      mobile        390 px overflow
      runtime       what the page's own JavaScript throws on load
  ↓
  told to the user, never silently "fixed"
  ↓
publish  ──────────────────  a release tree on disk, served straight by
                             Caddy: index.html, one per translated locale,
                             one per site page, sitemap, robots — swapped
                             in atomically
```

Which model plays which role is one table
([`lib/generation/model-policy.ts`](./lib/generation/model-policy.ts)).
Surfaces name the **work** — `page_edit`, `agent_turn`,
`agent_visual_verify` — and the table picks the model and how hard it thinks.
That is the only place a model name appears, so changing provider is editing a
table.

### Why this shape

- **The model's code is the code.** Whatever it writes ships. We do not rewrite
  its markup behind its back: the measurements above are *reported*, not
  applied. Correcting the page is the user's call, and the automatic repair
  pass was removed on purpose — it worked, and it was still the wrong owner.
- **The published document is static.** No React runtime and no Node in the
  render path. The page *interacts* with the server — form posts, the analytics
  beacon, chat — but it *renders* without it.
- **Measured, not judged.** Having one model grade another model's taste was
  tried and dropped. What survives is what a browser can prove: a contrast
  ratio, an overflow, an exception.

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
│   ├── [locale]/                    # EVERY user-facing route (next-intl, 10 locales)
│   │   ├── new/                     # the workspace: brief → edit → publish
│   │   ├── projects/ explore/ business/ templates/
│   │   └── page.tsx                 # marketing landing
│   ├── api/
│   │   ├── generate/                # POST — free-form generation (SSE)
│   │   ├── agent/                   # POST — the Agent (Len), a tool-calling loop
│   │   ├── templates/ai-design/     # POST — conversational editing
│   │   └── projects/[id]/publish/   # POST/DELETE — claim subdomain + write release
│   ├── c/                           # analytics beacon (outside the locale segment)
│   ├── p/                           # preview links
│   └── served/                      # custom domains
├── components/
│   ├── workspace-v2/                # the workspace UI — rail, panels, canvas
│   ├── marketing/                   # the public site
│   └── ui/                          # shared primitives
├── lib/
│   ├── ai/                          # provider clients (Fireworks) + image editing
│   ├── agent/                       # Len: loop, brain, tool catalog, and the eyes
│   ├── page-engine/                 # one pipeline: prepare → apply edits → persist
│   ├── publish/                     # release tree + atomic swap onto disk
│   ├── templates/                   # template store (Postgres + object storage)
│   ├── db/                          # Drizzle schema + driver selection
│   ├── normalize.ts                 # born-canonical ingestion — every path runs it
│   └── credits.ts                   # per-token credit accounting + provider rates
├── crates/                          # Rust: html-engine, images, rate-limit, edge
├── templates/starter/               # 3 starter templates seeded into the DB
├── infra/                           # Hetzner: Caddy, systemd units, runbooks
├── LICENSES/                        # MIT notices kept from vendored UI sources
└── LICENSE                          # AGPL-3.0 (this repo's code)
```

## Eval

> **Historical — Phase 2 (2026).** The table below was measured against the
> block-assembly pipeline and Gemini, and BOTH are gone: generation is
> free-form and runs on Fireworks. Kept as a record of what was measured
> then, not as a claim about the generator today.

Five representative briefs run end-to-end. The scoring that survives is in
[`EVAL_PHASE_2.md`](./EVAL_PHASE_2.md); the `evals/` directory it was produced
from is gone. Today's harnesses are `npm run evals:pages` and
`npm run evals:agent`:

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
npm run evals:pages   # page generation — spends real money
npm run evals:agent   # the Agent (Len)
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
