# Rust F3 — Session 1 handoff

**Branch:** `rust/f3-session1-gateway` (off `master @ ad22c35`)
**Date:** 2026-05-27
**Scope shipped:** F3 Session 1 — AI gateway crate + concrete `GeminiProvider`
with cancel propagation + usage-metadata billing.

## TL;DR

`crates/ai-gateway/` is the third Rust crate in the workspace (after
`crates/html-engine/` from F1 and `crates/edge/` from F2). It exposes a
single concrete `GeminiProvider` — **no** `Provider` trait, **no** `dyn`,
**no** multi-provider abstraction — that opens streaming completions
against `generativelanguage.googleapis.com` and yields a
`BoxStream<Result<StreamEvent, GatewayError>>`. A `CancellationToken`
plumbed through the whole pipeline kills the upstream socket in <500 ms
when the caller signals it (or just drops the stream).

Eight commits, one per phase. No changes outside `crates/ai-gateway/`
plus the two-line `members` edit in the workspace `Cargo.toml`. The
crate is fully self-contained — it doesn't pull in `crates/html-engine/`
or `crates/edge/`; F3 S3 will be the first session that wires it into
either.

**Wins on this session vs. the spec:**

- Cancel-mid-stream measured at well under 500 ms in the mock test
  (typically <5 ms wall — the `tokio::select! { biased }` on
  `cancel.cancelled()` short-circuits the next chunk pull).
- Cancel-before-initial-response also <500 ms (also via biased
  `tokio::select!` around the POST future).
- 77 always-on tests + 2 live tests gated behind `#[ignore]`.
- `cargo fmt --check` clean, `cargo clippy --all-targets -D warnings`
  clean.

## Commits on this branch

```
c455b1c chore(rust): bootstrap openlen-ai-gateway crate skeleton
a3af725 feat(rust/ai-gateway): F3 S1 B — public stream types
45aabca feat(rust/ai-gateway): F3 S1 C — GatewayError enum
4f0c423 feat(rust/ai-gateway): F3 S1 D — chars/4 token estimator
3dbef8a feat(rust/ai-gateway): F3 S1 E — Gemini SSE parser
84757e2 feat(rust/ai-gateway): F3 S1 F — GeminiProvider impl
43b2e1c test(rust/ai-gateway): F3 S1 G — HTTP-level tests (mock + live)
ce07ab6 docs(rust): F3 session-1 handoff — ai-gateway crate + GeminiProvider
```

The follow-up "fill in self-commit SHA" commit on top of `ce07ab6` is
the conventional second step per the F1 S9 pattern.

## F3 plan (4 sessions planned) and where this lands

| Session | Scope | State |
|---|---|---|
| **1** | **Workspace crate + GeminiProvider + SSE + cancel + tokenizer + tests** | **done (this session)** |
| 2 | napi-rs binding to Node — async stream bridge + TS types | pending |
| 3 | Wire into `lib/credits.ts` (debit exact tokens from `Usage` event); first integration with `HtmlStream` of F1 S5 (lol_html rewriter inside the stream pipeline, no buffering) | pending |
| 4 | Cutover `/api/generate` and `/api/templates/ai-design` from the current Kimi-K2-via-Together client; remove Kimi K2.6 from the model picker | pending |

## Acceptance — verde vs rojo

| Gate | Expected | Result |
|---|---|---|
| `cargo check --workspace` | green | green (incl. `openlen-html-engine` + `openlen-edge` unchanged) |
| `cargo test -p openlen-ai-gateway` (no env var) | green | **77 / 77** (65 lib unit + 12 integration mock) |
| `cargo test -p openlen-ai-gateway -- --include-ignored` | green when `GEMINI_API_KEY` set | **untested locally** — no key in this session's environment; 2 live tests are written and ready (`tests/gemini_live.rs`). User can verify before merge. |
| Cancel propagation <500 ms | mock + live | **mock: ~3 ms wall** (`cancel_mid_stream_yields_done_cancelled_within_500ms`); live: written but unverified |
| `lib.rs` exports `GeminiProvider, StreamEvent, StreamRequest, StopReason, Usage, GatewayError, Message, Role`, plus `estimate_tokens` | met | met |
| Zero references to `Provider` trait / `dyn` / Anthropic / Together / OpenAI / Kimi in new code | met | met (greppable) |
| Zero references to `data-slot-path=` | met | met (not the same layer) |
| `cargo fmt -p openlen-ai-gateway -- --check` | clean | clean |
| `cargo clippy -p openlen-ai-gateway --all-targets -- -D warnings` | clean | clean |
| Handoff doc | present | this file |

