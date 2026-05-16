# Show HN: OpenLen — Open-source AI landing page generator with quality gates

Hi HN,

I built OpenLen because every AI landing page generator I tried
(Lovable, Bolt, v0, Framer AI) produces something that *looks* OK in a demo
but fails when you actually inspect it: missing alt text, broken contrast,
"world-class" generic copy, mobile horizontal scroll, no schema.org markup,
hero says "Three partners. 14 years." and the about section says "Three
people. Six years." on the same generated page.

OpenLen does something none of the major ones do: every output passes
**6 quality gates before delivery**.

- **a11y** — axe-core: alt text, labels, WCAG AA contrast, heading hierarchy
- **conversion** — banned-phrase regex + Kimi K2.6 AI judge for primary CTA,
  hero outcome language, placeholder detection
- **mobile** — 360 px Puppeteer snapshot, no horizontal scroll, tap targets ≥ 44 px
- **SEO + AEO + brief-fidelity** — single H1, meta description, OG tags,
  schema.org JSON-LD, *and* regex check that brief facts (prices, dates,
  named people) appear verbatim in the rendered HTML
- **security** — 19 regex patterns + 17 ESLint security rules
- **performance** — bundle size budget, lazy-load enforcement

If a gate finds critical violations, the pipeline refines specifically the
offending block. If it can't fix it in 2 attempts, the output ships with a
`qualityGrade: needs_review` flag — no surprises, no silent failures.

## Why this works

The pipeline is structurally different from single-shot codegen:

```
brief → classify → plan (+ factsLedger) → fill (parallel) → assemble (deterministic) → 6 gates → refine
```

The **AI never writes JSX or HTML**. The `plan` step picks block IDs from a
curated 15-block library (Tailark / Magic UI / shadcn — all MIT). The `fill`
step produces validated slot JSON for each block in parallel. Code stitches
the page together via deterministic React SSR. Bug loops — Lovable's #1
user complaint, where the AI keeps "fixing" a broken page by adding more
broken code — are impossible by construction.

Smart routing across 7+ models on Together AI keeps real cost at
**~$0.13/generation** (measured on 5 representative briefs):

- classify: LFM2-24B-A2B ($0.03/M input)
- plan + factsLedger: Kimi-K2.6 ($1.20/M, cached $0.20/M)
- fill: Qwen3-235B-tput ($0.20/M) — cheap throughput-tier on structured JSON
- images: FLUX.2-pro / -flex ($0.03/img)
- conversion judge: Kimi-K2.6 — small models hallucinated "Lorem ipsum
  detected" on clean copy; Kimi reads 3 KB HTML reliably

Lovable runs on Claude Sonnet 4.5 ($3/$15 per M) — same call, ~10× the cost.
OpenLen is what you build when you decide the model bill matters as much
as the output quality.

## Honest eval

[`EVAL_PHASE_2.md`](https://github.com/jesusbernalrj/inari-pages/blob/main/EVAL_PHASE_2.md)
has the full numbers — 5 briefs, 4.8/5 average quality scored by hand, 0%
refine rate (gates passed first-try on every brief), 100% gates pass first
try. Total session spend across all dev runs: **~$1.40 USD**.

Per-brief outputs (HTML, witness JSONL, gate verdicts, cost breakdown) are
all checked into the repo at [`evals/`](https://github.com/jesusbernalrj/inari-pages/tree/main/evals).
The eval harness re-runs end-to-end so you can verify it yourself with your
own Together API key.

## Output

Single HTML file + Tailwind via CDN. No npm install, no platform lock-in.
Drop on Vercel, Netlify, your own server, GitHub Pages — anywhere static
hosting works. Witness JSONL ships alongside so you can audit exactly which
model was used for which step and why, at what cost.

## Open source

[AGPL v3](https://github.com/jesusbernalrj/inari-pages/blob/main/LICENSE).
The "network use" clause (the whole reason AGPL exists over GPL) means
hosted modifications stay open source — if you fork it and run a competing
service, your fork is also open. Vendored blocks keep their original MIT
licenses.

Hosted version coming soon at openlen.com.

- **Repo:** https://github.com/jesusbernalrj/inari-pages
- **Eval doc:** https://github.com/jesusbernalrj/inari-pages/blob/main/EVAL_PHASE_2.md
- **Design engine doc:** https://github.com/jesusbernalrj/inari-pages/blob/main/INARI_DESIGN_ENGINE.md

Genuinely curious about:

1. Are quality gates the right defense against AI slop, or am I
   over-engineering this? (The brief-fidelity gate has known false-positive
   modes — paraphrased prices, dropped speakers — and I'm interested in
   whether anyone's solved fuzzy fact-match without an LLM in the loop.)
2. Briefs I haven't tested that would break this. The eval covers
   saas / portfolio / event / ecommerce / agency. What's missing?
3. The Lovable comparison is unfair in places (OpenLen does **only** landing
   pages — Lovable does any React app). Is the vertical-specialisation wedge
   strong enough to justify the framing?

Thanks for looking.
