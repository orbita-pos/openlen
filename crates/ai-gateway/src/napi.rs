//! napi-rs binding for the `openlen-ai-gateway` crate.
//!
//! Re-exposes the concrete [`crate::GeminiProvider`] as a JavaScript class,
//! with the supporting types ([`crate::types::Message`],
//! [`crate::types::StreamRequest`], [`crate::types::StreamEvent`], etc.)
//! marshalled as plain JS objects. The Rust side stays in `snake_case`;
//! napi-derive auto-camelCases field names so JS sees `inputTokens`,
//! `maxOutputTokens`, etc.
//!
//! Type bridge cheat-sheet:
//!
//! | Rust                              | JS                                                                       |
//! |-----------------------------------|--------------------------------------------------------------------------|
//! | `crate::GeminiProvider`           | `GeminiProvider` (class)                                                 |
//! | `crate::types::Message`           | `{ role: 'system'\|'user'\|'assistant', content: string }`                |
//! | `crate::types::StreamRequest`     | `{ model, messages, maxOutputTokens?, temperature? }`                    |
//! | `crate::types::StreamEvent`       | flat-tagged union — see [`JsStreamEvent`] for the discriminated shape    |
//! | `crate::types::StopReason`        | `{ kind: 'end_turn'\|'max_tokens'\|'cancelled'\|'error', error?: string }` |
//! | `crate::error::GatewayError`      | thrown as `Error` whose `.message` is a JSON envelope (see below)        |
//!
//! Error envelope: each [`crate::error::GatewayError`] variant is mapped to
//! a [`napi::Error`] whose `reason` field is a JSON string of the shape
//! `{"kind":"…","retryable":bool,"message":"…"}`. The TS wrapper at
//! `lib/ai-gateway.ts` parses this envelope back into a typed
//! `GatewayError` so JS callers don't have to.
//!
//! Stream class ([`JsGeminiStream`]) is defined in [`crate::napi_stream`].

use napi::bindgen_prelude::*;
use napi_derive::napi;

use crate::error::GatewayError;
use crate::tokenizer;
use crate::types::{Message, Role, StopReason, StreamEvent, StreamRequest};

// --- Public-typed marshalling structs --------------------------------------

#[napi(object, js_name = "Message")]
#[derive(Debug, Clone)]
pub struct JsMessage {
    /// One of `"system"`, `"user"`, or `"assistant"`. Any other value is
    /// rejected with a `GatewayError`-shaped `Error` from the consuming
    /// method (`estimateInputTokens`, `stream`).
    pub role: String,
    pub content: String,
}

#[napi(object, js_name = "StreamRequest")]
#[derive(Debug, Clone)]
pub struct JsStreamRequest {
    pub model: String,
    pub messages: Vec<JsMessage>,
    pub max_output_tokens: Option<u32>,
    /// napi-rs marshals JS `number` as `f64`; the underlying Rust type
    /// stores `f32`. Lossy down-cast happens on the boundary — the
    /// rounding error for a temperature in `[0.0, 2.0]` is below
    /// `1e-7`, well inside Gemini's tolerance.
    pub temperature: Option<f64>,
}

/// Flat-tagged discriminated union. The `type` field is always present;
/// the rest are populated according to the variant. The TS wrapper in
/// `lib/ai-gateway.ts` narrows this into a proper
/// `StreamEvent = { type: 'start', id } | { type: 'text_delta', text } | …`
/// so callers don't see the optionals.
///
/// Emission order from [`crate::GeminiProvider::stream`]:
/// `Start { id }` → 0..N `TextDelta { text }` → optional `Usage` →
/// terminal `Done { stopReason }`.
#[napi(object, js_name = "StreamEvent")]
#[derive(Debug, Clone)]
pub struct JsStreamEvent {
    #[napi(js_name = "type")]
    pub event_type: String,
    pub id: Option<String>,
    pub text: Option<String>,
    pub input_tokens: Option<u32>,
    pub output_tokens: Option<u32>,
    pub stop_reason: Option<JsStopReason>,
}

