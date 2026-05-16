# Few-shot Reference HTMLs

This folder will hold 9 hand-crafted reference landing pages used as in-context
examples for the AI orchestrator. They are NOT shipped to the browser — they
go into the `<few_shot_examples>` block of the master system prompt so the
model can pattern-match against bespoke Linear/Vercel/Stripe-grade output
instead of generic AI defaults.

## Structure (to be populated in Session 2)

```
technical-minimal/{01,02,03}.html
refined-editorial/{01,02,03}.html
warm-humanist/{01,02,03}.html
```

Three references per aesthetic direction × three directions = nine total.

## Selection logic per request

Pick three (one per aesthetic direction) and rotate so the same triple is
never used twice in a session. Token budget per few-shot block: ~6,000 tokens
combined, comfortably within Together AI's 128k context for Qwen3-Coder /
Kimi K2.6 / DeepSeek V4 Pro.

## Session 2 will

1. Receive nine HTMLs from the user (created via claude.ai artifacts with
   dedicated prompts).
2. Implement `loadFewShot()` rotation logic in `lib/orchestrator/few-shots/`.
3. Wire into `buildMasterPrompt({ fewShotExamples: [...] })` from
   `lib/orchestrator/master-prompt.ts`.

Until then `fewShotExamples` defaults to `[]` and the master prompt emits a
single comment placeholder where the block would go. The orchestrator already
honours the empty case — no integration work is required when files land.
