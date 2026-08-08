//! HTTP-level integration tests for `GeminiProvider` against a hand-rolled
//! tokio mock server. These run on every `cargo test` invocation — no
//! environment variables, no network.

use std::time::{Duration, Instant};

use futures::StreamExt;
use openlen_ai_gateway::{
    GatewayError, GeminiProvider, Message, StopReason, StreamEvent, StreamRequest,
};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio_util::sync::CancellationToken;

/// Spawn a one-shot HTTP/1.1 mock that accepts a single connection, reads
/// the request (best-effort, up to 8 KiB), writes the canned response, and
/// then either closes immediately or holds the connection open for
/// `hold` (useful for cancel-mid-stream tests). Returns the base URL the
/// provider should be pointed at.
async fn serve_one(response: Vec<u8>, hold: Duration) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        if let Ok((mut socket, _)) = listener.accept().await {
            let mut buf = vec![0u8; 8192];
            let _ = tokio::time::timeout(Duration::from_secs(2), socket.read(&mut buf)).await;
            let _ = socket.write_all(&response).await;
            let _ = socket.flush().await;
            if hold > Duration::ZERO {
                tokio::time::sleep(hold).await;
            }
        }
    });
    format!("http://{addr}")
}

fn sse_envelope(body: &str) -> Vec<u8> {
    let mut out = String::new();
    out.push_str("HTTP/1.1 200 OK\r\n");
    out.push_str("Content-Type: text/event-stream\r\n");
    out.push_str("Connection: close\r\n");
    out.push_str("\r\n");
    out.push_str(body);
    out.into_bytes()
}

fn small_request() -> StreamRequest {
    StreamRequest::new("gemini-2.5-flash", vec![Message::user("hi")])
}

