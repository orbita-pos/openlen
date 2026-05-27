# Rust F3 — Session 4 handoff (cutover)

**Branch:** `rust/f3-session4-cutover` (off `origin/master @ 8361cff` = F3 S3 merged tip)
**Date:** 2026-05-27
**Scope shipped:** F3 Session 4 — the production cutover. `/api/generate` now consumes `generateHtmlStream` (Gemini via `@openlen/ai-gateway` + `HtmlStream` sanitize/normalize), `/api/templates/ai-design` runs on `GeminiProvider` directly (one level under the helper, because Mode A's `<edits>` XML output cannot pipe through HtmlStream). The `together-ai` SDK dependency is removed; legacy "Kimi K2.6 / Together" copy across the chat UI + workspace comments is updated. F3 is officially complete after this merges.

Self-commit SHA: `<PLACEHOLDER>` (filled by the conventional follow-up commit, matching the F3 S1/S2/S3 pattern).

## TL;DR

| | Before S4 | After S4 |
|---|---|---|
| `/api/generate` provider call | raw `fetch` to Gemini's OpenAI-compatible endpoint, manual SSE parsing | `generateHtmlStream({ apiKey, messages, userId, ... })` |
| `/api/generate` HTML pipeline | per-byte deltas accumulated, `normalizeBornCanonical` post-flight | per-write chunks already sanitized + normalized via HtmlStream; `done.finalHtml` is the canonical doc |
| `/api/generate` SSE shape | `reasoning_chunk` + `html_chunk` split on `---HTML---` marker | `html_chunk` only — marker scheme retired (Gemini's instruction-tuning makes it unreliable + unnecessary) |
| `/api/templates/ai-design` provider call | raw `fetch` to Gemini's OpenAI-compatible endpoint, manual SSE parsing | `GeminiProvider.stream(...)` for-await loop |
| `/api/templates/ai-design` Mode A / B | unchanged | unchanged — chat UX still needs marker-split + dual-mode dispatch |
| `together-ai` SDK dep | declared, **zero importers** | removed |
| Model picker UI | already Gemini-only (Pro / Flash) | unchanged (Phase D was effectively text-cleanup) |
| Style Match autofill (`/api/templates/autofill`) | uses raw `fetch` to `api.together.xyz`, Kimi K2.6 | **unchanged — out of scope per F3 S4 brief** |

## Phase A — investigation findings

Before touching code: a full audit of provider routing + model picker UI + Together / Kimi references across the repo.

### `resolveAIProvider` was already Gemini-only

`lib/ai-provider.ts` returns Google's OpenAI-compatible endpoint for both `"gemini-pro"` and `"gemini-flash"`. No Kimi/Together branch exists. The Kimi-only-then-multi-provider transition happened *before* F3 S4, leaving residual Kimi/Together references in:

- Hand-written `fetch(PROVIDER.url, ...)` call sites in the two route handlers (the bytes themselves were already going to Gemini, but the response handling code still spoke OpenAI/Together-style SSE)
- JSDoc + inline comments throughout `components/workspace-v2/` referring to "Kimi K2.6" by name
- `package.json` description string + `together-ai` SDK dependency (declared but never imported)

### Model picker (`components/workspace-v2/model-picker.tsx`) was already Gemini-only

```ts
const MODEL_META: Record<AIModel, ...> = {
  "gemini-pro":   { label: "Gemini 2.5 Pro", note: "Recommended" },
  "gemini-flash": { label: "Gemini 2.5 Flash", note: "Faster" },
};
```

No Kimi option to remove. Phase D's "remove Kimi K2.6 from picker" reduced to "fix Kimi-mentioning JSDoc + inline comments."

### Carry-over: Style Match autofill stays on Together (out of scope)

`lib/style-match/autofill/fill-template.ts` directly calls Together's chat-completions endpoint with Kimi K2.6 + `TOGETHER_API_KEY`. The F3 S4 brief excludes Style Match explicitly ("✗ Cambios a Style Match (Gemini vision, diferente code path)"). Consequences:

- `TOGETHER_API_KEY` stays in `.env.local.example` + `infra/app/env.example` + the deploy scripts.
- The `together-ai` *SDK* dep is still removed — autofill uses raw `fetch`, not the SDK. Grep confirms zero TS/JS importers of `together-ai` anywhere in the repo.
- Vision (Style Match URL → tokens) was already Google-AI direct via raw fetch — no Together there either.

This carry-over is the *only* Together-side surface that ships to prod after S4. A follow-up session can migrate autofill to `@openlen/ai-gateway` once the GeminiProvider grows a vision path; the Together MCP catalog probe ([[together-models-probe]]) shows Kimi K2.6 has no vision tier on Together anyway, so the autofill text-fill is the only thing that would change.

### Other AI surfaces touched

- `lib/use-generation.ts` — client-side consumer of `/api/generate` SSE. Updated the "Together is slow under load" comment to a provider-neutral version; the `reasoning` state field on `GenerationState` stays (vestigial, always empty after S4, but the type isn't worth breaking for one field).
- `app/new-v2/page.tsx` — one stale JSDoc comment fixed (`Kimi K2.6 streaming` → `Gemini streaming`).
- `components/workspace-v2/{left-sidebar,panels/chat-panel,panels/brief-panel,use-section-reorder,use-section-select}.tsx` — JSDoc + inline comments updated.
- `components/workspace-v2/autofill-modal.tsx` left alone — autofill genuinely still uses Kimi K2.6, the label `"Kimi K2.6 escribiendo…"` is factually correct.

## Phase B — `/api/generate` cutover

**File:** `app/api/generate/route.ts`

**Decisions recorded:**

1. **Marker scheme retired.** The Kimi-era system prompt instructed the model to emit "1-3 sentences of design reasoning → blank line → `---HTML---` literal → HTML document." The `useGeneration` client consumed both `reasoning_chunk` (display in the loading overlay) and `html_chunk` (live preview). Per the F3 S3 handoff's own recommendation ("Probably drop, since Gemini's instruction-tuning makes the marker scheme less reliable than it was for Kimi"), S4 drops it: the system prompt now says "the first character of your response is `<`." The route stops emitting `reasoning_chunk` events. `useGeneration` keeps the `reasoning` state field for type stability but it stays an empty string — the loader gracefully falls back to "Reading your brief…" (the `aiGenState.reasoning ||` short-circuit already covered this case).

2. **`htmlOpts.injectOpIds: false` for fresh generations.** Op-ids are a chat-edit protocol marker; a fresh page has no need for them. Saving them with the project bloats every DB row and the chat tab re-tags via `tagWithOpIds` at every edit turn anyway. The S3 helper defaults to `injectOpIds: true` (because chat-edit-after-generate is the typical follow-up), but for the `/api/generate` cutover the cleaner DB shape wins.

3. **Credit accounting moved into the helper.** The route's pre-flight credit-balance gate (`balance < 1 → SSE error`) stays. The post-flight `creditsForUsage(...) + debitCredits(...)` calls are removed — `generateHtmlStream` debits on the upstream `usage` event using the exact token counts the provider reports. The route logs token usage via `summary.usage` for parity with the old log line.

4. **Keepalive preserved.** Gemini's "thinking" phase can be silent for many seconds on Pro; the 5-second `progress` event keepalive (same SSE event name as before) stays so `useGeneration`'s SILENCE_TIMEOUT_MS watchdog doesn't false-positive.

5. **Stall guard removed.** The Kimi-era 720s read-or-stall guard was a Together-specific workaround (Together would 200-then-silent under load). Gemini's GeminiProvider has its own cancel propagation via AbortSignal; the route's `upstreamAbort` covers both the consumer-cancel path (`ReadableStream.cancel()`) and any throw out of the for-await loop.

6. **Error mapping.** Pre-stream errors stay as HTTP 4xx/5xx JSON responses (auth, quota, missing API key, malformed body). Stream-level errors surface via the `error` SSE event with the upstream message string — `summary.error?.message` for GatewayError shapes, fallback to "Generation failed — try again." for null cases.

**Stream-shape contract** (preserved against `lib/use-generation.ts` + `app/new-v2/page.tsx`):

| SSE event | Payload | When |
|---|---|---|
| `html_chunk` | `{ text: string }` | Each per-write HtmlStream chunk |
| `progress` | `{ chars: number }` | Every 5 s; keeps client watchdog reset |
| `project_saved` | `{ projectId, title }` | Terminal success |
| `error` | `{ message: string }` | Any failure path |

(No more `reasoning_chunk`.)

## Phase C — `/api/templates/ai-design` cutover

**File:** `app/api/templates/ai-design/route.ts`

**Decision recorded — why GeminiProvider directly, not `generateHtmlStream`:**

The chat-edit endpoint has two output modes:

- **Mode B** (full rewrite): a complete `<!doctype>...</html>` document. Conceptually compatible with `generateHtmlStream`.
- **Mode A** (ops emission): an `<edits><edit op="..." target="...">...</edit></edits>` XML block. **Not** HTML. Piping this through `HtmlStream.write()` would either get wrapped in synthetic `<html><body>` boilerplate (sanitizer's default for loose content) or fail validation entirely.

Two ways to solve this:

1. Add an `htmlPipeline?: boolean` option to `generateHtmlStream` that, when `false`, skips HtmlStream entirely and emits raw text deltas.
2. Skip `generateHtmlStream` for ai-design; use `GeminiProvider.stream()` directly and let the route handler keep its mode-dispatch logic.

**Chose option 2.** Reasons:

- The route already has the apparatus for marker-split + Mode A vs Mode B dispatch + token accounting + DB persist + version snapshot. Re-using `generateHtmlStream` with `htmlPipeline: false` would just move the same logic into a different file.
- `generateHtmlStream`'s value-add (sanitize + normalize on end) is exactly what we *don't* want for Mode A and is redundant for Mode B (the route already does `stripOpIds → normalizeBornCanonical` post-flight). HtmlStream's per-write sanitize is real value-add only for `/api/generate`, where the stream output IS the final document.
- Adding `htmlPipeline?: boolean` to a tested helper would invalidate its test invariants (12 cases assume the pipeline always runs). The helper stays clean for its primary caller.

So the route handler keeps its existing structure, with one targeted replacement: the raw `fetch` + manual SSE parsing → `provider.stream(...)` for-await loop. Marker-split (`handleDelta` / `flushReasoning`), Mode A `parseOps → applyOps → stripOpIds`, Mode B `stripOpIds → normalizeBornCanonical`, scope/pin handling, image attachment, credit accounting — all preserved 1:1.

**Other changes in this file:**

- `STREAM_TIMEOUT_MS = 360_000` is now a top-of-file constant, wired via a `setTimeout(() => upstreamAbort.abort(), STREAM_TIMEOUT_MS)` (instead of the previous `AbortSignal.timeout(360_000)` on the fetch). Same end result — a wedged stream is aborted after 6 minutes — but the timeout handle is cleared on stream close so a successful run doesn't leak a pending timer.
- Error messages that mentioned Kimi by name now read "the model" instead. Same wording elsewhere.
- The `MAX_PROMPT_TOKENS = 240_000` cap stays — Gemini 2.5 Pro has 1M-token context but a 240K-token request on a single chat turn is a sign the user should be using Select to scope down anyway.

## Phase D — model picker UI cleanup

The picker was already Gemini-only (no Kimi option to remove). Phase D reduced to JSDoc + inline-comment cleanup in:

- `components/workspace-v2/panels/chat-panel.tsx` — 6 mentions of "Kimi K2.6 / Kimi" → "Gemini / the model"
- `components/workspace-v2/panels/brief-panel.tsx` — 1 mention
- `components/workspace-v2/left-sidebar.tsx` — 2 mentions in JSDoc
- `components/workspace-v2/use-section-reorder.ts` — 1 mention
- `components/workspace-v2/use-section-select.ts` — 1 mention
- `app/new-v2/page.tsx` — 1 mention

Files NOT touched (factually correct Kimi references):
- `components/workspace-v2/autofill-modal.tsx` — autofill genuinely uses Kimi K2.6 ("Kimi K2.6 escribiendo…" is correct)
- `app/api/templates/autofill/route.ts` — autofill genuinely uses Kimi K2.6
- `lib/style-match/autofill/fill-template.ts` — autofill genuinely uses Kimi K2.6
- `app/api/generate/route.ts` — one historical reference ("the Kimi era was dropped") in the route header preserved for context

## Phase E — `together-ai` dep removal

```diff
-    "tailwind-merge": "^3.6.0",
-    "together-ai": "^0.21.0",
-    "zod": "^3.24.1"
+    "tailwind-merge": "^3.6.0",
+    "zod": "^3.24.1"
```

`package.json` `description` field updated from "smart multi-model routing on Together AI" → "Gemini streaming via the @openlen/ai-gateway Rust crate".

Verification (Phase A): `grep -rE 'from\s+["'"'"']together-ai["'"'"']' .` → zero matches. The SDK was declared as a dep but never imported; autofill (the only Kimi/Together-side surface left) uses raw `fetch`.

What stays:
- `TOGETHER_API_KEY` env var (autofill still needs it)
- `lib/style-match/autofill/*` (carry-over)
- The historical "Kimi" references in autofill UI (factually correct)
- The `infra/app/env.example` + `infra/scripts/push-env.sh` + `infra/app/install-app.sh` `TOGETHER_API_KEY` plumbing (autofill in prod needs the key)

## Phase F — smoke samples

**Script:** `bench/cutover-samples/smoke.ts`

Mirrors what the two route handlers do (system prompt, generateHtmlStream pipeline / GeminiProvider stream loop, born-canonical normalize on end) but skips the HTTP / DB / auth layer so the AI-quality signal isn't entangled with infra plumbing. Run command:

```bash
# In the worktree, with GEMINI_API_KEY in .env.local:
node --env-file=.env.local --import tsx bench/cutover-samples/smoke.ts
```

**Outputs:**

- `bench/cutover-samples/generate/{slug}-gemini.html` × 3
  - `linear-clone` — dark technical landing
  - `coffee-shop` — warm editorial single-origin
  - `ai-product-with-form` — AI tool with hero + waitlist + testimonials
- `bench/cutover-samples/ai-design/{slug}-gemini.html` × 3 (+ `.reasoning.txt` siblings)
  - `mode-a-headline-cta` — small Mode A edit on a seed page
  - `mode-b-editorial-rebuild` — Mode B tonal rebuild
  - `mode-b-dark-cinematic` — Mode B with structural restyle
- `bench/cutover-samples/SUMMARY.md` — run report (status per sample, bytes, duration, token usage)

**Smoke results** (recorded in `bench/cutover-samples/SUMMARY.md`):

| Surface | Slug | Status | Bytes | Duration | Tokens |
|---|---|---|---|---|---|
| /api/generate | linear-clone | ✓ | 40,228 | 79.3 s | 2,831 → 10,868 |
| /api/generate | coffee-shop | ✓ | 23,553 | 55.5 s | 2,842 → 6,473 |
| /api/generate | ai-product-with-form | ✓ | 44,927 | 113.1 s | 2,840 → 16,381 |
| /api/templates/ai-design | mode-a-headline-cta | ✓ (ops) | 8,461 | 6.8 s | 1,294 → 116 |
| /api/templates/ai-design | mode-b-editorial-rebuild | ✓ (rewrite) | 9,928 | 33.5 s | 1,303 → 1,141 |
| /api/templates/ai-design | mode-b-dark-cinematic | ✓ (rewrite) | 10,495 | 28.9 s | 1,306 → 1,441 |

All 6/6 samples generated cleanly on the first run after the fence-strip fix (see "Surprise" below). Born-canonical markers (`<script data-ol-radius>` / `data-ol-space` / etc.) landed in every output. The operator should still open each HTML in a browser for visual review before declaring the cutover done.

**Surprise during smoke** (and fix that landed in Phase B):

The first smoke run failed 2/3 `/api/generate` samples with `validation failed (head=\`\`\`html\n<!doctype html>...`. Gemini 2.5 Pro occasionally wraps its output in `\`\`\`html...\`\`\`` markdown fences despite the system prompt's explicit "no markdown code fences" instruction. The Kimi-era route had a `stripMarkdownFences()` post-flight as a safety net; the cutover route initially dropped it (assuming the new prompt was strong enough). After re-adding the function, 3/3 generate samples pass. The same safety net now lives in `smoke.ts` so the bench result mirrors prod behaviour exactly.

Lesson worth flagging for future work: Gemini's instruction-following on output-format constraints is *not* as tight as Kimi's was. Anything that previously relied on the Kimi prompt being honored verbatim deserves a defensive post-flight check.

## Acceptance vs. the S4 brief

| Criterion | Status |
|---|---|
| `/api/generate` uses `generateHtmlStream` (Gemini), NOT Kimi | green |
| `/api/templates/ai-design` uses GeminiProvider (Gemini), NOT Kimi | green (per Phase C rationale, NOT `generateHtmlStream` because of Mode A) |
| Model picker UI no longer offers Kimi K2.6 | green (was already Gemini-only — Phase A finding) |
| Together client + dep removed if no other consumer | dep removed; autofill carry-over documented |
| Smoke tests green against ai-design + generate (live, against Gemini) | green — 6/6 (see results table) |
| Visual quality side-by-side check via `bench/cutover-samples/` | samples shipped; **operator follow-up** to browser-inspect |
| `npx tsc --noEmit` green | green |
| `cargo check --workspace` green | green |
| Existing tests pass + new tests pass | green — 12/12 `lib/ai-stream/generate.test.ts` re-runs unchanged |
| `grep -r "kimi"` returns 0 unintended matches | **green** — remaining matches are intentional: autofill (still uses Kimi), historical `(Kimi era)` comments in route headers, handoff docs, memories |

## Files touched

```
app/api/generate/route.ts                                rewrite (cutover, B)
app/api/templates/ai-design/route.ts                     rewrite (cutover, C)
app/new-v2/page.tsx                                      JSDoc cleanup (D)
components/workspace-v2/left-sidebar.tsx                 JSDoc cleanup (D)
components/workspace-v2/panels/brief-panel.tsx           JSDoc cleanup (D)
components/workspace-v2/panels/chat-panel.tsx            JSDoc + comment cleanup (D)
components/workspace-v2/use-section-reorder.ts           comment cleanup (D)
components/workspace-v2/use-section-select.ts            comment cleanup (D)
lib/use-generation.ts                                    comment cleanup (B)
lib/html-ops.ts                                          JSDoc cleanup (D follow-up)
lib/design-guidance.ts                                   module header cleanup (D follow-up)
lib/db/schema.ts                                         column-comment cleanup (D follow-up)
package.json                                             remove together-ai dep + update description (E)
package-lock.json                                        regenerated after dep removal (E)
docs/rust-f3-session4-handoff.md                         NEW — this file (G)
bench/cutover-samples/smoke.ts                           NEW — live samples script (F)
bench/cutover-samples/generate/{...}-gemini.html         NEW — 3 samples (F)
bench/cutover-samples/ai-design/{...}-gemini.html        NEW — 3 samples + reasoning siblings (F)
bench/cutover-samples/SUMMARY.md                         NEW — run report (F)
```

Zero changes to Rust source (`crates/`). Zero changes to `lib/ai-stream/generate.ts` (the S3 helper is consumed as-is by the new `/api/generate`). Zero changes to `lib/ai-gateway.ts` (consumed as-is by the new `/api/templates/ai-design`).

## Operator follow-up

1. **Visual review.** Open each `bench/cutover-samples/{generate,ai-design}/*-gemini.html` in a browser. Specifically check:
   - Page renders end-to-end (no JS errors, no half-rendered hero from a truncated stream)
   - Typography hierarchy looks intentional (display vs body, accent color usage)
   - Mobile responsiveness down to 360 px
   - Born-canonical markers landed in `<head>` (look for `<script data-ol-radius>` / `data-ol-space` / `data-ol-type` / `data-ol-font`)
   - For ai-design Mode A samples: the requested element changed and nothing else did
   - For ai-design Mode B samples: the entire visual language shifted as requested
2. **If any sample looks visually worse than its Kimi-era equivalent,** flag it before merging this branch. The cutover code can stay; the issue may be a system-prompt nuance (Gemini interprets some instructions differently than Kimi did).
3. **Live regression check.** Generate one fresh page via the workspace UI (`/new-v2?mode=ai`) and one chat-edit turn from a template-clone to confirm the SSE wire shape is right. (`useGeneration` no longer sees `reasoning_chunk` events; the iframe should still update.)
4. **Style Match autofill is the last Together caller** — a follow-up session can migrate it to Gemini once `GeminiProvider` grows a vision path (or once Together exposes Kimi multimodal serverless — see [[together-no-serverless-vision]]).

## Open questions / for the next session

1. **Gemini's behavior on the `---HTML---` marker prompt** in `/api/templates/ai-design`. Kimi's training internalized the marker pattern well. Gemini's instruction-tuning works fine on the simpler "emit HTML directly" prompt (the `/api/generate` test bench validates this), but for ai-design we kept the marker because the chat UX needs reasoning split out. Watch the F samples for marker compliance — if Gemini drops the marker on Mode B rewrites, the route's `mode === "reasoning"` post-stream check fires and surfaces "Model only returned reasoning". A future session might switch ai-design to structured output (Gemini supports JSON schema mode) to remove the marker dependency.

2. **`useGeneration.reasoning` is now dead code.** Kept the field on `GenerationState` for type stability; could be removed in a follow-up that also drops the `aiGenState.reasoning ||` fallback in `app/new-v2/page.tsx:1072`. Not urgent — the empty string fallback is harmless.

3. **`MAX_PROMPT_TOKENS = 240_000` in ai-design** is a Kimi-era cap. Gemini 2.5 Pro has 1M-token context; the cap could be raised. But: a single chat turn against a 200KB tagged doc is wasteful even when it fits, and the Select-to-scope UX flow assumes the cap fires for huge pages. Worth re-tuning empirically post-cutover.

4. **Autofill migration.** As above — once vision lands on `GeminiProvider`, autofill can move off Together. The cache layer in `lib/style-match/autofill/cache.ts` is provider-agnostic and stays.

5. **F3 is COMPLETE post-merge.** No F3 S5. F4 (or whatever's next) starts from the merge tip with a clean Gemini-only stack except the documented autofill carry-over.

## How the next session picks up

```bash
git fetch
# F3 S4 lands on master; the next session branches off master normally.
```