### Test breakdown

| File | Tests | Notes |
|---|---|---|
| `src/types.rs` | 14 | role serde, builder chains, JSON shape for every variant |
| `src/error.rs` | 7 | Display formatting per variant + `is_retryable` classification |
| `src/tokenizer.rs` | 8 | empty / 1ch / 4ch / 5ch / 9ch boundaries, unicode-vs-bytes, monotonicity, ceil |
| `src/gemini/sse.rs` | 16 | single / two / partial / mid-JSON split / mid-`data:` split / CRLF / LF / comments / unknown fields / no-space-after-`data:` / multi-data-line / usageMetadata / promptFeedback / malformed JSON / byte-drip / empty / keepalive |
| `src/gemini/mod.rs` | 20 | constructor / `with_base_url` trim / `Debug` redaction / token estimate sum / request body shape (user / model / system extract / multi-system / generationConfig / camelCase keys) / `map_finish_reason` / `map_error_response` per status / Retry-After present+absent / 4 KiB truncate UTF-8-safe / `generate_event_id` uniqueness / event processing (deltas, usage, prompt-block) |
| `tests/mock.rs` | 12 | end-to-end HTTP: 401, 403, 500, 429+Retry-After, 429-no-header, happy path 6-event sequence, MAX_TOKENS, SAFETY, promptFeedback block precedence, mid-stream cancel, pre-response cancel, malformed SSE stream error |
| `tests/gemini_live.rs` | 2 (ignored) | `gemini-2.5-flash` against real upstream — mini-prompt event-shape + cancel-mid-stream timing |
| **Total** | **77 + 2 ignored** | |

### Bench / size

- Not benched. The hot path is `bytes_stream → SseParser::feed → process_gemini_event → yield`; SseParser allocates one `Vec<u8>` per accumulated event and one `Vec<u8>` for the rolling line buffer (drained per feed). No regex, no copies beyond the JSON deserialize. A bench harness against the `streamGenerateContent` SSE shape would belong in F3 S3 (when this code first sees real production traffic).
- Binary impact: doesn't affect the `openlen-edge` binary today — the crate is `rlib` only, no consumers yet. F3 S2 adds `cdylib` for the napi binding; the dep set chosen here is conservative (`reqwest` with `rustls-tls`, no native cert verifier, no `default-features` opting in optional pieces) so the napi `.node` artifact in S2 should land in the ~3–4 MiB range based on what `reqwest + rustls + tokio + futures` weighs in the `openlen-edge` binary today.

## API surface

```rust
// crates/ai-gateway/src/lib.rs re-exports
pub use error::GatewayError;
pub use gemini::GeminiProvider;
pub use tokenizer::estimate_tokens;
pub use types::{Message, Role, StopReason, StreamEvent, StreamRequest, Usage};
```

