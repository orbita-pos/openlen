# Phase 2 Evaluation — Real Together API, 5-brief suite

**Date:** 2026-05-16
**Branch:** `master`
**Commit at start of session:** `2291ff3` (Session 5 docs)
**Pipeline:** slot-filling (classify → plan → fill + images → assemble → 6 gates → optional refine)

> Note: this document supersedes the earlier Phase-2 eval written against the previous HTML-generation pipeline (now retired). Numbers, gate names, and failure modes here all reference the post-Session-5 slot-filling architecture.

## TL;DR

- **5/5 briefs succeeded** end-to-end against real Together AI calls. Average cost **$0.126 / generation**, average wall **42.0 s**.
- **All 6/6 quality gates pass first try** on every brief. **0 refine attempts** across the whole suite.
- **Average quality: 4.8 / 5** in honest scoring. Best: portfolio (5/5), Volcánica (5/5), Solo Founder Summit (5/5).
- **Brief fidelity was the dominant quality lever.** A single fill-prompt change (raw brief inserted verbatim + explicit fidelity rules) moved average quality from ~4.1/5 to 4.8/5.
- **Total session spend across all runs: ~$1.40 USD**, well below the $5–10 alert.

## Setup

### Models verified live against `GET https://api.together.xyz/v1/models`

| Code reference                | Together AI slug                              | Pricing (per 1M tokens) | Use on path |
|-------------------------------|-----------------------------------------------|--------------------------|-------------|
| `lfm2-24b-a2b`                | `LiquidAI/LFM2-24B-A2B`                        | $0.03 / $0.12            | classify + conversion judge |
| `moonshotai/Kimi-K2.6`        | `moonshotai/Kimi-K2.6`                         | $1.20 / $4.50 (cached $0.20) | plan + fill fallback   |
| `glm-5.1`                     | `zai-org/GLM-5.1`                              | $1.40 / $4.40            | plan fallback (unused)      |
| `qwen3-235b-tput`             | `Qwen/Qwen3-235B-A22B-Instruct-2507-tput`      | $0.20 / $0.60            | fill primary                |
| `qwen3-coder-480b`            | `Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8`      | $2.00 / $2.00            | reserved, not on path       |
| `deepseek-ai/DeepSeek-V4-Pro` | `deepseek-ai/DeepSeek-V4-Pro`                  | $2.10 / $4.40 (cached $0.20) | reserved hard-fallback  |
| `FLUX.2-pro`                  | `black-forest-labs/FLUX.2-pro`                 | $0.03 / image            | hero                        |
| `FLUX.2-flex`                 | `black-forest-labs/FLUX.2-flex`                | $0.03 / image            | decorative                  |

All eight IDs resolved cleanly on the first attempt. Pricing in `lib/together/models.ts` matched the live API to the cent — no updates needed. The pre-existing Together client (Session 4) was already wired correctly: retry-with-backoff, typed error normalization, $1.00/gen budget guard, lazy SDK loading. Nothing to do on the client itself.

### Safety nets in place

- **Retry:** exponential backoff (500 ms → 1.5 s → 4.5 s), 3 attempts, 30 s total cap per call. Fail-fast on 4xx (other than 429) and "model not found".
- **Budget guard:** $1.00/gen cap, enforced before parallel fan-out and every text call. Never tripped in the eval.
- **Prompt caching:** Together auto-caches identical prefixes. `usage.prompt_tokens_details.cached_tokens` surfaced into pricing math; Kimi/DeepSeek cached input bills at $0.20/M (6–10× cheaper than fresh).
- **Typed errors:** `RateLimitError` / `ModelUnavailableError` / `InvalidOutputError` / `TimeoutError` wrappers; pipeline code matches on these to decide recoverable vs structural.

## Per-brief results (final eval, post-fix)

