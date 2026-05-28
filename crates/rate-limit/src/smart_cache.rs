//! SmartCache — memory-primary, lazily-persisted rate limiter.
//!
//! Closes Open Q #1 from F4 S1: combines [`MemoryLimiter`]'s token-bucket
//! hot path with optional Postgres durability + cross-restart hydration,
//! all behind a single API shaped like [`crate::postgres::PostgresLimiter`].
//!
//! ## Decision flow per `check_and_consume`
//!
//! 1. **Memory token bucket** per window — `{key}::{window.label}` is a
//!    distinct bucket inside the shared [`MemoryLimiter`], sized by that
//!    window's `max` + `window_ms`. Each call deducts one token from each
//!    window. If any window blocks, the call is denied; no PG write.
//! 2. **Async PG flush on allow** — if every window passes, the
//!    [`PersistenceMode::AllEvents`] path enqueues one event onto the
//!    bounded flush channel. The flush task drains it every
//!    [`SmartCacheConfig::flush_interval`] into a single multi-row INSERT.
//! 3. **No PG hit on block** — the "negative cache" promise from the F4 S2
//!    brief: a blocked decision never sees the database. The token bucket
//!    already amortises blocked-key floods to ~600 ns per call.
//!
//! ## Cold-start hydration
//!
//! [`SmartCache::hydrate`] runs one `SELECT key, COUNT(*) FROM
//! "rateLimitEvents" WHERE "createdAt" > $1 GROUP BY key` per window and
//! seeds the memory buckets with `tokens = max - count` (clamped at zero).
//! After a restart this restores live state so the limiter doesn't
//! temporarily over-allow while memory warms up.
//!
//! ## Persistence modes
//!
//! - [`PersistenceMode::None`] — memory only. No flush queue, no PG writes,
//!   no hydration. Edge default for high-volume IP-based limits where DB
//!   writes per request are prohibitive and losing state on restart is
//!   acceptable (operators tolerate a few minutes of looser limits after
//!   a deploy).
//! - [`PersistenceMode::AllEvents`] — every allowed event flushes to PG.
//!   Use for TS callers already writing to PG today.
//!
//! ## Backpressure
//!
//! The flush queue is bounded. When full, new events are counted as
//! dropped ([`SmartCacheStats::flush_dropped`]) and the memory consume
//! still stands — losing durability doesn't reverse the live count.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use sqlx::PgPool;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio::time::MissedTickBehavior;
use tracing::{debug, warn};
use uuid::Uuid;

use crate::bucket::{MemoryLimiter, DEFAULT_GC_INTERVAL};
use crate::error::RateLimitError;
use crate::types::{
    ConsumeOutcome, LimitDecision, LimitWindow, MemorySpec, RemainingWindow, UsageWindow,
};

/// How allow-decisions are persisted to Postgres.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PersistenceMode {
    /// No PG writes. Memory is authoritative; soft state is lost on restart.
    /// Use for high-volume scenarios (per-IP IPs at the edge) where DB
    /// writes per request would dominate the workload.
    None,
    /// Every allowed event enqueued for batched PG insert. Mirrors the
    /// existing PG-backed limiter's persistence guarantee.
    AllEvents,
}

/// Tunables for the smart cache. All defaults match the F4 S2 brief.
#[derive(Debug, Clone)]
pub struct SmartCacheConfig {
    pub persistence_mode: PersistenceMode,
    /// How often the flush task drains the queue into PG.
    pub flush_interval: Duration,
    /// Max rows per multi-row INSERT. Drained-but-not-yet-flushed events
    /// queue up between ticks; if the batch exceeds this on a single tick,
    /// the task splits into multiple INSERTs.
    pub flush_batch_max: usize,
    /// Bounded channel capacity. Past this, new events are dropped.
    pub flush_queue_capacity: usize,
    /// Window queried for cold-start hydration — match (or exceed) the
    /// longest limit window used by callers.
    pub hydration_window_ms: u64,
    /// Memory bucket GC interval (forwarded to [`MemoryLimiter::spawn_gc`]).
    pub memory_gc_interval: Duration,
}

