# Rust F3 — Session 2 handoff

**Branch:** `rust/f3-session2-napi` (off `rust/f3-session1-gateway @ c426cad`)
**Date:** 2026-05-27
**Scope shipped:** F3 Session 2 — napi-rs binding for `openlen-ai-gateway`,
TypeScript wrapper at `lib/ai-gateway.ts`, Node-side mock + live tests,
CI prebuild workflow.

## TL;DR

`crates/ai-gateway/` is now consumable from Node. After this session,
`import { GeminiProvider } from "@openlen/ai-gateway"` works in any
file in the workspace — both directly (the JS class with `next()` /
`cancel()`) and through the curated TS wrapper at `lib/ai-gateway.ts`
(which adds a `Symbol.asyncIterator` + an `AbortSignal` bridge + a
typed `GatewayError` subclass).

Nobody imports it yet. The cutover at `/api/generate` and
`/api/templates/ai-design` is F3 S4 (per the S2 brief's out-of-scope
list). F3 S3 is HtmlStream + credit-gate hookup.

Six commits, one per phase A–F. The handoff doc itself is the seventh
(this commit; the conventional "fill in self-commit SHA" follow-up is
the eighth, matching the F3 S1 pattern).

**Acceptance vs. the S2 brief:**

| Criterion | Status |
|---|---|
| `cargo check --workspace` | green |
| `cargo test -p openlen-ai-gateway` — 79 baseline | green (now 92: 80 unit + 12 mock) |
| `npm run build -w @openlen/ai-gateway` produces `.node` | green (2.4 MB Win64 in release mode) |
| `npm test -w @openlen/ai-gateway` without GEMINI_API_KEY | green (18 pass, 2 skip) |
| `npm test -w @openlen/ai-gateway` with GEMINI_API_KEY | reviewer-run; see Open Questions |
| `npx tsc --noEmit` | green |
| Cancel <500ms verified (mock + live) | mock: < 4 ms in tests; live: reviewer-run |
| Stream consumable via `for await (... of stream)` | green (TS wrapper does it) |
| CI workflow file syntactically valid | green (yamllint unavailable locally; structure is a near-1:1 mirror of the html-engine workflow that's been in production since F1 S6) |
| `cargo fmt --check` | clean |
| `cargo clippy --all-targets -D warnings` | clean |
| Handoff doc | this file |

## Commits on this branch

```
5784425 chore(rust/ai-gateway): F3 S2 A — napi-rs crate setup
de81dff feat(rust/ai-gateway): F3 S2 B — expose GeminiProvider via napi
86b6c9b feat(rust/ai-gateway): F3 S2 C — async stream bridge + cancel
66faef7 feat(ai-gateway):      F3 S2 D — TS wrapper + Rust↔JS naming alignment
96cf7c1 test(ai-gateway):      F3 S2 E — Node-side mock + live tests
d59abdf ci(ai-gateway):        F3 S2 F — prebuild workflow for tag pushes
```

Self-commit SHA for this handoff doc: `__SELF_SHA__` (to be filled in
by the conventional follow-up commit).

## Phase-by-phase

### Phase A — Crate setup

`crates/ai-gateway/Cargo.toml` switched from `crate-type = ["rlib"]`
to `["cdylib", "rlib"]`. Added `napi = { version = "2", default-features
= false, features = ["napi6", "async", "tokio_rt"] }`,
`napi-derive = "2"`, and a `napi-build = "2"` build-dep. The
`async` + `tokio_rt` features were essential — `async fn` on a
`#[napi] impl` method requires both; without them the methods compile
to FFI shims that immediately panic at call time.

`crates/ai-gateway/build.rs` is the standard `napi_build::setup()`
shim.

`crates/ai-gateway/package.json` mirrors `@openlen/html-engine`'s
shape: same triples (win32-x64-msvc + linux-x64-gnu), same script set
(`build`, `build:debug`, `test`, `test:rust`, `test:node`,
`prepublishOnly`), same `optionalDependencies` pattern for the
per-platform pre-built artifact (`@openlen/ai-gateway-win32-x64-msvc`,
`@openlen/ai-gateway-linux-x64-gnu` at `0.1.0`). `.gitignore` matches
html-engine's exclusions (the generated `index.js`, `index.d.ts`,
`*.node`, plus `node_modules/`, `.napi-rs/`, and `npm-debug.log*`).
`.npmignore` strips source so npm consumers see only the binding
surface.