#[napi(object, js_name = "StopReason")]
#[derive(Debug, Clone)]
pub struct JsStopReason {
    /// One of `"end_turn"`, `"max_tokens"`, `"cancelled"`, `"error"`.
    pub kind: String,
    /// Populated only when `kind == "error"`. Carries the upstream
    /// `finishReason` (e.g. `"finish_reason: SAFETY"`) so callers can
    /// surface a meaningful failure message.
    pub error: Option<String>,
}

// --- Conversions: JS shapes → native ---------------------------------------

impl TryFrom<JsMessage> for Message {
    type Error = napi::Error;

    fn try_from(m: JsMessage) -> std::result::Result<Self, Self::Error> {
        let role = parse_role(&m.role)?;
        Ok(Message {
            role,
            content: m.content,
        })
    }
}

impl TryFrom<JsStreamRequest> for StreamRequest {
    type Error = napi::Error;

    fn try_from(r: JsStreamRequest) -> std::result::Result<Self, Self::Error> {
        let messages: Vec<Message> = r
            .messages
            .into_iter()
            .map(Message::try_from)
            .collect::<std::result::Result<_, _>>()?;
        let mut req = StreamRequest::new(r.model, messages);
        if let Some(n) = r.max_output_tokens {
            req = req.with_max_output_tokens(n);
        }
        if let Some(t) = r.temperature {
            req = req.with_temperature(t as f32);
        }
        Ok(req)
    }
}

fn parse_role(s: &str) -> Result<Role> {
    match s {
        "system" => Ok(Role::System),
        "user" => Ok(Role::User),
        "assistant" => Ok(Role::Assistant),
        other => Err(napi::Error::from_reason(format!(
            "invalid role \"{other}\" (expected one of: system, user, assistant)"
        ))),
    }
}

// --- Conversions: native → JS shapes ---------------------------------------

impl From<StopReason> for JsStopReason {
    fn from(sr: StopReason) -> Self {
        match sr {
            StopReason::EndTurn => Self {
                kind: "end_turn".to_owned(),
                error: None,
            },
            StopReason::MaxTokens => Self {
                kind: "max_tokens".to_owned(),
                error: None,
            },
            StopReason::Cancelled => Self {
                kind: "cancelled".to_owned(),
                error: None,
            },
            StopReason::Error(e) => Self {
                kind: "error".to_owned(),
                error: Some(e),
            },
        }
    }
}

impl From<StreamEvent> for JsStreamEvent {
    fn from(ev: StreamEvent) -> Self {
        match ev {
            StreamEvent::Start { id } => Self {
                event_type: "start".to_owned(),
                id: Some(id),
                text: None,
                input_tokens: None,
                output_tokens: None,
                stop_reason: None,
            },
            StreamEvent::TextDelta { text } => Self {
                event_type: "text_delta".to_owned(),
                id: None,
                text: Some(text),
                input_tokens: None,
                output_tokens: None,
                stop_reason: None,
            },
            StreamEvent::Usage {
                input_tokens,
                output_tokens,
            } => Self {
                event_type: "usage".to_owned(),
                id: None,
                text: None,
                input_tokens: Some(input_tokens),
                output_tokens: Some(output_tokens),
                stop_reason: None,
            },
            StreamEvent::Done { stop_reason } => Self {
                event_type: "done".to_owned(),
                id: None,
                text: None,
                input_tokens: None,
                output_tokens: None,
                stop_reason: Some(stop_reason.into()),
            },
        }
    }
}

// --- GatewayError → napi::Error --------------------------------------------

/// Render a [`GatewayError`] into a [`napi::Error`] with a structured JSON
/// envelope as the reason. The TS wrapper parses this back into a typed
/// `GatewayError` class so callers see `err.kind`, `err.retryable`, and
/// `err.message` directly.
///
/// The function is only called from the stream binding ([`crate::napi_stream`],
/// added in Phase C). Until that lands, suppress the dead-code warning so
/// the type-marshalling and constructor surface still build clippy-clean.
#[allow(dead_code)]
pub(crate) fn gateway_error_to_napi(err: GatewayError) -> napi::Error {
    let kind = match &err {
        GatewayError::ApiError { .. } => "api",
        GatewayError::NetworkError(_) => "network",
        GatewayError::Cancelled => "cancelled",
        GatewayError::InvalidResponse(_) => "invalid_response",
        GatewayError::RateLimited { .. } => "rate_limited",
        GatewayError::AuthError => "auth",
    };
    let retry_after_ms = match &err {
        GatewayError::RateLimited { retry_after_ms } => *retry_after_ms,
        _ => None,
    };
    let envelope = serde_json::json!({
        "kind": kind,
        "retryable": err.is_retryable(),
        "message": err.to_string(),
        "retryAfterMs": retry_after_ms,
    });
    napi::Error::from_reason(envelope.to_string())
}

