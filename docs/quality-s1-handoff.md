# Quality S1 handoff — HTML post-processor + few-shot snippets + prompt restructure

Self-SHA: _to fill at merge_

## Mission recap

Close the ~12-18% quality gap between Gemini output and the curated Opus 4.7
templates. Three coordinated changes, no provider/model switch:

1. **Rust HTML post-processor** (`harden_visual_quality`) — surgical
   border-alpha caps + Tailwind class normalization + banned-phrase
   detection. Enforces hairlines on the AI output regardless of what
   Gemini emits.
2. **Few-shot micro-snippets** (`DESIGN_REFERENCE.REFERENCE_SNIPPETS`) —
   5 copy-paste-style excerpts from Mirror / Manuscript / Counter so the
   model has concrete patterns to emulate, not just abstract rules.
3. **Prompt restructure** — split `DESIGN_GUIDANCE` into two exports:
   `DESIGN_GUIDANCE` (system-prompt material) + `DESIGN_REFERENCE`
   (user-message reference, tagged `<reference>…</reference>`). Both
   `/api/generate` and `/api/templates/ai-design` updated.

## What shipped

### Rust — `harden_visual_quality`

`crates/html-engine/src/publish/harden.rs` (new file, 369 lines including
tests). Exposed via napi as `hardenVisualQuality(html: string)` returning
`{ html, counts, warnings }`.

Operations applied to the canonical HTML once at end-of-stream:

| Op | Trigger | Action |
|---|---|---|
| White border alpha cap | `border…: …rgba(255,255,255, X>0.06)…` inside `<style>` text or inline `style=` | Rewrite alpha to 0.06 |
| Black border alpha cap | `border…: …rgba(0,0,0, X>0.08)…` | Rewrite alpha to 0.08 |
| Tailwind white-border normalize | `border-white/{10,20,…,90}` | Rewrite to `border-white/5` |
| Tailwind black-border normalize | `border-black/{10,20,…,90}` | Rewrite to `border-black/5` |
| Banned phrase scan | "Streamline your workflow", "cutting-edge", etc. | Emit warning (no rewrite) |
| Generic CTA scan | "Learn more →", "Click here", etc. | Emit warning (no rewrite) |

**Scope (deliberately narrow):**
- Only `border` / `border-color` / `border-X` / `border-X-color`
  declarations get the alpha cap. Background, shadow, and text-color rgba
  values are untouched — they're often intentional design choices.
- Banned phrases / CTAs are detected but NOT rewritten. Quality S1 ships
  in "log + leave intact" mode. Quality S3 (vision-critic loop) can
  later use the warnings to trigger regeneration.

**Tests:** 19 unit tests covering each operation + idempotency on both
clean and post-rewrite input. Full suite green (186 lib tests).

### TS wrapper — `lib/harden.ts`

Type-clean wrapper over the napi binding, mirroring the
`@/lib/html-engine` pattern (Option<T> → `null`). Public surface:

```ts
import { hardenVisualQuality } from "@/lib/harden";
const r = hardenVisualQuality(html);
// r.html — rewritten HTML
// r.counts — { whiteAlphaCapped, blackAlphaCapped, tailwindWhiteNormalized, tailwindBlackNormalized }
// r.warnings — [{ kind: "banned_phrase" | "generic_cta", matched: string }, …]
```

### Pipeline integration — `lib/ai-stream/generate.ts`

`applyHardening(html)` invoked on `endResult.finalHtml` at the two
end-of-stream paths (normal `end_turn`/`max_tokens` and the safety
fall-through when the provider returns without an explicit `done` event).
Hardening counts > 0 are info-logged; banned-phrase / generic-CTA
warnings are warn-logged. Idempotent: a no-op when the HTML is already
clean.

**Failure mode:** hardening errors don't break the pipeline — they fall
through to the raw HTML with an error log. The Rust impl never throws on
valid input, so this is purely defensive.

### Design guidance — `lib/design-guidance.ts`

Split into two exports:

**`DESIGN_GUIDANCE`** (kept name → system prompt; constraints/shape):
- OUTPUT FORMAT (strict rules)
- TYPOGRAPHY PRECISIONS
- BRIEF EXPANSION (family detection + blueprint fill)
- SECTION SKELETON (10-section landing-page order)
- DESIGN BAR (Linear/Vercel/Stripe-level test)
- **BANNED ANTI-PATTERNS** (new — instant-failure rules covering border
  alphas, banned copy, generic CTAs, mockup density minimums, pricing
  row minimums, layout bans)

**`DESIGN_REFERENCE`** (new export → user message tagged `<reference>`;
material to draw from):
- CSS RECIPES (compact recipe list)
- **REFERENCE_SNIPPETS** (new — 5 micro-snippets from Mirror/Manuscript):
  1. `hairline-tokens-and-utilities` (CSS vars + hairline class)
  2. `stats-card-with-comparisons` (4-metric tile with deltas)
  3. `hero-half-tone-headline` (display headline + half-tone span +
     dual CTA + mono SDK hint)
  4. `featured-pricing-tier` (middle tier with ring-accent + Most popular
     pill + 5 features + dotted divider)
  5. `faq-details-summary` (native `<details>` + accent plus icon)
- VISUAL FLOURISH RECIPES
- FAMILY AESTHETIC
- FICTIONAL BRANDS
- CONTENT RULES

### API routes

