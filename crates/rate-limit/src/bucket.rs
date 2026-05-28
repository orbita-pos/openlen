//! Sliding-window in-memory token bucket — port of `lib/rate-limit.ts`.
//!
//! The bucket is keyed by an arbitrary string (typically `"<feature>:<userId>"`
//! or `"<feature>:<ip>"`) and refills continuously at `limit / window_ms`
//! tokens per millisecond. Each `try_consume` deducts exactly one token and
//! reports remaining capacity; when the bucket is below 1.0 the call is
//! blocked and a `retry_after_ms` deadline is reported.
//!
//! ## Design choices that mirror the TS implementation
//!
//! - Continuous refill (no fixed reset boundaries). A `{limit: 10, window:
//!   1h}` bucket lets a user spam 10 calls instantly, then drip-feed one
//!   every six minutes. Matches the way the TS limiter behaves today and
//!   keeps backward compatibility for the autofill caller.
//! - `tokens` is stored as `f64` so partial refills round consistently —
//!   `Math.floor(bucket.tokens)` in TS maps to `f64::floor as u32` here.
//! - `lastRefill` is a wall-clock millisecond timestamp (matches
//!   `Date.now()`). We use a [`Clock`] trait so tests can inject a mock.
//!
//! ## Concurrency
//!
//! [`DashMap`] gives per-bucket sharding without a global lock. Two callers
//! hitting different keys never contend; two callers hitting the same key
//! serialise on a per-shard `RwLock` but the critical section is a handful
//! of arithmetic ops — well under a microsecond.

use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use dashmap::DashMap;
use tokio::task::JoinHandle;
use tokio::time::MissedTickBehavior;

use crate::types::{ConsumeOutcome, MemorySpec};

/// Wall-clock millisecond source. Exists so tests can drive time
/// deterministically; production uses [`SystemClock`].
pub trait Clock: Send + Sync + 'static {
    fn now_ms(&self) -> u64;
}

/// `SystemTime::now()` → milliseconds since UNIX epoch. Saturates to 0 if
/// the system clock is somehow before 1970 (won't happen in practice).
#[derive(Debug, Default, Clone, Copy)]
pub struct SystemClock;

impl Clock for SystemClock {
    fn now_ms(&self) -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0)
    }
}

#[derive(Debug, Clone, Copy)]
struct Bucket {
    tokens: f64,
    last_refill_ms: u64,
}

/// Default idle TTL — matches the 6-hour eviction in the TS GC. A bucket
/// untouched for longer than this gets dropped at the next sweep.
pub const DEFAULT_IDLE_EVICTION_MS: u64 = 6 * 60 * 60 * 1000;

/// Default sweep interval — runs once an hour, same as the TS setInterval.
pub const DEFAULT_GC_INTERVAL: Duration = Duration::from_secs(60 * 60);

/// In-memory sliding-window token bucket store. Cheap to construct; the
/// background GC task is opt-in via [`MemoryLimiter::spawn_gc`].
pub struct MemoryLimiter {
    buckets: DashMap<String, Bucket>,
    clock: Arc<dyn Clock>,
    idle_eviction_ms: u64,
}

impl std::fmt::Debug for MemoryLimiter {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MemoryLimiter")
            .field("buckets", &self.buckets.len())
            .field("idle_eviction_ms", &self.idle_eviction_ms)
            .finish()
    }
}

impl Default for MemoryLimiter {
    fn default() -> Self {
        Self::new()
    }
}

impl MemoryLimiter {
    /// Default limiter wired to [`SystemClock`] and the 6-hour eviction.
    pub fn new() -> Self {
        Self::with_clock(Arc::new(SystemClock))
    }

    /// Construct with a custom clock (typically [`MockClock`] in tests).
    pub fn with_clock(clock: Arc<dyn Clock>) -> Self {
        Self {
            buckets: DashMap::new(),
            clock,
            idle_eviction_ms: DEFAULT_IDLE_EVICTION_MS,
        }
    }