`package-lock.json` for the crate locks `@napi-rs/cli` for
reproducible builds.

### Phase B — Sync napi surface

`src/napi.rs` (new module added to `lib.rs`) carries:

- `GeminiProvider` napi class with `#[napi(constructor)]` and an
  `estimate_input_tokens` method (sync).
- Type marshalling structs: `Message`, `StreamRequest`, `StreamEvent`,
  `StopReason` — all `#[napi(object)]`, all named identically to
  their JS-side counterparts (Rust = JS name, by design — see
  "Naming policy" below).
- `From` / `TryFrom` impls converting JS shapes to / from the native
  Rust types in `crate::types`. The native types are imported under
  `Native*` aliases (e.g. `Message as NativeMessage`) so the napi
  module is self-contained.
- `gateway_error_to_napi`: maps `GatewayError` to a `napi::Error`
  whose `reason` is a JSON envelope
  `{ kind, retryable, message, retryAfterMs }`. This is the contract
  the TS wrapper deserialises back into a typed `GatewayError` class.
- `estimateTokens` free function (mirrors `crate::tokenizer::estimate_tokens`).

15 new Rust unit tests cover role parsing (good + bad), JS↔native
round-trips for `Message` and `StreamRequest`, all four `StreamEvent`
variant conversions, three representative `GatewayError` envelope
shapes, and the free function.

### Phase C — Async stream bridge

`src/napi_stream.rs` carries the heart of the session: the
`GeminiStream` napi class, plus a second `#[napi] impl GeminiProvider`
block that adds the synchronous `stream(request) -> GeminiStream`
method.

**The big design choice was `next()` semantics + cancellation
timing.** Per the brief, three napi patterns were on the table:

| Pattern | Verdict |
|---|---|
| **(a) Native `AsyncIterator`** from a Rust `Stream` | Not available in `napi-rs` 2.x in a way that bridges `tokio` futures cleanly. The crate exposes `AsyncTask` for one-shot `Promise<T>` but not a streaming variant. |
| **(b) Generator-style `next(): Promise<Option<T>>`** | Picked. Simple, idiomatic, supports `Symbol.asyncIterator` from a TS wrapper without ceremony. |
| **(c) ThreadsafeFunction callback** | Available but uglier — the consumer holds the callback registry. Unnecessary here. |

`GeminiStream` is a state machine over a `tokio::sync::Mutex<StreamState>`:

```
Initial { provider, request }
        │
        │ first next()
        ▼
   Open(BoxStream<…>)  ──── stream.next() returns None ──▶ Closed
        │
        │ stream-level error
        ▼
     Closed (returns Err to next())

Initial ──── pre-start cancel detected ──▶ PendingSyntheticDone
                                                 │
                                                 │ next next()
                                                 ▼
                                            yields Done{Cancelled},
                                            then Closed
```

The `PendingSyntheticDone` state is what gives JS callers the
"every stream ends in exactly one terminal `Done` event" contract,
regardless of whether the cancel arrived before, during, or after
the initial POST. Mid-stream cancel is handled by the underlying
Rust `BoxStream` from F3 S1 — it already yields a real
`Done{Cancelled}` event on its own `biased` `select!`, so the binding
doesn't need to synthesise anything for case 3.

**AbortSignal bridge** — JS-side, per the brief's option (b)
recommendation. The TS wrapper in `lib/ai-gateway.ts` attaches an
`abort` event listener that calls `inner.cancel()`. Rust never
needs to know AbortSignal exists — it just sees the
`CancellationToken` fire. This is the standard web-platform shape
and avoids plumbing a JS-typed callback into Rust.

