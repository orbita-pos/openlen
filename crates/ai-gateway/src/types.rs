//! Public types crossing the gateway boundary.
//!
//! All types serialize through `serde` so the F3 S2 napi binding can marshal
//! them as JSON if it chooses to (alternative: `napi-derive` direct conversion;
//! the decision is owned by S2). Field names stay in canonical Rust
//! `snake_case`; the wire shape — should it be camelCase for TS ergonomics —
//! is something S2 can layer on with `rename_all = "camelCase"` without
//! breaking the public Rust API.

use serde::{Deserialize, Serialize};

/// Role of a chat message. Maps to the standard AI convention
/// (system / user / assistant). Gemini's wire format uses `user` and `model`
/// instead — that mapping is hidden inside the provider (`Role::Assistant`
/// becomes `"model"` at the Gemini boundary; `Role::System` is extracted into
/// `systemInstruction`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    System,
    User,
    Assistant,
}

/// A single message in a streaming request. F3 S1 is text-only; future
/// multimodal support would require widening `content` to a `Vec<Content>`
/// (image / audio parts). Doing that now would be premature — there is no
/// caller yet.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Message {
    pub role: Role,
    pub content: String,
}

impl Message {
    pub fn new(role: Role, content: impl Into<String>) -> Self {
        Self {
            role,
            content: content.into(),
        }
    }

    pub fn system(content: impl Into<String>) -> Self {
        Self::new(Role::System, content)
    }

    pub fn user(content: impl Into<String>) -> Self {
        Self::new(Role::User, content)
    }

    pub fn assistant(content: impl Into<String>) -> Self {
        Self::new(Role::Assistant, content)
    }
}

/// Input to [`crate::gemini::GeminiProvider::stream`]. The model string is
/// passed through verbatim to Gemini, e.g. `"gemini-2.5-pro"` or
/// `"gemini-2.5-flash"`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct StreamRequest {
    pub model: String,
    pub messages: Vec<Message>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_output_tokens: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,
}

impl StreamRequest {
    pub fn new(model: impl Into<String>, messages: Vec<Message>) -> Self {
        Self {
            model: model.into(),
            messages,
            max_output_tokens: None,
            temperature: None,
        }
    }

    pub fn with_max_output_tokens(mut self, n: u32) -> Self {
        self.max_output_tokens = Some(n);
        self
    }

    pub fn with_temperature(mut self, t: f32) -> Self {
        self.temperature = Some(t);
        self
    }
}

/// Token counts reported by the provider. For Gemini these come from
/// `usageMetadata.{promptTokenCount, candidatesTokenCount}` and are exact
/// (billing-grade) rather than heuristic.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Usage {
    pub input_tokens: u32,
    pub output_tokens: u32,
}

/// Why a stream ended.
///
/// `Error(String)` is reserved for *non-cancel* terminal failures that arrive
/// mid-stream — for example, Gemini returning a non-`STOP` `finishReason` like
/// `SAFETY` or `RECITATION`. Pre-flight failures (4xx on the initial POST,
/// network errors before the first byte) come back as
/// [`crate::error::GatewayError`] from `stream()` itself, not as a `Done`
/// event.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StopReason {
    EndTurn,
    MaxTokens,
    Cancelled,
    Error(String),
}

