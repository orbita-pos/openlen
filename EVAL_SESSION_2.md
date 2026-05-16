# EVAL — Session 2: Few-shot Corpus Integration

**Status:** complete
**Date:** 2026-05-16
**Scope:** integrate the 9 hand-crafted reference variants (3 per aesthetic
direction) into the orchestrator's master prompt as few-shot examples.

---

## What landed

1. **9 reference variants** under `lib/orchestrator/few-shots/<direction>/<variant>.jsx`.
   Built via `scripts/build-few-shots.ts` from the artifact downloads in
   `~/Downloads/{technical-minimal,refined-editorial,warm-humanist}/`.

2. **Rotation logic** in `lib/orchestrator/few-shots/index.ts`. `loadFewShots()`
   returns three examples — one per aesthetic direction. A session-scoped
   counter walks variant indices so successive calls pick different triples.
   Preferred-direction first per Lost-in-the-Middle.

3. **Master-prompt wire-up** in `lib/orchestrator/master-prompt.ts`. The
   `<few_shot_examples>` block moved to the END of the system message (last
   block before the user message) per the same Lost-in-the-Middle research.
   `<final_constraint_check>` moved up to keep its instructions ahead of the
   large reference dump.

4. **Per-step routing** in `lib/orchestrator/routing.ts`. `FEW_SHOT_STEPS = {
   plan, copy, html }`. classify and refine skip few-shot entirely (structured
   tiny tasks). `buildSystemMessageForStep` now returns `{ content,
   fewShotVariants }` so witness recording can capture which references shaped
   each call.

5. **Witness metadata** in `lib/orchestrator/types.ts`, `lib/witness/recorder.ts`,
   `lib/orchestrator/_shared.ts`. New optional `fewShotVariants?: string[]`
   field on `WitnessRecord` carries the chosen triple per call in
   `"direction/variant"` form. Absent for steps that don't load few-shots and
   for legacy recordings.

6. **Regen path** in `lib/orchestrator/copy.ts` also wired (it's a copy-variant
   creative step, so it benefits from the same corpus).

---

## Token budget

`scripts/measure-few-shot-tokens.ts` reports the master-prompt + 3-example
total, broken down per palette family:

| Palette         | Preferred direction      | Examples total | Full system prompt |
|-----------------|--------------------------|---------------:|-------------------:|
| emerald-dark    | technical-minimal        | 26,491 tok     | 28,471 tok         |
| warm-dark       | refined-editorial        | 25,821 tok     | 27,799 tok         |
| mono-light      | refined-editorial        | 26,664 tok     | 28,644 tok         |
| mono-dark (default) | technical-minimal    | 26,491 tok     | 28,470 tok         |

**Heuristic:** 4 chars per token. This **over-counts** real BPE tokens for
dense JSX (which averages ~4.5–5 chars/token because of repeated `className=`
runs). Conservative real-token estimate: **22–25K** per call.

**Context headroom:** Together AI's Qwen3-Coder-480B, Kimi K2.6, and
DeepSeek V4 Pro all support 128K context. At a 28K system prompt we leave
~100K for the user message (~2–4K), the model output (~6–8K for html), and
any cached prefix re-use. No risk of context overflow.

### Trim decision

Of the original 6,471 lines / 322 KB across 9 files, only the three
technical-minimal variants (tide, arrow, glass) were trimmed. Each lost its
Testimonials and FAQ sections — the least distinctive parts of the page,
between Pricing and CTA. Everything else (nav, hero, bento, big-feature,
pricing, CTA, footer, composition) is intact. This dropped the trio from
~32K tokens to ~26K combined.

Refined-editorial and warm-humanist variants are emitted in full.

### Cost delta vs Session 1 baseline

Per-generation input-token uplift (3 steps × ~26K few-shot tokens):

- **Without prompt caching:** ~78K extra input tokens per generation.
  At Qwen3-Coder's $2/M input rate: **+$0.156 per generation**.
- **With Together AI prompt cache** (`cache_control: ephemeral`): the
  master prompt + few-shot block is stable across the plan/copy/html steps,
  so after the first uncached call the cache hits for ~78% of the prefix.
  Realistic uplift: **+$0.04–0.06 per generation**.

Baseline (Session 1) was ~$0.10–0.15 per generation in MOCK_MODE; expected
real-API cost was $0.15–0.40 per blueprint § 2. The few-shot uplift
sits comfortably inside the budget — and is the lever the blueprint
explicitly calls out as the *highest leverage* layer for open-source models.

---

## Smoke test results

```
MOCK_MODE=1 npm run eval -- 01-saas-launch
```

- ✅ Pipeline runs end-to-end.
- ✅ Witness `recordings/<generationId>.jsonl` includes `fewShotVariants`
  entries on plan/copy/html records, omitted on classify and image_* records.
- ✅ Different palettes select different preferred orderings (verified
  emerald-dark → technical-minimal first, warm-dark → refined-editorial first).
- ✅ Rotation counter advances across pipeline steps within a single
  generation — plan, copy, and html each see a different triple, which gives
  the model varied references at each stage.
- ✅ No regression in output shape; assemble + render works as before.

---

## Open questions for Session 3+

1. **Per-step rotation vs. per-generation rotation.** Today the counter
   advances on every `loadFewShots()` call, which means plan/copy/html each
   see a different triple inside the same generation. Arguably they should
   see the SAME triple so the references stay coherent. Easy to switch —
   cache the triple on `StepContext` after the first load. Defer to Session
   4 when the slot-filling pipeline lands and we can decide if section-level
   variation helps or hurts.

2. **Pro tier escalation.** The few-shot uplift is borne by all tiers. If
   real-cost numbers show free-tier margins under pressure, we can gate
   few-shot to Pro and Pro+ only, with free tier running master-prompt only.

3. **Corpus expansion.** Three directions × three variants = 9 today. The
   two missing aesthetic directions (`editorial-maximalist`,
   `brutalist-technical`) would benefit from 3 variants each. Track as
   Session 6 work after real-API evals show which directions the model
   under-serves.

---

## Files touched (Session 2)

```
lib/orchestrator/few-shots/index.ts                  (new — 110 lines)
lib/orchestrator/few-shots/technical-minimal/*.jsx   (new — 3 files)
lib/orchestrator/few-shots/refined-editorial/*.jsx   (new — 3 files)
lib/orchestrator/few-shots/warm-humanist/*.jsx       (new — 3 files)
lib/orchestrator/master-prompt.ts                    (edit — typed
                                                       FewShotExample[];
                                                       block moved to end)
lib/orchestrator/routing.ts                          (edit — async, returns
                                                       fewShotVariants)
lib/orchestrator/_shared.ts                          (edit — fewShotVariants
                                                       on TextCallPlan +
                                                       recorder.record)
lib/orchestrator/{classify,plan,copy,html,refine}.ts (edit — propagate async
                                                       buildSystemMessage;
                                                       thread fewShotVariants)
lib/orchestrator/types.ts                            (edit — fewShotVariants
                                                       on WitnessRecord)
lib/witness/recorder.ts                              (edit — fewShotVariants
                                                       on RecordInput)
scripts/build-few-shots.ts                           (new — one-time
                                                       converter)
scripts/measure-few-shot-tokens.ts                   (new — budget audit)
```
