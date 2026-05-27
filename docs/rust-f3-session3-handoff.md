# Rust F3 — Session 3 handoff

**Branch:** `rust/f3-session3-pipeline` (off `origin/master @ 719111b` = F3 S2 merged tip)
**Date:** 2026-05-27
**Scope shipped:** F3 Session 3 — `generateHtmlStream` pipeline helper at `lib/ai-stream/generate.ts`, mock-based tests, and the webpack carve-out for `@openlen/ai-gateway`. Nobody calls it yet — the cutover at `/api/generate` and `/api/templates/ai-design` is F3 S4.

## TL;DR

S3 stitches the three F-track outputs that landed in earlier sessions into one consumable helper:

```ts
import { generateHtmlStream } from "@/lib/ai-stream/generate"

const { stream, done } = generateHtmlStream({
  apiKey: process.env.GEMINI_API_KEY!,
  messages: [{ role: "user", content: brief }],
  userId,
  signal: controller.signal,        // AbortSignal — cancel anytime
})

// Pipe `stream` to the SSE client for live preview chunks.
for await (const chunk of stream) {
  // bytes are HtmlStream.write() outputs (sanitized + op-id-tagged)
  sse.emit("html_chunk", chunk)
}

// `done` is the post-stream summary — never rejects.
const { finalHtml, usage, creditsDebited, stopKind } = await done
// finalHtml is the post-end() canonical doc (normalize + optional minify
// applied). Persist this to the DB; the live chunks are preview-only.
```

Three building blocks wired:

- **`@openlen/ai-gateway`** (F3 S1+S2): `GeminiProvider.stream()` yields `StreamEvent`s — `start | text_delta | usage | done` — with AsyncIterator + AbortSignal contracts.
- **`@openlen/html-engine`** (F1 S5): `HtmlStream` streams sanitize + op-id-tag on every `write()`, applies `normalize_born_canonical` + optional `optimize_for_publish` on `end()`.
- **`lib/credits.ts`**: `creditsForUsage(input, output, rate)` + `debitCredits(userId, n)`.

Plus the matching webpack carve-out so `next build` doesn't choke on the native `.node` binary the first time a server route imports the helper.

Three commits, one per logical phase (B is documentation-only — HtmlStream was already exposed to JS by F1 S5):

```
5a822f5  feat(infra):     F3 S3 A — externalise @openlen/ai-gateway for the Next.js webpack server bundle
1b48819  feat(ai-stream): F3 S3 C+D — generateHtmlStream pipeline helper
4699424  test(ai-stream): F3 S3 E — generateHtmlStream tests (12 cases, mock-based)
```

Self-commit SHA for this handoff doc: `<placeholder>` (filled in by the conventional follow-up commit, matching the F3 S1/S2 pattern).

## Acceptance vs. the S3 brief

| Criterion | Status |
|---|---|
| `npm run build` (Next.js standalone) green | **Webpack phase green** — `.next/server/chunks/` populated, **zero `.node` files in `.next/server/`** (verified by `find`). Post-webpack `generateStaticParams` for `/templates/[slug]` failed because the worktree has no working `DATABASE_URL`; this is a **pre-existing build dependency on `.env.local`**, not a regression. The host operator runs the standalone build with real env. |
| `npx tsc --noEmit` | green |
| `cargo check --workspace` | green |
| Tests green (mock-based, no live AI calls) | **12 pass, 0 fail, 0 skip** in `lib/ai-stream/generate.test.ts` (~1.9 s) |
| `@openlen/ai-gateway` NOT in the server bundle | Carve-out is in place; no production consumer yet, so the package isn't referenced from any `.next/server/*.js` chunk. (For comparison, `@openlen/html-engine` appears as `require("@openlen/html-engine")` in 18 server chunks — that's the exact pattern S4 will produce for ai-gateway.) |
| HtmlStream consumable from `lib/ai-stream/generate.ts` | green — imported via `lib/html-engine.ts` (already exposed in F1 S5; see Phase B below) |
| Helper returns ReadableStream consumable with `for await` from route handlers | green — `{ stream, done }` return type; `stream: ReadableStream<Uint8Array>` |
| Cancel via AbortSignal: stream closes < 500 ms + credits NOT debited (pre-usage) | green — three cancel tests; mid-stream cancel measured < 5 ms in the test loop |
| Zero touches to `app/api/generate/` or `app/api/templates/ai-design/` | green — `git diff origin/master -- app/api/` is empty |
| Handoff doc | this file |

