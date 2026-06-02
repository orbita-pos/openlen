# Phase 0 Spike — does assemble-then-recolour beat bespoke?

The gate for the whole assembly bet. **Hand-build 3 pages** by assembling library
sections (the EXISTING `/api/sections/prepare` flow), and compare them head-to-head
against **bespoke** full-HTML generation. Cheap, fast, decisive.

> **GATE:** if the assembled pages **lose** to bespoke on craft + coherence →
> do NOT build the recipe/library engine. Ship only curation + template-reference
> retrieval. If they **match or beat** bespoke → build the assembler (Fork #1
> architecture). This is what resolves Fork #4 (spike kill-authority) with data.

This is deliberately tiny (N=3) and **your eye is the primary judge** — you have
the taste and you've rejected AI slop before. The `spike:judge` harness is an
objective AI **second opinion**, not the decider.

## The 3 briefs (chosen to span the range)

Pick cases that stress assembly from easy → hard:

1. **`01` — Devtools/SaaS, dark** *(assembly's strong case — rich library here)*
   > "A developer tool that traces LLM agent runs in production — spans, costs, evals."
2. **`02` — Food & Beverage, cream/light** *(warmer, softer — different aesthetic)*
   > "An independent third-wave coffee roaster's subscription — origin stories, tasting notes."
3. **`03` — Agency/portfolio, editorial** *(the HARDEST — portfolios are distinctive; if assembly holds here it holds anywhere)*
   > "A boutique brand-design studio — selected work, point of view, contact."

## Produce each pair

For each brief `<id>` (01/02/03), drop three files in a `spike/` dir:

- **`<id>.brief.txt`** — the brief text above.
- **`<id>.bespoke.html`** — generate via `/api/generate` with that brief (the current free-form path). **Record the latency.**
- **`<id>.assembled.html`** — hand-build in the app: new project → **Library** tab → insert sections (nav → hero → … → footer) via **"Use on my page"** (this runs `prepare` = recolour to the page palette) → arrange → export/copy the project HTML. **Record the time/effort.**

(Run where Gemini + a Chrome are reachable — locally via `npx next dev`, or the box.)

## Judge

```
npm run spike:judge -- ./spike
```

Per pair it renders both, shows them to Gemini in **both A/B orderings** (a
winner that flips on swap = position bias = tie), and scores the rubric:

- **coherence** — reads as ONE brand (consistent accent/type/spacing, no mismatched seams)?
- **craft** — hero polish, spacing rhythm, type hierarchy, color discipline — clearly hand-made-quality?
- **brief-fit** — industry/tone/right sections?
- **overall** — which would you ship?

It prints a per-brief + aggregate scorecard + a gate recommendation.

## Decide

Combine the harness scorecard, the **latency** you recorded (assembly should be
faster/cheaper), and — decisively — **your own eyeball** on the 3 pages:

- **Assembled matches/beats bespoke** (esp. on the dark devtools + F&B; a portfolio loss is expected/OK) → **BUILD the assembler.**
- **Assembled clearly loses** (samey, mismatched seams, worse than bespoke) → **FALL BACK**: curation + feed retrieved sections as exemplars into the existing generation, no recipe engine.

Either outcome is a win: you either unlock the cheap/best path, or you save months building an engine that wouldn't have beaten what you already have.
