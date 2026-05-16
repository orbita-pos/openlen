# Phase 2 Evaluation — Real Together API

**Date:** 2026-05-15
**Branch:** master
**Generation count:** 5 briefs end-to-end via real Together AI calls (MOCK_MODE off).

## TL;DR

- **5/5 briefs succeeded.** Average cost **$0.135 / page**, average wall-clock **58s**.
- Quality scores honestly: **4.1 / 5 average.** All five outputs would be acceptable starting points for a paying customer; two are genuinely good.
- Cost came in lower than the mock estimate ($0.30–$0.60). The $19/mo Pro tier (~140 pages/mo at $0.135 each = $18.90 cost) is workable but tight; see *Pricing implications* below.
- Three model surprises forced routing changes mid-session — see *Model availability discoveries*.

## Per-brief results

| Slug | Brief | Cost | Time | Images | Score | Notes |
|---|---|---|---|---|---|---|
| `01-saas-launch` | FlowDeck Kanban (full pricing) | $0.143 | 69s | 4 | 4 / 5 | Headline "Kanban that sorts your design backlog automatically" lands. Pricing tiers reflect the brief verbatim. Two `<section class="features">` repeated — duplicated section in plan output. |
| `02-portfolio` | Sofia, freelance designer | $0.144 | 61s | 4 | 4 / 5 | "Sofia designs fintech products that ship" — concrete and brand-true. Project cards reuse the same 3 image URLs across 6 slots; harmless but lazy. |
| `03-event-conference` | Solo Founder Summit 2026 | $0.147 | 72s | 4 | **5 / 5** | "1 day. 3 builders. $99." — punchy, uses brief's numbers directly. Speakers and date appear in copy. |
| `04-ecommerce` | Volcánica coffee subscription | $0.139 | 52s | 4 | 4 / 5 | "Coffee grown on Mexican volcanoes, delivered to your door." — strong brand voice. Subscription tiers preserved. |
| `05-agency` | Pixelhaus, Berlin | $0.103 | 37s | 3 | **3.5 / 5** | "Brand identities that scale with you" — slightly generic compared to others. **Bug:** four `<img src="" alt="..."` empty-src logo tags in the social_proof section; the html model invented logo `<img>` references not in the imagePrompts list. |

**Total spend across the suite:** $0.6755 over 4m 51s wall-clock.

## Cost breakdown (averaged over 5 runs)

| Step | Avg cost | % of total | Notes |
|---|---|---|---|
| classify | $0.00002 | 0.01% | LFM2-24B-A2B is essentially free; 800–1.2K input tokens. |
| plan | $0.00305 | 2.3% | Kimi K2.6 with 80–95% input cached after the first call. |
| copy | $0.00813 | 6.0% | Kimi K2.6 with cache; bulk goes to output tokens (~1.5K). |
| html | $0.01166 | 8.6% | Qwen3-Coder-480B. Input tokens dominate (~3K, no cache discount). |
| images | $0.11250 | 83.1% | 3.75 images avg × $0.03 = $0.1125. **The rest of the pipeline is rounding error compared to images.** |
| refine | $0.00000 | 0% | Never triggered — html quality gates passed on the primary every time. |

**Image cost is the dominant lever.** Cutting to "1 hero + 1 decorative" would drop avg cost from $0.135 to ~$0.075. Cutting to hero-only would land at ~$0.05. Worth A/B testing whether 4 images visibly improves perceived quality vs. 1.

## Quality gate hits

| Gate | Triggered? | Outcome |
|---|---|---|
| classify: invalid JSON | 0 / 5 | LFM2 produced clean JSON every time. |
| plan: missing hero image prompt | 0 / 5 | Kimi reliably emits a hero entry. |
| copy: anti-generic regex (>2 hits) | 0 / 5 | Stricter system prompt + temperature 0.7 was enough. |
| html: missing closing `</main>` | 0 / 5 | Qwen3-Coder followed the wrapper instruction. |
| html: tag balance | 0 / 5 | Clean. |
| html: missing `alt` on `<img>` | 0 / 5 | Prompt explicitly required it. |
| html: `<script>` injection | 0 / 5 | Never attempted. |
| html: missing `{{HERO_IMAGE}}` placeholder | 0 / 5 | Always present. |

DeepSeek fallback and the refine step were never invoked. Either the primary chain is solid enough for now, or our gates are too lenient — the agency `<img src="">` issue suggests at least one new gate is warranted.

## Model availability discoveries

The 2026 placeholder model IDs in the original `models.ts` were almost-but-not-quite right. Probing `GET /v1/models` and one-shot test calls surfaced three blockers:

