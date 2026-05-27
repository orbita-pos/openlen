//! Concrete Gemini provider. No trait abstraction — there is one provider
//! and there will be one provider unless that decision is explicitly
//! revisited by a future session.

pub(crate) mod sse;

use std::time::Duration;

use async_stream::stream;
use futures::stream::{BoxStream, StreamExt};
use reqwest::header::{HeaderMap, RETRY_AFTER};
use serde::Serialize;
use tokio_util::sync::CancellationToken;
use tracing::{debug, warn};

use crate::error::GatewayError;
use crate::tokenizer;
use crate::types::{Message, Role, StopReason, StreamEvent, StreamRequest};

use sse::{GeminiEvent, SseParser};

/// Default upstream. Overridable via [`GeminiProvider::with_base_url`] for
/// tests that point at a local mock server.
const DEFAULT_BASE_URL: &str = "https://generativelanguage.googleapis.com";

/// Single-provider entry point. Cheap to clone — the inner `reqwest::Client`
/// uses an Arc and the api_key is stored owned but small.
#[derive(Clone)]
pub struct GeminiProvider {
    api_key: String,
    client: reqwest::Client,
    base_url: String,
}

impl std::fmt::Debug for GeminiProvider {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GeminiProvider")
            .field("base_url", &self.base_url)
            .field("api_key", &"<redacted>")
            .finish()
    }
}

impl GeminiProvider {
    pub fn new(api_key: impl Into<String>) -> Self {
        Self::with_base_url(api_key, DEFAULT_BASE_URL)
    }

    pub fn with_base_url(api_key: impl Into<String>, base_url: impl Into<String>) -> Self {
        let client = reqwest::Client::builder()
            // Initial POST is bounded; once streaming starts we want no
            // overall request timeout. The cancel token + per-frame body
            // poll (in F3 S3 when we re-wrap with a TimeoutBody) cover the
            // mid-stream stalls.
            .connect_timeout(Duration::from_secs(15))
            .pool_idle_timeout(Some(Duration::from_secs(90)))
            .build()
            .expect("reqwest Client builder with default options should not fail");

        Self {
            api_key: api_key.into(),
            client,
            base_url: base_url.into().trim_end_matches('/').to_owned(),
        }
    }

    /// Sum the heuristic estimate across each message's content. Cheap
    /// pre-flight gate; exact counts come back in
    /// [`StreamEvent::Usage`].
    pub fn estimate_input_tokens(&self, messages: &[Message]) -> u32 {
        messages
            .iter()
            .map(|m| tokenizer::estimate_tokens(&m.content))
            .sum()
    }

    /// Open a streaming generation against Gemini. Returns a stream of
    /// [`StreamEvent`]s; the consumer can cancel mid-flight by signalling
    /// `cancel` (or by dropping the returned stream — both terminate the
    /// upstream socket).
    ///
    /// Emission order is the one documented on [`StreamEvent`]:
    /// `Start { id }`, zero or more `TextDelta`, optional `Usage`, terminal
    /// `Done { stop_reason }`.
    pub async fn stream(
        &self,
        request: StreamRequest,
        cancel: CancellationToken,
    ) -> Result<BoxStream<'static, Result<StreamEvent, GatewayError>>, GatewayError> {
        let body = build_request_body(&request);
        let url = format!(
            "{}/v1beta/models/{}:streamGenerateContent?alt=sse",
            self.base_url, request.model,
        );

        let post = self
            .client
            .post(&url)
            .header("x-goog-api-key", &self.api_key)
            .header("Content-Type", "application/json")
            .json(&body)
            .send();

        let response = tokio::select! {
            biased;
            _ = cancel.cancelled() => {
                debug!("gemini stream cancelled before initial response");
                return Err(GatewayError::Cancelled);
            }
            res = post => res?,
        };

        let status = response.status();
        if !status.is_success() {
            let headers = response.headers().clone();
            let body_text = response.text().await.unwrap_or_default();
            return Err(map_error_response(status.as_u16(), &headers, body_text));
        }

        let bytes_stream = response.bytes_stream();
        let id = generate_event_id();
        let s = build_event_stream(bytes_stream, cancel, id);
        Ok(s.boxed())
    }
}

