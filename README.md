# inari-pages

Open-source landing-page generator with **smart multi-model routing** on
[Together AI](https://together.ai). Output is yours — download the zip, deploy
where you like, modify whatever you want.

> Status: **Phase 1 — orchestrator backend (mock mode).** The pipeline runs
> end-to-end with no API spend; the UI lives in a separate workstream and will
> be wired up in Phase 3.

---

## Why this exists

Closed-source landing-page tools (Lovable, Bolt, v0, Framer AI) hardcode a
single foundation model for every subtask, then mark up the output 5–10×. This
project does the opposite:

- **Smart routing per subtask.** Classify a brief on a $0.03/M token classifier,
  plan sections on Kimi, generate code on Qwen3-Coder, render images on FLUX.2.
  Each model does what it's best at.
- **Open source from day 1.** AGPL v3. The orchestrator, prompts, routing
  table, and witness recordings are all in this repo.
- **You own the output.** Generated pages are vanilla HTML/CSS — no proprietary
  runtime, no lock-in.

---

## Quickstart

```bash
npm install
cp .env.local.example .env.local
# MOCK_MODE=1 is the default — no API key needed for local dev
npm run dev
```

Then in another terminal:

```bash
curl -N -X POST http://localhost:3000/api/generate \
  -H "Content-Type: application/json" \
  -d '{"brief":"Landing page for FlowDeck, a Kanban tool for designers"}'
```

You'll see a stream of `data: {...}` SSE events: `progress` for each pipeline
step, then a final `result` event carrying the generated HTML, CSS, image URLs,
cost breakdown, and witness path.

## Environment variables

| Variable           | Default | Purpose                                                        |
|--------------------|---------|----------------------------------------------------------------|
| `MOCK_MODE`        | `1`     | Use canned mock responses instead of hitting Together AI.      |
| `TOGETHER_API_KEY` | _none_  | Required when `MOCK_MODE=0`. Get one at together.ai.           |
| `INARIWATCH_DSN`   | _none_  | Optional. Error monitoring DSN; auto-local in dev when blank.  |

---

## Architecture

```
brief
  ↓ classify     (lfm2-24b-a2b — $0.03 / $0.12 per 1M tokens)
intent
  ↓ plan         (Kimi-K2.6 — adaptive fast-path for simple briefs)
plan
  ├─ generateCopy(plan)        (Kimi-K2.6 — parallel with image batch)
  └─ generateImages(prompts)   (FLUX.2 hero + Wan 2.6 decorative)
copy + images
  ↓ generateHtml (Qwen3-Coder-Next-FP8 — fallback to DeepSeek V4 Pro on bad output)
html
  ↓ assemble
LandingPage { html, css, images, meta, cost, witness }
```

Eleven principles drive the design:

1. **Smart routing per subtask** — central table in
   [`lib/orchestrator/routing.ts`](./lib/orchestrator/routing.ts).
2. **Parallel execution** — copy + images + HTML all overlap where
   dependencies allow.
3. **Streaming progress** — Server-Sent Events from `/api/generate` so the UI
   never goes 60 seconds without feedback.
4. **Detailed cost tracking** — every call's token usage is priced via
   [`lib/together/models.ts`](./lib/together/models.ts) and rolled into the
   `cost` field of the response.
5. **Witness recording** — each routing decision (model, reason,
   input/output tokens, latency) is appended to `recordings/<id>.jsonl`.
   This is the explainability moat.
6. **Fallback chains** — Qwen3-Coder bad output → DeepSeek V4 Pro hard fix.
   Configured per step in the routing table.
7. **Prompt caching** — system prompts marked `cache: true` ride Together
   AI's ephemeral cache.
8. **Adaptive routing** — short, low-complexity briefs skip the Kimi
   planning step and use the cheap classifier instead.
9. **Quality gates** — HTML well-formedness check between steps; missing
   sections trigger a fallback retry.
10. **Budget guard** — pass `maxBudget: 0.50` in the request body to cap
    spend; the orchestrator aborts cleanly if it would exceed.
11. **Mock-first development** — `MOCK_MODE=1` runs the full pipeline against
    canned responses so you can iterate without burning credits.

---

## Project layout

```
inari-pages/
├── app/
│   ├── api/generate/route.ts    # POST endpoint (SSE streaming)
│   ├── layout.tsx
│   └── page.tsx                 # placeholder; UI ships in Phase 3
├── lib/
│   ├── orchestrator/
│   │   ├── index.ts             # generateLandingPage() main
│   │   ├── classify.ts plan.ts copy.ts html.ts images.ts assemble.ts
│   │   ├── routing.ts           # central routing table + fallbacks
│   │   ├── types.ts             # Zod schemas + TS types
│   │   └── _shared.ts           # runTextStep helper, progress emitter
│   ├── together/
│   │   ├── client.ts            # SDK wrapper (real + mock dispatch)
│   │   ├── models.ts            # model IDs + pricing
│   │   └── mock.ts              # canned responses for MOCK_MODE
│   ├── witness/
│   │   ├── recorder.ts          # JSONL append per generation
│   │   └── types.ts
│   └── budget.ts                # cost accumulation + cap guard
├── recordings/                  # gitignored — witness output
└── ...
```

---

## Witness recordings

Every generation writes a JSONL file at `recordings/<generationId>.jsonl`. Each
line is a fully-typed `WitnessRecord`:

```json
{"ts":"2026-05-15T18:42:11.213Z","generationId":"...","step":"classify","decision":{"model":"lfm2-24b-a2b","reason":"Cheap classifier — input/output structure is small and well-typed.","isFallback":false,"fallbackChain":[]},"inputTokens":78,"outputTokens":52,"latencyMs":98,"costUsd":0.0000086,"mocked":true}
```

These are the audit trail for any output — open the file referenced by
`page.witnessPath` in the response and you can see exactly which model was
chosen for which step and why.

---

## Phase roadmap

- **Phase 1 (this commit)**: orchestrator + mocks + witness + budget +
  streaming endpoint.
- **Phase 2**: flip `MOCK_MODE=0`, refine prompts per step, measure real
  costs, tune routing thresholds.
- **Phase 3**: integrate UI shipped from the design workstream.
- **Phase 4**: hosted free tier + deploy automation + Stripe.

---

## Contributing

This repository is licensed under **AGPL v3** ([`LICENSE`](./LICENSE)). The
short version for contributors:

- You can use, modify, and redistribute this code.
- If you run a modified version as a network service (e.g. host your own
  landing-page generator), you must publish your source.
- Pull requests welcome. By submitting code you agree to license it under the
  same terms.

---

## License

[AGPL-3.0-or-later](./LICENSE). Copyright the inari-pages contributors.
