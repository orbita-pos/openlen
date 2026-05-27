//! Request coalescing. The first caller for a key (`do_or_wait`) executes the
//! supplied future; all concurrent callers for the same key wait for that
//! future to publish its result, then receive a clone of it.
//!
//! Built on top of [`tokio::sync::OnceCell`] so the "leader runs init, others
//! wait" semantics come for free. The wrapper layer adds:
//!
//! - per-key sharing via an `Arc<OnceCell>` slot in a `HashMap`,
//! - eager map cleanup once the leader publishes (so a *subsequent* call for
//!   the same key starts a fresh in-flight session — important because the
//!   cache layer above us has its own TTL semantics).
//!
//! There are existing crates that do this (`async_singleflight`,
//! `singleflight-async`) but the impl here is ~60 LOC and lets us avoid
//! pulling another transitive dep + audit on the request hot path.

use std::collections::HashMap;
use std::future::Future;
use std::hash::Hash;
use std::sync::{Arc, Mutex};

use tokio::sync::OnceCell;

#[derive(Debug)]
pub struct SingleFlight<K, V> {
    inner: Mutex<HashMap<K, Arc<OnceCell<V>>>>,
}

impl<K, V> Default for SingleFlight<K, V> {
    fn default() -> Self {
        Self {
            inner: Mutex::new(HashMap::new()),
        }
    }
}

impl<K, V> SingleFlight<K, V>
where
    K: Eq + Hash + Clone,
    V: Clone,
{
    pub fn new() -> Self {
        Self::default()
    }

    /// Run `f` for `key` if nobody else is, or wait for the in-flight leader
    /// to publish and return a clone of its result.
    ///
    /// The result is `V: Clone` rather than `&V` so followers don't have to
    /// hold a borrow of the underlying `OnceCell` past their await point.
    pub async fn do_or_wait<F, Fut>(&self, key: K, f: F) -> V
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = V>,
    {
        let cell = {
            let mut map = self.inner.lock().expect("singleflight map poisoned");
            map.entry(key.clone())
                .or_insert_with(|| Arc::new(OnceCell::new()))
                .clone()
        };

        let value_ref = cell.get_or_init(|| async { f().await }).await;
        let value = value_ref.clone();

        // Eagerly free the map entry. Anyone still holding `cell` via a clone
        // captured before this point completes via the `get_or_init` above —
        // the map removal cannot starve them. A fresh call for the same key
        // *after* this point starts a new in-flight session.
        {
            let mut map = self.inner.lock().expect("singleflight map poisoned");
            if let Some(existing) = map.get(&key) {
                if Arc::ptr_eq(existing, &cell) {
                    map.remove(&key);
                }
            }
        }

        value
    }

    /// Number of in-flight entries, for test introspection.
    pub fn inflight_len(&self) -> usize {
        self.inner.lock().expect("singleflight map poisoned").len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::time::Duration;

    #[tokio::test]
    async fn solo_caller_runs_f_once() {
        let sf = SingleFlight::<String, u32>::new();
        let calls = Arc::new(AtomicUsize::new(0));
        let calls_ref = calls.clone();
        let v = sf
            .do_or_wait("k".into(), || async move {
                calls_ref.fetch_add(1, Ordering::SeqCst);
                42
            })
            .await;
        assert_eq!(v, 42);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(sf.inflight_len(), 0);
    }

    #[tokio::test]
    async fn concurrent_callers_share_one_execution() {
        let sf = Arc::new(SingleFlight::<String, u32>::new());
        let calls = Arc::new(AtomicUsize::new(0));

        let mut handles = Vec::with_capacity(64);
        for _ in 0..64 {
            let sf = sf.clone();
            let calls = calls.clone();
            handles.push(tokio::spawn(async move {
                sf.do_or_wait("shared".into(), move || async move {
                    calls.fetch_add(1, Ordering::SeqCst);
                    tokio::time::sleep(Duration::from_millis(20)).await;
                    7u32
                })
                .await
            }));
        }
        for h in handles {
            assert_eq!(h.await.unwrap(), 7);
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(sf.inflight_len(), 0);
    }

    #[tokio::test]
    async fn different_keys_run_independently() {
        let sf = Arc::new(SingleFlight::<String, u32>::new());
        let calls = Arc::new(AtomicUsize::new(0));

        let sf1 = sf.clone();
        let calls1 = calls.clone();
        let sf2 = sf.clone();
        let calls2 = calls.clone();

        let h1 = tokio::spawn(async move {
            sf1.do_or_wait("a".into(), move || async move {
                calls1.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(15)).await;
                1u32
            })
            .await
        });
        let h2 = tokio::spawn(async move {
            sf2.do_or_wait("b".into(), move || async move {
                calls2.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(15)).await;
                2u32
            })
            .await
        });
        assert_eq!(h1.await.unwrap(), 1);
        assert_eq!(h2.await.unwrap(), 2);
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn sequential_calls_run_f_each_time() {
        let sf = SingleFlight::<String, u32>::new();
        let calls = Arc::new(AtomicUsize::new(0));

        for expect in 1..=3 {
            let calls = calls.clone();
            let v = sf
                .do_or_wait("k".into(), move || async move {
                    let n = calls.fetch_add(1, Ordering::SeqCst) + 1;
                    n as u32
                })
                .await;
            assert_eq!(v, expect);
        }
        assert_eq!(calls.load(Ordering::SeqCst), 3);
    }

    #[tokio::test]
    async fn map_is_empty_after_inflight_completes() {
        let sf = Arc::new(SingleFlight::<String, u32>::new());
        let mut handles = vec![];
        for i in 0..10 {
            let sf = sf.clone();
            handles.push(tokio::spawn(async move {
                sf.do_or_wait(format!("k{i}"), move || async move {
                    tokio::time::sleep(Duration::from_millis(5)).await;
                    i
                })
                .await
            }));
        }
        for h in handles {
            let _ = h.await.unwrap();
        }
        assert_eq!(sf.inflight_len(), 0, "map should be empty after all done");
    }
}
