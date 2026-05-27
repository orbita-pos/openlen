//! Custom-domain lookup. Resolves a hostname like `mybrand.com` to the
//! subdomain whose published HTML should answer the request.
//!
//! The production stack is layered:
//!
//! ```text
//!   request → LayeredLookup ─→ Cache (moka, TTL'd, per-entry positive/negative)
//!                             │
//!                             └→ SingleFlight (coalesce N concurrent lookups)
//!                                  │
//!                                  └→ PostgresDomainLookup (sqlx Pool → Neon)
//! ```
//!
//! All three layers implement the [`DomainLookup`] trait, so tests can swap in
//! [`MockDomainLookup`] (in-memory HashMap) for the Postgres bottom layer.
//!
//! Errors degrade gracefully: a DB failure surfaces as an
//! [`LookupError`] which the caller (server) maps to 404. Errors are NOT
//! cached, so a transient Postgres blip doesn't lock out a legitimate
//! verified domain for the full TTL.

pub mod cache;
pub mod internal_api;
pub mod postgres;
pub mod singleflight;

pub use cache::{CachedEntry, DomainCache};
pub use internal_api::{run_internal_api, serve_internal_api, InternalApiState};
pub use postgres::PostgresDomainLookup;
pub use singleflight::SingleFlight;

use anyhow::{Context, Result};

use crate::config::EdgeConfig;

/// Build the production lookup stack from configuration.
///
/// - If `cfg.database_url` is set, connect via [`PostgresDomainLookup`]
///   (failure aborts startup — the edge should not silently fall back to a
///   "no custom domains exist" state in production).
/// - Otherwise, an empty [`MockDomainLookup`] backs the chain (dev / tests).
///
/// In both cases the base lookup is wrapped in [`LayeredLookup`] which adds
/// caching + singleflight coalescing on top.
pub async fn build_lookup_from_config(cfg: &EdgeConfig) -> Result<std::sync::Arc<LayeredLookup>> {
    let base: std::sync::Arc<dyn DomainLookup> = match &cfg.database_url {
        Some(url) if !url.is_empty() => {
            let pg = PostgresDomainLookup::connect(url, cfg.db_pool_max)
                .await
                .context("postgres domain lookup connect")?;
            std::sync::Arc::new(pg)
        }
        _ => std::sync::Arc::new(MockDomainLookup::new()),
    };
    let layered = LayeredLookup::new(
        base,
        cfg.domain_cache_max,
        Duration::from_secs(cfg.domain_cache_ttl_secs),
        Duration::from_secs(cfg.domain_negative_ttl_secs),
    );
    Ok(std::sync::Arc::new(layered))
}

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use tokio::sync::Mutex;
use tracing::{debug, warn};

/// Errors surfaced from the lookup layer. Cloneable so the singleflight can
/// share a single error across all followers that joined the same in-flight
/// query.
#[derive(Debug, Clone, thiserror::Error)]
pub enum LookupError {
    #[error("postgres error: {0}")]
    Postgres(String),
}

/// Outcome of a single lookup call. `Ok(Some(sub))` is a verified custom
/// domain pointing at `sub`. `Ok(None)` is a definitive "no verified custom
/// domain for this host" — safe to cache. `Err(_)` is a transient failure —
/// should NOT be cached.
pub type LookupResult = Result<Option<String>, LookupError>;

/// Resolves a host to a published subdomain. Pluggable so production can use
/// Postgres while tests use [`MockDomainLookup`].
///
/// Implementations MUST be cheap to call concurrently — the layered facade
/// already handles request coalescing.
#[async_trait]
pub trait DomainLookup: Send + Sync + std::fmt::Debug {
    async fn lookup(&self, host: &str) -> LookupResult;
}

/// In-memory lookup for tests + dev. Tracks call count for assertions about
/// cache-hit and singleflight-coalescing behavior.
#[derive(Debug, Default, Clone)]
pub struct MockDomainLookup {
    data: Arc<Mutex<HashMap<String, String>>>,
    calls: Arc<AtomicUsize>,
    delay_ms: Arc<Mutex<u64>>,
    error_mode: Arc<Mutex<bool>>,
}

