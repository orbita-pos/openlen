//! Error type returned from [`crate::gemini::GeminiProvider::stream`] and the
//! items inside its returned stream.
//!
//! Two distinct call sites:
//!
//! 1. **`stream()` itself** returns `Result<BoxStream<…>, GatewayError>`. A
//!    failure here means the initial POST never produced a useful response —
//!    auth failure, rate limit, transport error, or cancellation racing the
//!    request. No streaming happened.
//! 2. **Items inside the stream** are `Result<StreamEvent, GatewayError>`. A
//!    failure here means we got the headers, started streaming, and something
//!    went wrong mid-flight — malformed SSE, abrupt connection close,
//!    upstream error after partial output.
//!
//! Caller-requested cancellation is *not* a stream-level error — it surfaces
//! as the terminal `StreamEvent::Done { stop_reason: StopReason::Cancelled }`
//! so callers have a single termination point to match on. The
//! `GatewayError::Cancelled` variant is reserved for the narrower race where
//! the cancel token fires before [`crate::gemini::GeminiProvider::stream`]
//! returns from its initial POST.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum GatewayError {
    /// Upstream returned a non-success HTTP status that doesn't fit a more
    /// specific variant below (everything except 401/403, 429, and the
    /// transport layer). `body` is truncated to 4 KiB before being captured
    /// so an overly verbose Gemini error response can't blow up logs.
    #[error("upstream API returned HTTP {status}: {body}")]
    ApiError { status: u16, body: String },

    /// Connect failed, TLS handshake failed, body read errored, etc.
    #[error("network error: {0}")]
    NetworkError(#[from] reqwest::Error),

    /// Caller's [`tokio_util::sync::CancellationToken`] fired before the
    /// initial POST returned. Once the stream is open, cancellation surfaces
    /// as a [`crate::types::StreamEvent::Done`] with stop_reason
    /// [`crate::types::StopReason::Cancelled`] instead.
    #[error("stream cancelled by caller")]
    Cancelled,

    /// Got bytes that don't parse as valid Gemini SSE — typically a JSON shape
    /// we don't recognise or a UTF-8 error inside a `data:` line.
    #[error("invalid response from upstream: {0}")]
    InvalidResponse(String),

    /// 429 from Gemini. `retry_after_ms` is best-effort — parsed from either
    /// the `Retry-After` header or the `retryDelay` field inside Google's RPC
    /// error envelope; `None` means neither was present (rare in practice).
    #[error("rate limited by upstream (retry after: {})", format_retry_after(*.retry_after_ms))]
    RateLimited { retry_after_ms: Option<u64> },

    /// 401 or 403 — the API key is missing, invalid, or doesn't have access
    /// to the requested model.
    #[error("authentication failed — check GEMINI_API_KEY")]
    AuthError,
}

fn format_retry_after(ms: Option<u64>) -> String {
    match ms {
        Some(ms) => format!("{} ms", ms),
        None => "unspecified".into(),
    }
}

impl GatewayError {
    /// True when the failure is plausibly worth retrying with the same
    /// request body. Useful for callers that wrap the gateway with a
    /// retry/backoff layer (S3+).
    pub fn is_retryable(&self) -> bool {
        match self {
            Self::NetworkError(_) | Self::RateLimited { .. } => true,
            Self::ApiError { status, .. } => *status >= 500,
            Self::Cancelled | Self::AuthError | Self::InvalidResponse(_) => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn api_error_display_includes_status_and_body() {
        let e = GatewayError::ApiError {
            status: 503,
            body: "service unavailable".into(),
        };
        let s = e.to_string();
        assert!(s.contains("503"), "got: {s}");
        assert!(s.contains("service unavailable"), "got: {s}");
    }

    #[test]
    fn rate_limited_display_formats_retry_after() {
        let with = GatewayError::RateLimited {
            retry_after_ms: Some(60_000),
        }
        .to_string();
        assert!(with.contains("60000 ms"), "got: {with}");

        let without = GatewayError::RateLimited {
            retry_after_ms: None,
        }
        .to_string();
        assert!(without.contains("unspecified"), "got: {without}");
    }

    #[test]
    fn auth_error_display_mentions_api_key() {
        assert!(GatewayError::AuthError
            .to_string()
            .to_lowercase()
            .contains("api"),);
    }

    #[test]
    fn cancelled_display_mentions_cancel() {
        assert!(GatewayError::Cancelled
            .to_string()
            .to_lowercase()
            .contains("cancel"),);
    }

    #[test]
    fn invalid_response_display_includes_detail() {
        let e = GatewayError::InvalidResponse("unknown finishReason".into());
        assert!(e.to_string().contains("unknown finishReason"));
    }

    #[test]
    fn is_retryable_classification() {
        assert!(GatewayError::RateLimited {
            retry_after_ms: None
        }
        .is_retryable());
        assert!(GatewayError::ApiError {
            status: 500,
            body: String::new()
        }
        .is_retryable());
        assert!(GatewayError::ApiError {
            status: 503,
            body: String::new()
        }
        .is_retryable());
        assert!(!GatewayError::ApiError {
            status: 400,
            body: String::new()
        }
        .is_retryable());
        assert!(!GatewayError::AuthError.is_retryable());
        assert!(!GatewayError::Cancelled.is_retryable());
        assert!(!GatewayError::InvalidResponse(String::new()).is_retryable());
    }
}