## Phase-by-phase

### Phase A — Webpack carve-out (5a822f5)

`next.config.ts` extended exactly the way F1 S9 (commit 1ab1724) extended it for `@openlen/html-engine`:

- `serverExternalPackages` array grew from `["tailwindcss", "postcss", "@openlen/html-engine"]` → adds `@openlen/ai-gateway`.
- The `webpack(config, ctx)` callback's server-only externals function gained the corresponding pair: `request === "@openlen/ai-gateway"` and `request.endsWith("/crates/ai-gateway/index.js")`.

The `.node` suffix branch already caught the binary, so no change there.

**Phase A alone is a no-op behaviourally** — no app code imports `@openlen/ai-gateway` yet. The carve-out is pre-positioned so the next commit (Phase C) builds clean against `next build` rather than failing webpack at module-graph time.

### Phase B — HtmlStream surface check (no code)

The brief allowed for HtmlStream not yet being exposed to JS and reserving scope for an additional napi binding. That contingency did not fire: F1 S5 already shipped `HtmlStream` as a napi class with `constructor(opts?)`, `write(chunk: string): string`, and `end(): HtmlStreamResult`. The S5 surface is documented in `docs/rust-f1-session5-handoff.md §"Surface shipped"` and re-exported through `lib/html-engine.ts`:

```ts
import { HtmlStream as RustHtmlStream } from "@openlen/html-engine"
// …
export { RustHtmlStream as HtmlStream }
```

`lib/html-engine.test.ts` exercises both write + end paths (incl. slot-path rejection). Phase B reduces to "import and use it" — no new bindings, no rebuild needed.

The `crates/html-engine/__test__/stream.test.mjs` Node-side smoke tests (16 cases, F1 S5) cover the FFI boundary; this session adds no further crate work.

### Phase C+D — `generateHtmlStream` helper (1b48819)

One new file: `lib/ai-stream/generate.ts` (416 lines). Phase D (credit accounting) is fused into Phase C because the debit logic is a small handful of lines inside the same pull-loop — splitting it across two files would have left an awkward seam.

**API:**

```ts
export interface GenerateHtmlStreamOpts {
  apiKey: string
  messages: Message[]
  model?: "gemini-pro" | "gemini-flash"    // default: "gemini-pro"
  signal?: AbortSignal
  userId: string
  htmlOpts?: HtmlStreamOpts                // default: Rust crate defaults
  maxOutputTokens?: number
  temperature?: number
}

export interface GenerateHtmlStreamResult {
  stream: ReadableStream<Uint8Array>
  done: Promise<GenerateHtmlStreamSummary>
}

export interface GenerateHtmlStreamSummary {
  finalHtml: string | null                    // null on cancel/error
  result: HtmlStreamResult | null             // null when end() was not called
  usage: { inputTokens: number; outputTokens: number } | null
  creditsDebited: number                      // 0 on pre-usage cancel/error
  stopKind: "end_turn" | "max_tokens" | "cancelled" | "error"
  error: Error | null
}

export function generateHtmlStream(
  opts: GenerateHtmlStreamOpts,
  internals?: GenerateHtmlStreamInternals,    // test-only, see §"Test injection"
): GenerateHtmlStreamResult
```

**Why two return fields (`stream` + `done`), not a bare `ReadableStream<Uint8Array>`:**

The brief sketched the return type as `ReadableStream<Uint8Array>`, with an explicit invitation to "revisit if it feels clunky." It did feel clunky once I wrote the consumer mental model down:

