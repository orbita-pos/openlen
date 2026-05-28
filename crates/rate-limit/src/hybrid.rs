//! Composite limiter holding both backends.
//!
//! ## Why this exists in its current shape
//!
//! The F4 brief sketches a memory-primary / Postgres-durable hybrid where
//! the memory bucket holds the live count, the Postgres write happens
//! asynchronously off the request path, and a startup hydration step
//! re-seeds memory from recent rows after a restart. That design is
//! **not implemented in F4** — the working agreement allows falling back
//! to Pure-Postgres if the hybrid layer "se complica más de la cuenta",
//! and reconciling continuous token refills with discrete event logs
//! while also handling lossy async writes + cold-start hydration was
//! the cost. See `docs/rust-f4-rate-limit-handoff.md` Open Q #1.
//!
//! What this type *does* provide is the structural piece needed today:
//! a single value that owns **both** an in-memory bucket store and a
//! Postgres-backed limiter, exposed to the napi binding as the
//! [`crate::napi::RateLimiter`] class. Each method delegates to the
//! appropriate backend — `try_consume` to memory, `check_and_consume` to
//! Postgres — so the four migrated call sites preserve their current
//! storage choice unchanged.
//!
//! The `_hybrid` variant signals the future direction; for now it
//! delegates straight to the Postgres backend so the API name is stable
//! when the real implementation lands.

use std::sync::Arc;

use crate::bucket::MemoryLimiter;
use crate::error::RateLimitError;
use crate::postgres::PostgresLimiter;
use crate::types::{ConsumeOutcome, LimitDecision, LimitWindow, MemorySpec, UsageWindow};

/// Holds both an in-memory and a Postgres-backed limiter side-by-side.
/// The napi class wraps one of these so a single JS `RateLimiter`
/// instance covers every call site.
#[derive(Debug, Clone)]
pub struct HybridLimiter {
    memory: Arc<MemoryLimiter>,
    persistent: Option<PostgresLimiter>,
}

impl HybridLimiter {
    /// Construct with both backends. Use [`memory_only`] when no
    /// Postgres pool is available (test rigs, scripts).
    pub fn new(memory: Arc<MemoryLimiter>, persistent: PostgresLimiter) -> Self {
        Self {
            memory,
            persistent: Some(persistent),
        }
    }

    /// Construct with the memory backend only. The Postgres methods on
    /// the returned value will return [`RateLimitError::Postgres`] with a
    /// configuration message. Useful in tests and when migrating callers
    /// that don't need persistence (autofill, analytics beacon).
    pub fn memory_only(memory: Arc<MemoryLimiter>) -> Self {
        Self {
            memory,
            persistent: None,
        }
    }

    pub fn memory(&self) -> &Arc<MemoryLimiter> {
        &self.memory
    }

    pub fn persistent(&self) -> Option<&PostgresLimiter> {
        self.persistent.as_ref()
    }

    /// Sync, in-memory token bucket — delegates to [`MemoryLimiter::try_consume`].
    pub fn try_consume(&self, key: &str, spec: MemorySpec) -> ConsumeOutcome {
        self.memory.try_consume(key, spec)
    }

    /// Async, Postgres-backed sliding window. Errors with a config
    /// message if the limiter was built via [`memory_only`].
    pub async fn check_and_consume(
        &self,
        key: &str,
        windows: &[LimitWindow],
    ) -> Result<LimitDecision, RateLimitError> {
        let pg = self.persistent.as_ref().ok_or_else(|| no_persistent())?;
        pg.check_and_consume(key, windows).await
    }

    /// Read-only equivalent of `check_and_consume`.
    pub async fn get_usage(
        &self,
        key: &str,
        windows: &[LimitWindow],
    ) -> Result<Vec<UsageWindow>, RateLimitError> {
        let pg = self.persistent.as_ref().ok_or_else(|| no_persistent())?;
        pg.get_usage(key, windows).await
    }
}

/// Surface the "no Postgres pool wired up" condition as a typed error so
/// callers don't have to guess.
fn no_persistent() -> RateLimitError {
    // We piggyback on the existing variant rather than introducing a new
    // one — the upstream is sqlx-shaped, and this branch only fires when
    // the caller forgot to pass a pool. The text is the disambiguator.
    RateLimitError::Postgres(sqlx::Error::Configuration(
        "HybridLimiter built with memory_only; persistent backend not available".into(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_only_constructor_omits_persistent() {
        let mem = Arc::new(MemoryLimiter::new());
        let hyb = HybridLimiter::memory_only(mem);
        assert!(hyb.persistent().is_none());
    }

    #[test]
    fn try_consume_delegates_to_memory_backend() {
        let mem = Arc::new(MemoryLimiter::new());
        let hyb = HybridLimiter::memory_only(mem);
        let out = hyb.try_consume("u:a", MemorySpec::new(2, 60_000));
        assert!(out.allowed);
        assert_eq!(out.remaining, 1);
    }

    #[tokio::test]
    async fn check_and_consume_errors_on_memory_only_builder() {
        let mem = Arc::new(MemoryLimiter::new());
        let hyb = HybridLimiter::memory_only(mem);
        let err = hyb
            .check_and_consume(
                "u:a",
                &[LimitWindow {
                    window_ms: 60_000,
                    max: 5,
                    label: "minute".into(),
                }],
            )
            .await
            .unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.to_lowercase().contains("memory_only")
                || msg.to_lowercase().contains("not available"),
            "expected config error, got: {msg}"
        );
    }
}