**Lock discipline** is the subtle part:

- `next()` holds a `tokio::sync::Mutex` only during the
  decision-block at the top — long enough to extract an `Action`
  enum (OpenStream / PullNext) by moving the state out via
  `mem::replace`. The lock is released before any `.await`.
- The heavy work (initial POST, frame poll) happens on owned data,
  outside the lock.
- The lock is re-acquired briefly to install the result and choose
  the next transition.
- `cancel()` doesn't take the mutex at all — it's a `CancellationToken::cancel`
  call, which is internally a `tokio` watch broadcast. So `cancel()` stays
  responsive even when a `next()` is blocked on the network.

Mid-stream cancel verified at ~3 ms in `mock.test.mjs`'s
"cancel mid-stream yields Done{cancelled} within 500ms"; pre-start
cancel at <2 ms in the synthesised-Done test.

### Phase D — TS wrapper

`lib/ai-gateway.ts` is the consumer-facing TypeScript module:

```typescript
import { GeminiProvider } from "@/lib/ai-gateway"

const provider = new GeminiProvider(process.env.GEMINI_API_KEY!)
const controller = new AbortController()

const stream = provider.stream(
  {
    model: "gemini-2.5-flash",
    messages: [{ role: "user", content: "hi" }],
    maxOutputTokens: 256, // ≥ 128, see thinking-budget gotcha
  },
  { signal: controller.signal },
)

for await (const event of stream) {
  if (event.type === "text_delta") process.stdout.write(event.text)
  if (event.type === "usage") console.log("tokens:", event)
  if (event.type === "done") console.log("reason:", event.stopReason)
}

// From anywhere:
controller.abort()
```

What the wrapper hides:

1. **Flat-tagged `StreamEvent` → discriminated union.** The napi
   binding exports a shape where every event-payload field is
   optional and a `type` string discriminates which are populated.
   The TS wrapper narrows that to a proper
   `{type: 'text_delta', text} | {type: 'usage', inputTokens, outputTokens} | …`
   so callers pattern-match without manual `?`-chasing.

2. **`null` ↔ `undefined` shim.** Same pattern as `lib/html-engine.ts`'s
   shim file: napi-rs marshals `Option<T>` as `T | undefined`; the
   wrapper normalises absent fields to the union variants directly.

3. **GatewayError class.** The napi binding throws an `Error` whose
   `.message` is a JSON envelope. The wrapper catches it on every
   `inner.next()` call and re-throws a `GatewayError` with typed
   `.kind`, `.retryable`, `.retryAfterMs`. Stream-level errors
   surface inside the `for await` loop; cancellation NEVER throws —
   it yields a terminal `Done{cancelled}` event instead.

4. **`AbortSignal` listener.** Attached BEFORE the wrapper returns,
   so even an `signal.aborted === true` at call time still triggers
   `cancel()`.