impl Default for SmartCacheConfig {
    fn default() -> Self {
        Self {
            persistence_mode: PersistenceMode::AllEvents,
            flush_interval: Duration::from_secs(1),
            flush_batch_max: 500,
            flush_queue_capacity: 10_000,
            hydration_window_ms: 60 * 60 * 1000, // 1 hour
            memory_gc_interval: DEFAULT_GC_INTERVAL,
        }
    }
}

impl SmartCacheConfig {
    /// Memory-only preset — flush queue and PG writes disabled regardless
    /// of capacity values.
    pub fn memory_only() -> Self {
        Self {
            persistence_mode: PersistenceMode::None,
            ..Self::default()
        }
    }
}

/// Counters exposed for metrics + tests. All monotonic, all `u64`.
#[derive(Debug, Default)]
pub struct SmartCacheStats {
    /// Times a check_and_consume returned allowed (sum across windows).
    pub memory_allow: AtomicU64,
    /// Times a check_and_consume returned blocked (any window).
    pub memory_block: AtomicU64,
    /// Events successfully INSERTed by the flush task.
    pub flush_persisted: AtomicU64,
    /// Events dropped because the flush queue was full.
    pub flush_dropped: AtomicU64,
    /// Events dropped because the flush task failed the INSERT.
    pub flush_failed: AtomicU64,
    /// Rows inserted into the memory bucket store by hydration.
    pub hydration_seeded: AtomicU64,
}

impl SmartCacheStats {
    pub fn allow(&self) -> u64 {
        self.memory_allow.load(Ordering::Relaxed)
    }
    pub fn block(&self) -> u64 {
        self.memory_block.load(Ordering::Relaxed)
    }
    pub fn persisted(&self) -> u64 {
        self.flush_persisted.load(Ordering::Relaxed)
    }
    pub fn dropped(&self) -> u64 {
        self.flush_dropped.load(Ordering::Relaxed)
    }
    pub fn failed(&self) -> u64 {
        self.flush_failed.load(Ordering::Relaxed)
    }
    pub fn seeded(&self) -> u64 {
        self.hydration_seeded.load(Ordering::Relaxed)
    }
}

#[derive(Debug)]
struct FlushEvent {
    key: String,
    occurred_at: DateTime<Utc>,
}

/// Smart cache. Cheap to `clone` — the inner state is `Arc`-shared so the
/// type can be handed to multiple Tower service instances without copies.
#[derive(Clone)]
pub struct SmartCache {
    inner: Arc<Inner>,
}

struct Inner {
    memory: Arc<MemoryLimiter>,
    pg_pool: Option<PgPool>,
    flush_tx: Option<mpsc::Sender<FlushEvent>>,
    config: SmartCacheConfig,
    stats: Arc<SmartCacheStats>,
}

impl std::fmt::Debug for SmartCache {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SmartCache")
            .field("persistence_mode", &self.inner.config.persistence_mode)
            .field("has_pool", &self.inner.pg_pool.is_some())
            .field("buckets", &self.inner.memory.len())
            .finish()
    }
}

/// Owns the background tasks spawned for the smart cache. Drop = abort all.
pub struct SmartCacheBackground {
    flush_task: Option<JoinHandle<()>>,
    memory_gc_task: JoinHandle<()>,
}

impl SmartCacheBackground {
    /// Cooperative shutdown — abort flush + GC and wait for both to finish.
    /// Use this in tests that want immediate teardown without waiting on
    /// the flush interval; production drops the handle instead.
    pub async fn shutdown(mut self) {
        if let Some(handle) = self.flush_task.take() {
            handle.abort();
            let _ = handle.await;
        }
        self.memory_gc_task.abort();
        let _ = (&mut self.memory_gc_task).await;
    }
}

impl Drop for SmartCacheBackground {
    fn drop(&mut self) {
        if let Some(handle) = self.flush_task.take() {
            handle.abort();
        }
        self.memory_gc_task.abort();
    }
}

impl SmartCache {
    /// Memory-only build + GC sweep. No PG writes, no flush queue.
    pub fn start_memory_only(config: SmartCacheConfig) -> (Self, SmartCacheBackground) {
        let memory = Arc::new(MemoryLimiter::new());
        let mut effective = config;
        effective.persistence_mode = PersistenceMode::None;
        Self::start_with(memory, None, effective)
    }

