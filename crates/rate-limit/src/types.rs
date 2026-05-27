//! Public types crossing the rate-limit boundary.
//!
//! Both backends produce the same `LimitDecision` shape so the TS wrapper
//! can pattern-match on a single union. `ConsumeOutcome` is the
//! memory-bucket-only variant (no per-window accounting — there's only
//! one window per bucket).

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// Spec for a single in-memory token bucket. Mirrors the
/// `lib/rate-limit.ts::BucketSpec` shape on the TS side.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct MemorySpec {
    /// Maximum tokens the bucket holds (and starts with).
    pub limit: u32,
    /// Sliding window in milliseconds — also the refill period for `limit`
    /// tokens. e.g. `{ limit: 10, window_ms: 3_600_000 }` = 10/hour.
    pub window_ms: u64,
}

impl MemorySpec {
    pub fn new(limit: u32, window_ms: u64) -> Self {
        Self { limit, window_ms }
    }

    /// Tokens refilled per millisecond. Used by the bucket math.
    #[inline]
    pub(crate) fn refill_rate(self) -> f64 {
        self.limit as f64 / self.window_ms as f64
    }
}

/// Result of a single `MemoryLimiter::try_consume` call. Mirrors
/// `lib/rate-limit.ts::RateLimitResult`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct ConsumeOutcome {
    pub allowed: bool,
    /// Tokens left after this call (floor). 0 when not allowed.
    pub remaining: u32,
    /// Ms until at least one token is available, when `allowed = false`.
    /// 0 when `allowed = true`.
    pub retry_after_ms: u64,
    /// Echo of `MemorySpec::limit` — useful for response headers
    /// (`x-ratelimit-limit`).
    pub limit: u32,
}

/// Sliding-window definition for the Postgres-backed limiter. Mirrors
/// `lib/limits.ts::LimitWindow`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LimitWindow {
    /// Window length in milliseconds.
    pub window_ms: u64,
    /// Max events allowed inside the window.
    pub max: u32,
    /// Human label for error messages ("hourly", "daily", "monthly").
    pub label: String,
}

/// Per-window remaining counts returned alongside a `LimitDecision`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RemainingWindow {
    pub window: LimitWindow,
    pub remaining: u32,
}

/// Decision from `PostgresLimiter::check_and_consume`. Mirrors
/// `lib/limits.ts::LimitDecision`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct LimitDecision {
    pub ok: bool,
    /// Populated only when `ok = false`. The first window the caller
    /// breached.
    pub blocked: Option<LimitWindow>,
    /// Approximate UTC timestamp when the oldest event in `blocked` ages
    /// out — i.e. when the limit relaxes by one.
    pub reset_at: Option<DateTime<Utc>>,
    /// Per-window remaining counts. When `ok = true`, the just-recorded
    /// event is already subtracted.
    pub remaining: Vec<RemainingWindow>,
}

/// Read-only usage row for the `/api/usage` endpoint. Mirrors
/// `lib/limits.ts::getUsage`'s row shape.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct UsageWindow {
    pub window: LimitWindow,
    pub used: u32,
    pub remaining: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn memory_spec_refill_rate_is_limit_over_window() {
        let s = MemorySpec::new(10, 3_600_000);
        // 10 tokens / 3.6e6 ms ≈ 2.78e-6 tokens/ms
        let r = s.refill_rate();
        assert!((r - (10.0 / 3_600_000.0)).abs() < 1e-12);
    }

    #[test]
    fn memory_spec_serializes_snake_case_fields() {
        let s = MemorySpec::new(5, 60_000);
        let v = serde_json::to_value(&s).unwrap();
        assert_eq!(v["limit"], 5);
        assert_eq!(v["window_ms"], 60_000);
    }

    #[test]
    fn limit_window_round_trips_through_json() {
        let w = LimitWindow {
            window_ms: 60_000,
            max: 5,
            label: "hourly".into(),
        };
        let s = serde_json::to_string(&w).unwrap();
        let back: LimitWindow = serde_json::from_str(&s).unwrap();
        assert_eq!(back, w);
    }

    #[test]
    fn limit_decision_ok_carries_remaining_array() {
        let d = LimitDecision {
            ok: true,
            blocked: None,
            reset_at: None,
            remaining: vec![RemainingWindow {
                window: LimitWindow {
                    window_ms: 60_000,
                    max: 5,
                    label: "hourly".into(),
                },
                remaining: 4,
            }],
        };
        let v = serde_json::to_value(&d).unwrap();
        assert_eq!(v["ok"], true);
        assert_eq!(v["remaining"][0]["remaining"], 4);
        assert!(v["blocked"].is_null());
    }
}
