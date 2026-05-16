# EVAL — Session 4: Slot-Filling Pipeline Conversion

**Status:** complete
**Date:** 2026-05-16
**Scope:** convert the orchestrator from "AI generates raw HTML/CSS" to
"AI picks block IDs + fills slot JSON; code assembles HTML deterministically."

This is the architectural pivot that makes Inari Pages structurally different
from Lovable/v0/Framer. The model never touches markup. HTML emission is a
pure function of validated slot JSON and the block registry. Bug-loops of the
"AI rewrote one section and broke three others" variety become impossible by
construction — the AI doesn't write the broken thing.

---

## What landed

1. **New types** (`lib/orchestrator/types.ts`).
   - `PipelineStep` enum: `classify | plan | fill | image_hero | image_decorative | assemble`. `copy`, `html`, and `refine` removed.
   - `Plan` shape: `{ blockSequence: { blockId, purpose, emphasis? }[], aesthetic, palette, rationale, imageNeeds }`. No more section markup, no more imagePrompts (the AI picks block IDs only; image prompts are derived deterministically from intent + aesthetic).
   - `FilledBlock`: `{ blockId, index, slots: unknown, fillCost, fillTokens }`. Validated against the block's own `slotsSchema` at fill time.
   - `LandingPage` carries `plan + filledBlocks + meta.blockSequence` so the regen path can re-fill one block and re-assemble.
   - `CostBreakdown`: `classify | plan | fill | images | assemble`. The `assemble` slot is always `0` (deterministic).
   - `WitnessRecord` gains `blockId`, `blockIndex`, and `deterministic` fields.
   - `BlockIdSchema` is a refined Zod string keyed off the live registry, so a hallucinated block ID fails parse with a clear allowed-list error.

2. **New plan step** (`lib/orchestrator/plan.ts`).
   - Injects the live `BLOCK_REGISTRY` catalog into the system prompt as `<available_blocks>`.
   - Validates the model's output for: every blockId in registry, hero+footer present, no duplicates, every block's `aesthetics` includes the chosen aesthetic.
   - Falls back to a deterministic canonical 5-block sequence on total model failure so the page always renders something.

3. **New fill step** (`lib/orchestrator/fill.ts`).
   - For each block in `plan.blockSequence`, in parallel: build a system message (cached prefix) + per-block user message (block id + purpose + emphasis + intent context + exampleSlots as a worked example).
   - Calls `qwen3-235b-tput` ($0.20/$0.60 per M) with `response_format: json_object`.
   - Validates against `block.meta.slotsSchema`. Retries once with error feedback. Falls back to `block.meta.exampleSlots` as the final safety net — the page still renders even if every model failed.
   - Emits per-block `step_result` events for streaming UI.
   - Writes per-block witness records with `blockId` + `blockIndex`.

