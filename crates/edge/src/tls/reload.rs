//! Hot-reload of the wildcard certificate.
//!
//! Certbot rotates `/etc/letsencrypt/live/openlen.com/{fullchain,privkey}.pem`
//! roughly every 60 days. Before this module existed, the edge kept serving
//! the old cert until restart — fine in practice but a sharp edge on
//! deploy hooks. With the file watcher in place, the new cert is picked up
//! on the next handshake; existing in-flight connections continue under
//! the old `ServerConfig`'s session state until they close.
//!
//! Implementation notes:
//!
//! - `notify` v8 emits modify/create/remove events. We don't care which —
//!   any event on the watched files triggers a reload attempt.
//! - Events are debounced (200 ms) because certbot writes via tempfile +
//!   rename, which produces multiple events in close succession.
//! - A malformed swap (cert and key out of sync, expired chain, etc.) is
//!   logged and ignored. The old cert keeps serving.
//! - We watch the *parent directory* (not the files directly) so the
//!   rename pattern certbot uses is observable.

use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use notify::{recommended_watcher, Event, EventKind, RecursiveMode, Watcher};
use rustls::sign::CertifiedKey;
use tokio::sync::mpsc;
use tracing::{debug, info, warn};

use crate::tls::store::{build_certified_key, load_pem_certs, load_pem_key};

const DEBOUNCE: Duration = Duration::from_millis(200);

/// Read `cert_path` + `key_path` and return a fresh [`CertifiedKey`].
pub fn read_cert_pair(cert_path: &Path, key_path: &Path) -> Result<CertifiedKey> {
    let certs = load_pem_certs(cert_path)?;
    let key = load_pem_key(key_path)?;
    build_certified_key(certs, key)
}