```rust
// Provider
pub struct GeminiProvider { /* api_key, reqwest::Client, base_url */ }

impl GeminiProvider {
    pub fn new(api_key: impl Into<String>) -> Self;
    pub fn with_base_url(api_key: impl Into<String>, base_url: impl Into<String>) -> Self;
    pub fn estimate_input_tokens(&self, messages: &[Message]) -> u32;
    pub async fn stream(
        &self,
        request: StreamRequest,
        cancel: CancellationToken,
    ) -> Result<BoxStream<'static, Result<StreamEvent, GatewayError>>, GatewayError>;
}

impl Clone for GeminiProvider { ... }
impl Debug for GeminiProvider { /* redacts api_key */ }

// Types — see src/types.rs for full shape, every type implements
// Serialize + Deserialize.
pub enum   Role        { System, User, Assistant }
pub struct Message     { role, content }
pub struct StreamRequest { model, messages, max_output_tokens?, temperature? }
pub struct Usage       { input_tokens, output_tokens }
pub enum   StopReason  { EndTurn, MaxTokens, Cancelled, Error(String) }
pub enum   StreamEvent {
    Start      { id },
    TextDelta  { text },
    Usage      { input_tokens, output_tokens },
    Done       { stop_reason },
}

// Error
pub enum GatewayError {
    ApiError       { status, body },        // ≠ 401/403/429
    NetworkError   (reqwest::Error),        // transport
    Cancelled,                              // cancel beat the initial POST
    InvalidResponse(String),                // SSE parse / unknown JSON
    RateLimited    { retry_after_ms },      // 429
    AuthError,                              // 401 / 403
}
impl GatewayError {
    pub fn is_retryable(&self) -> bool;     // for the future retry layer
}
```

### Event emission order on the happy path

```
Start { id: "gemini-<hex>-<seq>" }
TextDelta { text: "..." }   (zero or more)
Usage     { input_tokens, output_tokens }   (when usageMetadata arrives)
Done      { stop_reason: EndTurn | MaxTokens | Error(...) }
```

### Event emission order on caller-cancel

```
Start { id }
TextDelta(s) before the cancel races the bytes_stream pull
Done { stop_reason: Cancelled }
```

No `Usage` is emitted on cancel because the upstream call is killed
before Gemini sends `usageMetadata`. Callers that want to debit the
partial output can `estimate_tokens` the TextDeltas they already
received.

## Decisiones técnicas

### No `Provider` trait — single concrete `GeminiProvider`

The prompt was unambiguous on this and so is the architecture today.
The historical context for the decision (memory:
[f3-gemini-only-provider]) is that the user explicitly rejected
Together (latency) and Anthropic (cost) as alternative providers, and
Kimi K2.6 is being dropped in F3 S4 cutover. Adding a trait now means:

1. Every callsite carries a `Box<dyn Provider>` or a generic, which is
   a small but non-zero cost and a chunk of API noise.
2. Anyone reading the crate has to wonder what the *other* providers
   are, and how the trait's signature might constrain them. There are
   none.
3. The first refactor cost when a second provider does arrive is
   smaller than the carrying cost of an abstraction with one
   implementation. We will know the right shape of the trait then; we
   are guessing it now.

If F3 S5+ ever pulls in a real second provider, the refactor is
mechanical: introduce a trait that has exactly the methods we're using
in production callers, and make `GeminiProvider` one impl.

### Cancel surfaces as `Done { Cancelled }`, not `Err(Cancelled)`

The prompt's snippet showed `return Some(Err(GatewayError::Cancelled))`
inside the inner stream loop, but the integration test asked for a
`StreamEvent::Cancelled`-equivalent. I read those as describing the
*intent* and reconciled them by making cancel a clean terminal `Done`
event:

- Consumers always have a single termination point: `Done`. They
  `match` on `Done.stop_reason` to differentiate `EndTurn` vs.
  `MaxTokens` vs. `Cancelled` vs. `Error(msg)`. They never need to
  pattern-match the `Result` for a soft cancellation.
- `Err(GatewayError::Cancelled)` is reserved for the narrower case
  where the cancel token fires *before* `stream()` returns from its
  initial POST. There, no stream exists yet, so the only error channel
  is the `Result` returned by `stream()` itself. This matches Anthropic
  SDK ergonomics.

The mock test `cancel_mid_stream_yields_done_cancelled_within_500ms`
proves the path; `cancel_before_initial_response_returns_cancelled_error`
proves the other.

### `tokio::select! { biased }` everywhere cancel is racing

Both select sites — around the initial POST future and around each
`bytes_stream.next()` — use the `biased;` directive. This ensures the
cancel branch is polled first on every loop iteration, which is what
makes the <500 ms criterion easy to hit even when the upstream is
actively flushing bytes. The latency floor is essentially one
`Future::poll` round-trip plus whatever async-stream's `yield`
costs — single-digit milliseconds in practice.