// --- Public free function ---------------------------------------------------

/// Coarse `chars / 4` token estimator. Mirrors
/// [`crate::tokenizer::estimate_tokens`] — exposed at module scope so JS
/// callers can use it without instantiating a `GeminiProvider`.
#[napi(js_name = "estimateTokens")]
pub fn js_estimate_tokens(text: String) -> u32 {
    tokenizer::estimate_tokens(&text)
}

// --- GeminiProvider napi class ---------------------------------------------

/// JS-facing wrapper around [`crate::GeminiProvider`]. Cheap to construct;
/// holds a `reqwest::Client` internally that is reused across calls.
#[napi(js_name = "GeminiProvider")]
pub struct JsGeminiProvider {
    pub(crate) inner: crate::GeminiProvider,
}

#[napi]
impl JsGeminiProvider {
    /// Construct a provider bound to a Gemini API key. `baseUrl` is
    /// optional — defaults to `https://generativelanguage.googleapis.com`
    /// (the official upstream); override for tests pointing at a mock
    /// server.
    #[napi(constructor)]
    pub fn new(api_key: String, base_url: Option<String>) -> Self {
        let inner = match base_url {
            Some(u) => crate::GeminiProvider::with_base_url(api_key, u),
            None => crate::GeminiProvider::new(api_key),
        };
        Self { inner }
    }

    /// Cheap pre-flight estimate of input tokens (chars/4 heuristic, sum
    /// across messages). Exact billing-grade counts arrive as the
    /// `usage` stream event mid-stream.
    #[napi]
    pub fn estimate_input_tokens(&self, messages: Vec<JsMessage>) -> Result<u32> {
        let native: Vec<Message> = messages
            .into_iter()
            .map(Message::try_from)
            .collect::<std::result::Result<_, _>>()?;
        Ok(self.inner.estimate_input_tokens(&native))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_role_recognises_all_three_lowercase_variants() {
        assert!(matches!(parse_role("system").unwrap(), Role::System));
        assert!(matches!(parse_role("user").unwrap(), Role::User));
        assert!(matches!(parse_role("assistant").unwrap(), Role::Assistant));
    }

    #[test]
    fn parse_role_rejects_unknown_role_with_helpful_message() {
        let err = parse_role("Model").unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("Model"), "got: {msg}");
        assert!(
            msg.contains("system") && msg.contains("user") && msg.contains("assistant"),
            "got: {msg}"
        );
    }

    #[test]
    fn message_try_from_round_trips_role_and_content() {
        let m = JsMessage {
            role: "user".to_owned(),
            content: "hi there".to_owned(),
        };
        let native: Message = m.try_into().unwrap();
        assert_eq!(native.role, Role::User);
        assert_eq!(native.content, "hi there");
    }

    #[test]
    fn stream_request_try_from_carries_all_optional_fields() {
        let r = JsStreamRequest {
            model: "gemini-2.5-flash".to_owned(),
            messages: vec![JsMessage {
                role: "system".to_owned(),
                content: "be brief".to_owned(),
            }],
            max_output_tokens: Some(256),
            temperature: Some(0.2),
        };
        let native: StreamRequest = r.try_into().unwrap();
        assert_eq!(native.model, "gemini-2.5-flash");
        assert_eq!(native.max_output_tokens, Some(256));
        assert!((native.temperature.unwrap() - 0.2).abs() < 1e-6);
        assert_eq!(native.messages.len(), 1);
        assert_eq!(native.messages[0].role, Role::System);
    }