1. **`Qwen/Qwen3-Coder-Next-FP8` is non-serverless.** The endpoint exists in the catalog but requires a dedicated deploy. Switched to **`Qwen/Qwen3-Coder-480B-A35B-Instruct-FP8`** (serverless, $2.0 / $2.0 per 1M tokens) for the html step.
2. **`Wan-AI/Wan2.6-image` has tight resolution constraints** (total area 1.6M–2.07M pixels). Our default sizes (1024×1024 for 1:1, 1280×720 for 16:9) fail validation. Rather than maintain per-model size maps, swapped decoratives to **`black-forest-labs/FLUX.2-flex`** — same family, same $0.03/image price, accepts any reasonable dimensions, and produces visually coherent imagery alongside FLUX.2-pro hero shots.
3. **`Qwen/Qwen3.5-9B-FP8` is non-serverless** *and* the non-FP8 variant **`Qwen/Qwen3.5-9B`** is a thinking model that consumed the full token budget on `reasoning` without producing `content`. For the refine step (which doesn't need to be tiny), we picked **`Qwen/Qwen3-235B-A22B-Instruct-2507-tput`** (serverless, $0.2 / $0.6 per 1M tokens, no thinking) instead.

Slug fixes also needed for two correctly-priced models: `lfm2-24b-a2b` → `LiquidAI/LFM2-24B-A2B`, `glm-5.1` → `zai-org/GLM-5.1`.

## Prompt caching

Together caches identical prompt prefixes **automatically** — there is no `cache_control` parameter to send. The Anthropic-style `cache: true` field on `ChatMessage` is now a no-op for transit but kept as documentation.

Cache hits show up as `usage.prompt_tokens_details.cached_tokens` on the response. After the first call to a model, ~80–95% of the system prompt is cached. For Kimi K2.6 and DeepSeek V4 Pro, cached input bills at $0.20/M (vs $1.20/$2.10 fresh) — a 6–10× discount. Pricing math in `models.ts` honors this via the new `cachedInputPerMillion` field.

## Routing changes made during the session

1. **Removed `fastPath` from `plan` step.** LFM2-24B failed Zod validation 5/5 times when asked to produce the full plan schema. Wasted call cost ~$0.0001 each, no plan output. Kimi K2.6 is now the unconditional plan model. The fastpath flag still flows through `StepContext` for future re-enablement once we have a tighter LFM2-friendly plan prompt.
2. **`shouldUseFastPath` heuristic preserved** but currently has no effect on plan. Will revisit in Phase 3 with a simpler LFM2 plan template.
3. **`fallbackCount(step)` helper added** in `routing.ts`. Image step now walks exactly the defined fallbacks instead of always trying `fallbackIndex: 0` (which threw for `image_decorative` because its fallback list is empty by design).
4. **Hard cap of 1 hero + 3 decorative images** (`MAX_DECORATIVE_IMAGES` in `images.ts`). Plan validation already enforces this on the model output, but defense-in-depth: if a future plan emits 10 image prompts, we don't pay for them.

## Pricing implications

At **$0.135 / page** average:
- $19/mo Pro tier with 140 page generations/mo: **$18.90 cost, $0.10 margin per user.** Untenable.
- $19/mo with 100 pages/mo: $13.50 cost, $5.50 margin (29% margin). Workable.
- $19/mo with 50 pages/mo: $6.75 cost, $12.25 margin (64% margin). Comfortable.

The image budget dominates. Two paths to better margins:
- **Drop default to 1 hero + 1 decorative.** Avg cost falls to ~$0.075. At 100 pages/mo: $7.50 cost, $11.50 margin (60%).
- **Show 4-image plans only on a higher tier.** Default tier capped at 2 images.

Recommendation: **default new generations to 1 hero + 2 decoratives (~$0.105/page)**, expose the 4-image option behind a "rich preview" toggle for paying users only.

## Bugs to address (next session)

1. **Empty `<img src="">` for invented logo references.** Add an html quality gate: every `<img>` must have a non-empty `src` (either a real URL or an `{{IMG_<id>}}` / `{{HERO_IMAGE}}` placeholder). Right now an empty src renders as a broken-image icon — visible in the agency output.
2. **Duplicate sections in plan output.** `01-saas-launch` and `02-portfolio` both emitted two `<section class="features">` blocks. Either de-dup in plan validation or accept it as designed.
3. **Project-card image reuse.** Portfolio brief asked for 6 projects but only 3 image prompts were generated; the html step duplicated the URLs to fill slots. Either: (a) generate enough images, (b) instruct html to use abstract gradient backgrounds when no image is available.
4. **Progress detail says "Adaptive fast-path" even when fastpath is disabled** for a step. Cosmetic — `plan.ts`'s `progressDetail` ternary should consult the routing table, not just `ctx.fastPath`.

## Acceptance check

- [x] MOCK_MODE off by default (`MOCK_MODE=1` opt-in for dev)
- [x] All 6 mandatory pipeline steps make real Together calls (classify, plan, copy, html, image_hero, image_decorative)
- [x] 5 test briefs successfully generated end-to-end
- [x] Cost measured and documented ($0.135 / page average)
- [x] Quality 4 / 5 average in honest scoring (4.1 / 5)
- [x] EVAL_PHASE_2.md committed
- [x] Refine step implemented (not yet invoked in production runs — quality gates passed primary chain)