5. **Thinking-budget docstring.** Constructor docstring documents the
   F3 S1 post-fix finding — Gemini 2.5 Flash needs `maxOutputTokens
   >= 256` (S1's safety margin) to avoid the empty-output failure
   mode that bit the live test earlier.

### Phase E — Node tests

Three test files under `crates/ai-gateway/__test__/`. Runner is
`node --test` (the built-in runner), matching what `crates/html-engine`
uses. The S2 brief mentioned `ava`, but `ava` was never adopted in
this repo — `crates/html-engine/__test__/*.test.mjs` has been on
`node:test` since F1 and I matched that.

`provider.test.mjs` — 9 always-on tests, no network. Covers
`estimateTokens`, the `GeminiProvider` constructor surface,
`estimateInputTokens` happy/error paths, and `stream()` returning a
class instance without hitting the network.

`mock.test.mjs` — 9 always-on tests using `node:http` for a mock
upstream. Covers happy path, three error envelope variants
(401/429/500), mid-stream cancel via `stream.cancel()`, pre-start
cancel via `stream.cancel()` (synthetic Done path), AbortSignal
bridge, and the two interesting `finishReason` mappings
(MAX_TOKENS → max_tokens; SAFETY → error-with-payload).

`live.test.mjs` — 2 tests, skipped unless `GEMINI_API_KEY` is set.
One mini-prompt happy path against real Flash; one mid-stream cancel
against real Flash. Reviewer runs them at merge time.

Final count: 18 pass, 2 skip, 0 fail (without key); reviewer
confirms 20 pass at merge.

### Phase F — Build pipeline + CI

`.github/workflows/rust-ai-gateway-prebuild.yml` is a near-mirror of
the html-engine prebuild workflow that's been in production since
F1 S6. Differences from the html-engine version:

- Tag pattern: `ai-gateway-v*` (vs `html-engine-v*`).
- Artifact names: `openlen-ai-gateway.{win32-x64-msvc,linux-x64-gnu}.node`.
- Working directory: `crates/ai-gateway` (vs `crates/html-engine`).

Same matrix: Windows + Linux on x86_64. Same upload + GH Release
attach flow. Same `softprops/action-gh-release@v2` pin.

`npm test`, `npm run build`, `npm run build:debug`, `npm run
prepublishOnly` scripts were defined in Phase A's `package.json`;
this commit only adds the CI step.

The operator triggers the first build with `git tag ai-gateway-v0.1.0
&& git push --tags` after master merge. F3 S3 is the first session
that consumes the released artifact (the Hetzner `deploy.sh` will
download the `.node` for the host triple from the GH Release matching
the pinned version).

## Naming policy — why no `Js` prefix

The S2 brief suggested `JsGeminiProvider` / `JsStreamRequest` style
naming on the Rust side, with `js_name = "..."` on each `#[napi]`
attribute. I tried that first; the build succeeded but
`npx tsc --noEmit` failed:

```
lib/ai-gateway.ts(NN,NN): error TS2304: Cannot find name 'JsStopReason'.
```

The cause: `napi-derive` 2.x emits a `JsX = X` type alias only for
`#[napi]` *classes* with a `js_name` (so cross-references inside other
classes' method signatures resolve). For `#[napi(object)]` *structs*,
no alias is emitted. So a field like

```rust
#[napi(object, js_name = "StreamEvent")]
pub struct JsStreamEvent {
    pub stop_reason: Option<JsStopReason>,  // ← stays JsStopReason in TS
    …
}
```

would generate

```typescript
export interface StreamEvent {
  stopReason?: JsStopReason  // ← unresolved!
}
```

Two clean fixes were available:

1. Hand-write `export type JsX = X` aliases into a separate `.d.ts`
   that augments the generated one.
2. Drop the rename: keep the Rust name == JS name, no `js_name`
   needed on object structs.

I picked (2). The native Rust types from `crate::types` live alongside
the napi types, but imported under `Native*` aliases inside `napi.rs`
and `napi_stream.rs`, so there's no Rust-level name collision. The
upside is a one-pass type resolution in `napi build`, and the
generated `index.d.ts` reads exactly like the JS surface a consumer
sees.

This refactor landed inside the Phase D commit (since that's when it
became observable through `tsc`); the commit message has the full
story.

## Final test counts

```
cargo test -p openlen-ai-gateway:
  80 unit tests + 12 mock tests + 1 doc-test (ignored) + 2 live tests (ignored) = 95 total
  92 active, 0 failures.

npm test  (cd crates/ai-gateway && node --test __test__/*.test.mjs):
  20 tests:
    9 provider tests (always on, no network)
    9 mock tests (always on, mock HTTP via node:http)
    2 live tests (skipped without GEMINI_API_KEY)

  Without GEMINI_API_KEY: 18 pass, 2 skip.

npx tsc --noEmit: clean (no errors).
cargo clippy --all-targets -- -D warnings: clean.
cargo fmt -- --check: clean.
```

## F3 S3 spec — HtmlStream + credit-gate integration

S3 is the first session that *uses* the gateway from app code. Two
threads, both wired up by S3:

### Thread 1 — HtmlStream pipeline integration

`crates/ai-gateway::GeminiStream` produces `StreamEvent`s. The
`crate::html-engine::HtmlStream` from F1 S5 produces transformed
HTML chunks from raw HTML input chunks. The S3 task is to stitch them:

- Pull `text_delta` events from a `GeminiStream`.
- Feed each `text_delta.text` into `HtmlStream.write(chunk)`.
- Forward the per-write emit to the SSE client as the live preview.
- On `Done`, call `HtmlStream.end()` and capture the post-normalize
  HTML.
- On `Done{Cancelled}`, drop the partial HtmlStream — no end() call.

This is plain glue in TS. Most of it goes inside a new
`lib/ai-stream-to-html.ts` (or similar) that exposes a single function
`streamGenerateToHtml(provider, request, htmlOpts)`.

### Thread 2 — Credit-gate hookup

`lib/credits.ts` exposes the monthly budget check. The hookup:

- Pre-flight: `provider.estimateInputTokens(messages)` → check the
  user has at least that much budget. Reject 402 if not.
- Post-flight: when `usage` event arrives, debit `inputTokens +
  outputTokens` against the user's budget.
- On cancellation: only debit the `inputTokens` (the user got no
  output) OR debit nothing if the cancel happened pre-POST.
  Decision lives with whoever owns the `lib/credits.ts` policy
  (memory: [[credit-system]]). I'd default to "debit nothing if
  no `usage` event arrived" since input is metered separately
  upstream.

### S3 acceptance

- `/api/generate` and `/api/templates/ai-design` are NOT cut over
  yet (that's S4). S3 builds the stream-to-html bridge + the
  credit-debit hook behind a new internal helper. Existing routes
  stay on `@ai-sdk/google` (or whatever they use today).
- New tests: a Node integration test that exercises the bridge
  end-to-end against a mock Gemini upstream + mock credit ledger.
- `next.config.ts` gets the webpack carve-out for
  `@openlen/ai-gateway` (mirror of the one already there for
  `@openlen/html-engine`). This is where webpack externalisation
  lands — explicitly out of scope for S2 because no app code
  imports the package yet.
- `infra/scripts/deploy.sh` gets a step to download the prebuilt
  `.node` for `linux-x64-gnu` from the matching GH Release. (Or
  alternatively, builds the crate on the Hetzner box during deploy;
  the html-engine pattern is to download — match that.)

## Open questions for review / Session 3

1. **Live test verification.** I wrote both live tests but the
   `GEMINI_API_KEY` wasn't in this session's environment, so they
   ran as `skipped`. Before merge, please run from the worktree:

   ```bash
   cd D:/worktrees/openlen-f3-s2/crates/ai-gateway
   GEMINI_API_KEY=… node --test __test__/live.test.mjs
   ```

   Both tests should pass. Cost: ~$0.001 of Flash quota total.

2. **napi `tokio_rt` feature flag.** I enabled `tokio_rt` on the
   napi crate so the `#[napi] pub async fn next()` awaits work
   correctly. This effectively bundles a tokio runtime inside the
   `.node` artifact. The runtime is *separate* from any tokio runtime
   the host Node app might have — napi-rs creates its own. If we
   later want to share the host's runtime (smaller binary), the
   alternative feature is `napi/async` without `tokio_rt`, but then
   `async fn` methods require an explicit runtime in the calling
   context. Flagging this as a future optimisation; not load-bearing
   for S3.

3. **Single-consumer assumption on `GeminiStream::next()`.** The
   `tokio::sync::Mutex` serialises concurrent `next()` calls but
   would not error — a second concurrent caller waits on the lock,
   then sees whatever state the first caller left. For an iterator
   that's the right behaviour (deterministic ordering), but JS-side
   we could *also* throw on concurrent `next()` by tracking a
   `pending: bool` field. Not adding it speculatively; flagging
   in case a consumer does it by accident and we want a louder
   failure.

4. **Webpack externalisation deferred to S3.** Per the brief, no
   changes to `next.config.ts` in this session. The first import
   from app code (S3) is when the carve-out is needed. The pattern
   to mirror lives at `next.config.ts` lines 36–58 (the existing
   externals callback for `@openlen/html-engine` and `.node`
   suffixes).

5. **Prebuild workflow — first tag push.** The operator triggers
   `git tag ai-gateway-v0.1.0 && git push --tags` after master
   merge to produce the first set of binaries. The workflow file
   was syntax-checked via inspection (no `yamllint` available
   locally); structurally it's a near-1:1 mirror of the html-engine
   workflow that's been running in production since F1 S6 without
   incident.

6. **No retry / backoff wrapper.** Same status as S1: `GatewayError::is_retryable()`
   is present and surfaced through the JS envelope (as
   `err.retryable`), but no automatic retry. S3 is the natural place
   to add a thin TS-side retry layer around the for-await loop —
   classify by `kind`, sleep `retryAfterMs`, reissue the request.
   Keeping it out of S2 keeps the gateway surface obvious.

7. **No metrics / no tracing spans.** Identical to S1 — no production
   caller yet. S3 will be the first wiring; that's the right place
   to add Prometheus counters (`gateway_requests_total{model, kind}`,
   `gateway_request_duration_seconds`, `gateway_tokens_total{direction}`)
   and tracing spans. Don't scaffold speculatively in S2.

## Files touched

```
.github/workflows/rust-ai-gateway-prebuild.yml      NEW (CI workflow)
Cargo.lock                                          (auto-regen)
crates/ai-gateway/.gitignore                        NEW
crates/ai-gateway/.npmignore                        NEW
crates/ai-gateway/Cargo.toml                        ↳ add cdylib + napi deps
crates/ai-gateway/__test__/live.test.mjs            NEW (gated live tests)
crates/ai-gateway/__test__/mock.test.mjs            NEW (mock HTTP tests)
crates/ai-gateway/__test__/provider.test.mjs        NEW (sync-surface tests)
crates/ai-gateway/build.rs                          NEW (napi_build::setup)
crates/ai-gateway/package-lock.json                 NEW (lock @napi-rs/cli)
crates/ai-gateway/package.json                      NEW (@openlen/ai-gateway)
crates/ai-gateway/src/lib.rs                        ↳ add `pub mod napi; pub mod napi_stream;`
crates/ai-gateway/src/napi.rs                       NEW (type marshalling + class shell)
crates/ai-gateway/src/napi_stream.rs                NEW (GeminiStream state machine)
docs/rust-f3-session2-handoff.md                    NEW — this file
lib/ai-gateway.ts                                   NEW (consumer TS wrapper)
package.json                                        ↳ + `@openlen/ai-gateway: file:./crates/ai-gateway`
package-lock.json                                   (auto-regen)
```

No changes to existing Rust source in `crates/ai-gateway/src/error.rs`,
`gemini/*`, `tokenizer.rs`, `types.rs`. No changes to other crates.
No changes to `app/`, `components/`, `infra/`, or any other lib/
file.

## How the next session picks up

```bash
git fetch
git checkout rust/f3-session3-htmlstream-credits   # or off the merge
cd D:/worktrees/openlen-f3-s3                       # new worktree
export CARGO_TARGET_DIR=D:/rust/target              # share the target dir
cargo check --workspace
cargo test -p openlen-ai-gateway                    # 92 pass baseline

cd crates/ai-gateway && npm install && npm run build:debug
cd ../.. && npx tsc --noEmit                        # green baseline
```

Then start with the S3 stream-to-html bridge per the spec above.