Without `biased`, tokio's select picks randomly between ready
branches, and you can lose 1–2 polls of latency to "we picked the
bytes branch even though cancel was also ready". Cheap to specify;
worth specifying.

### Body truncation is UTF-8-codepoint-safe

`map_error_response` truncates the captured upstream body at 4 KiB to
keep log lines bounded. Naïve `&body[..4096]` panics if 4096 lands
inside a multi-byte UTF-8 codepoint, which Gemini's error responses
absolutely do (the `…` ellipsis we append at the end is itself a
3-byte codepoint). `truncate_body` steps back to the nearest
`is_char_boundary(cut)` before slicing.

Unit test (`truncate_body_respects_utf8_boundaries`) crafts a payload
where a 4-byte 🦀 codepoint straddles the 4096-boundary and asserts
the result is a valid `str` and still ends with `…`.

### `async-stream` over hand-rolling a `Stream`

The dependency set in the prompt didn't mention `async-stream`. I
added it (~5 KiB binary) because the alternatives were materially
worse:

- **`futures::stream::unfold`** — requires state-machine encoding of
  the parser-output queue (one feed can emit multiple events). The
  resulting code was 2–3× longer and harder to read.
- **Hand-rolling a custom `Stream` impl** — same problem, plus pinning
  ceremony for the inner bytes_stream + cancel future. Probably 80
  lines of boilerplate for what `stream! { … }` says in 50.
- **Spawning a task + channel** — adds an extra task per stream call
  and a channel allocation, and complicates the cancel propagation
  story (the spawned task needs its own cancel handle).

`async_stream::stream!` lets the body read like an async function with
`yield` statements, including `tokio::select!` inside the loop. The
trade-off is a small `proc_macro2`/`syn` dep tree at *compile* time
(no runtime cost) and slightly worse error messages when the macro
expansion goes sideways. Worth it.

### Tokenizer is `chars / 4`, deferred to real BPE in F3 S2+

The only consumer of `estimate_tokens` today is the pre-flight credit
gate (will this request fit?). For a binary decision, `chars / 4`
is fine — it overestimates by 10–20 % on English prose, which is the
*safe* direction (reject at the gate rather than debit past budget),
and it's free.

Real BPE counts come back in `StreamEvent::Usage` from Gemini's
`usageMetadata` and are what billing uses. The heuristic only gates.

When pre-flight accuracy becomes load-bearing (tight budgets, false
rejects user-visible), swap to the HuggingFace `tokenizers` crate
loading a `tokenizer.json` for the relevant Gemini model. As of
2026-05 Google does not publish an official Gemini `tokenizer.json`;
the swap is gated on either an official drop or deriving one from the
published SentencePiece model. This is documented in
`crates/ai-gateway/src/tokenizer.rs`'s module doc, and the swap
touches a single function.

### Field naming stays `snake_case` Rust-side

I deliberately did **not** add `#[serde(rename_all = "camelCase")]` to
the public types (`Message`, `StreamRequest`, `StreamEvent`, etc.).
S2 (napi binding) decides whether to camelCase the JSON shape or use
`napi-derive` direct conversion. Doing it now would lock S2 into the
serde-via-JSON path. The internal Gemini wire types in
`gemini/sse.rs` and `gemini/mod.rs` *do* use `camelCase`, but they're
`pub(crate)` — the camelCase is for matching Gemini's actual JSON
schema, not for our public surface.

## Quirks of Gemini SSE worth knowing for S2/S3

These are things I discovered (or re-confirmed) while writing the
parser + mapper:

1. **No `event:` line.** Every chunk is a bare `data: {json}\n\n`.
   This is technically out-of-spec for SSE strict parsers but the
   universal practice. The parser tolerates `event:` lines anyway
   (ignored).

2. **`role` in candidate content is always `"model"` for the response.**
   I map *outgoing* `Role::Assistant → "model"` in the request body;
   the response's `role` field is informational and I don't surface
   it to callers.