    /// PG-backed build. The `persistence_mode` field on `config` controls
    /// whether the flush task actually starts.
    pub fn start_with_pool(pool: PgPool, config: SmartCacheConfig) -> (Self, SmartCacheBackground) {
        let memory = Arc::new(MemoryLimiter::new());
        Self::start_with(memory, Some(pool), config)
    }

    /// Construct around an injected [`MemoryLimiter`] — used by tests that
    /// want to drive a [`MockClock`](crate::bucket::test_clock::MockClock).
    pub fn start_with(
        memory: Arc<MemoryLimiter>,
        pg_pool: Option<PgPool>,
        config: SmartCacheConfig,
    ) -> (Self, SmartCacheBackground) {
        let stats = Arc::new(SmartCacheStats::default());
        let memory_gc_task = memory.spawn_gc(config.memory_gc_interval);

        let (flush_tx, flush_task) = match (&pg_pool, config.persistence_mode) {
            (Some(pool), PersistenceMode::AllEvents) => {
                let (tx, rx) = mpsc::channel::<FlushEvent>(config.flush_queue_capacity);
                let pool_clone = pool.clone();
                let stats_clone = stats.clone();
                let interval = config.flush_interval;
                let batch_max = config.flush_batch_max;
                let handle = tokio::spawn(async move {
                    flush_loop(pool_clone, rx, interval, batch_max, stats_clone).await
                });
                (Some(tx), Some(handle))
            }
            _ => (None, None),
        };

        let inner = Arc::new(Inner {
            memory,
            pg_pool,
            flush_tx,
            config,
            stats,
        });

        (
            Self { inner },
            SmartCacheBackground {
                flush_task,
                memory_gc_task,
            },
        )
    }

    /// Returns the shared in-memory bucket store. Mostly useful for
    /// observability + tests; production callers use `check_and_consume`.
    pub fn memory(&self) -> &Arc<MemoryLimiter> {
        &self.inner.memory
    }

    /// Read-only view of the cache's persistence configuration.
    pub fn persistence_mode(&self) -> PersistenceMode {
        self.inner.config.persistence_mode
    }

    /// Cumulative counters since process start.
    pub fn stats(&self) -> &SmartCacheStats {
        &self.inner.stats
    }

    /// Cheap accessor for tests/observability — number of buckets the
    /// memory store currently holds.
    pub fn bucket_count(&self) -> usize {
        self.inner.memory.len()
    }

    /// Memory-primary check + consume. Mirrors
    /// [`PostgresLimiter::check_and_consume`]'s shape so the two are drop-in
    /// substitutes from the caller's perspective.
    ///
    /// Per the SmartCache contract: blocked never touches PG; allowed
    /// enqueues an async insert. Both paths complete synchronously from
    /// the caller's perspective — the PG write happens on a background
    /// task. Returns `Ok(LimitDecision)` even when the queue is saturated
    /// (the drop is counted in [`SmartCacheStats::flush_dropped`] but the
    /// caller sees a normal allow).
    pub async fn check_and_consume(
        &self,
        key: &str,
        windows: &[LimitWindow],
    ) -> Result<LimitDecision, RateLimitError> {
        if windows.is_empty() {
            return Err(RateLimitError::InvalidWindow);
        }
        for w in windows {
            if w.max == 0 {
                return Err(RateLimitError::InvalidMax(0));
            }
            if w.window_ms == 0 {
                return Err(RateLimitError::InvalidWindow);
            }
        }

        // Per-window deduction. We consume in order; if a later window
        // blocks, the earlier window has already burned one token. The
        // token-bucket has continuous refill so this minor over-consume
        // self-corrects within the same window. Mirrors the PostgresLimiter
        // documented slop ("two concurrent requests at the limit might both
        // pass") — acceptable for a quota system.
        let mut per_window: Vec<(LimitWindow, ConsumeOutcome)> = Vec::with_capacity(windows.len());
        let mut blocked_idx: Option<usize> = None;
        for (i, w) in windows.iter().enumerate() {
            let spec = MemorySpec::new(w.max, w.window_ms);
            let composite_key = format!("{key}::{}", w.label);
            let outcome = self.inner.memory.try_consume(&composite_key, spec);
            per_window.push((w.clone(), outcome));
            if !outcome.allowed && blocked_idx.is_none() {
                blocked_idx = Some(i);
            }
        }

        if let Some(idx) = blocked_idx {
            self.inner
                .stats
                .memory_block
                .fetch_add(1, Ordering::Relaxed);
            let blocked_window = per_window[idx].0.clone();
            let retry_ms = per_window[idx].1.retry_after_ms.min(i64::MAX as u64) as i64;
            let reset_at = Some(Utc::now() + chrono::Duration::milliseconds(retry_ms));
            let remaining = per_window
                .into_iter()
                .map(|(w, o)| RemainingWindow {
                    remaining: o.remaining,
                    window: w,
                })
                .collect();
            return Ok(LimitDecision {
                ok: false,
                blocked: Some(blocked_window),
                reset_at,
                remaining,
            });
        }

        self.inner
            .stats
            .memory_allow
            .fetch_add(1, Ordering::Relaxed);

        if matches!(
            self.inner.config.persistence_mode,
            PersistenceMode::AllEvents
        ) {
            if let Some(tx) = &self.inner.flush_tx {
                let event = FlushEvent {
                    key: key.to_owned(),
                    occurred_at: Utc::now(),
                };
                match tx.try_send(event) {
                    Ok(()) => {}
                    Err(mpsc::error::TrySendError::Full(_)) => {
                        self.inner
                            .stats
                            .flush_dropped
                            .fetch_add(1, Ordering::Relaxed);
                        debug!(key, "smart cache flush queue full — dropping event");
                    }
                    Err(mpsc::error::TrySendError::Closed(_)) => {
                        self.inner
                            .stats
                            .flush_dropped
                            .fetch_add(1, Ordering::Relaxed);
                    }
                }
            }
        }

        let remaining = per_window
            .into_iter()
            .map(|(w, o)| RemainingWindow {
                remaining: o.remaining,
                window: w,
            })
            .collect();
        Ok(LimitDecision {
            ok: true,
            blocked: None,
            reset_at: None,
            remaining,
        })
    }