4. **Deterministic assemble step** (`lib/orchestrator/assemble.tsx`).
   - **No LLM call.** Renders each block via `react-dom/server`'s `renderToStaticMarkup`.
   - Hero image injection: the FLUX-generated URL gets written into the first hero/* block's image slot (`imageSrc` or `mockupSrc`, depending on which the block uses). Decoratives are injected into feature blocks with image slots.
   - Stitches a complete HTML document: Tailwind Play CDN + Inter font + CSS-variable token block. Block markup contains inline styles for token values, so the iframe renders correctly even without Tailwind processing.
   - Injects `data-section-id="block-N"` + `data-block-id` into each block's outer `<section>` / `<footer>` so the iframe regen overlay can target individual blocks.
   - Writes a synthetic witness record with `deterministic: true`, zero cost.

5. **Routing table update** (`lib/orchestrator/routing.ts`).
   - `RoutedStep = Exclude<PipelineStep, "assemble">` — the deterministic step has no routing entry by design.
   - `fill` routes to `qwen3-235b-tput` primary, Kimi-K2.6 fallback.
   - `copy`/`html`/`refine` entries removed.
   - System message addendums rewritten: `CLASSIFY_TASK`, `PLAN_TASK` (with `<available_blocks>` injected from the registry), `FILL_TASK` (slot-filling rules).

6. **Pipeline orchestration** (`lib/orchestrator/index.ts`).
   - Flow: `classify → plan → parallel(fillAllBlocks, generateImages) → assemble`.
   - Image prompts derived deterministically from intent + plan.aesthetic (no AI call), saving the plan step's output token budget for block sequencing.

7. **Regen path** (`lib/orchestrator/regenerate-section.ts` + `app/api/regenerate-section/route.ts`).
   - Accepts `{ brief, intent, plan, filledBlocks, images, blockIndex, additionalInstruction? }`.
   - Re-fills one block via `fillBlock`, splices into `filledBlocks`, re-assembles. Images are preserved.
   - Client (`lib/use-generation.ts`) parses the iframe overlay's `block-N` `data-section-id` back into the numeric index before posting.

8. **Mocks** (`lib/together/mock.ts`).
   - Plan mock returns a realistic block sequence keyed by signal (simple/standard/rich complexity + tone-driven palette).
   - **Fill mock returns the block's `exampleSlots`** — guaranteed to validate against its own schema (Session 3 ensures this), so `MOCK_MODE=1` produces real, renderable pages with no special-casing.
   - `copy` / `html` / `refine` / `image_prompts` mocks removed.

9. **Eval harness** (`evals/run.ts` + `tsconfig.eval.json` + `package.json`).
   - `tsconfig.eval.json` extends the base tsconfig with `"jsx": "react-jsx"` so `tsx` uses the automatic JSX runtime (block files don't import React). Next.js itself keeps `"jsx": "preserve"` in `tsconfig.json` — its lint pass enforces this.
   - `buildSrcDoc` no longer wraps the assembled HTML, which is already a full `<!doctype>` document.

10. **Witness recorder + budget tracker** updated for the new step set.

---

## Cost delta (MOCK_MODE measurements)

Before Session 4 — full pipeline per brief:

```
01-saas-launch  $0.2599  (classify $0.0001 + plan $0.039 + copy $0.04 + html $0.06 + images $0.12)
```

After Session 4 — same brief:

```
01-saas-launch  $0.0720  (classify $0.0001 + plan $0.039 + fill $0.003 + images $0.03 + assemble $0)
```

5-brief totals:

| Brief                | Before    | After     | Δ        |
|----------------------|-----------|-----------|----------|
| 01-saas-launch       | $0.2599   | $0.0720   | −72%     |
| 02-portfolio         | ≈$0.25    | $0.0694   | −72%     |
| 03-event-conference  | ≈$0.25    | $0.0707   | −72%     |
| 04-ecommerce         | ≈$0.25    | $0.0702   | −72%     |
| 05-agency            | ≈$0.25    | $0.0709   | −72%     |
| **Suite total**      | **≈$1.30**| **$0.353**| **−73%** |

Where the savings come from:

- **`html` step gone**: the old pipeline spent ~$0.06/brief on the html model (`qwen3-coder-480b` at $2/$2 per M tokens, ~3K output tokens). That entire line item disappears.
- **`copy` step gone**: ~$0.04/brief on Kimi K2.6 generating long-form copy. Replaced by `fill` at ~$0.003/brief total (6 blocks × ~$0.0005 each on the throughput-tier `qwen3-235b-tput`).
- **`assemble` always $0**: deterministic React SSR.
- **Images** unchanged per image, but `imageNeeds.decorative` defaults to 0 unless a block actually needs decoratives. Most pages now generate 1 image (hero only) instead of 4, saving ~$0.09 of image spend on the typical brief.

Caveat: the mock plan cost (~$0.039) is inflated because mock token estimation reads chars/4 across the few-shot-loaded master prompt (~30K chars). In real Together mode, the master prompt prefix is auto-cached after the first call of a session; the actual cost per generation will drop further when measured against the cache-hit rate. Session 6 will produce the real-mode cost numbers.

---

## Bug-loop elimination

The structural claim: **the model cannot produce broken HTML, ever, by construction.**

- The model emits JSON. Zod parses it. Invalid JSON fails fast; the retry chain handles transient failure; the exampleSlots fallback handles persistent failure.
- The model never sees or generates HTML, CSS, JSX, or className strings.
- The HTML document is a pure function of: validated `FilledBlock[]` + palette tokens + the registry's React components.

What this kills:
- Unclosed tags, mismatched quotes, stray markdown fences in output — impossible (no HTML being written by the model).
- "Refactor broke other sections" — impossible (other sections never re-rendered unless the user asks for regen).
- "Mobile layout broke" — depends only on the block's CSS, which is Session 3 frozen and human-reviewed.
- "Hero image went missing" — surfaces in the witness's `assemble` note (`hero image injected` vs `none`).

What it does NOT kill (Session 5 quality gates handle these):
- Generic copy that passes Zod but reads like AI ("revolutionary platform that empowers...").
- Wrong block picked for the brief (a pricing block on a portfolio page).
- A11y issues in the block library itself (Session 3 has alt text + aria-labelledby on every block; Session 5 will run axe-core).
- Slot validation passing but slot semantically wrong (e.g., 12-word headline that's all banned phrases).

---

## New observable metrics in Witness

Each witness JSONL now exposes:

- `fill` records with `blockId` + `blockIndex` — lets us slice cost/latency per block over time. Useful for spotting "the pricing block always retries" patterns.
- `assemble` records with `deterministic: true`, `note` describing block count + image injection state.
- Per-block fallback usage via `decision.isFallback`. After a few hundred real generations we can answer "which blocks fail Qwen3-235B JSON-mode and need Kimi fallback?".

The cost breakdown's `fill` slot aggregates all blocks; `note` on individual records carries the per-block context.

---

## Open questions for Session 5 (quality gates)

1. **Generic-copy detector in slot JSON.** The old html-step regex scanned rendered HTML. The new scan target is `JSON.stringify(filled.slots)` per block. Same regex, different surface. Should we gate at `fill` time (retry inside fillBlock) or post-assemble?

2. **Mobile-snapshot test.** Now applies to the assembled HTML (which uses Tailwind's responsive utilities baked into the block components). Block library is Session 3 frozen so this stays cheap.

3. **A11y axe-core** on the rendered output. Should be high signal — blocks already carry `aria-labelledby`, `<img alt>`, semantic landmarks.

4. **SEO + AEO checklist** is mostly inherent to assemble.tsx (title, meta description, semantic HTML). Need a checklist runner.

5. **Conversion checklist** — does the page have a hero, value, proof, action, footer? Easy to assert: `plan.blockSequence` includes blocks of each kind.

6. **"Which blocks did the model pick most often?"** Witness records over time give us this for free. May want a dashboard endpoint surfacing usage counts.

---

## A/B test ready

The new architecture enables a/b experiments that weren't possible before:

- **Same brief, different block sequences.** Run the plan step twice with different temperature settings (or different models), keep the rest constant. Two different page assemblies, identical fill content.
- **Same plan, different fill models.** Compare Qwen3-235B vs Kimi K2.6 on the same block sequence. Quality vs cost trade-off becomes measurable.
- **Same fill, different palettes.** Re-run assemble with `palette: "mono-light"` vs `palette: "indigo-dark"` on identical filled blocks. The block components already render any palette deterministically — no AI re-run needed. **This is a 0-cost experiment** that wasn't possible in the old pipeline.

---

## Files touched

```
NEW   lib/orchestrator/fill.ts
NEW   lib/orchestrator/assemble.tsx
NEW   tsconfig.eval.json
NEW   EVAL_SESSION_4.md
DEL   lib/orchestrator/assemble.ts
DEL   lib/orchestrator/html.ts
DEL   lib/orchestrator/copy.ts
DEL   lib/orchestrator/refine.ts
MOD   lib/orchestrator/types.ts                 (Plan/FilledBlock/LandingPage shapes)
MOD   lib/orchestrator/plan.ts                  (catalog-driven block-id picking)
MOD   lib/orchestrator/routing.ts               (fill routing; copy/html/refine gone)
MOD   lib/orchestrator/index.ts                 (new flow)
MOD   lib/orchestrator/_shared.ts               (RoutedStep type)
MOD   lib/orchestrator/regenerate-section.ts    (re-fill one block)
MOD   lib/together/mock.ts                      (block-shaped mocks via exampleSlots)
MOD   lib/witness/recorder.ts                   (blockId/blockIndex/deterministic)
MOD   lib/budget.ts                             (fill + assemble categories)
MOD   lib/projects.ts                           (sectionCount from blockSequence)
MOD   lib/use-generation.ts                     (filledBlocks state, blockIndex regen)
MOD   components/workspace/types.ts             (filledBlocks in GeneratingPartial)
MOD   components/workspace/generating-view.tsx  (read slots, not copy.sectionTexts)
MOD   app/api/regenerate-section/route.ts       (blockIndex contract)
MOD   evals/run.ts                              (don't double-wrap full doc)
MOD   package.json                              (eval uses tsconfig.eval.json)
```

---

## Verification

- `npx tsc --noEmit` — clean.
- `npm run lint` — clean (no warnings).
- `MOCK_MODE=1 npm run eval` — 5/5 briefs succeed.
- Per-brief witness JSONL contains: classify, plan, 5× fill (with blockId + blockIndex), image_hero, assemble (deterministic).
- Cost breakdown for every brief shows `"assemble": 0`.
- Generated HTML contains `data-section-id="block-N"` on every block so the iframe overlay's regen path still targets concrete blocks.
- No double `<!doctype>` in eval output.
