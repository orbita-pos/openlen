//! Real-API integration tests against `generativelanguage.googleapis.com`.
//!
//! Gated behind `#[ignore]` so `cargo test` stays offline by default. To
//! run them locally:
//!
//! ```text
//! GEMINI_API_KEY=... cargo test -p openlen-ai-gateway -- --include-ignored
//! ```
//!
//! These spend real (tiny) quota. The cheapest model — `gemini-2.5-flash`
//! — is used everywhere; per-test output is bounded by
//! `max_output_tokens`.

use std::time::{Duration, Instant};

use futures::StreamExt;
use openlen_ai_gateway::{GeminiProvider, Message, StopReason, StreamEvent, StreamRequest};
use tokio_util::sync::CancellationToken;

fn api_key() -> String {
    std::env::var("GEMINI_API_KEY").expect("set GEMINI_API_KEY to run --include-ignored live tests")
}

const FAST_MODEL: &str = "gemini-2.5-flash";

#[tokio::test]
#[ignore = "requires GEMINI_API_KEY — run with --include-ignored"]
async fn live_mini_prompt_emits_expected_event_shape() {
    let provider = GeminiProvider::new(api_key());

    // 2.5 Flash reserves part of `max_output_tokens` for internal thinking
    // before emitting visible text. A budget of 16 is consumed entirely by
    // thinking on trivial prompts and the stream finishes with MAX_TOKENS
    // before any TextDelta is emitted. 256 covers any plausible thinking
    // + a one-word response with margin to spare.
    let req = StreamRequest::new(FAST_MODEL, vec![Message::user("Say hi in one word.")])
        .with_max_output_tokens(256)
        .with_temperature(0.0);

    let mut stream = provider
        .stream(req, CancellationToken::new())
        .await
        .expect("stream() against real Gemini should succeed");

    let mut start_count = 0usize;
    let mut delta_count = 0usize;
    let mut usage_count = 0usize;
    let mut done_count = 0usize;
    let mut last_stop = None;

    while let Some(item) = tokio::time::timeout(Duration::from_secs(30), stream.next())
        .await
        .expect("each event should arrive within 30s")
    {
        match item.expect("each event should be Ok") {
            StreamEvent::Start { id } => {
                assert!(id.starts_with("gemini-"), "id was {id:?}");
                start_count += 1;
            }
            StreamEvent::TextDelta { text } => {
                assert!(!text.is_empty(), "empty TextDelta");
                delta_count += 1;
            }
            StreamEvent::Usage {
                input_tokens,
                output_tokens,
                cached_tokens,
            } => {
                assert!(input_tokens > 0, "expected non-zero input_tokens");
                assert!(output_tokens > 0, "expected non-zero output_tokens");
                // A one-word prompt with no shared prefix has nothing to hit
                // the cache — just assert the field is wired, not a specific
                // value. F3-T3 owns actually forcing/measuring a cache hit.
                assert!(
                    cached_tokens < input_tokens,
                    "cached_tokens: {cached_tokens}"
                );
                usage_count += 1;
            }
            StreamEvent::Done { stop_reason } => {
                last_stop = Some(stop_reason);
                done_count += 1;
            }
            // This test sends no `tools`/`toolConfig`, so Gemini has nothing
            // to call — not expected here. Added only to keep the match
            // exhaustive after Task 2 (response-side FunctionCall event).
            StreamEvent::FunctionCall { .. } => {
                panic!("unexpected FunctionCall event — this test configures no tools");
            }
        }
    }

    assert_eq!(start_count, 1, "exactly one Start expected");
    assert!(delta_count >= 1, "expected at least one TextDelta");
    assert_eq!(usage_count, 1, "exactly one Usage expected");
    assert_eq!(done_count, 1, "exactly one Done expected");
    match last_stop {
        Some(StopReason::EndTurn) | Some(StopReason::MaxTokens) => {}
        other => panic!("expected EndTurn or MaxTokens, got {other:?}"),
    }
}

#[tokio::test]
#[ignore = "requires GEMINI_API_KEY — run with --include-ignored"]
async fn live_cancel_mid_stream_yields_done_cancelled_within_500ms() {
    let provider = GeminiProvider::new(api_key());

    // A prompt that's long enough to span several SSE chunks.
    let req = StreamRequest::new(
        FAST_MODEL,
        vec![Message::user(
            "Write a 200-word neutral paragraph about the Rust programming language.",
        )],
    )
    .with_max_output_tokens(512)
    .with_temperature(0.4);

    let cancel = CancellationToken::new();
    let mut stream = provider
        .stream(req, cancel.clone())
        .await
        .expect("stream() against real Gemini should succeed");

    // Wait for the first TextDelta — confirms the stream is actively
    // pulling from the upstream socket.
    loop {
        let next = tokio::time::timeout(Duration::from_secs(30), stream.next())
            .await
            .expect("first events must arrive within 30s")
            .expect("stream ended early")
            .expect("event must be Ok");
        if matches!(next, StreamEvent::TextDelta { .. }) {
            break;
        }
    }

    let t0 = Instant::now();
    cancel.cancel();

    let stop = loop {
        let next = tokio::time::timeout(Duration::from_millis(500), stream.next())
            .await
            .expect("Done{Cancelled} must arrive within 500ms of cancel");
        match next {
            Some(Ok(StreamEvent::Done { stop_reason })) => break stop_reason,
            Some(Ok(_)) => continue,
            Some(Err(e)) => panic!("got error after cancel: {e:?}"),
            None => panic!("stream ended without a Done event"),
        }
    };
    let elapsed = t0.elapsed();
    assert!(
        elapsed < Duration::from_millis(500),
        "cancel-to-Done elapsed {elapsed:?}, must be < 500ms"
    );
    assert_eq!(stop, StopReason::Cancelled);
}