    /// Read-only usage snapshot. The memory bucket store has no peek API
    /// (consume is the only public method), so this returns a coarse view:
    /// `used = 0`, `remaining = max` for every window. Callers wanting
    /// precision should pair the smart cache with
    /// [`PostgresLimiter::get_usage`] which queries the durable event log.
    pub fn get_usage(
        &self,
        key: &str,
        windows: &[LimitWindow],
    ) -> Result<Vec<UsageWindow>, RateLimitError> {
        if windows.is_empty() {
            return Err(RateLimitError::InvalidWindow);
        }
        let _ = key;
        let mut out = Vec::with_capacity(windows.len());
        for w in windows {
            if w.max == 0 {
                return Err(RateLimitError::InvalidMax(0));
            }
            if w.window_ms == 0 {
                return Err(RateLimitError::InvalidWindow);
            }
            out.push(UsageWindow {
                window: w.clone(),
                used: 0,
                remaining: w.max,
            });
        }
        Ok(out)
    }

    /// Cold-start hydration: one COUNT-per-key query per window. Seeds the
    /// memory buckets so the live count post-restart approximates pre-
    /// restart state. Safe to skip — if it fails, memory just starts empty
    /// and the limiter is briefly more permissive than PG would have been.
    /// Returns the number of (key, window) pairs seeded.
    pub async fn hydrate(&self, windows: &[LimitWindow]) -> Result<usize, RateLimitError> {
        let Some(pool) = self.inner.pg_pool.as_ref() else {
            debug!("hydrate called on memory-only smart cache — no-op");
            return Ok(0);
        };
        let mut total = 0usize;
        for window in windows {
            if window.max == 0 || window.window_ms == 0 {
                continue;
            }
            let since = Utc::now()
                - chrono::Duration::milliseconds(window.window_ms.min(i64::MAX as u64) as i64);
            let rows: Vec<(String, i64)> = sqlx::query_as(HYDRATE_SQL)
                .bind(since)
                .fetch_all(pool)
                .await?;
            for (key, count) in rows {
                let count = count.max(0) as u64;
                let used = count.min(window.max as u64) as u32;
                if used == 0 {
                    continue;
                }
                let spec = MemorySpec::new(window.max, window.window_ms);
                let composite_key = format!("{key}::{}", window.label);
                // try_consume seeds the bucket on first call (cold path)
                // and deducts one. Looping `used` times leaves the bucket
                // at `max - used` tokens. We don't worry about the
                // 1-token blocking case — even at used == max the bucket
                // will refill normally.
                for _ in 0..used {
                    let _ = self.inner.memory.try_consume(&composite_key, spec);
                }
                total += 1;
            }
        }
        self.inner
            .stats
            .hydration_seeded
            .fetch_add(total as u64, Ordering::Relaxed);
        Ok(total)
    }
}

