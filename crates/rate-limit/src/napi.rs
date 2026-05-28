//! napi-rs binding for the `openlen-rate-limit` crate.
//!
//! Exposes a single `RateLimiter` JS class with both backends layered in:
//! `try_consume` is the sync, in-memory token bucket call site
//! (autofill, analytics); `check_and_consume` and `get_usage` are the
//! async, Postgres-backed sliding-window calls (auth, generate, forms).
//!
//! ## Connection lifecycle
//!
//! The constructor is sync and stores the optional `database_url`. The
//! actual `PgPool` is created lazily on the first Postgres-using call —
//! this keeps `new RateLimiter(...)` zero-cost in JS even when the
//! caller never touches the persistent path (e.g. a script that only
//! does memory rate-limiting).
//!
//! ## GC task lifecycle
//!
//! The background memory-bucket sweep is started in the constructor and
//! its [`JoinHandle`] is held inside the class. When the JS class is
//! garbage-collected, Rust drops the struct, which drops the handle.
//! The current `JoinHandle::drop` semantics in tokio detach the task
//! (the task continues until it naturally exits — and ours never does;
//! it loops forever). The leak is one task per `RateLimiter` instance,
//! and we expect exactly one such instance per Node process, so the
//! cost is bounded.
//!
//! ## Error envelope
//!
//! Errors thrown across the boundary use the same JSON-encoded envelope
//! shape as `ai-gateway` — `{ kind, retryable, message }` — so the TS
//! wrapper at `lib/rate-limit-rs.ts` can rehydrate a typed
//! `RateLimitError` class with the same ergonomics callers already know
//! from `GatewayError`.

use std::sync::Arc;
use std::time::Duration;

use napi::bindgen_prelude::*;
use napi_derive::napi;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use crate::bucket::{MemoryLimiter, DEFAULT_GC_INTERVAL, DEFAULT_IDLE_EVICTION_MS};
use crate::error::RateLimitError;
use crate::postgres::PostgresLimiter;
use crate::types::{
    ConsumeOutcome as NativeConsumeOutcome, LimitDecision as NativeLimitDecision,
    LimitWindow as NativeLimitWindow, MemorySpec as NativeMemorySpec,
    UsageWindow as NativeUsageWindow,
};

// ─── JS-facing structs ───────────────────────────────────────────────────────