fn build_event_stream<S>(
    bytes_stream: S,
    cancel: CancellationToken,
    id: String,
) -> impl futures::Stream<Item = Result<StreamEvent, GatewayError>> + Send + 'static
where
    S: futures::Stream<Item = Result<bytes::Bytes, reqwest::Error>> + Send + 'static,
{
    stream! {
        yield Ok(StreamEvent::Start { id });

        let mut parser = SseParser::new();
        let mut pending_usage: Option<(u32, u32)> = None;
        let mut pending_stop: Option<StopReason> = None;
        let mut bytes_stream = Box::pin(bytes_stream);

        loop {
            tokio::select! {
                biased;
                _ = cancel.cancelled() => {
                    debug!("gemini stream cancelled mid-flight");
                    yield Ok(StreamEvent::Done {
                        stop_reason: StopReason::Cancelled,
                    });
                    return;
                }
                next = bytes_stream.next() => {
                    match next {
                        Some(Ok(chunk)) => {
                            let events = match parser.feed(&chunk) {
                                Ok(evs) => evs,
                                Err(err) => {
                                    warn!(error = %err, "gemini SSE parse failed");
                                    yield Err(err);
                                    return;
                                }
                            };
                            for ev in events {
                                for delta in process_gemini_event(
                                    ev,
                                    &mut pending_usage,
                                    &mut pending_stop,
                                ) {
                                    yield Ok(delta);
                                }
                            }
                        }
                        Some(Err(err)) => {
                            warn!(error = %err, "gemini upstream body errored mid-stream");
                            yield Err(GatewayError::NetworkError(err));
                            return;
                        }
                        None => {
                            if let Some((input_tokens, output_tokens)) = pending_usage {
                                yield Ok(StreamEvent::Usage {
                                    input_tokens,
                                    output_tokens,
                                });
                            }
                            yield Ok(StreamEvent::Done {
                                stop_reason: pending_stop.unwrap_or(StopReason::EndTurn),
                            });
                            return;
                        }
                    }
                }
            }
        }
    }
}

fn process_gemini_event(
    ev: GeminiEvent,
    pending_usage: &mut Option<(u32, u32)>,
    pending_stop: &mut Option<StopReason>,
) -> Vec<StreamEvent> {
    let mut deltas: Vec<StreamEvent> = Vec::new();

    if let Some(pf) = ev.prompt_feedback {
        if let Some(reason) = pf.block_reason {
            *pending_stop = Some(StopReason::Error(format!("prompt blocked: {reason}")));
            return deltas;
        }
    }

    for c in ev.candidates {
        if let Some(content) = c.content {
            for p in content.parts {
                if let Some(text) = p.text {
                    if !text.is_empty() {
                        deltas.push(StreamEvent::TextDelta { text });
                    }
                }
            }
        }
        if let Some(reason) = c.finish_reason {
            let mapped = map_finish_reason(&reason);
            // A prompt-block already recorded as Error wins over a per-
            // candidate STOP; otherwise the latest reason wins.
            if !matches!(pending_stop, Some(StopReason::Error(_))) {
                *pending_stop = Some(mapped);
            }
        }
    }

    if let Some(um) = ev.usage_metadata {
        let it = um.prompt_token_count.unwrap_or(0);
        let ot = um.candidates_token_count.unwrap_or(0);
        if it != 0 || ot != 0 {
            *pending_usage = Some((it, ot));
        }
    }

    deltas
}

fn map_finish_reason(s: &str) -> StopReason {
    // Gemini finishReason values per
    // https://ai.google.dev/api/rest/v1beta/Candidate#FinishReason
    match s {
        "STOP" => StopReason::EndTurn,
        "MAX_TOKENS" => StopReason::MaxTokens,
        // Everything else (SAFETY, RECITATION, LANGUAGE, OTHER,
        // BLOCKLIST, PROHIBITED_CONTENT, SPII, MALFORMED_FUNCTION_CALL,
        // …) is a terminal failure we don't want to silently mask.
        other => StopReason::Error(format!("finish_reason: {other}")),
    }
}

fn map_error_response(status: u16, headers: &HeaderMap, body: String) -> GatewayError {
    match status {
        401 | 403 => GatewayError::AuthError,
        429 => GatewayError::RateLimited {
            retry_after_ms: parse_retry_after_ms(headers),
        },
        _ => GatewayError::ApiError {
            status,
            body: truncate_body(body, 4096),
        },
    }
}

fn truncate_body(body: String, max_bytes: usize) -> String {
    if body.len() <= max_bytes {
        return body;
    }
    // Step back to the nearest UTF-8 codepoint boundary so the slice
    // doesn't split a multi-byte character.
    let mut cut = max_bytes;
    while cut > 0 && !body.is_char_boundary(cut) {
        cut -= 1;
    }
    let mut out = String::with_capacity(cut + 3);
    out.push_str(&body[..cut]);
    out.push('…');
    out
}