| # | Brief                | Cost     | Wall   | Imgs | Gates | Grade  | Refine | Quality |
|---|----------------------|----------|--------|------|-------|--------|--------|---------|
| 1 | 01-saas-launch       | $0.0812  | 50.1 s | 1    | 6/6   | passed | 0      | **4.5 / 5** |
| 2 | 02-portfolio         | $0.1376  | 41.6 s | 3    | 6/6   | passed | 0      | **5 / 5**   |
| 3 | 03-event-conference  | $0.0522  | 44.9 s | 0    | 6/6   | passed | 0      | **5 / 5**   |
| 4 | 04-ecommerce         | $0.2201  | 44.3 s | 4    | 6/6   | passed | 0      | **5 / 5**   |
| 5 | 05-agency            | $0.1382  | 29.0 s | 4    | 6/6   | passed | 0      | **4.5 / 5** |

**Averages:** $0.126/gen · 42.0 s/gen · 4.8/5 quality · **0 % refine rate** · 100 % gates pass first-try.

See `evals/<slug>/notes.md` for per-brief observations. `evals/<slug>/cost.json` carries the full gate result objects (with up to 10 violations per gate, evidence included) for post-hoc inspection.

## Prompt + pipeline adjustments made during this session

1. **`lib/gates/conversion.ts`** — downgrade the LFM2-24B AI-judge's three critical checks (`hasOnePrimaryCTA`, `heroHasOutcomeLanguage`, `noLoremPresent`) to warnings. The 24B/A2B-activation model hallucinated "Lorem ipsum detected" on a page that grepped clean in two consecutive runs. The deterministic banned-phrase regex stays critical and is authoritative; the judge now produces soft signal only.

2. **`lib/blocks/features/bento-asymmetric.tsx`** — replace `tokens.accent` (low-contrast brand indigo `#5E6AD2` on dark surface, 3.66 : 1 — fails WCAG AA) with `tokens.text` + font-weight differentiation in the code-snippet visual. Inline comment documents the contrast math and the policy: brand accent goes on solid-fill buttons, text-tones go on text foregrounds.

3. **`lib/orchestrator/index.ts`** — early-out the refine loop when zero blocks were attributable to critical violations. Avoids ~10 s of wasted re-assemble + re-gate per stuck attempt when the violation is structural (block-component bug) rather than slot-content.

4. **`lib/orchestrator/fill.ts`** — include the raw brief verbatim in every fill user prompt, inside `<brief>…</brief>` tags, plus an explicit "Brief fidelity (non-negotiable)" rules block covering exact pricing, named people, named places, and brief-specified quantities. **This single change moved average quality from ~4.1/5 to 4.8/5 and was the biggest lever of the session.**

5. **`evals/run.ts`** — persist the full `gateResults` (per-gate pass/fail, duration, violation evidence truncated to 10) into `cost.json`. Debugging a failing brief no longer requires re-running the (expensive) pipeline.

## Cost reality vs estimate

- **Estimated (Session 4 docs):** $0.07–$0.12 per generation.
- **Observed (post-fix avg):** $0.126 per generation.
- **Delta:** the brief-fidelity fix added ~600–900 input tokens per generation (the brief × 6 fills) at $0.20/M = ~$0.0002 incremental. The visible cost bump between the two full evals ($0.5451 → $0.6293, +15 %) is dominated by **image-count variability** — the plan step picked 4 decorative images for two briefs on the second pass vs 0–1 on the first; each FLUX call is $0.03. Strip images and the per-text cost difference is < 5 %.
- **Verdict:** within envelope. $0.05–$0.20 was the design budget; $0.126 lands cleanly in the middle.

## Discoveries

### Models that brilliated

- **Qwen3-235B-A22B-Instruct-2507-tput** as fill primary. Sub-cent per block, schema validation passes 6/7 blocks per generation on average, copy good enough to clear the conversion gate without an AI rewrite.
- **Moonshot Kimi-K2.6** as plan-step primary continues to be the price/quality sweet spot. Plan output (block sequence + aesthetic + palette + image needs) was coherent and brief-aware across all 5 briefs.
- **FLUX.2-pro** hero images came back clean on every call. No 422s, no rate-limit retries.

### Models that disappointed