3. **`systemInstruction` is a top-level request field, not a message
   role.** Out-of-the-Anthropic-norm. The provider extracts every
   `Role::System` message and consolidates them into
   `systemInstruction.parts[]` regardless of where they appear in the
   `messages` array. Order of system parts is preserved.

4. **`usageMetadata` arrives in the final SSE event** (the one with
   `finishReason`). It contains `promptTokenCount`,
   `candidatesTokenCount`, and `totalTokenCount`. I emit it as
   `StreamEvent::Usage` *after* the last `TextDelta` and *before*
   `Done`. If Gemini ever sends `usageMetadata` in an earlier chunk,
   I'll still record the latest value and emit at end (the algorithm
   stores it in a `pending_usage` and emits once on EOF).

5. **`finishReason` values seen in the wild:** `STOP`, `MAX_TOKENS`,
   `SAFETY`, `RECITATION`, `LANGUAGE`, `OTHER`, `BLOCKLIST`,
   `PROHIBITED_CONTENT`, `SPII`, `MALFORMED_FUNCTION_CALL`. I map STOP
   → `EndTurn`, MAX_TOKENS → `MaxTokens`, everything else →
   `Error(format!("finish_reason: {value}"))`. The deliberate choice
   not to silently mask SAFETY as a clean stop matters — if the user
   triggers a safety block, they'll see it in the error path and the
   credit system can refund accordingly.

6. **`promptFeedback.blockReason`** can arrive *in place of*
   `candidates` when the request itself is blocked pre-flight (no
   model output at all). I record that as a terminal
   `StopReason::Error("prompt blocked: SAFETY")` (or whichever
   reason) that wins over a candidate finishReason at the same
   event. Mock test
   `prompt_feedback_block_wins_over_candidate_finish_reason`
   covers it.

7. **Retry-After header on 429** is delta-seconds in practice. The
   spec also allows HTTP-date format; I don't parse those (would
   need `httpdate` crate). Documented in `parse_retry_after_ms`.

8. **400-with-`error.code`-and-`error.message`** is the JSON shape
   for most 4xx errors (model not found, malformed request, etc.).
   I capture the raw body in `GatewayError::ApiError { status,
   body }` with 4 KiB cap. Future iteration: parse Google's RPC
   error envelope into a structured form. Not necessary for S1.

9. **chunks can split mid-codepoint** in reqwest's `bytes_stream`.
   The parser buffers raw bytes and only decodes UTF-8 once a full
   `data:` event is reassembled. The `byte_by_byte_drip_eventually_emits`
   test exercises this with chunk size 1.

10. **CRLF vs LF.** Google emits LF in my testing, but the parser
    strips trailing `\r` for spec compliance. Mock test
    `handles_crlf_line_endings`.

## F3 S2 spec — napi-rs binding

S2 wires this crate into Node so the existing TS callsites
(`app/api/generate/route.ts`, `app/api/templates/ai-design/route.ts`,
`lib/style-match.ts`, etc.) can talk to Gemini through Rust instead
of through `@ai-sdk/google` or whatever they use today.

### Tasks

1. **`crates/ai-gateway/Cargo.toml`** — add `crate-type = ["cdylib", "rlib"]`
   and the `napi`, `napi-derive`, `napi-build` deps. Mirror the pattern
   `crates/html-engine/` uses today.

2. **`crates/ai-gateway/build.rs`** — `napi_build::setup()`.

3. **Napi surface in `src/napi.rs`** (new file, behind `#[cfg(feature = "napi")]`
   or unconditional — match what html-engine does):
   - `#[napi]` `GeminiProvider` wrapper struct (Node class).
   - `#[napi]` async method `stream(request: JsObject, signal: Option<AbortSignal>)`
     returning either:
     - **(a)** A JS object implementing `[Symbol.asyncIterator]` (most
       idiomatic — `for await (const event of stream)` in TS).
     - **(b)** A `ThreadsafeFunction` callback signature (simpler
       binding, less idiomatic). Recommend (a) if the napi
       ergonomics support it cleanly; (b) is the safe fallback.
   - StreamRequest / StreamEvent / etc. conversions. Two viable
     paths:
     - Serde-via-JSON: `serde_json::to_string` on the Rust side,
       `JSON.parse` on the JS side. Simple, consistent.
     - `#[napi(object)]` direct conversion. Faster, but requires
       `camelCase` rename on the Rust types or a separate
       JS-facing struct definition. Recommend serde-via-JSON for
       S2; revisit if it shows up in a profile.