fn parse_retry_after_ms(headers: &HeaderMap) -> Option<u64> {
    let raw = headers.get(RETRY_AFTER)?.to_str().ok()?.trim();
    // Retry-After can be either delta-seconds or an HTTP-date. We only
    // parse the delta-seconds form (the only one Gemini emits in practice);
    // HTTP-date support would need `httpdate` or similar.
    let secs: u64 = raw.parse().ok()?;
    Some(secs.saturating_mul(1000))
}

fn generate_event_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64;
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    format!("gemini-{ts:x}-{n:x}")
}

// --- Outgoing wire types --------------------------------------------------

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
struct GeminiRequestBody {
    contents: Vec<GeminiRequestContent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    system_instruction: Option<GeminiSystemInstruction>,
    #[serde(skip_serializing_if = "Option::is_none")]
    generation_config: Option<GenerationConfig>,
}

#[derive(Serialize, Debug)]
struct GeminiRequestContent {
    role: &'static str,
    parts: Vec<GeminiRequestPart>,
}

#[derive(Serialize, Debug)]
struct GeminiRequestPart {
    text: String,
}

#[derive(Serialize, Debug)]
struct GeminiSystemInstruction {
    parts: Vec<GeminiRequestPart>,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct GenerationConfig {
    #[serde(skip_serializing_if = "Option::is_none")]
    temperature: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    max_output_tokens: Option<u32>,
}

fn build_request_body(request: &StreamRequest) -> GeminiRequestBody {
    let mut system_parts: Vec<GeminiRequestPart> = Vec::new();
    let mut contents: Vec<GeminiRequestContent> = Vec::new();

    for msg in &request.messages {
        match msg.role {
            Role::System => system_parts.push(GeminiRequestPart {
                text: msg.content.clone(),
            }),
            Role::User => contents.push(GeminiRequestContent {
                role: "user",
                parts: vec![GeminiRequestPart {
                    text: msg.content.clone(),
                }],
            }),
            Role::Assistant => contents.push(GeminiRequestContent {
                role: "model",
                parts: vec![GeminiRequestPart {
                    text: msg.content.clone(),
                }],
            }),
        }
    }

    let system_instruction = if system_parts.is_empty() {
        None
    } else {
        Some(GeminiSystemInstruction {
            parts: system_parts,
        })
    };

    let generation_config = if request.temperature.is_some() || request.max_output_tokens.is_some()
    {
        Some(GenerationConfig {
            temperature: request.temperature,
            max_output_tokens: request.max_output_tokens,
        })
    } else {
        None
    };

    GeminiRequestBody {
        contents,
        system_instruction,
        generation_config,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_does_not_panic_on_empty_api_key() {
        let p = GeminiProvider::new("");
        assert_eq!(p.base_url, DEFAULT_BASE_URL);
    }

    #[test]
    fn with_base_url_trims_trailing_slash() {
        let p = GeminiProvider::with_base_url("k", "https://example.com/");
        assert_eq!(p.base_url, "https://example.com");
    }

    #[test]
    fn debug_redacts_api_key() {
        let p = GeminiProvider::new("super-secret-key");
        let s = format!("{p:?}");
        assert!(!s.contains("super-secret-key"), "got: {s}");
        assert!(s.contains("redacted"), "got: {s}");
    }

    #[test]
    fn estimate_input_tokens_sums_per_message() {
        let p = GeminiProvider::new("");
        let msgs = vec![
            Message::system("abcd"),   // 1
            Message::user("abcdefgh"), // 2
        ];
        assert_eq!(p.estimate_input_tokens(&msgs), 3);
    }

    #[test]
    fn build_request_body_maps_user_role_to_user() {
        let req = StreamRequest::new("gemini-2.5-flash", vec![Message::user("hi")]);
        let body = build_request_body(&req);
        assert_eq!(body.contents.len(), 1);
        assert_eq!(body.contents[0].role, "user");
        assert_eq!(body.contents[0].parts[0].text, "hi");
        assert!(body.system_instruction.is_none());
        assert!(body.generation_config.is_none());
    }

    #[test]
    fn build_request_body_maps_assistant_role_to_model() {
        let req = StreamRequest::new(
            "gemini-2.5-flash",
            vec![Message::user("hi"), Message::assistant("hello")],
        );
        let body = build_request_body(&req);
        assert_eq!(body.contents.len(), 2);
        assert_eq!(body.contents[0].role, "user");
        assert_eq!(body.contents[1].role, "model");
    }

    #[test]
    fn build_request_body_extracts_system_to_system_instruction() {
        let req = StreamRequest::new(
            "gemini-2.5-flash",
            vec![
                Message::system("you are a helpful assistant"),
                Message::user("hi"),
            ],
        );
        let body = build_request_body(&req);
        assert_eq!(body.contents.len(), 1);
        assert_eq!(body.contents[0].role, "user");
        let si = body.system_instruction.as_ref().unwrap();
        assert_eq!(si.parts.len(), 1);
        assert_eq!(si.parts[0].text, "you are a helpful assistant");
    }

    #[test]
    fn build_request_body_collects_multiple_system_messages_as_parts() {
        let req = StreamRequest::new(
            "gemini-2.5-flash",
            vec![
                Message::system("part one"),
                Message::system("part two"),
                Message::user("hi"),
            ],
        );
        let body = build_request_body(&req);
        let si = body.system_instruction.as_ref().unwrap();
        assert_eq!(si.parts.len(), 2);
        assert_eq!(si.parts[0].text, "part one");
        assert_eq!(si.parts[1].text, "part two");
    }

    #[test]
    fn build_request_body_includes_generation_config_only_when_set() {
        let plain = build_request_body(&StreamRequest::new(
            "gemini-2.5-flash",
            vec![Message::user("hi")],
        ));
        assert!(plain.generation_config.is_none());

        let configured = build_request_body(
            &StreamRequest::new("gemini-2.5-flash", vec![Message::user("hi")])
                .with_max_output_tokens(64)
                .with_temperature(0.2),
        );
        let cfg = configured.generation_config.as_ref().unwrap();
        assert_eq!(cfg.max_output_tokens, Some(64));
        assert_eq!(cfg.temperature, Some(0.2));
    }

    #[test]
    fn request_body_serializes_to_expected_json_shape() {
        let req = StreamRequest::new(
            "gemini-2.5-pro",
            vec![
                Message::system("be brief"),
                Message::user("hi"),
                Message::assistant("hello"),
                Message::user("again"),
            ],
        )
        .with_max_output_tokens(100)
        .with_temperature(0.5);

        let body = build_request_body(&req);
        let v: serde_json::Value = serde_json::to_value(&body).unwrap();

        assert_eq!(v["contents"][0]["role"], "user");
        assert_eq!(v["contents"][0]["parts"][0]["text"], "hi");
        assert_eq!(v["contents"][1]["role"], "model");
        assert_eq!(v["contents"][1]["parts"][0]["text"], "hello");
        assert_eq!(v["contents"][2]["role"], "user");
        assert_eq!(v["contents"][2]["parts"][0]["text"], "again");

        assert_eq!(v["systemInstruction"]["parts"][0]["text"], "be brief");

        assert_eq!(v["generationConfig"]["temperature"], 0.5);
        assert_eq!(v["generationConfig"]["maxOutputTokens"], 100);
    }

    #[test]
    fn map_finish_reason_maps_known_values() {
        assert_eq!(map_finish_reason("STOP"), StopReason::EndTurn);
        assert_eq!(map_finish_reason("MAX_TOKENS"), StopReason::MaxTokens);
        match map_finish_reason("SAFETY") {
            StopReason::Error(msg) => assert!(msg.contains("SAFETY")),
            other => panic!("expected Error, got {other:?}"),
        }
        match map_finish_reason("RECITATION") {
            StopReason::Error(msg) => assert!(msg.contains("RECITATION")),
            other => panic!("expected Error, got {other:?}"),
        }
    }

    #[test]
    fn map_error_response_classifies_status_codes() {
        let h = HeaderMap::new();
        assert!(matches!(
            map_error_response(401, &h, "nope".into()),
            GatewayError::AuthError
        ));
        assert!(matches!(
            map_error_response(403, &h, "nope".into()),
            GatewayError::AuthError
        ));
        assert!(matches!(
            map_error_response(429, &h, "".into()),
            GatewayError::RateLimited { .. }
        ));
        match map_error_response(500, &h, "boom".into()) {
            GatewayError::ApiError { status, body } => {
                assert_eq!(status, 500);
                assert_eq!(body, "boom");
            }
            other => panic!("expected ApiError, got {other:?}"),
        }
        match map_error_response(400, &h, "bad request".into()) {
            GatewayError::ApiError { status, .. } => assert_eq!(status, 400),
            other => panic!("expected ApiError, got {other:?}"),
        }
    }

    #[test]
    fn map_error_response_truncates_body() {
        let h = HeaderMap::new();
        let huge = "x".repeat(10_000);
        match map_error_response(500, &h, huge) {
            GatewayError::ApiError { body, .. } => {
                // 4096 ASCII bytes + 3 bytes for "…" UTF-8 = 4099.
                assert!(body.len() <= 4096 + 3, "got len {}", body.len());
                assert!(
                    body.ends_with('…'),
                    "got tail: {:?}",
                    &body[body.len().saturating_sub(8)..]
                );
            }
            other => panic!("expected ApiError, got {other:?}"),
        }
    }

    #[test]
    fn truncate_body_respects_utf8_boundaries() {
        // 4-byte codepoint 🦀 at the boundary: cut should step back to
        // before the start of the codepoint, then append "…".
        let mut s = "x".repeat(4094);
        s.push('🦀'); // 4 bytes — pushes total past 4096
        s.push('🦀');
        let out = truncate_body(s, 4096);
        assert!(out.is_char_boundary(out.len() - "…".len()));
        assert!(out.ends_with('…'));
    }

    #[test]
    fn truncate_body_passes_short_input_unchanged() {
        let s = "hello world".to_string();
        let out = truncate_body(s.clone(), 4096);
        assert_eq!(out, s);
    }

    #[test]
    fn map_error_response_parses_retry_after_header() {
        let mut h = HeaderMap::new();
        h.insert(RETRY_AFTER, "30".parse().unwrap());
        match map_error_response(429, &h, "".into()) {
            GatewayError::RateLimited { retry_after_ms } => {
                assert_eq!(retry_after_ms, Some(30_000));
            }
            other => panic!("expected RateLimited, got {other:?}"),
        }
    }

    #[test]
    fn map_error_response_handles_missing_retry_after() {
        let h = HeaderMap::new();
        match map_error_response(429, &h, "".into()) {
            GatewayError::RateLimited { retry_after_ms } => {
                assert!(retry_after_ms.is_none());
            }
            other => panic!("expected RateLimited, got {other:?}"),
        }
    }

    #[test]
    fn generate_event_id_is_unique_across_calls() {
        let ids: std::collections::HashSet<_> = (0..16).map(|_| generate_event_id()).collect();
        assert_eq!(ids.len(), 16);
    }

    #[test]
    fn process_event_collects_text_deltas() {
        use super::sse::*;
        let ev = GeminiEvent {
            candidates: vec![GeminiCandidate {
                content: Some(GeminiContent {
                    parts: vec![
                        GeminiPart {
                            text: Some("hi".into()),
                        },
                        GeminiPart {
                            text: Some(" there".into()),
                        },
                    ],
                }),
                finish_reason: None,
            }],
            usage_metadata: None,
            prompt_feedback: None,
        };

        let mut usage = None;
        let mut stop = None;
        let deltas = process_gemini_event(ev, &mut usage, &mut stop);
        assert_eq!(deltas.len(), 2);
        assert!(matches!(&deltas[0], StreamEvent::TextDelta { text } if text == "hi"));
        assert!(matches!(&deltas[1], StreamEvent::TextDelta { text } if text == " there"));
        assert!(usage.is_none());
        assert!(stop.is_none());
    }

    #[test]
    fn process_event_extracts_usage_metadata() {
        use super::sse::*;
        let ev = GeminiEvent {
            candidates: vec![GeminiCandidate {
                content: None,
                finish_reason: Some("STOP".into()),
            }],
            usage_metadata: Some(GeminiUsageMetadata {
                prompt_token_count: Some(10),
                candidates_token_count: Some(20),
            }),
            prompt_feedback: None,
        };
        let mut usage = None;
        let mut stop = None;
        let _ = process_gemini_event(ev, &mut usage, &mut stop);
        assert_eq!(usage, Some((10, 20)));
        assert_eq!(stop, Some(StopReason::EndTurn));
    }

    #[test]
    fn process_event_prompt_block_records_terminal_error() {
        use super::sse::*;
        let ev = GeminiEvent {
            candidates: vec![],
            usage_metadata: None,
            prompt_feedback: Some(GeminiPromptFeedback {
                block_reason: Some("SAFETY".into()),
            }),
        };
        let mut usage = None;
        let mut stop = None;
        let _ = process_gemini_event(ev, &mut usage, &mut stop);
        match stop {
            Some(StopReason::Error(msg)) => assert!(msg.contains("SAFETY")),
            other => panic!("expected Error, got {other:?}"),
        }
    }
}