impl MockDomainLookup {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_entries<I, A, B>(entries: I) -> Self
    where
        I: IntoIterator<Item = (A, B)>,
        A: Into<String>,
        B: Into<String>,
    {
        let mock = Self::new();
        let mut map = mock
            .data
            .try_lock()
            .expect("uncontended lock at construction");
        for (k, v) in entries {
            map.insert(k.into().to_ascii_lowercase(), v.into());
        }
        drop(map);
        mock
    }

    pub async fn insert(&self, host: &str, sub: &str) {
        let mut g = self.data.lock().await;
        g.insert(host.to_ascii_lowercase(), sub.into());
    }

    pub async fn remove(&self, host: &str) {
        let mut g = self.data.lock().await;
        g.remove(&host.to_ascii_lowercase());
    }

    pub fn calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }

    pub fn reset_calls(&self) {
        self.calls.store(0, Ordering::SeqCst);
    }

    pub async fn set_delay_ms(&self, ms: u64) {
        *self.delay_ms.lock().await = ms;
    }

    pub async fn set_error_mode(&self, on: bool) {
        *self.error_mode.lock().await = on;
    }
}

#[async_trait]
impl DomainLookup for MockDomainLookup {
    async fn lookup(&self, host: &str) -> LookupResult {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let ms = *self.delay_ms.lock().await;
        if ms > 0 {
            tokio::time::sleep(Duration::from_millis(ms)).await;
        }
        if *self.error_mode.lock().await {
            return Err(LookupError::Postgres("mock error mode".into()));
        }
        let map = self.data.lock().await;
        Ok(map.get(&host.to_ascii_lowercase()).cloned())
    }
}

/// Wraps a base [`DomainLookup`] with two layers:
///
/// 1. [`SingleFlight`] coalesces N concurrent identical lookups → 1 base call.
/// 2. [`DomainCache`] caches positive AND negative results with per-entry TTL.
///
/// Stale-while-revalidate: on a cache hit older than `ttl/2`, fire-and-forget
/// a background refresh task. The current request returns the cached value
/// immediately — no added latency.
pub struct LayeredLookup {
    base: Arc<dyn DomainLookup>,
    cache: DomainCache,
    flight: SingleFlight<String, LookupResult>,
}

impl std::fmt::Debug for LayeredLookup {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LayeredLookup")
            .field("base", &self.base)
            .field("cache_entries", &self.cache.entry_count())
            .finish()
    }
}

impl LayeredLookup {
    pub fn new(
        base: Arc<dyn DomainLookup>,
        cache_max: u64,
        positive_ttl: Duration,
        negative_ttl: Duration,
    ) -> Self {
        Self {
            base,
            cache: DomainCache::new(cache_max, positive_ttl, negative_ttl),
            flight: SingleFlight::new(),
        }
    }

    pub fn cache(&self) -> &DomainCache {
        &self.cache
    }

    pub fn flight(&self) -> &SingleFlight<String, LookupResult> {
        &self.flight
    }

    /// Force-evict a key. Useful for tests + a future invalidation endpoint.
    pub async fn invalidate(&self, host: &str) {
        self.cache.invalidate(&host.to_ascii_lowercase()).await;
    }
}