- The per-write chunks (sanitized + op-id-tagged) are the *live preview* — what you'd pipe to the SSE client as the LLM speaks.
- `HtmlStream.end()` applies `normalize_born_canonical` (and optionally `optimize_for_publish`) to the *buffered full document*. That step can **rewrite the document mid-flight**, not just append. So `concat(per-write chunks) !== finalHtml` in general — the difference is the `<script data-ol-radius>` / `<script data-ol-space>` / `<script data-ol-type>` marker scripts plus any normalize-time CSS rewrites.

A single `ReadableStream<Uint8Array>` either has to (a) emit only the per-write chunks (live preview, but caller can't reconstruct the canonical doc), or (b) buffer everything and emit only `finalHtml` at end (no live preview, defeats the streaming name). Neither is right.

Returning `{ stream, done }` lets the consumer pick. The S4 cutover at `/api/generate` will:
- Pipe `stream` to the SSE client as `html_chunk` events for live preview.
- `await done` after, then persist `done.finalHtml` to the project as the canonical document.

That matches the existing `/api/generate` shape (the route does `emit("html_chunk", …)` per delta and saves the normalized HTML at the end), so S4 should be a near-mechanical port.

**Cancellation model:**

- `opts.signal` aborts → forwarded to the upstream `GeminiProvider` via an internal `AbortController`. Provider yields `Done{Cancelled}`; the for-await exits via the cancelled branch; `htmlStream.end()` is **NOT called** (partial document; F1 S5 spec); stream closes cleanly (`controller.close()` — not `controller.error`).
- `reader.cancel()` (consumer-side) → the `ReadableStream`'s `cancel()` callback fires `internalAbort.abort()`; same path.
- Both wired in one place so the provider only sees a single AbortSignal and never has to know which side fired.

**Credits hookup (the brief's Phase D):**

- Per-token rate computed from `creditsForUsage(inputTokens, outputTokens, modelKey)` (`lib/credits.ts`), debited on the `usage` event as soon as it arrives.
- Pre-charge: **NO** (per brief — defer to v2). The debit happens AFTER the LLM has reported real token usage, so we never charge for tokens that didn't fly.
- Refund on cancel: **NO** (per brief). If `usage` already fired before the cancel, the debit is already done. If `usage` hadn't fired yet, no debit was attempted in the first place. So there's nothing to refund.
- Debit failure: **best-effort**. If `debitCredits` throws (DB hiccup, network blip, whatever), the helper logs via `console.error` and continues serving the stream. Rationale: the LLM call already cost real money; closing the user's stream because the ledger had a transient failure would lose both the money and the user's generation. Reconciliation is a separate concern (the ledger's job).
- `summary.creditsDebited` records what *was* successfully debited, so the caller can read a precise number out (0 on failure or pre-usage cancel).

**Test injection:**

The helper accepts an optional second arg `internals?: GenerateHtmlStreamInternals` with `provider`, `debit`, and `makeHtmlStream` slots. Production callers ignore it entirely; tests pass mocks. The pattern is structurally typed (`GeminiProviderLike`, `DebitFn`, `HtmlStreamLike`) so test fakes don't have to subclass napi classes.

### Phase E — Tests (4699424)

One new file: `lib/ai-stream/generate.test.ts` (652 lines). Runs via `npx tsx --test lib/ai-stream/generate.test.ts` — the convention established by `lib/html-engine.test.ts`, `lib/normalize.test.ts`, `lib/shadow-soak.test.ts`, etc.

**Test helpers**

| Helper | Purpose |
|---|---|
| `scriptedProvider(script)` | Builds a `GeminiProviderLike` that yields a fixed event sequence. Honors `AbortSignal` — yields `Done{Cancelled}` and stops. Awaitable gates (`{ __wait: Promise<void> }`) let cancellation tests interleave aborts between specific events deterministically. |
| `PassthroughHtmlStream` | Returns `write()` input verbatim; `end()` returns the joined writes as `finalHtml`. Lets tests assert byte-equality between per-write chunks and `done.finalHtml`. |
| `ThrowingHtmlStream` | Throws on first `write()` with a slot-path-shaped message — for the "HtmlStream errors mid-stream" path. |
| `spyDebit() / failingDebit(N)` | Record debit calls / optionally fail N times before succeeding. |
| `readAll(stream)` / `readUntilBytes(stream, n)` | TextDecoder-aware ReadableStream consumers. |

**Cases (12, all pass)**

1. Happy path: 3 `text_delta` → 3 enqueued chunks; 1 `usage` → 1 debit; `stopKind === "end_turn"`; concat = `finalHtml`.
2. Happy path with `model: "gemini-flash"` routes the credit rate accordingly (1 credit vs Pro's 2 for the same token volume).
3. `max_tokens` stop still calls `end()` and surfaces `finalHtml`.
4. Cancel mid-stream: AbortController.abort() → stream closes < 500 ms (measured); debit **not** called.
5. Pre-flight cancel (signal aborted at call time) yields no chunks and no debit.
6. Consumer-side `reader.cancel()` forwards to upstream; no debit.
7. Cancel **after** `usage`: one debit recorded, no double-debit, `stopKind === "cancelled"`, `summary.creditsDebited` matches the single debit.
8. Auth error (provider iterator throws on first iteration): stream errors with the provider message; no debit.
9. `done { kind: "error" }` (mid-stream provider-level error): stream errors with the provider's error string; no debit.
10. `HtmlStream.write` throws (slot-path detection): stream errors; no further chunks; no debit.
11. Debit failure: stream completes normally; `console.error` logged; `summary.creditsDebited === 0`; `summary.error === null`.
12. `done` promise resolves (never rejects) even on errors — caller can `await done` without try/catch and inspect `.stopKind`.

Total wall time ~1.9 s; the longest test (#7, "cancel after usage") includes a 20 ms `setTimeout` to let the provider's microtask queue drain past the `usage` event before the abort lands.

## How a route handler will consume this (S4 sketch)

```ts
// app/api/generate/route.ts — post-S4 sketch
import { generateHtmlStream } from "@/lib/ai-stream/generate"

export async function POST(req: Request) {
  const { brief, model } = await req.json()
  const session = await auth()
  const userId = session.user.id  // pre-flight auth/quota as today

  const upstream = new AbortController()

  const { stream, done } = generateHtmlStream({
    apiKey: process.env.GEMINI_API_KEY!,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `BRIEF:\n${brief}` },
    ],
    model: model === "gemini-flash" ? "gemini-flash" : "gemini-pro",
    userId,
    signal: upstream.signal,
    maxOutputTokens: 65_536,
    temperature: 0.8,
  })

  // SSE wrapper.
  const sse = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      const emit = (event: string, data: unknown) =>
        controller.enqueue(encoder.encode(
          `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`,
        ))

      try {
        for await (const chunk of stream) {
          emit("html_chunk", { text: new TextDecoder().decode(chunk) })
        }
      } catch (err) {
        emit("error", { message: (err as Error).message })
        controller.close()
        return
      }

      const summary = await done
      if (summary.stopKind === "error" || !summary.finalHtml) {
        emit("error", { message: summary.error?.message ?? "generation failed" })
        controller.close()
        return
      }

      // Persist + finish.
      const title = extractTitle(summary.finalHtml) ?? brief.slice(0, 60)
      const projectId = await createProject(userId, {
        html: summary.finalHtml, brief, title,
      })
      emit("project_saved", { projectId, title })
      controller.close()
    },
    cancel() { upstream.abort() },
  })

  return new Response(sse, { headers: { "Content-Type": "text/event-stream" } })
}
```

That's S4's `/api/generate`. `/api/templates/ai-design` follows the same shape with a different SYSTEM_PROMPT + project-update-instead-of-create at the end.

## Decisions recorded

1. **Return type is `{ stream, done }`, not bare `ReadableStream<Uint8Array>`.** See Phase C above for the rationale. The brief explicitly invited revisiting if clunky.

2. **No pre-charge, no refund.** Debit on `usage` event; cancellation pre-usage skips debit entirely. Matches the F3 S2 handoff spec; v2 can add per-grant ledger entries if reconciliation gets messy.

3. **Best-effort debit accounting.** Debit failures log + continue. The cost trade-off: a transient ledger failure during a successful generation costs us one user's worth of credits (free generation, edge case); a strict-mode debit would close the stream and lose both the credits AND the user's output. Stream availability > strict bookkeeping for v1.

4. **Test injection via optional `internals` parameter**, not module-level mutable state. Structural types (`GeminiProviderLike`, `DebitFn`, `HtmlStreamLike`) keep test fakes simple — no need to subclass napi classes. Production callers ignore the second arg entirely.

5. **Phase B = doc-only.** F1 S5 already exposed `HtmlStream` to JS as a napi class. No additional binding work was needed. The `crates/html-engine` napi surface is unchanged this session.

6. **Phase D folded into Phase C's commit.** The debit logic is ~15 lines inside the same `pull` loop as the rest of the helper; splitting into a separate commit would have left a noisy seam in `lib/ai-stream/generate.ts`. The commit message lists both phases explicitly.

## Open questions for review / Session 4

1. **Live integration test.** All S3 tests are mock-based — they validate `generate.ts`'s control flow but not the round-trip against a real Gemini stream + real `HtmlStream`. The S4 cutover will pick up the integration test concern naturally (the route handler exercises both crates end-to-end). If reviewers want a smoke test before S4 lands, run:

   ```bash
   cd D:/worktrees/openlen-f3-s3
   # with GEMINI_API_KEY in env:
   # (no test file scaffolded — write a one-shot script if needed)
   ```

   I considered scaffolding a live test as `lib/ai-stream/generate.live.test.ts` (gated by env), but the upstream `crates/ai-gateway/__test__/live.test.mjs` already covers the GeminiProvider end. Wiring a third live-test path felt redundant.

2. **`finalHtml` size on max_tokens.** When the model truncates (`max_tokens`), `HtmlStream.end()` still runs on whatever partial document arrived. The test (#3) verifies this works without throwing, but doesn't validate the resulting HTML is well-formed (it may end mid-tag). The publish-time gate in `app/api/generate/route.ts` already checks `/<\/html>\s*$/i.test(html)` and surfaces a friendlier error — S4 should keep that check after the cutover.

3. **`stopKind: "error"` granularity.** Today the helper surfaces a single `error` bucket whether the failure was an `AuthError`, `RateLimitError`, network drop, or HtmlStream rejection. The provider already classifies via `GatewayError.kind` (`api | network | cancelled | invalid_response | rate_limited | auth`). If S4 wants per-kind branching (e.g. retry vs. immediate-fail), expose `summary.gatewayErrorKind: GatewayErrorKind | null`. Not adding speculatively; flag for S4.

4. **HtmlStream `htmlOpts` defaults.** Today we pass through whatever the caller specifies; `undefined` lets the Rust crate apply its defaults (`injectOpIds = true`, `sanitize = true`, `normalizeOnEnd = true`, `minifyOnEnd = false`). For the chat-edit path (`/api/templates/ai-design`), `minifyOnEnd: true` might be wanted to keep diffs small. Decide at S4.

5. **No retry / backoff wrapper.** Same status as F3 S1+S2 — `GatewayError.retryable` is surfaced via the typed error class, but no automatic retry. Adding a thin TS-side retry layer would live in this file or a sibling. Out of scope for S3.

6. **No Prometheus / tracing.** Same status as F3 S1+S2 — no telemetry on this path. The natural place to add `gateway_requests_total{model, kind}` / `gateway_request_duration_seconds` / `gateway_tokens_total{direction}` is at the first production call site. S4 is that call site; consider then.

7. **The `_reason` arg in `ReadableStream.cancel(reason)` is dropped.** I forward to `internalAbort.abort()` with no reason. The reason would be visible inside the provider's `CancellationToken` listeners if we threaded it through `abort(reason)` and the `AbortSignal` bridge. Today the upstream provider treats any abort as "user cancel" without inspecting the reason, so threading it adds no value. Flagging in case S4 wants reason propagation for telemetry.

## F3 S4 spec — `/api/generate` + `/api/templates/ai-design` cutover

S4 is the FIRST session that actually consumes `generateHtmlStream` from a route handler. Two routes change:

### `/api/generate`

- Replace the Together / Kimi K2.6 fetch + manual SSE parsing in `app/api/generate/route.ts` with a `generateHtmlStream({ apiKey, messages, userId, signal, model, … })` call.
- Keep the existing pre-flight: auth + quota + credit gate (≥1 credit). The post-flight credit debit moves into `generateHtmlStream` (already wired).
- Keep the `marker-split (---HTML---) → reasoning_chunk vs html_chunk` SSE shape, OR drop the marker entirely and stream only `html_chunk` events — depends on whether the consumer still wants the reasoning preamble. Probably drop, since Gemini's instruction-tuning makes the marker scheme less reliable than it was for Kimi.
- Keep the post-success `createProject` + `createVersion` + `project_saved` SSE event.
- Keep the `stripMarkdownFences` + slot-path detection guards before persisting.

### `/api/templates/ai-design`

- Same engine swap but on the chat-edit path. The existing route doesn't create a project; it mutates an existing one.
- Keep the `htmlOps` apply-ops parsing if it's still part of that route, or simplify to "full rewrite" if the chat surface always emits a complete new document.

### Adjacent cleanup

- Remove the Kimi K2.6 option from the AI model picker UI (and the `together-ai` SDK package from `package.json` if no other caller remains). Per memory `[[f3-gemini-only-provider]]`, F3 commits to Gemini-only — Kimi stays as long as it's referenced; this is the cutover that drops the last reference.
- `lib/ai-provider.ts` simplifies to a one-model dispatcher (or get folded into `generate.ts` outright).
- The Hetzner `infra/scripts/deploy.sh` step needs a new download for the `@openlen/ai-gateway` `linux-x64-gnu` prebuild — same pattern as `@openlen/html-engine`. Make sure the `ai-gateway-v0.1.0` tag has been pushed to GitHub before deploying (F3 S2 handoff Open Question #5).

### Acceptance for S4

- `/api/generate` produces a project against a real GEMINI_API_KEY end-to-end.
- `/api/templates/ai-design` produces a redesign against the same.
- Both routes' SSE keepalive / stall-guard / cancel-propagation behaviour is preserved or improved.
- Credit accounting is verified by inspecting `users.credits` before/after a real generation against a test user.
- `together-ai` removed from `package.json`.

## Files touched

```
docs/rust-f3-session3-handoff.md          NEW — this file
lib/ai-stream/generate.ts                 NEW (416 lines)
lib/ai-stream/generate.test.ts            NEW (652 lines, 12 tests)
next.config.ts                            ↳ add @openlen/ai-gateway to externals (mirror of F1 S9 1ab1724)
```

Zero changes to Rust source. Zero changes to other `lib/` files. Zero changes to `app/`, `components/`, `infra/`, or any other consumer. The `crates/ai-gateway` and `crates/html-engine` napi `.node` artifacts + generated `index.{js,d.ts}` are gitignored and rebuilt locally / by CI.

## How the next session picks up

```bash
git fetch
git checkout rust/f3-session4-cutover               # or off the merge
cd D:/worktrees/openlen-f3-s4                       # new worktree
export CARGO_TARGET_DIR=D:/rust/target              # share the target dir

# Build napi binaries if not already cached:
(cd crates/ai-gateway && npm install && npm run build:debug)
(cd crates/html-engine && npm install && npm run build:debug)

npx tsc --noEmit                                    # green baseline
npx tsx --test lib/ai-stream/generate.test.ts       # 12 pass baseline
```

Then start with the `/api/generate` cutover — that's the load-bearing route, and once it's stable on `generateHtmlStream`, `/api/templates/ai-design` is a near-mechanical follow-up.