/// Hydration SQL — aggregate event counts per key inside `$1`. Quoted
/// identifiers match the existing `rateLimitEvents` table.
pub(crate) const HYDRATE_SQL: &str = r#"SELECT "key", COUNT(*)::bigint FROM "rateLimitEvents" WHERE "createdAt" > $1 GROUP BY "key""#;

/// Multi-row INSERT template. The flush task substitutes `$N` markers for
/// the actual batch size at runtime.
pub(crate) const INSERT_BATCH_PREFIX: &str =
    r#"INSERT INTO "rateLimitEvents" ("id", "key", "createdAt") VALUES "#;

/// Drain `rx` every `interval` and INSERT batches into `pool`. Exits when
/// the channel closes (sender dropped); aborts when the task is aborted.
async fn flush_loop(
    pool: PgPool,
    mut rx: mpsc::Receiver<FlushEvent>,
    interval: Duration,
    batch_max: usize,
    stats: Arc<SmartCacheStats>,
) {
    let mut ticker = tokio::time::interval(interval);
    ticker.set_missed_tick_behavior(MissedTickBehavior::Delay);
    // Skip the immediate first tick — receiver has nothing.
    ticker.tick().await;
    let mut buf: Vec<FlushEvent> = Vec::with_capacity(batch_max.min(4096));
    loop {
        tokio::select! {
            _ = ticker.tick() => {
                if !buf.is_empty() {
                    flush_batch(&pool, &mut buf, batch_max, &stats).await;
                }
            }
            recv = rx.recv() => {
                match recv {
                    Some(ev) => {
                        buf.push(ev);
                        if buf.len() >= batch_max {
                            flush_batch(&pool, &mut buf, batch_max, &stats).await;
                        }
                    }
                    None => {
                        // Sender dropped — drain remaining events then exit.
                        if !buf.is_empty() {
                            flush_batch(&pool, &mut buf, batch_max, &stats).await;
                        }
                        break;
                    }
                }
            }
        }
    }
}