#[tokio::test]
async fn auth_error_on_401() {
    let url = serve_one(
        b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 19\r\nConnection: close\r\n\r\n{\"error\":\"no key\"}\n"
            .to_vec(),
        Duration::ZERO,
    )
    .await;
    let provider = GeminiProvider::with_base_url("", url);

    let err = provider
        .stream(small_request(), CancellationToken::new())
        .await
        .err()
        .expect("expected stream() to fail");
    assert!(matches!(err, GatewayError::AuthError), "got {err:?}");
}

#[tokio::test]
async fn auth_error_on_403() {
    let url = serve_one(
        b"HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec(),
        Duration::ZERO,
    )
    .await;
    let provider = GeminiProvider::with_base_url("bad-key", url);

    let err = provider
        .stream(small_request(), CancellationToken::new())
        .await
        .err()
        .expect("expected stream() to fail");
    assert!(matches!(err, GatewayError::AuthError), "got {err:?}");
}

#[tokio::test]
async fn api_error_on_500() {
    let url = serve_one(
        b"HTTP/1.1 500 Internal Server Error\r\nContent-Length: 4\r\nConnection: close\r\n\r\nboom"
            .to_vec(),
        Duration::ZERO,
    )
    .await;
    let provider = GeminiProvider::with_base_url("k", url);

    let err = provider
        .stream(small_request(), CancellationToken::new())
        .await
        .err()
        .expect("expected stream() to fail");
    match err {
        GatewayError::ApiError { status, body } => {
            assert_eq!(status, 500);
            assert_eq!(body, "boom");
        }
        other => panic!("expected ApiError, got {other:?}"),
    }
}

#[tokio::test]
async fn rate_limited_on_429_parses_retry_after() {
    let url = serve_one(
        b"HTTP/1.1 429 Too Many Requests\r\nRetry-After: 30\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            .to_vec(),
        Duration::ZERO,
    )
    .await;
    let provider = GeminiProvider::with_base_url("k", url);

    let err = provider
        .stream(small_request(), CancellationToken::new())
        .await
        .err()
        .expect("expected stream() to fail");
    match err {
        GatewayError::RateLimited { retry_after_ms } => {
            assert_eq!(retry_after_ms, Some(30_000));
        }
        other => panic!("expected RateLimited, got {other:?}"),
    }
}

#[tokio::test]
async fn rate_limited_on_429_without_retry_after_header() {
    let url = serve_one(
        b"HTTP/1.1 429 Too Many Requests\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            .to_vec(),
        Duration::ZERO,
    )
    .await;
    let provider = GeminiProvider::with_base_url("k", url);

    let err = provider
        .stream(small_request(), CancellationToken::new())
        .await
        .err()
        .expect("expected stream() to fail");
    match err {
        GatewayError::RateLimited { retry_after_ms } => assert!(retry_after_ms.is_none()),
        other => panic!("expected RateLimited, got {other:?}"),
    }
}

#[tokio::test]
async fn happy_path_emits_start_deltas_usage_done_in_order() {
    let body = concat!(
        // Two text events.
        "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Hi\"}],\"role\":\"model\"}}]}\n\n",
        "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\" there\"}],\"role\":\"model\"}}]}\n\n",
        // Final event: finishReason + usage.
        "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"!\"}],\"role\":\"model\"},\"finishReason\":\"STOP\"}],\"usageMetadata\":{\"promptTokenCount\":3,\"candidatesTokenCount\":4,\"totalTokenCount\":7}}\n\n",
    );
    let url = serve_one(sse_envelope(body), Duration::ZERO).await;
    let provider = GeminiProvider::with_base_url("k", url);

    let mut stream = provider
        .stream(small_request(), CancellationToken::new())
        .await
        .expect("stream() should succeed on 200");

    let mut events = Vec::new();
    while let Some(item) = stream.next().await {
        events.push(item.expect("each event should be Ok"));
    }

    // Expected sequence:
    //   Start, TextDelta("Hi"), TextDelta(" there"), TextDelta("!"),
    //   Usage{3,4}, Done{EndTurn}
    assert_eq!(events.len(), 6, "got: {events:?}");

    assert!(matches!(events[0], StreamEvent::Start { .. }));
    assert!(
        matches!(&events[1], StreamEvent::TextDelta { text } if text == "Hi"),
        "got {:?}",
        events[1]
    );
    assert!(
        matches!(&events[2], StreamEvent::TextDelta { text } if text == " there"),
        "got {:?}",
        events[2]
    );
    assert!(
        matches!(&events[3], StreamEvent::TextDelta { text } if text == "!"),
        "got {:?}",
        events[3]
    );
    assert!(
        matches!(
            events[4],
            StreamEvent::Usage {
                input_tokens: 3,
                output_tokens: 4,
                cached_tokens: 0,
                thinking_tokens: 0
            }
        ),
        "got {:?}",
        events[4]
    );
    assert!(
        matches!(
            &events[5],
            StreamEvent::Done {
                stop_reason: StopReason::EndTurn
            }
        ),
        "got {:?}",
        events[5]
    );
}

#[tokio::test]
async fn cached_content_token_count_surfaces_on_the_usage_event() {
    // Gemini 2.5+ implicit caching (on by default): a cache hit reports
    // cachedContentTokenCount alongside prompt/candidates counts. End-to-end
    // through the SSE parser → process_gemini_event → StreamEvent::Usage.
    let body = "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"hi\"}],\"role\":\"model\"},\"finishReason\":\"STOP\"}],\"usageMetadata\":{\"promptTokenCount\":120,\"candidatesTokenCount\":30,\"cachedContentTokenCount\":100,\"totalTokenCount\":150}}\n\n";
    let url = serve_one(sse_envelope(body), Duration::ZERO).await;
    let provider = GeminiProvider::with_base_url("k", url);

    let mut stream = provider
        .stream(small_request(), CancellationToken::new())
        .await
        .unwrap();

    let mut usage_event = None;
    while let Some(item) = stream.next().await {
        if let StreamEvent::Usage { .. } = item.as_ref().unwrap() {
            usage_event = Some(item.unwrap());
        }
    }

    match usage_event {
        Some(StreamEvent::Usage {
            input_tokens,
            output_tokens,
            cached_tokens,
            thinking_tokens,
        }) => {
            assert_eq!(input_tokens, 120);
            assert_eq!(output_tokens, 30);
            assert_eq!(cached_tokens, 100);
            assert_eq!(thinking_tokens, 0);
        }
        other => panic!("expected Usage event, got {other:?}"),
    }
}

#[tokio::test]
async fn thoughts_token_count_surfaces_on_the_usage_event() {
    let body = "data: {\"candidates\":[{\"finishReason\":\"STOP\"}],\"usageMetadata\":{\"promptTokenCount\":12,\"candidatesTokenCount\":5,\"thoughtsTokenCount\":9}}\n\n";
    let url = serve_one(sse_envelope(body), Duration::ZERO).await;
    let provider = GeminiProvider::with_base_url("k", url);
    let mut stream = provider
        .stream(small_request(), CancellationToken::new())
        .await
        .unwrap();

    while let Some(item) = stream.next().await {
        if let StreamEvent::Usage { thinking_tokens, .. } = item.unwrap() {
            assert_eq!(thinking_tokens, 9);
            return;
        }
    }
    panic!("expected Usage event");
}

#[tokio::test]
async fn max_tokens_finish_reason_maps_to_max_tokens_stop() {
    let body = "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"...\"}]},\"finishReason\":\"MAX_TOKENS\"}],\"usageMetadata\":{\"promptTokenCount\":1,\"candidatesTokenCount\":50,\"totalTokenCount\":51}}\n\n";
    let url = serve_one(sse_envelope(body), Duration::ZERO).await;
    let provider = GeminiProvider::with_base_url("k", url);

    let mut stream = provider
        .stream(small_request(), CancellationToken::new())
        .await
        .unwrap();

    let mut last = None;
    while let Some(item) = stream.next().await {
        last = Some(item.unwrap());
    }
    match last {
        Some(StreamEvent::Done { stop_reason }) => {
            assert_eq!(stop_reason, StopReason::MaxTokens);
        }
        other => panic!("expected Done{{MaxTokens}}, got {other:?}"),
    }
}

#[tokio::test]
async fn safety_finish_reason_maps_to_error_stop() {
    let body = "data: {\"candidates\":[{\"content\":{\"parts\":[]},\"finishReason\":\"SAFETY\"}],\"usageMetadata\":{\"promptTokenCount\":1,\"candidatesTokenCount\":0,\"totalTokenCount\":1}}\n\n";
    let url = serve_one(sse_envelope(body), Duration::ZERO).await;
    let provider = GeminiProvider::with_base_url("k", url);

    let mut stream = provider
        .stream(small_request(), CancellationToken::new())
        .await
        .unwrap();

    let mut last = None;
    while let Some(item) = stream.next().await {
        last = Some(item.unwrap());
    }
    match last {
        Some(StreamEvent::Done {
            stop_reason: StopReason::Error(msg),
        }) => {
            assert!(msg.contains("SAFETY"), "got: {msg}");
        }
        other => panic!("expected Done{{Error}}, got {other:?}"),
    }
}

#[tokio::test]
async fn prompt_feedback_block_wins_over_candidate_finish_reason() {
    let body = "data: {\"promptFeedback\":{\"blockReason\":\"SAFETY\"},\"candidates\":[{\"finishReason\":\"STOP\"}]}\n\n";
    let url = serve_one(sse_envelope(body), Duration::ZERO).await;
    let provider = GeminiProvider::with_base_url("k", url);

    let mut stream = provider
        .stream(small_request(), CancellationToken::new())
        .await
        .unwrap();

    let mut last = None;
    while let Some(item) = stream.next().await {
        last = Some(item.unwrap());
    }
    match last {
        Some(StreamEvent::Done {
            stop_reason: StopReason::Error(msg),
        }) => {
            assert!(
                msg.contains("blocked") && msg.contains("SAFETY"),
                "got: {msg}"
            );
        }
        other => panic!("expected Done{{Error}}, got {other:?}"),
    }
}

#[tokio::test]
async fn cancel_mid_stream_yields_done_cancelled_within_500ms() {
    // Two events then hold the connection open for 30s — long enough that
    // any wait on the upstream is the dominant timer when cancel is asleep.
    let body = concat!(
        "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"Hi\"}],\"role\":\"model\"}}]}\n\n",
        "data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\" there\"}],\"role\":\"model\"}}]}\n\n",
    );
    let url = serve_one(sse_envelope(body), Duration::from_secs(30)).await;
    let provider = GeminiProvider::with_base_url("k", url);
    let cancel = CancellationToken::new();

    let mut stream = provider
        .stream(small_request(), cancel.clone())
        .await
        .expect("stream() should succeed");

    // Pull until we see the first TextDelta — then we know the stream is
    // actively running and the cancel will hit the bytes_stream wait.
    let mut saw_delta = false;
    for _ in 0..6 {
        match tokio::time::timeout(Duration::from_secs(2), stream.next())
            .await
            .expect("first events should arrive within 2s")
            .expect("stream ended unexpectedly")
            .expect("event must be Ok")
        {
            StreamEvent::TextDelta { .. } => {
                saw_delta = true;
                break;
            }
            StreamEvent::Start { .. } => continue,
            other => panic!("did not expect {other:?} before TextDelta"),
        }
    }
    assert!(saw_delta, "never observed a TextDelta");

    // Trigger cancel and time the round-trip to Done{Cancelled}.
    let t0 = Instant::now();
    cancel.cancel();

    // The stream may emit one or two more buffered deltas before the
    // select! picks up the cancel branch — pull until we hit the Done.
    let done_seen: StopReason = loop {
        let next = tokio::time::timeout(Duration::from_millis(500), stream.next())
            .await
            .expect("Done{Cancelled} must arrive within 500ms of cancel.cancel()");
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
    assert_eq!(done_seen, StopReason::Cancelled);
}

#[tokio::test]
async fn cancel_before_initial_response_returns_cancelled_error() {
    // Listener that never answers — we want the cancel token to win the
    // race against the initial POST.
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let url = format!("http://{addr}");
    tokio::spawn(async move {
        // Accept and then sleep forever — no response written.
        if let Ok((mut socket, _)) = listener.accept().await {
            let mut buf = vec![0u8; 8192];
            let _ = socket.read(&mut buf).await;
            tokio::time::sleep(Duration::from_secs(30)).await;
        }
    });

    let provider = GeminiProvider::with_base_url("k", url);
    let cancel = CancellationToken::new();

    let cancel_clone = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(150)).await;
        cancel_clone.cancel();
    });

    let t0 = Instant::now();
    let err = provider
        .stream(small_request(), cancel)
        .await
        .err()
        .expect("expected stream() to error on pre-response cancel");
    let elapsed = t0.elapsed();
    assert!(
        matches!(err, GatewayError::Cancelled),
        "got {err:?} after {elapsed:?}"
    );
    assert!(
        elapsed < Duration::from_millis(500),
        "pre-response cancel returned in {elapsed:?}, must be < 500ms"
    );
}

#[tokio::test]
async fn malformed_sse_yields_invalid_response_stream_error() {
    let body = "data: {not valid json at all\n\n";
    let url = serve_one(sse_envelope(body), Duration::ZERO).await;
    let provider = GeminiProvider::with_base_url("k", url);

    let mut stream = provider
        .stream(small_request(), CancellationToken::new())
        .await
        .expect("stream() should succeed on 200");

    // Start event first.
    let first = stream.next().await.unwrap().unwrap();
    assert!(matches!(first, StreamEvent::Start { .. }));

    // Then the parse error.
    let second = stream.next().await.unwrap();
    match second {
        Err(GatewayError::InvalidResponse(msg)) => {
            assert!(msg.contains("malformed"), "got: {msg}");
        }
        other => panic!("expected InvalidResponse, got {other:?}"),
    }
}