#[async_trait]
impl DomainLookup for LayeredLookup {
    async fn lookup(&self, host: &str) -> LookupResult {
        let key = host.to_ascii_lowercase();

        if let Some(entry) = self.cache.get(&key).await {
            if self.cache.is_stale(&entry) {
                let base = self.base.clone();
                let cache = self.cache.clone();
                let key2 = key.clone();
                tokio::spawn(async move {
                    match base.lookup(&key2).await {
                        Ok(v) => cache.insert(key2, v).await,
                        Err(err) => {
                            warn!(host = %key2, error = %err, "background revalidation failed")
                        }
                    }
                });
            }
            return Ok(entry.value.clone());
        }

        let base = self.base.clone();
        let key_for_flight = key.clone();
        let result = self
            .flight
            .do_or_wait(key.clone(), move || async move {
                base.lookup(&key_for_flight).await
            })
            .await;

        match &result {
            Ok(v) => self.cache.insert(key, v.clone()).await,
            Err(err) => debug!(host = %key, error = %err, "lookup error not cached"),
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn mock_returns_known_host() {
        let m = MockDomainLookup::with_entries([("mybrand.com", "mybrand")]);
        assert_eq!(
            m.lookup("mybrand.com").await.unwrap().as_deref(),
            Some("mybrand")
        );
        assert_eq!(m.calls(), 1);
    }

    #[tokio::test]
    async fn mock_returns_none_for_unknown() {
        let m = MockDomainLookup::new();
        assert_eq!(m.lookup("unknown.com").await.unwrap(), None);
        assert_eq!(m.calls(), 1);
    }

    #[tokio::test]
    async fn mock_normalizes_host_case() {
        let m = MockDomainLookup::with_entries([("MyBrand.COM", "mybrand")]);
        assert_eq!(
            m.lookup("MYBRAND.com").await.unwrap().as_deref(),
            Some("mybrand")
        );
    }

    #[tokio::test]
    async fn mock_error_mode_surfaces_error() {
        let m = MockDomainLookup::with_entries([("mybrand.com", "mybrand")]);
        m.set_error_mode(true).await;
        let r = m.lookup("mybrand.com").await;
        assert!(matches!(r, Err(LookupError::Postgres(_))));
    }

    #[tokio::test]
    async fn layered_caches_hits() {
        let base = Arc::new(MockDomainLookup::with_entries([("mybrand.com", "mybrand")]));
        let layered = LayeredLookup::new(
            base.clone(),
            1000,
            Duration::from_secs(60),
            Duration::from_secs(60),
        );

        let r1 = layered.lookup("mybrand.com").await.unwrap();
        let r2 = layered.lookup("mybrand.com").await.unwrap();
        assert_eq!(r1.as_deref(), Some("mybrand"));
        assert_eq!(r2.as_deref(), Some("mybrand"));
        assert_eq!(base.calls(), 1, "second call should hit cache");
    }

    #[tokio::test]
    async fn layered_caches_misses() {
        let base = Arc::new(MockDomainLookup::new());
        let layered = LayeredLookup::new(
            base.clone(),
            1000,
            Duration::from_secs(60),
            Duration::from_secs(60),
        );
        let r1 = layered.lookup("ghost.com").await.unwrap();
        let r2 = layered.lookup("ghost.com").await.unwrap();
        assert_eq!(r1, None);
        assert_eq!(r2, None);
        assert_eq!(base.calls(), 1, "negative cache should suppress 2nd call");
    }

    #[tokio::test]
    async fn layered_errors_are_not_cached() {
        let base = Arc::new(MockDomainLookup::new());
        base.set_error_mode(true).await;
        let layered = LayeredLookup::new(
            base.clone(),
            1000,
            Duration::from_secs(60),
            Duration::from_secs(60),
        );
        let _ = layered.lookup("foo.com").await;
        let _ = layered.lookup("foo.com").await;
        assert_eq!(base.calls(), 2, "errors must not be cached");
    }

    #[tokio::test]
    async fn invalidate_evicts_cached_entry() {
        let base = Arc::new(MockDomainLookup::with_entries([("mybrand.com", "mybrand")]));
        let layered = LayeredLookup::new(
            base.clone(),
            1000,
            Duration::from_secs(60),
            Duration::from_secs(60),
        );
        let _ = layered.lookup("mybrand.com").await;
        layered.invalidate("mybrand.com").await;
        let _ = layered.lookup("mybrand.com").await;
        assert_eq!(base.calls(), 2);
    }

    #[tokio::test]
    async fn singleflight_coalesces_concurrent_requests() {
        let base = Arc::new(MockDomainLookup::with_entries([("mybrand.com", "mybrand")]));
        base.set_delay_ms(40).await;
        let layered = Arc::new(LayeredLookup::new(
            base.clone(),
            1000,
            Duration::from_secs(60),
            Duration::from_secs(60),
        ));

        let mut handles = Vec::with_capacity(200);
        for _ in 0..200 {
            let l = layered.clone();
            handles.push(tokio::spawn(async move { l.lookup("mybrand.com").await }));
        }
        let mut hits = 0;
        for h in handles {
            let r = h.await.unwrap().unwrap();
            if r.as_deref() == Some("mybrand") {
                hits += 1;
            }
        }
        assert_eq!(hits, 200, "every follower must observe the hit");
        assert_eq!(base.calls(), 1, "singleflight must coalesce to 1 base call");
    }
}
