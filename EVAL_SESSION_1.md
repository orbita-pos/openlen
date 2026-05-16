# EVAL — Session 1: Design Engine Foundations

What landed, what it costs, what to expect in Session 2.

## Scope shipped

- `lib/orchestrator/design-tokens.ts` — five palettes (mono-dark / indigo-dark / emerald-dark / warm-dark / mono-light), typography stack, type scale, spacing, shadow scale, radius scale, `selectPalette(intent)`.
- `lib/orchestrator/master-prompt.ts` — `buildMasterPrompt({ palette, fewShotExamples, taskSpecificAdditions })` rendering blueprint § 4 verbatim with token slots filled.
- `lib/orchestrator/routing.ts` — `buildSystemMessageForStep(step, ctx)` and per-step JSON-schema addenda for classify / plan / copy / html / refine. Model picking untouched.
- Every step (`classify`, `plan`, `copy`, `html`, `refine`, plus `regenerateSectionCopy`) now composes its system message via the master prompt instead of carrying a hardcoded preamble.
- `StepContext` gains a `palette: Palette` field. `generateLandingPage` seeds it with `DEFAULT_PALETTE` (mono-dark), then re-picks via `selectPalette(intent)` once classify finishes. Every witness record now carries `palette: PaletteName`.
- `lib/orchestrator/few-shots/README.md` — placeholder for the nine reference HTMLs Session 2 will introduce.

## Token + cost delta (mock-pipeline measurement)

Mock pipeline charges from real `priceTextCall` math (rough char→token ratio). Numbers below are per-step **input** tokens — output is unchanged from Phase 1A since schemas didn't shift.

| Step      | Before (Phase 1A) | After (Session 1) | Δ input tokens |
|-----------|-------------------|-------------------|----------------|
| classify  | 327               | 2,076             | **+1,749**     |
| plan      | 687               | 2,420             | **+1,733**     |
| copy      | 1,288             | 2,954             | **+1,666**     |
| html      | 2,968             | 4,117             | **+1,149**     |

Average overhead: ~1,600 input tokens per text step. Matches the blueprint's "~1,800 tokens" estimate for the master prompt body.

Mock-mode total cost for the FlowDeck SaaS-launch brief:
- **Before Session 1:** ~$0.11 (recording `868737de`, real Together API).
- **After Session 1 (mock):** $0.1412 — driven almost entirely by the four image generations ($0.12). Text-side cost rose from ~$0.024 to ~$0.022 in mock; real Together API will hit the prompt cache on the master prompt prefix and the delta should land in the $0.005–0.015 range.

## Cache hit expectation (real Together mode)

The master prompt body only varies on `palette.name` and the rendered token block — otherwise constant across an entire generation. After the classify call seeds the cache with `mono-dark`, plan/copy/html/refine usually run with a single different palette (the one `selectPalette(intent)` chose), so we expect:

- One cold-cache call per palette × per session, ~1,800 input tokens at full rate.
- Every other text call within the same generation lands as a cache hit on the master-prompt prefix → ~90% input-token discount on the prompt body (Together AI prompt cache rules for Kimi K2.6 and DeepSeek V4 Pro).
- Net effective overhead per generation: ~$0.005–0.010 on real models, masked entirely by the existing $0.12 image budget.

## Behavioural verification

`MOCK_MODE=1 npm run eval -- 01-saas-launch` produces:
- SSE event flow identical to Phase 1A (classify → plan → copy + images in parallel → html → assemble).
- Result shape unchanged (`html`, `css`, `images`, `meta.intent`, `cost`, `witnessPath`, `plan`, `copy`).
- Witness recording now contains `palette: "mono-dark"` on the classify record and `palette: "mono-light"` on every record after (the FlowDeck brief hits `selectPalette`'s productivity branch).

## Decisions worth flagging for Session 2

1. **Task-specific addenda are NOT terse.** The session brief suggested ~3-line `TASK_SPECIFIC_PROMPTS` entries. We kept the original step prompts' full JSON-schema bodies in the addendum because that schema is the only authoritative source of structured output. The master-prompt preamble carries voice / banned patterns / quality bar — the addendum carries shape.
2. **regenerate-section defaults to `mono-dark`.** The /api/regenerate-section route receives plan + copy + images but not intent, so we can't yet resolve the palette that drove the original generation. The page already ships with its own CSS, so the master prompt's tokens act as a stylistic anchor rather than a hard swap. Session 4 (slot-filling pipeline) is the natural moment to thread intent + palette through this path.
3. **Mock fixtures updated.** `htmlMock` now emits the `<header class="navbar">` and `data-section-id` attributes the production `assertHtmlQuality` gate requires (the gate was introduced in `59cc2ad` but the mock wasn't updated alongside). `refineMock` now returns `{html, css}` to match the schema the html step's `lastResort` expects. Real-mode behaviour is unaffected.
4. **No regressions in `npx tsc --noEmit` or `npm run lint`** after the refactor.

## Do-next for Session 2

- Receive nine reference HTMLs (3 per aesthetic direction) and drop them under `lib/orchestrator/few-shots/<direction>/0{1,2,3}.html`.
- Implement `loadFewShot()` rotation logic so the same triple is never reused in a session.
- Wire into `buildMasterPrompt({ fewShotExamples: [...] })` — the master prompt already honours the populated case.
- Expect another +5,000–6,000 input tokens per text call once few-shots are live (still well within Together AI's 128k context, and largely cacheable).