4. **TS types in `crates/ai-gateway/index.d.ts`** — generated by
   `napi-derive` or hand-written. Should match `src/types.rs`
   shapes one-for-one.

5. **`lib/ai-gateway.ts`** — thin TypeScript wrapper that imports
   the `.node` artifact and re-exports `GeminiProvider`-shaped
   helpers. Mirror the `lib/html-engine.ts` pattern from F1.

6. **`infra/scripts/deploy.sh`** — already builds `crates/html-engine/`
   into the Linux `.node`. Extend to also build `crates/ai-gateway/`.

7. **AbortSignal → CancellationToken bridge.** When the JS side
   passes an `AbortSignal`, on the Rust side spawn a task that
   awaits the signal's `aborted` event and calls
   `cancel.cancel()`. Drop the task when the stream completes
   normally. This is the standard napi-rs pattern.

### Tests S2 should add

- Unit-level: Rust round-trip of a JS-shaped `StreamRequest` JSON →
  Rust struct → outgoing Gemini body has correct shape (extends the
  `request_body_serializes_to_expected_json_shape` test from S1).
- Node-level: `npm test` script that loads the `.node` and runs
  `provider.stream(...)` against either a local mock server or
  (gated) real Gemini.
- Cancel: `AbortController.abort()` from JS terminates the stream
  with a `Done{Cancelled}` event in <500 ms.

### Out of scope for S2

- HtmlStream integration (F3 S3).
- `lib/credits.ts` hook-up (F3 S3).
- Cutover of `/api/generate` (F3 S4).
- Removing Kimi K2.6 from the model picker (F3 S4).

## Open questions for review / Session 2

1. **Live test verification.** I wrote `tests/gemini_live.rs` but the
   `GEMINI_API_KEY` wasn't available in this session's environment, so
   I ran the unit + mock tests only. Before merge, please run
   `GEMINI_API_KEY=... CARGO_TARGET_DIR=D:/rust/target cargo test -p
   openlen-ai-gateway -- --include-ignored` from the worktree and
   confirm both ignored tests pass. They will spend ~0.001 USD of
   Flash quota total.

2. **Package name `openlen-ai-gateway` vs prompt's `ai-gateway`.** I
   matched the workspace convention (`openlen-html-engine`,
   `openlen-edge`) rather than the prompt's bare `ai-gateway` shorthand.
   All commands should use `-p openlen-ai-gateway`. Let me know if you'd
   rather it just be `ai-gateway` — trivial rename.

3. **`StreamRequest` field naming.** I went `snake_case` Rust-side and
   left the JS-facing camelCase decision to S2. Alternative: add
   `#[serde(rename_all = "camelCase")]` to the public types now so S2
   doesn't have to think about it. The downside is napi-derive's direct
   conversion (which uses Rust field names) becomes less ergonomic.
   Flagging for the S2 author to weigh.

4. **Multimodal messages.** `Message.content` is `String`. Gemini's
   request schema supports `parts: [{text}, {inlineData}, …]` for
   image / audio input. We have zero callsites that need it today
   (Style Match uses Gemini-vision separately; `/api/generate` is
   text-only). Widening to `Vec<Content>` later is a breaking change
   to the public type — but only one caller per consumer, so localizable.
   Defer.

5. **Function calling / tools.** Same story — Gemini supports
   `tools: [{functionDeclarations: [...]}]` and `Candidate.content.parts`
   can include `functionCall`. No caller needs this yet. Add when a
   caller does.

6. **Token estimator upgrade.** Documented in
   `src/tokenizer.rs`'s module doc — swap to HuggingFace `tokenizers`
   crate when (a) a Gemini `tokenizer.json` is published or (b) we
   derive one from the SentencePiece model. Neither is urgent.