/// Watch `cert_path` + `key_path` and swap `slot` whenever either file
/// changes. Returns when `shutdown` resolves and the file watcher is
/// dropped.
pub async fn watch_wildcard(
    cert_path: PathBuf,
    key_path: PathBuf,
    slot: Arc<RwLock<Arc<CertifiedKey>>>,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> Result<()> {
    let cert_parent = cert_path
        .parent()
        .ok_or_else(|| anyhow!("cert path has no parent: {}", cert_path.display()))?
        .to_path_buf();
    let key_parent = key_path
        .parent()
        .ok_or_else(|| anyhow!("key path has no parent: {}", key_path.display()))?
        .to_path_buf();

    let (tx, mut rx) = mpsc::channel::<()>(8);

    let cert_filename = cert_path.file_name().map(|s| s.to_os_string());
    let key_filename = key_path.file_name().map(|s| s.to_os_string());

    let event_tx = tx.clone();
    let mut watcher = recommended_watcher(move |res: notify::Result<Event>| match res {
        Ok(event) => {
            if !is_data_event(&event.kind) {
                return;
            }
            let matches = event.paths.iter().any(|p| {
                let name = p.file_name();
                (cert_filename.is_some() && name == cert_filename.as_deref())
                    || (key_filename.is_some() && name == key_filename.as_deref())
            });
            if matches {
                let _ = event_tx.try_send(());
            }
        }
        Err(err) => warn!(error = %err, "wildcard watcher error event"),
    })
    .context("notify::recommended_watcher")?;

    watcher
        .watch(&cert_parent, RecursiveMode::NonRecursive)
        .with_context(|| format!("watching {}", cert_parent.display()))?;
    if key_parent != cert_parent {
        watcher
            .watch(&key_parent, RecursiveMode::NonRecursive)
            .with_context(|| format!("watching {}", key_parent.display()))?;
    }
    info!(
        cert_parent = %cert_parent.display(),
        key_parent = %key_parent.display(),
        "wildcard cert watcher armed"
    );

    tokio::pin!(shutdown);

    loop {
        tokio::select! {
            _ = &mut shutdown => {
                info!("wildcard cert watcher shutting down");
                break;
            }
            recv = rx.recv() => {
                if recv.is_none() {
                    debug!("wildcard cert watcher channel closed");
                    break;
                }
                // Debounce: drain any further events that landed in the
                // window. The first signal already fired so we know the
                // file moved; the drain just consolidates rename + write
                // pairs into a single reload.
                tokio::time::sleep(DEBOUNCE).await;
                while rx.try_recv().is_ok() {}
                match read_cert_pair(&cert_path, &key_path) {
                    Ok(new) => {
                        if let Ok(mut guard) = slot.write() {
                            *guard = Arc::new(new);
                            info!(
                                cert = %cert_path.display(),
                                "wildcard cert hot-reloaded"
                            );
                        } else {
                            warn!("wildcard cert slot rwlock poisoned");
                        }
                    }
                    Err(err) => warn!(
                        cert = %cert_path.display(),
                        key = %key_path.display(),
                        error = %err,
                        "wildcard cert reload failed — keeping previous cert"
                    ),
                }
            }
        }
    }

    drop(watcher);
    Ok(())
}

fn is_data_event(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use tempfile::TempDir;
    use tokio::sync::oneshot;
    use tokio::time::timeout;

    fn write_pair(dir: &Path, cn: &str) -> (PathBuf, PathBuf) {
        let (cert_pem, key_pem) = crate::tls::store::tests::test_self_signed(cn);
        let cert_path = dir.join("fullchain.pem");
        let key_path = dir.join("privkey.pem");
        std::fs::write(&cert_path, cert_pem).unwrap();
        std::fs::write(&key_path, key_pem).unwrap();
        (cert_path, key_path)
    }

    #[tokio::test]
    async fn read_cert_pair_round_trip() {
        let tmp = TempDir::new().unwrap();
        let (c, k) = write_pair(tmp.path(), "rt.com");
        let key = read_cert_pair(&c, &k).expect("read");
        assert!(!key.cert.is_empty());
    }

    #[tokio::test]
    async fn read_cert_pair_returns_error_on_missing_cert() {
        let res = read_cert_pair(
            Path::new("/nonexistent/cert.pem"),
            Path::new("/nonexistent/key.pem"),
        );
        assert!(res.is_err());
    }

    /// File-watcher integration: write fresh PEM, observe `slot` swapped.
    /// Times out at 5 seconds so a slow CI host doesn't hang the suite.
    #[tokio::test]
    async fn watcher_swaps_slot_on_file_replace() {
        let tmp = TempDir::new().unwrap();
        let (cert_path, key_path) = write_pair(tmp.path(), "old.com");
        let initial = Arc::new(read_cert_pair(&cert_path, &key_path).unwrap());
        let slot: Arc<RwLock<Arc<CertifiedKey>>> = Arc::new(RwLock::new(initial.clone()));

        let (tx, rx) = oneshot::channel::<()>();
        let slot_for_task = slot.clone();
        let c2 = cert_path.clone();
        let k2 = key_path.clone();
        let handle = tokio::spawn(async move {
            let _ = watch_wildcard(c2, k2, slot_for_task, async move {
                let _ = rx.await;
            })
            .await;
        });

        // Let the watcher arm.
        tokio::time::sleep(Duration::from_millis(150)).await;

        // Generate a brand-new pair (different keypair than `initial`).
        let (cert_pem_b, key_pem_b) = crate::tls::store::tests::test_self_signed("new.com");
        // Write atomically: rename a tempfile in place to mimic certbot.
        let tmp_cert = tmp.path().join(".fullchain.tmp");
        let tmp_key = tmp.path().join(".privkey.tmp");
        std::fs::write(&tmp_cert, &cert_pem_b).unwrap();
        std::fs::write(&tmp_key, &key_pem_b).unwrap();
        std::fs::rename(&tmp_cert, &cert_path).unwrap();
        std::fs::rename(&tmp_key, &key_path).unwrap();

        // Poll for the swap. Generous timeout — watcher latency is OS-dependent.
        let outcome = timeout(Duration::from_secs(5), async {
            loop {
                tokio::time::sleep(Duration::from_millis(100)).await;
                let g = slot.read().unwrap().clone();
                if !Arc::ptr_eq(&g, &initial) {
                    return;
                }
            }
        })
        .await;
        assert!(outcome.is_ok(), "slot was never swapped");

        let _ = tx.send(());
        let _ = handle.await;
    }

    #[tokio::test]
    async fn watcher_keeps_old_cert_when_new_pair_is_malformed() {
        let tmp = TempDir::new().unwrap();
        let (cert_path, key_path) = write_pair(tmp.path(), "stable.com");
        let initial = Arc::new(read_cert_pair(&cert_path, &key_path).unwrap());
        let slot: Arc<RwLock<Arc<CertifiedKey>>> = Arc::new(RwLock::new(initial.clone()));

        let (tx, rx) = oneshot::channel::<()>();
        let slot_for_task = slot.clone();
        let c2 = cert_path.clone();
        let k2 = key_path.clone();
        let handle = tokio::spawn(async move {
            let _ = watch_wildcard(c2, k2, slot_for_task, async move {
                let _ = rx.await;
            })
            .await;
        });

        tokio::time::sleep(Duration::from_millis(150)).await;

        // Overwrite with garbage — the reload must keep the old cert.
        std::fs::write(&cert_path, "not a cert").unwrap();
        std::fs::write(&key_path, "not a key").unwrap();

        // Wait past the debounce window + a buffer for the watcher to fire.
        tokio::time::sleep(Duration::from_millis(800)).await;

        let g = slot.read().unwrap().clone();
        assert!(
            Arc::ptr_eq(&g, &initial),
            "slot must remain the original cert when the swap was malformed"
        );

        let _ = tx.send(());
        let _ = handle.await;
    }

    #[test]
    fn is_data_event_classifies_correctly() {
        assert!(is_data_event(&EventKind::Modify(
            notify::event::ModifyKind::Any
        )));
        assert!(is_data_event(&EventKind::Create(
            notify::event::CreateKind::Any
        )));
        assert!(is_data_event(&EventKind::Remove(
            notify::event::RemoveKind::Any
        )));
        assert!(!is_data_event(&EventKind::Access(
            notify::event::AccessKind::Read
        )));
        assert!(!is_data_event(&EventKind::Other));
    }
}
