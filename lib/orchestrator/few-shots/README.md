# Few-shot Reference Corpus

Nine hand-crafted React + Tailwind JSX variants — three aesthetic directions
× three variants each — injected into the master system prompt as in-context
examples for the AI orchestrator. They are **not** shipped to the browser
and never executed. They are loaded as plain text into the
`<few_shot_examples>` block so the model can pattern-match against
bespoke Linear / Vercel / Stripe-grade output instead of generic AI defaults.

## Structure

```
lib/orchestrator/few-shots/
  technical-minimal/{tide,arrow,glass}.jsx
  refined-editorial/{folio,brace,letter}.jsx
  warm-humanist/{daybreak,cohort,kettle}.jsx
  index.ts                    ← loader + rotation
```

Token budget per call (one variant per direction = three loaded): ~26K input
tokens. See `scripts/measure-few-shot-tokens.ts` for the live breakdown and
`EVAL_SESSION_2.md` for the trim decisions.

## Loading

```ts
import { loadFewShots } from "@/lib/orchestrator/few-shots";

const examples = await loadFewShots({
  preferredDirection: "technical-minimal",
});
// → 3 FewShotExample objects, with the preferred direction first per
//   Lost-in-the-Middle ordering.
```

`routing.ts → buildSystemMessageForStep` calls this automatically for the
steps that benefit (plan, copy, html). classify and refine skip the corpus.

## Rotation

A session-scoped counter advances on every `loadFewShots()` call, so two
consecutive calls pick different variants per direction. Three consecutive
calls cycle through all variants per direction before repeating. This avoids
the model anchoring on a single triple within a generation.

## Rebuilding

The source artifacts are NOT in this repo — they are authored in claude.ai
artifacts and land in `~/Downloads/{technical-minimal,refined-editorial,
warm-humanist}/`. To rebuild:

```bash
npx tsx scripts/build-few-shots.ts
```

The converter concatenates each variant's shared primitives in front of the
variant body, trims the three technical-minimal variants' Testimonials + FAQ
sections (the largest non-distinctive parts), and writes one self-contained
`.jsx` per variant.

The output files are ESLint-ignored (see `.eslintignore`) because they're
reference text, not executable code.