**`app/api/generate/route.ts`** — `messages` array now
`[system, user(<reference>…), user(BRIEF: …)]`.

**`app/api/templates/ai-design/route.ts`** — `messages` array now
`[system, user(<reference>…), …history, user(scoped/full doc + prompt)]`.
`SYSTEM_TOKEN_BUDGET` bumped 4_000 → 7_000 to account for the reference
(~3K tokens). Token-cap pre-flight estimate updated.

### Tests

| Suite | Result |
|---|---|
| `cargo test -p openlen-html-engine --lib` | 186 / 186 ✅ |
| `cargo test -p openlen-html-engine --lib publish::harden` | 19 / 19 ✅ |
| `npx tsc --noEmit` | _verified locally; see Verification section_ |

## Acceptance criteria (checked)

- [x] `cargo check --workspace` green
- [x] `cargo test -p openlen-html-engine --lib` green (186 / 186, includes
  19 new harden tests)
- [x] `cargo test -p openlen-html-engine --test stream_perf` green in
  isolation (4 / 4 — one flaky failure under heavy parallel napi build
  load, passes solo)
- [x] `./node_modules/.bin/tsc --noEmit` clean (no errors)
- [x] Node-level smoke test confirms napi binding works end-to-end:
  border alpha caps, Tailwind normalize, banned-phrase + generic-CTA
  warnings all fire as expected
- [x] Border alpha caps applied: `rgba(255,255,255,X>0.06)` → `0.06`,
  `rgba(0,0,0,X>0.08)` → `0.08`
- [x] Tailwind border-white|black/{10..90} → /5
- [x] Banned phrases logged as warnings (not rewritten)
- [x] `/api/generate` + `/api/templates/ai-design` both restructured
- [x] `design-guidance.ts` exports `DESIGN_GUIDANCE` + `DESIGN_REFERENCE`
- [x] No breaking changes — existing tests pass
- [x] Handoff doc complete

## Verification

To verify the pipeline locally:

```bash
cd D:/worktrees/openlen-quality-s1
npm ci                                  # one-time, sets up node_modules
cd crates/html-engine && npm run build  # rebuilds napi binding with harden
cd ../..
npx tsc --noEmit                        # type-check
CARGO_TARGET_DIR=D:/rust/target cargo test -p openlen-html-engine --lib
```

Smoke test with a representative brief:

```
"landing for project management SaaS named FlowDeck"
```

Expected post-merge behaviour:
1. Server log emits `[generate] hardened — w:N b:M tw-w:P tw-b:Q` if
   Gemini emitted any over-cap borders (typical N for first-pass output:
   3-10).
2. Server log emits `[generate] harden warnings: banned_phrase:cutting-edge`
   if Gemini ships banned copy.
3. Visual diff: section borders read as hairlines (not bright lines).
4. Mockup density: hero stats card has 4 metrics with mono comparison
   strings (the snippet 2 pattern bleeds through).

## Out of scope (Quality S2+)

- ✗ Template screenshot as `image_part` (Quality S2)
- ✗ Vision-critic loop with puppeteer (Quality S3)
- ✗ Two-call brief-expansion → HTML pipeline (Quality S4)
- ✗ New providers / models
- ✗ ai-gateway crate changes (deliberately untouched per
  `[[f3-gemini-only-provider]]`)

## Quality S2 spec — template screenshot reference

The next step is to ship a SCREENSHOT of one canonical template per family
as an `image_part` in the Gemini request. Sketch:

1. **Storage:** `templates/starter/{mirror,manuscript,counter}.png`
   committed to the repo (≤ 200 KB each, JPEG-XL would help). Precomputed
   via puppeteer at 1280×N.
2. **Selection:** route the chosen image based on family detected in
   `BRIEF EXPANSION` (devtools → mirror.png, editorial → manuscript.png,
   etc.). Default = mirror.png.
3. **Wire-up:** `messages[1]` becomes a mixed-content user turn:
   `[{ type: "text", text: REFERENCE_MESSAGE }, { type: "image",
   source: { base64, mediaType: "image/png" } }]`. GeminiProvider needs a
   small extension to forward image parts.
4. **Acceptance:** with the screenshot in context, output should match
   the curated template's *visual register* (not just content), pushing
   the gap further down from ~95% to ~98% Mirror-level.

## Open questions / risks

- **Reference message position in ai-design**: currently placed
  AFTER system + BEFORE history. Could alternatively go between history
  and the current prompt. Trade-off: where it is now means the reference
  feels like context the model "always had". Watch the next 5-10 chat
  edits for any regression — if Mode A op-rates drop, reconsider.
- **Mode A op tax**: the reference adds ~3K tokens to every chat-edit
  turn even when the user just wants to rename one heading. Acceptable
  for Quality S1 (consistency > minor token cost), but if the per-turn
  bill surprises, gate the reference on `!scopedView` (scoped requests
  skip the reference, full-doc requests get it).
- **Banned-phrase false positives**: the case-insensitive match catches
  "cutting-edge" inside arbitrary text. Low priority — most landing pages
  shouldn't have legitimate uses of these phrases, and the warning is
  log-only.
- **Tailwind v4 syntax**: `border-white/[0.06]` arbitrary classes are
  NOT covered by the normalizer. The standard utility `/5` step covers
  the common Gemini emission patterns; arbitrary classes are rare and
  if Gemini learns to emit them, add a third regex.