    /// Override the idle eviction TTL. Useful in tests that want sweep
    /// behaviour to fire on a smaller window than 6 hours.
    pub fn with_idle_eviction_ms(mut self, ms: u64) -> Self {
        self.idle_eviction_ms = ms;
        self
    }

    /// Attempt to consume one token. Pure-function over the bucket's
    /// internal state; the only side effects are (a) refilling the bucket
    /// to `now` and (b) decrementing one token on success.
    ///
    /// `spec` is passed at call time — different callers can target the
    /// same key with different limits if they want (we don't; this stays
    /// flexible).
    pub fn try_consume(&self, key: &str, spec: MemorySpec) -> ConsumeOutcome {
        // Sanity: a degenerate spec would divide by zero in refill_rate.
        // Match TS's "fail open" stance — return allowed without recording.
        if spec.limit == 0 || spec.window_ms == 0 {
            return ConsumeOutcome {
                allowed: true,
                remaining: spec.limit,
                retry_after_ms: 0,
                limit: spec.limit,
            };
        }
        let now = self.clock.now_ms();
        let refill_rate = spec.refill_rate();

        if let Some(mut entry) = self.buckets.get_mut(key) {
            // Refill since the last touch, capped at `limit`.
            let elapsed = now.saturating_sub(entry.last_refill_ms) as f64;
            let refilled = elapsed * refill_rate;
            entry.tokens = (entry.tokens + refilled).min(spec.limit as f64);
            entry.last_refill_ms = now;

            if entry.tokens >= 1.0 {
                entry.tokens -= 1.0;
                return ConsumeOutcome {
                    allowed: true,
                    remaining: entry.tokens.floor() as u32,
                    retry_after_ms: 0,
                    limit: spec.limit,
                };
            }

            // Floor-clamped at zero — bucket.tokens may be slightly negative
            // from floating-point creep; ceil((1 - x) / rate) handles it.
            let needed = 1.0 - entry.tokens;
            let ms = (needed / refill_rate).ceil();
            // The cast saturates if `ms` exceeds u64::MAX — impossible at our
            // refill rates but defensible.
            let retry_after_ms = if ms.is_finite() && ms >= 0.0 {
                ms as u64
            } else {
                spec.window_ms
            };
            return ConsumeOutcome {
                allowed: false,
                remaining: 0,
                retry_after_ms,
                limit: spec.limit,
            };
        }

        // Cold path — first call for this key. Matches TS exactly:
        // start full, immediately deduct one, return remaining = limit - 1.
        self.buckets.insert(
            key.to_owned(),
            Bucket {
                tokens: (spec.limit - 1) as f64,
                last_refill_ms: now,
            },
        );
        ConsumeOutcome {
            allowed: true,
            remaining: spec.limit - 1,
            retry_after_ms: 0,
            limit: spec.limit,
        }
    }

    /// Synchronous sweep — drop every bucket that hasn't been touched
    /// within `idle_eviction_ms`. Exposed publicly so the napi binding can
    /// trigger a one-shot GC for tests.
    pub fn gc_now(&self) {
        let now = self.clock.now_ms();
        let ttl = self.idle_eviction_ms;
        self.buckets
            .retain(|_, b| now.saturating_sub(b.last_refill_ms) <= ttl);
    }

    /// Spawn a tokio background task that calls [`gc_now`] every
    /// `interval`. The returned handle owns the task — drop it to stop the
    /// sweep (the task is aborted via `JoinHandle::abort` in `Drop` when
    /// the returned handle goes out of scope, see
    /// [`tokio::task::JoinHandle`] docs).
    ///
    /// Designed for the napi layer: the JS class holds the handle so the
    /// task lives as long as the limiter does.
    pub fn spawn_gc(self: &Arc<Self>, interval: Duration) -> JoinHandle<()> {
        let me = Arc::clone(self);
        tokio::spawn(async move {
            let mut iv = tokio::time::interval(interval);
            iv.set_missed_tick_behavior(MissedTickBehavior::Delay);
            // Drop the immediate first tick; the constructor doesn't need
            // a sweep before any traffic landed.
            iv.tick().await;
            loop {
                iv.tick().await;
                me.gc_now();
            }
        })
    }

