//! Error type returned from the Postgres-backed limiter.
//!
//! The in-memory token bucket is infallible (a deterministic computation
//! over local state) — its results surface as `ConsumeOutcome` enum
//! variants, not `Result`. Only the SQL path can fail.

use thiserror::Error;

#[derive(Debug, Error)]
pub enum RateLimitError {
    /// Connection acquire / query / row decode failure from sqlx.
    #[error("postgres error: {0}")]
    Postgres(#[from] sqlx::Error),

    /// `LimitWindow.max == 0` — the caller asked for a "0 events allowed"
    /// window. Doable in principle but indicates a config bug; reject loudly.
    #[error("invalid limit: max must be > 0 (got {0})")]
    InvalidMax(u32),

    /// `LimitWindow.window_ms == 0` — division-by-zero waiting to happen.
    #[error("invalid limit: window_ms must be > 0")]
    InvalidWindow,
}

impl RateLimitError {
    /// True when the failure is plausibly worth retrying. Transport-level
    /// `sqlx::Error` cases (pool exhausted, broken connection) are
    /// retryable; configuration bugs are not.
    pub fn is_retryable(&self) -> bool {
        match self {
            Self::Postgres(err) => matches!(
                err,
                sqlx::Error::Io(_) | sqlx::Error::PoolTimedOut | sqlx::Error::PoolClosed
            ),
            Self::InvalidMax(_) | Self::InvalidWindow => false,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_max_renders_value_in_message() {
        let e = RateLimitError::InvalidMax(0);
        assert!(e.to_string().contains("0"));
    }

    #[test]
    fn invalid_window_is_not_retryable() {
        assert!(!RateLimitError::InvalidWindow.is_retryable());
    }

    #[test]
    fn invalid_max_is_not_retryable() {
        assert!(!RateLimitError::InvalidMax(5).is_retryable());
    }
}