/// An event in the output stream.
///
/// Internally-tagged JSON shape — the discriminator is `type`. Variant names
/// are emitted in snake_case so a TypeScript consumer sees
/// `{"type":"text_delta","text":"..."}` etc.
///
/// Emission order from `GeminiProvider::stream`:
///
/// 1. `Start { id }` — first event, before any text. Best-effort `id` (random
///    UUID-ish; Gemini doesn't expose a stream id).
/// 2. Zero or more `TextDelta { text }`.
/// 3. Exactly one `Usage { .. }` once `usageMetadata` arrives (last data
///    frame).
/// 4. Exactly one `Done { stop_reason }` as the final event.
///
/// On cancel: stream emits `Done { stop_reason: Cancelled }` and ends. No
/// `Usage` is emitted because the upstream call is killed before
/// `usageMetadata` arrives — callers wanting partial billing must rely on
/// `estimate_tokens` against the deltas they received.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamEvent {
    Start {
        id: String,
    },
    TextDelta {
        text: String,
    },
    Usage {
        input_tokens: u32,
        output_tokens: u32,
    },
    Done {
        stop_reason: StopReason,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn role_serializes_lowercase() {
        assert_eq!(serde_json::to_string(&Role::System).unwrap(), "\"system\"");
        assert_eq!(serde_json::to_string(&Role::User).unwrap(), "\"user\"");
        assert_eq!(
            serde_json::to_string(&Role::Assistant).unwrap(),
            "\"assistant\""
        );
    }

    #[test]
    fn role_roundtrips_through_json() {
        for role in [Role::System, Role::User, Role::Assistant] {
            let s = serde_json::to_string(&role).unwrap();
            let back: Role = serde_json::from_str(&s).unwrap();
            assert_eq!(back, role);
        }
    }

    #[test]
    fn message_helpers_set_role_correctly() {
        assert_eq!(Message::system("x").role, Role::System);
        assert_eq!(Message::user("x").role, Role::User);
        assert_eq!(Message::assistant("x").role, Role::Assistant);
        assert_eq!(Message::user("hello").content, "hello");
    }

    #[test]
    fn stream_request_builder_chains() {
        let req = StreamRequest::new("gemini-2.5-flash", vec![Message::user("hi")])
            .with_max_output_tokens(64)
            .with_temperature(0.2);
        assert_eq!(req.model, "gemini-2.5-flash");
        assert_eq!(req.max_output_tokens, Some(64));
        assert_eq!(req.temperature, Some(0.2));
    }

    #[test]
    fn stream_request_skips_none_fields_in_json() {
        let req = StreamRequest::new("gemini-2.5-flash", vec![Message::user("hi")]);
        let v: serde_json::Value = serde_json::to_value(&req).unwrap();
        assert!(v.get("max_output_tokens").is_none());
        assert!(v.get("temperature").is_none());
        assert_eq!(v["model"], "gemini-2.5-flash");
        assert_eq!(v["messages"][0]["role"], "user");
        assert_eq!(v["messages"][0]["content"], "hi");
    }

    #[test]
    fn stream_event_text_delta_has_type_tag() {
        let e = StreamEvent::TextDelta { text: "hi".into() };
        let v: serde_json::Value = serde_json::to_value(&e).unwrap();
        assert_eq!(v["type"], "text_delta");
        assert_eq!(v["text"], "hi");
    }

    #[test]
    fn stream_event_usage_inlines_token_fields() {
        let e = StreamEvent::Usage {
            input_tokens: 12,
            output_tokens: 34,
        };
        let v: serde_json::Value = serde_json::to_value(&e).unwrap();
        assert_eq!(v["type"], "usage");
        assert_eq!(v["input_tokens"], 12);
        assert_eq!(v["output_tokens"], 34);
    }

    #[test]
    fn stream_event_start_carries_id() {
        let e = StreamEvent::Start {
            id: "abc-123".into(),
        };
        let v: serde_json::Value = serde_json::to_value(&e).unwrap();
        assert_eq!(v["type"], "start");
        assert_eq!(v["id"], "abc-123");
    }

    #[test]
    fn stop_reason_end_turn_is_snake_case_string() {
        let s = serde_json::to_string(&StopReason::EndTurn).unwrap();
        assert_eq!(s, "\"end_turn\"");
    }

    #[test]
    fn stop_reason_max_tokens_is_snake_case_string() {
        let s = serde_json::to_string(&StopReason::MaxTokens).unwrap();
        assert_eq!(s, "\"max_tokens\"");
    }

    #[test]
    fn stop_reason_cancelled_is_snake_case_string() {
        let s = serde_json::to_string(&StopReason::Cancelled).unwrap();
        assert_eq!(s, "\"cancelled\"");
    }

    #[test]
    fn stop_reason_error_carries_message_under_error_key() {
        let r = StopReason::Error("upstream 5xx".into());
        let v: serde_json::Value = serde_json::to_value(&r).unwrap();
        assert_eq!(v["error"], "upstream 5xx");
    }

    #[test]
    fn stream_event_done_with_error_round_trips() {
        let e = StreamEvent::Done {
            stop_reason: StopReason::Error("boom".into()),
        };
        let s = serde_json::to_string(&e).unwrap();
        let back: StreamEvent = serde_json::from_str(&s).unwrap();
        assert_eq!(back, e);
    }

    #[test]
    fn stream_event_done_with_unit_variant_round_trips() {
        let e = StreamEvent::Done {
            stop_reason: StopReason::EndTurn,
        };
        let s = serde_json::to_string(&e).unwrap();
        let back: StreamEvent = serde_json::from_str(&s).unwrap();
        assert_eq!(back, e);
    }
}