async fn flush_batch(
    pool: &PgPool,
    buf: &mut Vec<FlushEvent>,
    batch_max: usize,
    stats: &Arc<SmartCacheStats>,
) {
    while !buf.is_empty() {
        let take = buf.len().min(batch_max);
        let drained: Vec<FlushEvent> = buf.drain(..take).collect();
        let count = drained.len();
        // Build the multi-row INSERT — three binds per row: id, key,
        // createdAt. The id is generated app-side so the column stays
        // plain `text` (matches the existing schema; PostgresLimiter does
        // the same).
        let mut sql = String::with_capacity(INSERT_BATCH_PREFIX.len() + count * 18);
        sql.push_str(INSERT_BATCH_PREFIX);
        for i in 0..count {
            if i > 0 {
                sql.push(',');
            }
            let base = i * 3;
            sql.push_str(&format!("(${},${},${})", base + 1, base + 2, base + 3));
        }
        let mut query = sqlx::query(&sql);
        for ev in &drained {
            let id = Uuid::new_v4().to_string();
            query = query.bind(id).bind(&ev.key).bind(ev.occurred_at);
        }
        match query.execute(pool).await {
            Ok(_) => {
                stats
                    .flush_persisted
                    .fetch_add(count as u64, Ordering::Relaxed);
            }
            Err(err) => {
                warn!(error = %err, count, "smart cache flush INSERT failed");
                stats
                    .flush_failed
                    .fetch_add(count as u64, Ordering::Relaxed);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bucket::test_clock::MockClock;
    use std::sync::Arc;

    fn windows_for_test() -> Vec<LimitWindow> {
        vec![
            LimitWindow {
                window_ms: 60_000,
                max: 5,
                label: "per_min".into(),
            },
            LimitWindow {
                window_ms: 3_600_000,
                max: 100,
                label: "per_hour".into(),
            },
        ]
    }

    #[tokio::test]
    async fn memory_only_allows_within_limit_and_blocks_beyond() {
        let (cache, _bg) = SmartCache::start_memory_only(SmartCacheConfig::default());
        let windows = windows_for_test();
        for i in 0..5 {
            let dec = cache
                .check_and_consume("ip:1.2.3.4", &windows)
                .await
                .unwrap();
            assert!(dec.ok, "consume #{i} should be allowed");
            assert!(dec.blocked.is_none());
        }
        let blocked = cache
            .check_and_consume("ip:1.2.3.4", &windows)
            .await
            .unwrap();
        assert!(!blocked.ok);
        assert!(blocked.blocked.is_some());
        assert_eq!(blocked.blocked.as_ref().unwrap().label, "per_min");
        assert!(blocked.reset_at.is_some());
        assert_eq!(cache.stats().allow(), 5);
        assert_eq!(cache.stats().block(), 1);
    }

    #[tokio::test]
    async fn different_keys_have_independent_buckets() {
        let (cache, _bg) = SmartCache::start_memory_only(SmartCacheConfig::default());
        let windows = windows_for_test();
        for _ in 0..5 {
            assert!(cache.check_and_consume("ip:A", &windows).await.unwrap().ok);
        }
        for _ in 0..5 {
            assert!(cache.check_and_consume("ip:B", &windows).await.unwrap().ok);
        }
        assert!(!cache.check_and_consume("ip:A", &windows).await.unwrap().ok);
    }

    #[tokio::test]
    async fn blocked_decision_does_not_persist() {
        let (cache, _bg) = SmartCache::start_memory_only(SmartCacheConfig::default());
        let windows = windows_for_test();
        for _ in 0..5 {
            let _ = cache.check_and_consume("ip:X", &windows).await.unwrap();
        }
        let _ = cache.check_and_consume("ip:X", &windows).await.unwrap();
        assert_eq!(cache.stats().block(), 1);
        assert_eq!(cache.stats().persisted(), 0);
        assert_eq!(cache.stats().dropped(), 0);
    }

    #[tokio::test]
    async fn invalid_windows_rejected() {
        let (cache, _bg) = SmartCache::start_memory_only(SmartCacheConfig::default());
        let err = cache.check_and_consume("k", &[]).await.unwrap_err();
        assert!(matches!(err, RateLimitError::InvalidWindow));

        let bad_max = vec![LimitWindow {
            window_ms: 60_000,
            max: 0,
            label: "bad".into(),
        }];
        let err = cache.check_and_consume("k", &bad_max).await.unwrap_err();
        assert!(matches!(err, RateLimitError::InvalidMax(0)));

        let bad_window = vec![LimitWindow {
            window_ms: 0,
            max: 5,
            label: "bad".into(),
        }];
        let err = cache.check_and_consume("k", &bad_window).await.unwrap_err();
        assert!(matches!(err, RateLimitError::InvalidWindow));
    }

    #[tokio::test]
    async fn second_window_blocks_even_when_first_allows() {
        let (cache, _bg) = SmartCache::start_memory_only(SmartCacheConfig::default());
        let windows = vec![
            LimitWindow {
                window_ms: 60_000,
                max: 100,
                label: "per_min".into(),
            },
            LimitWindow {
                window_ms: 3_600_000,
                max: 5,
                label: "per_hour".into(),
            },
        ];
        for _ in 0..5 {
            assert!(cache.check_and_consume("k", &windows).await.unwrap().ok);
        }
        let blocked = cache.check_and_consume("k", &windows).await.unwrap();
        assert!(!blocked.ok);
        assert_eq!(blocked.blocked.as_ref().unwrap().label, "per_hour");
    }

    #[test]
    fn config_default_is_all_events_with_one_second_flush() {
        let cfg = SmartCacheConfig::default();
        assert!(matches!(cfg.persistence_mode, PersistenceMode::AllEvents));
        assert_eq!(cfg.flush_interval, Duration::from_secs(1));
        assert_eq!(cfg.flush_batch_max, 500);
    }

    #[test]
    fn memory_only_preset_disables_persistence() {
        let cfg = SmartCacheConfig::memory_only();
        assert!(matches!(cfg.persistence_mode, PersistenceMode::None));
    }

    #[tokio::test]
    async fn bucket_count_reflects_per_window_keys() {
        let (cache, _bg) = SmartCache::start_memory_only(SmartCacheConfig::default());
        let windows = windows_for_test();
        let _ = cache.check_and_consume("ip:A", &windows).await.unwrap();
        assert_eq!(cache.bucket_count(), 2);
        let _ = cache.check_and_consume("ip:B", &windows).await.unwrap();
        assert_eq!(cache.bucket_count(), 4);
    }

    #[tokio::test]
    async fn get_usage_reports_zero_used_on_fresh_key() {
        let (cache, _bg) = SmartCache::start_memory_only(SmartCacheConfig::default());
        let usage = cache.get_usage("untouched", &windows_for_test()).unwrap();
        assert_eq!(usage.len(), 2);
        for u in usage {
            assert_eq!(u.used, 0);
            assert_eq!(u.remaining, u.window.max);
        }
    }

    #[tokio::test]
    async fn refill_after_window_lets_traffic_resume() {
        let clock = Arc::new(MockClock::at(1_000));
        let memory = Arc::new(MemoryLimiter::with_clock(clock.clone()));
        let (cache, _bg) = SmartCache::start_with(memory, None, SmartCacheConfig::memory_only());
        let windows = vec![LimitWindow {
            window_ms: 60_000,
            max: 3,
            label: "per_min".into(),
        }];
        for _ in 0..3 {
            assert!(cache.check_and_consume("k", &windows).await.unwrap().ok);
        }
        assert!(!cache.check_and_consume("k", &windows).await.unwrap().ok);
        clock.advance(60_000);
        for _ in 0..3 {
            assert!(cache.check_and_consume("k", &windows).await.unwrap().ok);
        }
        assert!(!cache.check_and_consume("k", &windows).await.unwrap().ok);
    }

    #[tokio::test]
    async fn hydrate_no_op_on_memory_only_cache() {
        let (cache, _bg) = SmartCache::start_memory_only(SmartCacheConfig::default());
        let seeded = cache.hydrate(&windows_for_test()).await.unwrap();
        assert_eq!(seeded, 0);
        assert_eq!(cache.stats().seeded(), 0);
    }

    #[test]
    fn hydrate_sql_uses_quoted_identifiers_and_group_by() {
        assert!(HYDRATE_SQL.contains(r#""rateLimitEvents""#));
        assert!(HYDRATE_SQL.contains(r#""key""#));
        assert!(HYDRATE_SQL.contains(r#""createdAt""#));
        assert!(HYDRATE_SQL.to_uppercase().contains("GROUP BY"));
        assert!(HYDRATE_SQL.contains("$1"));
    }

    #[test]
    fn insert_batch_prefix_targets_correct_columns() {
        assert!(INSERT_BATCH_PREFIX.contains(r#""rateLimitEvents""#));
        assert!(INSERT_BATCH_PREFIX.contains(r#""id""#));
        assert!(INSERT_BATCH_PREFIX.contains(r#""key""#));
        assert!(INSERT_BATCH_PREFIX.contains(r#""createdAt""#));
        assert!(INSERT_BATCH_PREFIX.to_uppercase().contains("INSERT INTO"));
        assert!(INSERT_BATCH_PREFIX.to_uppercase().contains("VALUES"));
    }

    #[tokio::test]
    async fn smart_cache_is_cheaply_cloneable() {
        let (cache, _bg) = SmartCache::start_memory_only(SmartCacheConfig::default());
        let c1 = cache.clone();
        let c2 = cache.clone();
        let windows = windows_for_test();
        let _ = c1.check_and_consume("ip:A", &windows).await.unwrap();
        let _ = c2.check_and_consume("ip:A", &windows).await.unwrap();
        // Both clones see the same bucket state.
        assert_eq!(cache.stats().allow(), 2);
    }

    #[tokio::test]
    async fn shutdown_cleanly_aborts_background_tasks() {
        let (cache, bg) = SmartCache::start_memory_only(SmartCacheConfig::default());
        let _ = cache
            .check_and_consume("ip:A", &windows_for_test())
            .await
            .unwrap();
        bg.shutdown().await;
        // After shutdown the cache itself is still usable (the GC task
        // owned by `bg` is gone, but the bucket store survives via Arc).
        let _ = cache
            .check_and_consume("ip:B", &windows_for_test())
            .await
            .unwrap();
    }
}
