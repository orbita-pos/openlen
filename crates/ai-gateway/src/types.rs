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

/// A single message in a streaming request. `content` holds the text part;
/// `function_calls` (assistant turns) and `function_responses` (user turns)
/// carry the native tool-calling parts for the agentic loop. Multimodal
/// image/audio parts would still require widening `content` to a
/// `Vec<Content>` — no caller for that yet.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Message {
    pub role: Role,
    pub content: String,
    /// Assistant turn: tool calls the model emitted, as a JSON array of
    /// `{name, args}`. Rendered as native `functionCall` parts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub function_calls: Option<serde_json::Value>,
    /// User turn: tool results going back, as a JSON array of
    /// `{name, response}`. Rendered as native `functionResponse` parts.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub function_responses: Option<serde_json::Value>,
}

impl Message {
    pub fn new(role: Role, content: impl Into<String>) -> Self {
        Self {
            role,
            content: content.into(),
            function_calls: None,
            function_responses: None,
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

/// An inline image attached to a request. Rendered as a native Gemini
/// `inlineData` part (base64). Added for the Quality S2 multimodal reference:
/// the native `streamGenerateContent` API does NOT fetch remote URLs, so the
/// caller fetches the image and passes the base64 bytes here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InlineImage {
    /// MIME type, e.g. `"image/jpeg"` or `"image/png"`.
    pub mime_type: String,
    /// Base64-encoded image bytes — no `data:` URI prefix.
    pub data_base64: String,
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
    /// Reference images for the request. Attached as native `inlineData`
    /// parts on the LAST user content. Empty by default — the text-only path
    /// is byte-for-byte unchanged.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<InlineImage>,
    /// Structured-output controls (Quality S3 vision critic). When
    /// `response_mime_type` is `Some("application/json")`, Gemini is forced to
    /// emit valid JSON instead of free-form text. `response_schema`, when set,
    /// further constrains the output to a Gemini-subset OpenAPI schema —
    /// passed through verbatim to `generationConfig.responseSchema`. Both
    /// `None` by default: the free-form generation path is byte-for-byte
    /// unchanged.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_mime_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub response_schema: Option<serde_json::Value>,
    /// Native Gemini `tools` — an array of `{functionDeclarations: [...]}`.
    /// Passed through verbatim; `None` by default so the tool-free path is
    /// byte-for-byte unchanged.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tools: Option<serde_json::Value>,
    /// Native Gemini `toolConfig` (e.g. `{functionCallingConfig:{mode}}`).
    /// Passed through verbatim.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_config: Option<serde_json::Value>,
}

impl StreamRequest {
    pub fn new(model: impl Into<String>, messages: Vec<Message>) -> Self {
        Self {
            model: model.into(),
            messages,
            max_output_tokens: None,
            temperature: None,
            images: Vec::new(),
            response_mime_type: None,
            response_schema: None,
            tools: None,
            tool_config: None,
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

    pub fn with_images(mut self, images: Vec<InlineImage>) -> Self {
        self.images = images;
        self
    }

    pub fn with_response_mime_type(mut self, mime: impl Into<String>) -> Self {
        self.response_mime_type = Some(mime.into());
        self
    }

    pub fn with_response_schema(mut self, schema: serde_json::Value) -> Self {
        self.response_schema = Some(schema);
        self
    }

    pub fn with_tools(mut self, tools: serde_json::Value) -> Self {
        self.tools = Some(tools);
        self
    }

    pub fn with_tool_config(mut self, cfg: serde_json::Value) -> Self {
        self.tool_config = Some(cfg);
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
/// 2. Zero or more `TextDelta { text }` and `FunctionCall { name, args_json }`,
///    interleaved in the order Gemini emitted the underlying parts.
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
        /// Gemini 2.5+ implicit caching: the subset of `input_tokens` that
        /// hit the cache this turn (90% discount, automatic on Google's
        /// invoice — not reflected in OpenLen's own credit pricing as of
        /// F3). `0` when the provider reported no cache hit, never absent.
        cached_tokens: u32,
    },
    Done {
        stop_reason: StopReason,
    },
    FunctionCall {
        name: String,
        args_json: String,
        /// Gemini 3 thought signature accompanying this call (sibling of
        /// `functionCall` on the wire). `None` when the model didn't attach
        /// one (e.g. non-Gemini-3 models). Callers MUST echo this back
        /// verbatim on the replayed assistant turn or the next request 400s.
        #[serde(skip_serializing_if = "Option::is_none")]
        thought_signature: Option<String>,
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
        // images defaults empty and is skipped — text-only requests are
        // byte-for-byte unchanged.
        assert!(v.get("images").is_none());
        assert_eq!(v["model"], "gemini-2.5-flash");
        assert_eq!(v["messages"][0]["role"], "user");
        assert_eq!(v["messages"][0]["content"], "hi");
    }

    #[test]
    fn stream_request_new_defaults_images_empty() {
        let req = StreamRequest::new("gemini-2.5-flash", vec![Message::user("hi")]);
        assert!(req.images.is_empty());
    }

    #[test]
    fn with_images_attaches_and_serializes() {
        let req =
            StreamRequest::new("gemini-2.5-flash", vec![Message::user("hi")]).with_images(vec![
                InlineImage {
                    mime_type: "image/jpeg".into(),
                    data_base64: "QUJD".into(),
                },
            ]);
        assert_eq!(req.images.len(), 1);
        let v: serde_json::Value = serde_json::to_value(&req).unwrap();
        assert_eq!(v["images"][0]["mime_type"], "image/jpeg");
        assert_eq!(v["images"][0]["data_base64"], "QUJD");
    }

    #[test]
    fn structured_output_fields_skip_when_unset() {
        let req = StreamRequest::new("gemini-2.5-flash", vec![Message::user("hi")]);
        let v: serde_json::Value = serde_json::to_value(&req).unwrap();
        assert!(v.get("response_mime_type").is_none());
        assert!(v.get("response_schema").is_none());
    }

    #[test]
    fn stream_request_tools_default_none_and_skipped() {
        let req = StreamRequest::new("gemini-3.5-flash", vec![Message::user("hi")]);
        assert!(req.tools.is_none());
        let v: serde_json::Value = serde_json::to_value(&req).unwrap();
        assert!(v.get("tools").is_none());
        assert!(v.get("tool_config").is_none());
    }

    #[test]
    fn with_tools_and_tool_config_set_values() {
        let tools = serde_json::json!([{"functionDeclarations":[{"name":"leer_estado"}]}]);
        let cfg = serde_json::json!({"functionCallingConfig":{"mode":"AUTO"}});
        let req = StreamRequest::new("gemini-3.5-flash", vec![Message::user("hi")])
            .with_tools(tools.clone())
            .with_tool_config(cfg.clone());
        assert_eq!(req.tools.as_ref(), Some(&tools));
        assert_eq!(req.tool_config.as_ref(), Some(&cfg));
    }

    #[test]
    fn message_function_fields_default_none() {
        let m = Message::user("hola");
        assert!(m.function_calls.is_none());
        assert!(m.function_responses.is_none());
    }

    #[test]
    fn structured_output_builders_set_and_serialize() {
        let schema = serde_json::json!({
            "type": "OBJECT",
            "properties": { "ok": { "type": "BOOLEAN" } },
        });
        let req = StreamRequest::new("gemini-2.5-flash", vec![Message::user("hi")])
            .with_response_mime_type("application/json")
            .with_response_schema(schema.clone());
        assert_eq!(req.response_mime_type.as_deref(), Some("application/json"));
        assert_eq!(req.response_schema.as_ref(), Some(&schema));
        let v: serde_json::Value = serde_json::to_value(&req).unwrap();
        assert_eq!(v["response_mime_type"], "application/json");
        assert_eq!(v["response_schema"]["type"], "OBJECT");
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
            cached_tokens: 0,
        };
        let v: serde_json::Value = serde_json::to_value(&e).unwrap();
        assert_eq!(v["type"], "usage");
        assert_eq!(v["input_tokens"], 12);
        assert_eq!(v["output_tokens"], 34);
        assert_eq!(v["cached_tokens"], 0);
    }

    #[test]
    fn stream_event_usage_serializes_nonzero_cached_tokens() {
        // Gemini 2.5+ implicit caching: a cache hit reports a non-zero
        // cachedContentTokenCount (90% discount, automatic on Google's side).
        let e = StreamEvent::Usage {
            input_tokens: 120,
            output_tokens: 30,
            cached_tokens: 100,
        };
        let v: serde_json::Value = serde_json::to_value(&e).unwrap();
        assert_eq!(v["cached_tokens"], 100);
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

    #[test]
    fn stream_event_function_call_has_type_tag() {
        let e = StreamEvent::FunctionCall {
            name: "leer_estado".into(),
            args_json: "{}".into(),
            thought_signature: None,
        };
        let v: serde_json::Value = serde_json::to_value(&e).unwrap();
        assert_eq!(v["type"], "function_call");
        assert_eq!(v["name"], "leer_estado");
        assert_eq!(v["args_json"], "{}");
    }

    #[test]
    fn stream_event_function_call_with_thought_signature_serializes_key() {
        let e = StreamEvent::FunctionCall {
            name: "leer_estado".into(),
            args_json: "{}".into(),
            thought_signature: Some("sig-1".into()),
        };
        let v: serde_json::Value = serde_json::to_value(&e).unwrap();
        assert_eq!(v["thought_signature"], "sig-1");
    }

    #[test]
    fn stream_event_function_call_without_thought_signature_omits_key() {
        let e = StreamEvent::FunctionCall {
            name: "leer_estado".into(),
            args_json: "{}".into(),
            thought_signature: None,
        };
        let v: serde_json::Value = serde_json::to_value(&e).unwrap();
        assert!(v.get("thought_signature").is_none());
    }
}