#[napi(object)]
#[derive(Debug, Clone, Default)]
pub struct RateLimiterOptions {
    /// Postgres connection string. When absent, `check_and_consume` and
    /// `get_usage` reject with a typed `not_configured` envelope; the
    /// memory-only `try_consume` path still works.
    pub database_url: Option<String>,
    /// Idle eviction TTL for memory buckets in milliseconds. Default 6h.
    pub idle_eviction_ms: Option<u32>,
    /// Background GC sweep interval in milliseconds. Default 1h.
    pub gc_interval_ms: Option<u32>,
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct ConsumeOutcome {
    pub allowed: bool,
    pub remaining: u32,
    /// Ms until the next token. 0 when `allowed = true`.
    pub retry_after_ms: u32,
    pub limit: u32,
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct LimitWindow {
    /// Sliding window in milliseconds. Must be > 0 and ≤ u32::MAX
    /// (~49 days) — wider windows aren't a current call-site need.
    pub window_ms: u32,
    pub max: u32,
    pub label: String,
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct RemainingWindow {
    pub window: LimitWindow,
    pub remaining: u32,
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct LimitDecision {
    pub ok: bool,
    pub blocked: Option<LimitWindow>,
    /// ISO 8601 UTC timestamp string; `null` when `ok = true`.
    pub reset_at: Option<String>,
    pub remaining: Vec<RemainingWindow>,
}

#[napi(object)]
#[derive(Debug, Clone)]
pub struct UsageWindow {
    pub window: LimitWindow,
    pub used: u32,
    pub remaining: u32,
}

// ─── Conversions: native → JS ────────────────────────────────────────────────

fn u64_to_u32_clamped(n: u64) -> u32 {
    n.min(u32::MAX as u64) as u32
}

impl From<NativeConsumeOutcome> for ConsumeOutcome {
    fn from(o: NativeConsumeOutcome) -> Self {
        Self {
            allowed: o.allowed,
            remaining: o.remaining,
            retry_after_ms: u64_to_u32_clamped(o.retry_after_ms),
            limit: o.limit,
        }
    }
}

impl From<NativeLimitWindow> for LimitWindow {
    fn from(w: NativeLimitWindow) -> Self {
        Self {
            window_ms: u64_to_u32_clamped(w.window_ms),
            max: w.max,
            label: w.label,
        }
    }
}

impl From<NativeUsageWindow> for UsageWindow {
    fn from(u: NativeUsageWindow) -> Self {
        Self {
            window: u.window.into(),
            used: u.used,
            remaining: u.remaining,
        }
    }
}

impl From<NativeLimitDecision> for LimitDecision {
    fn from(d: NativeLimitDecision) -> Self {
        Self {
            ok: d.ok,
            blocked: d.blocked.map(LimitWindow::from),
            reset_at: d.reset_at.map(|t| t.to_rfc3339()),
            remaining: d
                .remaining
                .into_iter()
                .map(|r| RemainingWindow {
                    window: r.window.into(),
                    remaining: r.remaining,
                })
                .collect(),
        }
    }
}

// ─── Conversions: JS → native ────────────────────────────────────────────────

impl TryFrom<LimitWindow> for NativeLimitWindow {
    type Error = napi::Error;
    fn try_from(w: LimitWindow) -> std::result::Result<Self, Self::Error> {
        if w.window_ms == 0 {
            return Err(napi::Error::from_reason(rate_limit_envelope(
                "invalid_window",
                false,
                "window_ms must be > 0",
            )));
        }
        if w.max == 0 {
            return Err(napi::Error::from_reason(rate_limit_envelope(
                "invalid_max",
                false,
                "max must be > 0",
            )));
        }
        Ok(NativeLimitWindow {
            window_ms: w.window_ms as u64,
            max: w.max,
            label: w.label,
        })
    }
}

fn convert_windows(windows: Vec<LimitWindow>) -> Result<Vec<NativeLimitWindow>> {
    windows
        .into_iter()
        .map(NativeLimitWindow::try_from)
        .collect::<std::result::Result<_, _>>()
}

// ─── Error envelope ──────────────────────────────────────────────────────────

fn rate_limit_envelope(kind: &str, retryable: bool, message: impl Into<String>) -> String {
    serde_json::json!({
        "kind": kind,
        "retryable": retryable,
        "message": message.into(),
    })
    .to_string()
}

fn rate_limit_error_to_napi(err: RateLimitError) -> napi::Error {
    let kind = match &err {
        RateLimitError::Postgres(_) => "postgres",
        RateLimitError::InvalidMax(_) => "invalid_max",
        RateLimitError::InvalidWindow => "invalid_window",
    };
    napi::Error::from_reason(rate_limit_envelope(
        kind,
        err.is_retryable(),
        err.to_string(),
    ))
}

fn not_configured() -> napi::Error {
    napi::Error::from_reason(rate_limit_envelope(
        "not_configured",
        false,
        "RateLimiter was constructed without database_url — \
         check_and_consume / get_usage are not available on this instance",
    ))
}

// ─── The class ───────────────────────────────────────────────────────────────

/// JS-facing unified rate limiter.
///
/// Construct once per Node process and share via module scope — the
/// internal memory bucket is the per-process state previously held in
/// `lib/rate-limit.ts` and `lib/analytics/rate-limit.ts`, and the lazy
/// `PgPool` is best amortised across many calls.
#[napi]
pub struct RateLimiter {
    memory: Arc<MemoryLimiter>,
    database_url: Option<String>,
    persistent: Arc<Mutex<Option<PostgresLimiter>>>,
    _gc_handle: Option<JoinHandle<()>>,
}

#[napi]
impl RateLimiter {
    /// Construct a limiter with the given options. `databaseUrl` is
    /// optional — omit it for memory-only setups (scripts, tests, the
    /// autofill call site). The background memory-GC task is spawned
    /// here and held inside the struct until the JS class is GC'd.
    #[napi(constructor)]
    pub fn new(options: Option<RateLimiterOptions>) -> Self {
        let opts = options.unwrap_or_default();
        let idle_ms = opts
            .idle_eviction_ms
            .filter(|&n| n > 0)
            .map(u64::from)
            .unwrap_or(DEFAULT_IDLE_EVICTION_MS);
        let gc_ms = opts
            .gc_interval_ms
            .filter(|&n| n > 0)
            .map(u64::from)
            .unwrap_or_else(|| DEFAULT_GC_INTERVAL.as_millis() as u64);

        let memory = Arc::new(MemoryLimiter::new().with_idle_eviction_ms(idle_ms));
        let gc_handle = memory.spawn_gc(Duration::from_millis(gc_ms));

        Self {
            memory,
            database_url: opts.database_url,
            persistent: Arc::new(Mutex::new(None)),
            _gc_handle: Some(gc_handle),
        }
    }

    /// Sync, in-memory token bucket. Mirrors `lib/rate-limit.ts::consumeToken`.
    /// A non-positive `windowMs` fails open with `allowed = true` to match
    /// the TS behaviour.
    #[napi]
    pub fn try_consume(&self, key: String, limit: u32, window_ms: u32) -> ConsumeOutcome {
        if window_ms == 0 || limit == 0 {
            return ConsumeOutcome {
                allowed: true,
                remaining: limit,
                retry_after_ms: 0,
                limit,
            };
        }
        let spec = NativeMemorySpec::new(limit, window_ms as u64);
        self.memory.try_consume(&key, spec).into()
    }

    /// Async, Postgres-backed sliding window. Mirrors
    /// `lib/limits.ts::checkAndConsume`. Lazily opens the connection
    /// pool on first call.
    #[napi]
    pub async fn check_and_consume(
        &self,
        key: String,
        windows: Vec<LimitWindow>,
    ) -> Result<LimitDecision> {
        let native_windows = convert_windows(windows)?;
        let pg = self.connect_or_fail().await?;
        pg.check_and_consume(&key, &native_windows)
            .await
            .map(LimitDecision::from)
            .map_err(rate_limit_error_to_napi)
    }

    /// Async, read-only counterpart. Mirrors `lib/limits.ts::getUsage`.
    #[napi]
    pub async fn get_usage(
        &self,
        key: String,
        windows: Vec<LimitWindow>,
    ) -> Result<Vec<UsageWindow>> {
        let native_windows = convert_windows(windows)?;
        let pg = self.connect_or_fail().await?;
        pg.get_usage(&key, &native_windows)
            .await
            .map(|us| us.into_iter().map(UsageWindow::from).collect())
            .map_err(rate_limit_error_to_napi)
    }

    /// Synchronously sweep idle memory buckets. The background task does
    /// this automatically on a cadence; this method exists so tests can
    /// drive the sweep without waiting for the timer.
    #[napi]
    pub fn gc_now(&self) {
        self.memory.gc_now();
    }

    /// Diagnostic count of memory-bucket entries currently held.
    #[napi]
    pub fn memory_size(&self) -> u32 {
        // DashMap::len returns usize; clamp to u32 for the JS surface
        // (we'd hit memory pressure long before approaching u32::MAX
        // buckets).
        let n = self.memory.len();
        if n > u32::MAX as usize {
            u32::MAX
        } else {
            n as u32
        }
    }

    async fn connect_or_fail(&self) -> Result<PostgresLimiter> {
        let url = self.database_url.as_ref().ok_or_else(not_configured)?;
        let mut guard = self.persistent.lock().await;
        if let Some(pg) = guard.as_ref() {
            return Ok(pg.clone());
        }
        let pg = PostgresLimiter::connect(url)
            .await
            .map_err(rate_limit_error_to_napi)?;
        *guard = Some(pg.clone());
        Ok(pg)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn u64_to_u32_clamped_passes_normal_values() {
        assert_eq!(u64_to_u32_clamped(0), 0);
        assert_eq!(u64_to_u32_clamped(3_600_000), 3_600_000);
        assert_eq!(u64_to_u32_clamped(u32::MAX as u64), u32::MAX);
    }

    #[test]
    fn u64_to_u32_clamped_caps_overflow() {
        assert_eq!(u64_to_u32_clamped((u32::MAX as u64) + 1), u32::MAX);
        assert_eq!(u64_to_u32_clamped(u64::MAX), u32::MAX);
    }

    #[test]
    fn limit_window_try_from_rejects_zero_window() {
        let w = LimitWindow {
            window_ms: 0,
            max: 5,
            label: "bad".into(),
        };
        let err = NativeLimitWindow::try_from(w).unwrap_err();
        assert!(err.reason.contains("invalid_window"));
    }

    #[test]
    fn limit_window_try_from_rejects_zero_max() {
        let w = LimitWindow {
            window_ms: 60_000,
            max: 0,
            label: "bad".into(),
        };
        let err = NativeLimitWindow::try_from(w).unwrap_err();
        assert!(err.reason.contains("invalid_max"));
    }

    #[test]
    fn limit_window_round_trip_preserves_normal_values() {
        let w = LimitWindow {
            window_ms: 3_600_000,
            max: 10,
            label: "hourly".into(),
        };
        let native: NativeLimitWindow = w.clone().try_into().unwrap();
        let back: LimitWindow = native.into();
        assert_eq!(back.window_ms, w.window_ms);
        assert_eq!(back.max, w.max);
        assert_eq!(back.label, w.label);
    }

    #[test]
    fn envelope_includes_kind_retryable_message() {
        let env = rate_limit_envelope("postgres", true, "boom");
        let parsed: serde_json::Value = serde_json::from_str(&env).unwrap();
        assert_eq!(parsed["kind"], "postgres");
        assert_eq!(parsed["retryable"], true);
        assert_eq!(parsed["message"], "boom");
    }

    #[test]
    fn rate_limit_error_to_napi_carries_invalid_max_kind() {
        let err = rate_limit_error_to_napi(RateLimitError::InvalidMax(0));
        let parsed: serde_json::Value = serde_json::from_str(&err.reason).unwrap();
        assert_eq!(parsed["kind"], "invalid_max");
        assert_eq!(parsed["retryable"], false);
    }

    #[test]
    fn not_configured_uses_distinct_kind() {
        let err = not_configured();
        let parsed: serde_json::Value = serde_json::from_str(&err.reason).unwrap();
        assert_eq!(parsed["kind"], "not_configured");
        assert_eq!(parsed["retryable"], false);
    }

    #[test]
    fn consume_outcome_native_to_js_clamps_giant_retry_after() {
        let native = NativeConsumeOutcome {
            allowed: false,
            remaining: 0,
            retry_after_ms: u64::MAX,
            limit: 10,
        };
        let js: ConsumeOutcome = native.into();
        assert_eq!(js.retry_after_ms, u32::MAX);
    }
}
