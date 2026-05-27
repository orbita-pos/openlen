//! Moka-backed LRU cache for domain → subdomain mappings.
//!
//! Positive entries (`Some(sub)`) and negative entries (`None`) get
//! independent TTLs via the [`Expiry`] trait — negative TTL can be shorter so
//! a domain that gets verified mid-cache-window doesn't take a full minute to
//! propagate, but the value should still be long enough to absorb a hostile
//! query for a non-existent domain.
//!
//! Stale-while-revalidate: callers check [`is_stale`](DomainCache::is_stale)
//! on the entry and spawn a background refresh when an entry crosses TTL/2.
//! This keeps p95 lookup at ~0 ms during the second half of the entry's life,
//! without ever blocking the request on a refresh round-trip.

use std::sync::Arc;
use std::time::{Duration, Instant};

use moka::future::Cache;
use moka::Expiry;

#[derive(Debug, Clone)]
pub struct CachedEntry {
    /// `Some(sub)` = verified custom domain → subdomain. `None` = no verified
    /// custom domain for this host (cached negative).
    pub value: Option<String>,
    /// When the entry was inserted, for stale-while-revalidate.
    pub inserted_at: Instant,
}

#[derive(Debug, Clone)]
pub struct DomainCache {
    inner: Cache<String, Arc<CachedEntry>>,
    positive_ttl: Duration,
    negative_ttl: Duration,
}

#[derive(Debug, Clone)]
struct DomainExpiry {
    positive_ttl: Duration,
    negative_ttl: Duration,
}

impl DomainExpiry {
    fn ttl_for(&self, v: &CachedEntry) -> Duration {
        if v.value.is_some() {
            self.positive_ttl
        } else {
            self.negative_ttl
        }
    }
}

impl Expiry<String, Arc<CachedEntry>> for DomainExpiry {
    fn expire_after_create(
        &self,
        _key: &String,
        value: &Arc<CachedEntry>,
        _created_at: Instant,
    ) -> Option<Duration> {
        Some(self.ttl_for(value))
    }

    fn expire_after_update(
        &self,
        _key: &String,
        value: &Arc<CachedEntry>,
        _updated_at: Instant,
        _duration_until_expiry: Option<Duration>,
    ) -> Option<Duration> {
        Some(self.ttl_for(value))
    }
}

impl DomainCache {
    pub fn new(max_capacity: u64, positive_ttl: Duration, negative_ttl: Duration) -> Self {
        let expiry = DomainExpiry {
            positive_ttl,
            negative_ttl,
        };
        let inner = Cache::builder()
            .max_capacity(max_capacity)
            .expire_after(expiry)
            .build();
        Self {
            inner,
            positive_ttl,
            negative_ttl,
        }
    }

    pub async fn get(&self, key: &str) -> Option<Arc<CachedEntry>> {
        self.inner.get(key).await
    }

    pub async fn insert(&self, key: String, value: Option<String>) {
        let entry = Arc::new(CachedEntry {
            value,
            inserted_at: Instant::now(),
        });
        self.inner.insert(key, entry).await;
    }

    pub async fn invalidate(&self, key: &str) {
        self.inner.invalidate(key).await;
    }

    pub async fn invalidate_all(&self) {
        self.inner.invalidate_all();
        self.inner.run_pending_tasks().await;
    }

    pub fn entry_count(&self) -> u64 {
        self.inner.entry_count()
    }

    /// True if the entry has crossed half of its (positive or negative) TTL —
    /// the caller can fire a background refresh while returning this entry.
    pub fn is_stale(&self, entry: &CachedEntry) -> bool {
        let ttl = if entry.value.is_some() {
            self.positive_ttl
        } else {
            self.negative_ttl
        };
        entry.inserted_at.elapsed() > ttl / 2
    }

    pub fn positive_ttl(&self) -> Duration {
        self.positive_ttl
    }

    pub fn negative_ttl(&self) -> Duration {
        self.negative_ttl
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn insert_then_get_returns_value() {
        let c = DomainCache::new(100, Duration::from_secs(60), Duration::from_secs(60));
        c.insert("k".into(), Some("sub".into())).await;
        let e = c.get("k").await.unwrap();
        assert_eq!(e.value.as_deref(), Some("sub"));
    }

    #[tokio::test]
    async fn negative_entries_are_cached() {
        let c = DomainCache::new(100, Duration::from_secs(60), Duration::from_secs(60));
        c.insert("ghost".into(), None).await;
        let e = c.get("ghost").await.unwrap();
        assert_eq!(e.value, None);
    }

    #[tokio::test]
    async fn invalidate_removes_entry() {
        let c = DomainCache::new(100, Duration::from_secs(60), Duration::from_secs(60));
        c.insert("k".into(), Some("sub".into())).await;
        c.invalidate("k").await;
        assert!(c.get("k").await.is_none());
    }

    #[tokio::test]
    async fn positive_ttl_expires_entry() {
        let c = DomainCache::new(100, Duration::from_millis(40), Duration::from_secs(60));
        c.insert("k".into(), Some("sub".into())).await;
        assert!(c.get("k").await.is_some());
        tokio::time::sleep(Duration::from_millis(80)).await;
        c.inner.run_pending_tasks().await;
        assert!(c.get("k").await.is_none(), "positive entry must expire");
    }

    #[tokio::test]
    async fn negative_ttl_can_differ_from_positive() {
        let c = DomainCache::new(100, Duration::from_secs(60), Duration::from_millis(40));
        c.insert("ghost".into(), None).await;
        assert!(c.get("ghost").await.is_some());
        tokio::time::sleep(Duration::from_millis(80)).await;
        c.inner.run_pending_tasks().await;
        assert!(c.get("ghost").await.is_none());
    }

    #[tokio::test]
    async fn is_stale_after_half_ttl() {
        let c = DomainCache::new(100, Duration::from_millis(100), Duration::from_millis(100));
        c.insert("k".into(), Some("sub".into())).await;
        let e = c.get("k").await.unwrap();
        assert!(!c.is_stale(&e), "fresh entry should not be stale");
        tokio::time::sleep(Duration::from_millis(70)).await;
        let e = c.get("k").await.unwrap();
        assert!(c.is_stale(&e), "entry past TTL/2 should be stale");
    }

    #[tokio::test]
    async fn invalidate_all_clears_cache() {
        let c = DomainCache::new(100, Duration::from_secs(60), Duration::from_secs(60));
        c.insert("a".into(), Some("x".into())).await;
        c.insert("b".into(), Some("y".into())).await;
        c.invalidate_all().await;
        assert!(c.get("a").await.is_none());
        assert!(c.get("b").await.is_none());
    }
}
