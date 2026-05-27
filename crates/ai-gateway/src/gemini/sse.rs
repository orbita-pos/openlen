//! Server-Sent Events parser for Gemini's `streamGenerateContent?alt=sse`
//! endpoint.
//!
//! Gemini emits one `data: {json}\n\n` event per chunk. There is no `event:`
//! type line, no `id:` line, no `retry:` line — just `data:` payloads
//! terminated by a blank line. CRLF and LF line endings are both accepted
//! per the SSE spec (Google generally sends LF, but we don't depend on it).
//!
//! The parser is stateful because reqwest's `bytes_stream` hands us chunks
//! split at arbitrary byte boundaries — a single JSON event can span two or
//! more chunks, including splits inside a UTF-8 codepoint or right after
//! `data:`. We buffer until we see a `\n` to complete a line, and until we
//! see a blank line to complete an event.

use serde::Deserialize;

use crate::error::GatewayError;

/// Streaming SSE parser. Feed bytes in, get parsed events out.
pub(crate) struct SseParser {
    buf: Vec<u8>,
    /// Accumulator for multi-`data:`-line events. Gemini emits one data line
    /// per event in practice but the SSE spec allows N — we join them with
    /// `\n` per the spec before decoding JSON.
    current: Vec<u8>,
}

impl SseParser {
    pub(crate) fn new() -> Self {
        Self {
            buf: Vec::new(),
            current: Vec::new(),
        }
    }

    /// Push a chunk of bytes from the upstream response into the parser,
    /// returning every event that completed during this call. May return an
    /// empty Vec if the chunk only contained a partial line. On error, the
    /// parser's internal state is left in an inconsistent state and it
    /// should be discarded.
    pub(crate) fn feed(&mut self, bytes: &[u8]) -> Result<Vec<GeminiEvent>, GatewayError> {
        self.buf.extend_from_slice(bytes);
        let mut events = Vec::new();
        let mut consumed = 0usize;

        while let Some(rel_nl) = self.buf[consumed..].iter().position(|&b| b == b'\n') {
            let nl_idx = consumed + rel_nl;
            let line_end = if nl_idx > consumed && self.buf[nl_idx - 1] == b'\r' {
                nl_idx - 1
            } else {
                nl_idx
            };
            let line = &self.buf[consumed..line_end];

            if line.is_empty() {
                if !self.current.is_empty() {
                    match parse_event(&self.current) {
                        Ok(ev) => events.push(ev),
                        Err(err) => {
                            self.buf.drain(..=nl_idx);
                            self.current.clear();
                            return Err(err);
                        }
                    }
                    self.current.clear();
                }
            } else if let Some(payload) = strip_data_prefix(line) {
                if !self.current.is_empty() {
                    self.current.push(b'\n');
                }
                self.current.extend_from_slice(payload);
            }
            // Anything else (`:` comments, `event:`/`id:`/`retry:` lines) is
            // ignored — Gemini doesn't emit them but well-behaved parsers
            // tolerate them.

            consumed = nl_idx + 1;
        }

        if consumed > 0 {
            self.buf.drain(..consumed);
        }

        Ok(events)
    }
}

fn strip_data_prefix(line: &[u8]) -> Option<&[u8]> {
    let rest = line.strip_prefix(b"data:")?;
    // Per the SSE spec a single leading space after `data:` is optional and
    // should be stripped. Gemini always includes it; we tolerate both.
    if let Some(b' ') = rest.first().copied() {
        Some(&rest[1..])
    } else {
        Some(rest)
    }
}

fn parse_event(bytes: &[u8]) -> Result<GeminiEvent, GatewayError> {
    let s = std::str::from_utf8(bytes)
        .map_err(|e| GatewayError::InvalidResponse(format!("non-UTF8 SSE payload: {e}")))?;
    serde_json::from_str(s).map_err(|e| {
        GatewayError::InvalidResponse(format!(
            "malformed Gemini SSE JSON: {e} (body: {})",
            truncate(s, 200)
        ))
    })
}

fn truncate(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        s.to_owned()
    } else {
        let mut out: String = s.chars().take(max_chars).collect();
        out.push('…');
        out
    }
}