    /// Number of buckets currently held (post-GC). Useful for assertions.
    pub fn len(&self) -> usize {
        self.buckets.len()
    }

    pub fn is_empty(&self) -> bool {
        self.buckets.is_empty()
    }
}

#[cfg(test)]
pub(crate) mod test_clock {
    use super::Clock;
    use std::sync::atomic::{AtomicU64, Ordering};

    /// Atomic test clock — `set` jumps absolute, `advance` adds milliseconds.
    pub struct MockClock {
        now: AtomicU64,
    }

    impl MockClock {
        pub fn at(ms: u64) -> Self {
            Self {
                now: AtomicU64::new(ms),
            }
        }

        #[allow(dead_code)]
        pub fn set(&self, ms: u64) {
            self.now.store(ms, Ordering::Relaxed);
        }

        pub fn advance(&self, ms: u64) {
            self.now.fetch_add(ms, Ordering::Relaxed);
        }
    }

    impl Clock for MockClock {
        fn now_ms(&self) -> u64 {
            self.now.load(Ordering::Relaxed)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::test_clock::MockClock;
    use super::*;

    fn limiter_with(now: u64) -> (Arc<MockClock>, MemoryLimiter) {
        let clock = Arc::new(MockClock::at(now));
        let lim = MemoryLimiter::with_clock(clock.clone());
        (clock, lim)
    }

    fn spec_10_per_hour() -> MemorySpec {
        MemorySpec::new(10, 3_600_000)
    }

    #[test]
    fn cold_path_returns_allowed_with_limit_minus_one_remaining() {
        let (_clock, lim) = limiter_with(1_000);
        let out = lim.try_consume("u:a", spec_10_per_hour());
        assert!(out.allowed);
        assert_eq!(out.remaining, 9);
        assert_eq!(out.retry_after_ms, 0);
        assert_eq!(out.limit, 10);
        assert_eq!(lim.len(), 1);
    }

    #[test]
    fn ten_immediate_consumes_exhaust_the_bucket() {
        let (_clock, lim) = limiter_with(1_000);
        let spec = spec_10_per_hour();
        for i in 0..10 {
            let out = lim.try_consume("u:a", spec);
            assert!(out.allowed, "consume #{i} should pass");
        }
        let out = lim.try_consume("u:a", spec);
        assert!(!out.allowed);
        assert_eq!(out.remaining, 0);
        assert!(out.retry_after_ms > 0, "blocked → must report retry_after");
    }

    #[test]
    fn refill_between_calls_restores_tokens() {
        let (clock, lim) = limiter_with(1_000);
        let spec = spec_10_per_hour();
        for _ in 0..10 {
            assert!(lim.try_consume("u:a", spec).allowed);
        }
        // Half an hour passes → ~5 tokens refilled.
        clock.advance(1_800_000);
        for i in 0..5 {
            let out = lim.try_consume("u:a", spec);
            assert!(out.allowed, "refill consume #{i} should pass");
        }
        // 6th in this burst exhausts the refill.
        let out = lim.try_consume("u:a", spec);
        assert!(!out.allowed, "6th refill-burst consume must be blocked");
    }

    #[test]
    fn retry_after_ms_matches_ts_ceil_formula() {
        let (_clock, lim) = limiter_with(1_000);
        let spec = MemorySpec::new(1, 60_000); // 1/min
        assert!(lim.try_consume("u:a", spec).allowed);
        let out = lim.try_consume("u:a", spec);
        assert!(!out.allowed);
        // refill_rate = 1/60_000 → ceil(1 / (1/60_000)) = 60_000
        assert_eq!(out.retry_after_ms, 60_000);
    }

    #[test]
    fn full_window_after_block_restores_completely() {
        let (clock, lim) = limiter_with(1_000);
        let spec = spec_10_per_hour();
        for _ in 0..10 {
            lim.try_consume("u:a", spec);
        }
        clock.advance(3_600_000);
        // Full hour → 10 tokens refilled (capped at limit).
        for i in 0..10 {
            assert!(
                lim.try_consume("u:a", spec).allowed,
                "post-window consume #{i} should pass",
            );
        }
        assert!(!lim.try_consume("u:a", spec).allowed);
    }

    #[test]
    fn refill_is_capped_at_limit_after_long_idle() {
        let (clock, lim) = limiter_with(1_000);
        let spec = spec_10_per_hour();
        lim.try_consume("u:a", spec);
        // Sit idle for a week — far longer than the window. Tokens cap at 10.
        clock.advance(7 * 24 * 3_600_000);
        // Cap means: at most 10 successful consumes in a row.
        for i in 0..10 {
            assert!(
                lim.try_consume("u:a", spec).allowed,
                "cap consume #{i} should pass",
            );
        }
        assert!(!lim.try_consume("u:a", spec).allowed);
    }

    #[test]
    fn different_keys_have_independent_buckets() {
        let (_clock, lim) = limiter_with(1_000);
        let spec = MemorySpec::new(2, 60_000);
        assert!(lim.try_consume("u:a", spec).allowed);
        assert!(lim.try_consume("u:a", spec).allowed);
        assert!(!lim.try_consume("u:a", spec).allowed);
        // u:b is brand-new — gets a fresh bucket.
        assert!(lim.try_consume("u:b", spec).allowed);
        assert!(lim.try_consume("u:b", spec).allowed);
        assert!(!lim.try_consume("u:b", spec).allowed);
    }

    #[test]
    fn zero_limit_returns_allowed_fail_open() {
        let (_clock, lim) = limiter_with(1_000);
        let spec = MemorySpec::new(0, 60_000);
        let out = lim.try_consume("u:a", spec);
        assert!(out.allowed, "0-limit spec should fail open (matches TS)");
    }

    #[test]
    fn zero_window_returns_allowed_fail_open() {
        let (_clock, lim) = limiter_with(1_000);
        let spec = MemorySpec::new(5, 0);
        let out = lim.try_consume("u:a", spec);
        assert!(out.allowed, "0-window spec should fail open");
    }

    #[test]
    fn gc_now_evicts_idle_buckets_past_ttl() {
        let clock = Arc::new(MockClock::at(0));
        let lim = MemoryLimiter::with_clock(clock.clone()).with_idle_eviction_ms(10_000);
        lim.try_consume("u:a", MemorySpec::new(1, 1_000));
        assert_eq!(lim.len(), 1);
        clock.advance(5_000);
        lim.gc_now();
        assert_eq!(lim.len(), 1, "should still be live within TTL");
        clock.advance(20_000);
        lim.gc_now();
        assert_eq!(lim.len(), 0, "should be evicted past TTL");
    }

    #[test]
    fn gc_now_preserves_recently_touched_buckets() {
        let clock = Arc::new(MockClock::at(0));
        let lim = MemoryLimiter::with_clock(clock.clone()).with_idle_eviction_ms(10_000);
        let spec = MemorySpec::new(2, 1_000);
        lim.try_consume("idle", spec);
        clock.advance(20_000);
        // Touch "live" right at the cutoff.
        lim.try_consume("live", spec);
        lim.gc_now();
        // Idle is dropped; live is kept.
        assert_eq!(lim.len(), 1);
    }

    #[tokio::test]
    async fn spawn_gc_runs_periodically() {
        let clock = Arc::new(MockClock::at(0));
        let lim = Arc::new(
            MemoryLimiter::with_clock(clock.clone()).with_idle_eviction_ms(50),
        );
        // Add a bucket, drop GC handle separately, sleep enough to let the
        // task tick at least once on a short cadence.
        lim.try_consume("u:a", MemorySpec::new(1, 1_000));
        clock.advance(1_000); // mark the bucket as long-idle relative to MockClock
        let handle = lim.spawn_gc(Duration::from_millis(20));
        // Two cadence ticks should clear out the long-idle bucket.
        tokio::time::sleep(Duration::from_millis(80)).await;
        handle.abort();
        let _ = handle.await;
        assert_eq!(lim.len(), 0, "background GC should have evicted the idle bucket");
    }
}