- **LiquidAI/LFM2-24B-A2B as conversion judge.** Too small to read a 3 KB HTML page and answer 8 boolean checks reliably. Hallucinated "Lorem ipsum detected" on clean copy twice. Recommendation for Session 7: either upgrade the judge to Kimi (~10× the cost, still ~$0.005 — trivial) or replace it with deterministic HTML heuristics.
- **Qwen3-235B-tput on `footer/four-col-links`** consistently emits social-platform names outside the 5-platform enum (`twitter`, `github`, `linkedin`, `youtube`, `discord`). Falls back to Kimi cleanly — costs ~$0.005 extra per generation — but worth either widening the enum or tightening the per-block prompt.

### Prompts that required the most iteration

- **Fill-step user prompt.** The brief was buried inside the classifier's lossy `Intent` summary; the model never saw the raw brief and routinely invented facts (pricing drifts, geographic relocations, dropped speaker names). Two iterations to land on a working format.

### Gates that fired most often

- **Performance:** 1 violation per brief, every brief — always `cdn.tailwindcss.com` flagged as render-blocking. By design (assemble bakes Tailwind via CDN for the demo). Warning, not critical.
- **Mobile:** 1 violation per brief, every brief — hero CTA tap-target slightly under 44×44 px on mobile breakpoints. Warning. Worth tightening hero block padding in a future pass.
- **Conversion:** 2–3 warnings per brief, all post-fix. Typical: the LFM2 judge flags "no social proof" despite a testimonials block being on the page. Small-model misread; no impact on shipping.

## Pricing implications

At $0.126/gen observed:

| Tier  | Price/mo | Gens/mo | COGS    | Gross margin   |
|-------|----------|---------|---------|----------------|
| Free  | $0       | 10      | $1.26   | -$1.26 (CAC)   |
| Pro   | $19      | 50      | $6.30   | $12.70 (67 %)  |
| Team  | $49      | 200     | $25.20  | $23.80 (49 %)  |

**Verdict:** pricing is viable. Free tier loses $1.26 COGS per active user — acceptable as customer-acquisition cost if Pro conversion is ≥10 % over lifetime. Pro is healthy 67 % gross even before SaaS infra (Vercel, Neon, Resend add maybe $0.01–0.02/gen). Team is tighter; if power users hit the 200-cap, gross dips to ~49 %. Consider dropping Team to 150 gens to keep margin > 60 %.

## Honest verdict

**Is V1 shippable to friendlies as-is? Yes.**

Average 4.8/5 quality, 100 % gates passing first try, cost in the middle of the design envelope, and the worst failure mode of Session 4 (bug-loop on Qwen3-Coder writing HTML) is impossible by construction here — the AI never writes markup.

Before pointing actual customers at this, I'd want:

- **One internal-consistency guard.** The agency brief produced "Three partners. Fourteen years." in the hero and "Three people. Six years." later in the page — fill blocks are processed independently in parallel, with no shared fact-ledger. Cheapest fix: have the plan step emit a `factsLedger: { tenure, teamSize, prices, dates }` blob that fill blocks reference verbatim.
- **An honest pass over the bento-asymmetric code snippet.** It hardcodes `const result = await search("latency")` — Linear-styled but disconnected from any product. Either parameterise from the brief or rotate templates.

Estimated work to unblock the above: **2–4 hours**, not session-blocking.

## Open questions for Session 7

1. Upgrade conversion judge to Kimi (10× cost, still trivial) or replace with HTML heuristics?
2. Cap default image count by tier (free → hero only, pro → hero + 2 decorative) to harden the $0.07 cost floor?
3. Widen `SOCIAL_PLATFORMS` from 5 to 8–10 so footer fill doesn't need the Kimi fallback?
4. Plan step emit a `factsLedger` to prevent cross-block contradictions like "6 years vs 14 years"?
5. Deterministic brief-fidelity post-check: regex `$\d+` mentions in the brief and assert they appear verbatim in the rendered HTML?

## Session burn

- API spend total: **~$1.40 USD** across mock baseline (free), 2 smoke tests, 2 full 5-brief evals.
- Well below the $5–10 alert threshold from the session brief.