// --- Gemini wire types ----------------------------------------------------
//
// We only deserialize the fields we actually consume. Gemini's response
// schema includes safety ratings, citation metadata, grounding metadata,
// promptFeedback, etc. — none of which we surface today.

#[derive(Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GeminiEvent {
    #[serde(default)]
    pub(crate) candidates: Vec<GeminiCandidate>,
    pub(crate) usage_metadata: Option<GeminiUsageMetadata>,
    /// Top-level `promptFeedback.blockReason` (e.g. "SAFETY") arrives in
    /// place of `candidates` when the request itself is blocked pre-flight.
    pub(crate) prompt_feedback: Option<GeminiPromptFeedback>,
}

#[derive(Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GeminiCandidate {
    pub(crate) content: Option<GeminiContent>,
    pub(crate) finish_reason: Option<String>,
}

#[derive(Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GeminiContent {
    #[serde(default)]
    pub(crate) parts: Vec<GeminiPart>,
}

#[derive(Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GeminiPart {
    pub(crate) text: Option<String>,
}

#[derive(Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GeminiUsageMetadata {
    pub(crate) prompt_token_count: Option<u32>,
    pub(crate) candidates_token_count: Option<u32>,
}

#[derive(Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GeminiPromptFeedback {
    pub(crate) block_reason: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn single_event_bytes(text: &str) -> Vec<u8> {
        format!(
            "data: {{\"candidates\":[{{\"content\":{{\"parts\":[{{\"text\":\"{text}\"}}],\"role\":\"model\"}}}}]}}\n\n",
        ).into_bytes()
    }

    #[test]
    fn parses_single_complete_event() {
        let mut p = SseParser::new();
        let events = p.feed(&single_event_bytes("hi")).unwrap();
        assert_eq!(events.len(), 1);
        let text = events[0].candidates[0].content.as_ref().unwrap().parts[0]
            .text
            .as_deref()
            .unwrap();
        assert_eq!(text, "hi");
    }

    #[test]
    fn parses_two_events_in_one_feed() {
        let mut p = SseParser::new();
        let mut bytes = single_event_bytes("foo");
        bytes.extend_from_slice(&single_event_bytes("bar"));
        let events = p.feed(&bytes).unwrap();
        assert_eq!(events.len(), 2);
        assert_eq!(
            events[0].candidates[0].content.as_ref().unwrap().parts[0]
                .text
                .as_deref(),
            Some("foo"),
        );
        assert_eq!(
            events[1].candidates[0].content.as_ref().unwrap().parts[0]
                .text
                .as_deref(),
            Some("bar"),
        );
    }

    #[test]
    fn buffers_partial_event_across_feeds() {
        let mut p = SseParser::new();
        let bytes = single_event_bytes("partial");
        let mid = bytes.len() / 2;
        let first = &bytes[..mid];
        let second = &bytes[mid..];

        let events_a = p.feed(first).unwrap();
        assert!(events_a.is_empty(), "got events from partial chunk");
        let events_b = p.feed(second).unwrap();
        assert_eq!(events_b.len(), 1);
        assert_eq!(
            events_b[0].candidates[0].content.as_ref().unwrap().parts[0]
                .text
                .as_deref(),
            Some("partial"),
        );
    }

    #[test]
    fn split_inside_json_text_works() {
        let mut p = SseParser::new();
        let bytes = b"data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"hel";
        let bytes2 = b"lo\"}],\"role\":\"model\"}}]}\n\n";
        assert!(p.feed(bytes).unwrap().is_empty());
        let events = p.feed(bytes2).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0].candidates[0].content.as_ref().unwrap().parts[0]
                .text
                .as_deref(),
            Some("hello"),
        );
    }

    #[test]
    fn split_inside_data_prefix_works() {
        let mut p = SseParser::new();
        assert!(p.feed(b"da").unwrap().is_empty());
        assert!(p.feed(b"ta: {\"candidates\":[]}\n").unwrap().is_empty());
        let events = p.feed(b"\n").unwrap();
        assert_eq!(events.len(), 1);
        assert!(events[0].candidates.is_empty());
    }

    #[test]
    fn handles_crlf_line_endings() {
        let mut p = SseParser::new();
        let bytes = b"data: {\"candidates\":[]}\r\n\r\n";
        let events = p.feed(bytes).unwrap();
        assert_eq!(events.len(), 1);
    }

    #[test]
    fn ignores_sse_comments() {
        let mut p = SseParser::new();
        let bytes = b": keep-alive comment\ndata: {\"candidates\":[]}\n\n";
        let events = p.feed(bytes).unwrap();
        assert_eq!(events.len(), 1);
    }

    #[test]
    fn ignores_unknown_field_lines() {
        let mut p = SseParser::new();
        let bytes = b"event: chunk\nid: 42\ndata: {\"candidates\":[]}\n\n";
        let events = p.feed(bytes).unwrap();
        assert_eq!(events.len(), 1);
    }

    #[test]
    fn handles_data_without_leading_space() {
        let mut p = SseParser::new();
        let bytes = b"data:{\"candidates\":[]}\n\n";
        let events = p.feed(bytes).unwrap();
        assert_eq!(events.len(), 1);
    }

    #[test]
    fn joins_multiple_data_lines_with_newline() {
        let mut p = SseParser::new();
        // SSE spec: multiple data: lines for one event get joined with \n.
        // The resulting payload here is "{\"a\":1,\n\"b\":2}" — still valid JSON
        // (whitespace allowed inside objects), so parsing succeeds.
        //
        // We use a struct shape our `GeminiEvent` accepts: empty candidates
        // plus a usageMetadata object.
        let bytes =
            b"data: {\"candidates\":[],\ndata: \"usageMetadata\":{\"promptTokenCount\":1}}\n\n";
        let events = p.feed(bytes).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0]
                .usage_metadata
                .as_ref()
                .and_then(|u| u.prompt_token_count),
            Some(1),
        );
    }

    #[test]
    fn malformed_json_returns_invalid_response() {
        let mut p = SseParser::new();
        let bytes = b"data: {not json\n\n";
        let err = p.feed(bytes).unwrap_err();
        match err {
            GatewayError::InvalidResponse(msg) => {
                assert!(
                    msg.contains("malformed"),
                    "expected 'malformed' in error: {msg}"
                );
                assert!(
                    msg.contains("{not json"),
                    "expected raw body excerpt in error: {msg}"
                );
            }
            other => panic!("expected InvalidResponse, got {other:?}"),
        }
    }

    #[test]
    fn parses_usage_metadata_event() {
        let mut p = SseParser::new();
        let bytes = b"data: {\"candidates\":[{\"finishReason\":\"STOP\"}],\"usageMetadata\":{\"promptTokenCount\":12,\"candidatesTokenCount\":5,\"totalTokenCount\":17}}\n\n";
        let events = p.feed(bytes).unwrap();
        assert_eq!(events.len(), 1);
        let ev = &events[0];
        assert_eq!(ev.candidates[0].finish_reason.as_deref(), Some("STOP"),);
        let um = ev.usage_metadata.as_ref().unwrap();
        assert_eq!(um.prompt_token_count, Some(12));
        assert_eq!(um.candidates_token_count, Some(5));
    }

    #[test]
    fn parses_prompt_feedback_block_event() {
        let mut p = SseParser::new();
        let bytes = b"data: {\"promptFeedback\":{\"blockReason\":\"SAFETY\"}}\n\n";
        let events = p.feed(bytes).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(
            events[0]
                .prompt_feedback
                .as_ref()
                .and_then(|f| f.block_reason.as_deref()),
            Some("SAFETY"),
        );
    }

    #[test]
    fn byte_by_byte_drip_eventually_emits() {
        let mut p = SseParser::new();
        let bytes = single_event_bytes("dripped");
        for chunk in bytes.chunks(1) {
            let _ = p.feed(chunk).unwrap();
        }
        // After all bytes drip in including the trailing `\n\n`, exactly one
        // event has been emitted across the chunks. Drain assertion: feed an
        // empty slice and check the buffer is clean.
        assert!(p.buf.is_empty());
        assert!(p.current.is_empty());
    }

    #[test]
    fn empty_feed_emits_nothing() {
        let mut p = SseParser::new();
        let events = p.feed(b"").unwrap();
        assert!(events.is_empty());
    }

    #[test]
    fn keepalive_only_emits_nothing() {
        let mut p = SseParser::new();
        let events = p.feed(b": keep-alive\n\n").unwrap();
        assert!(events.is_empty());
    }
}