    #[test]
    fn stream_request_try_from_propagates_role_error() {
        let r = JsStreamRequest {
            model: "gemini-2.5-flash".to_owned(),
            messages: vec![JsMessage {
                role: "assistant_typo".to_owned(),
                content: "hi".to_owned(),
            }],
            max_output_tokens: None,
            temperature: None,
        };
        let err = StreamRequest::try_from(r).unwrap_err();
        assert!(err.to_string().contains("assistant_typo"));
    }

    #[test]
    fn stop_reason_end_turn_into_js_drops_error() {
        let js: JsStopReason = StopReason::EndTurn.into();
        assert_eq!(js.kind, "end_turn");
        assert!(js.error.is_none());
    }

    #[test]
    fn stop_reason_error_into_js_carries_error_string() {
        let js: JsStopReason = StopReason::Error("safety: blocked".to_owned()).into();
        assert_eq!(js.kind, "error");
        assert_eq!(js.error.as_deref(), Some("safety: blocked"));
    }

    #[test]
    fn stream_event_start_into_js_has_only_id_field() {
        let js: JsStreamEvent = StreamEvent::Start { id: "abc".into() }.into();
        assert_eq!(js.event_type, "start");
        assert_eq!(js.id.as_deref(), Some("abc"));
        assert!(js.text.is_none());
        assert!(js.input_tokens.is_none());
        assert!(js.output_tokens.is_none());
        assert!(js.stop_reason.is_none());
    }

    #[test]
    fn stream_event_text_delta_into_js_has_only_text_field() {
        let js: JsStreamEvent = StreamEvent::TextDelta {
            text: "Hello".into(),
        }
        .into();
        assert_eq!(js.event_type, "text_delta");
        assert_eq!(js.text.as_deref(), Some("Hello"));
        assert!(js.id.is_none());
    }

    #[test]
    fn stream_event_usage_into_js_carries_both_token_counts() {
        let js: JsStreamEvent = StreamEvent::Usage {
            input_tokens: 12,
            output_tokens: 34,
        }
        .into();
        assert_eq!(js.event_type, "usage");
        assert_eq!(js.input_tokens, Some(12));
        assert_eq!(js.output_tokens, Some(34));
    }

    #[test]
    fn stream_event_done_into_js_wraps_stop_reason() {
        let js: JsStreamEvent = StreamEvent::Done {
            stop_reason: StopReason::MaxTokens,
        }
        .into();
        assert_eq!(js.event_type, "done");
        let sr = js.stop_reason.unwrap();
        assert_eq!(sr.kind, "max_tokens");
        assert!(sr.error.is_none());
    }

    #[test]
    fn gateway_error_to_napi_renders_auth_with_expected_envelope() {
        let napi_err = gateway_error_to_napi(GatewayError::AuthError);
        let parsed: serde_json::Value =
            serde_json::from_str(&napi_err.reason).expect("napi reason must be JSON");
        assert_eq!(parsed["kind"], "auth");
        assert_eq!(parsed["retryable"], false);
        assert!(parsed["message"].as_str().unwrap().contains("API"));
    }

    #[test]
    fn gateway_error_to_napi_carries_retry_after_for_rate_limit() {
        let napi_err = gateway_error_to_napi(GatewayError::RateLimited {
            retry_after_ms: Some(45_000),
        });
        let parsed: serde_json::Value =
            serde_json::from_str(&napi_err.reason).expect("napi reason must be JSON");
        assert_eq!(parsed["kind"], "rate_limited");
        assert_eq!(parsed["retryable"], true);
        assert_eq!(parsed["retryAfterMs"], 45_000);
    }

    #[test]
    fn gateway_error_to_napi_omits_retry_after_for_other_variants() {
        let napi_err = gateway_error_to_napi(GatewayError::ApiError {
            status: 503,
            body: "unavailable".into(),
        });
        let parsed: serde_json::Value =
            serde_json::from_str(&napi_err.reason).expect("napi reason must be JSON");
        assert_eq!(parsed["kind"], "api");
        assert_eq!(parsed["retryable"], true);
        assert!(parsed["retryAfterMs"].is_null());
    }

    #[test]
    fn js_estimate_tokens_matches_native_estimator() {
        let s = "abcdefghijkl"; // 12 chars → 3 tokens
        assert_eq!(js_estimate_tokens(s.to_owned()), 3);
    }
}