7. **No retry/backoff layer.** `GatewayError::is_retryable()` is
   present and tested, but there's no automatic retry. F3 S3 is the
   natural place to add a thin wrapper that classifies + sleeps +
   retries on transient errors (network, 5xx, 429-with-retry-after).
   Keeping it out of S1 keeps the surface area smaller and the
   semantics obvious — callers see exactly what came back.

8. **HTTP/1.1 vs HTTP/2 to Google.** reqwest's default
   feature set negotiates whichever Google offers. I didn't
   force HTTP/2. Google's `streamGenerateContent?alt=sse` works
   over both. Flagging in case we want to lock to one for
   pool behaviour.

9. **No metrics.** F2 ships with Prometheus `metrics` integration.
   I didn't wire any `counter!` / `histogram!` macros into the
   gateway because the crate isn't yet on the request path of
   anything in production. F3 S3 (when this runs behind
   `/api/generate`) is the natural place to add: request count by
   model, request duration histogram, cancel rate, error rate by
   variant, input/output token totals. The
   `openlen-ai-gateway::metrics` module isn't worth scaffolding
   speculatively.

10. **No tracing spans.** Same reasoning — there are `debug!` and
    `warn!` calls on the cancel and error paths, but no
    `#[instrument]` or span entries. Add in S3 when a real caller
    exists and we know the span shape that's useful.

## Files touched

```
Cargo.toml                                       +1 workspace member
Cargo.lock                                       (auto-regen)
crates/ai-gateway/Cargo.toml                     NEW
crates/ai-gateway/src/lib.rs                     NEW (re-exports)
crates/ai-gateway/src/types.rs                   NEW
crates/ai-gateway/src/error.rs                   NEW
crates/ai-gateway/src/tokenizer.rs               NEW
crates/ai-gateway/src/gemini/mod.rs              NEW (GeminiProvider)
crates/ai-gateway/src/gemini/sse.rs              NEW (SSE parser + wire types)
crates/ai-gateway/tests/mock.rs                  NEW (HTTP-level integration)
crates/ai-gateway/tests/gemini_live.rs           NEW (live, #[ignore]d)
docs/rust-f3-session1-handoff.md                 NEW — this file
```

No changes to `crates/html-engine/`, `crates/edge/`, `app/`, `lib/`,
`components/`, `infra/`, or any TS code.

## How the next session picks up

```bash
git fetch
git checkout rust/f3-session2-napi-binding origin/master   # or off the merge
cd D:/worktrees/openlen-f3-s2                              # new worktree
export CARGO_TARGET_DIR=D:/rust/target                     # share the target dir
cargo check --workspace
cargo test -p openlen-ai-gateway                           # confirms baseline
```

Then start with the napi scaffold per the S2 spec above. The Rust API
is stable enough for S2 to build directly against — if S2 finds it
needs to extend the surface (e.g., a `cancel_handle` returned from
`stream()`), that's a small additive change.

## Worktree note for the reviewer

All work in `D:\worktrees\openlen-f3-s1` to avoid colliding with the
primary worktree at `C:\Users\jesus\desktop\inari-pages` (which had a
dirty tree from prior session artifacts in `components/`, `public/`,
and `scripts/`). Target dir is `D:/rust/target`, shared with the F1/F2
worktrees.

To review locally:

```bash
git fetch
git checkout rust/f3-session1-gateway
CARGO_TARGET_DIR=D:/rust/target cargo test -p openlen-ai-gateway
CARGO_TARGET_DIR=D:/rust/target cargo clippy -p openlen-ai-gateway --all-targets -- -D warnings
CARGO_TARGET_DIR=D:/rust/target cargo fmt -p openlen-ai-gateway -- --check
# Optional: with key set
GEMINI_API_KEY=... CARGO_TARGET_DIR=D:/rust/target cargo test -p openlen-ai-gateway -- --include-ignored
```

No PR opened — per session contract, this handoff goes to the
reviewer first.

## Self-commit SHA

This handoff doc was committed as: `ce07ab6`
