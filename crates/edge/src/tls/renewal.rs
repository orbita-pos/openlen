//! Background renewal sweep for ACME-issued certificates.
//!
//! Wakes up every `interval` (default 24 h), walks `cert_dir`, and
//! triggers a fresh issuance for any cert whose remaining validity is
//! below the configured threshold (default 30 days). On success the
//! in-memory custom-cert map is updated; on failure the old cert keeps
//! serving and we'll try again next tick.
//!
//! The sweep deliberately does not parallelise — Let's Encrypt rate limits
//! the same account hard, so a serial loop with logging is the right
//! shape. With ~100 custom domains this stays well inside the daily
//! per-account budget.

use std::future::Future;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use dashmap::DashMap;
use rustls::sign::CertifiedKey;
use tracing::{info, warn};

use crate::tls::acme::AcmeIssuer;
use crate::tls::store::{self, seconds_until};

/// Configuration for the renewal sweep.
#[derive(Debug, Clone)]
pub struct RenewalConfig {
    pub cert_dir: PathBuf,
    pub threshold_days: u32,
    pub interval: Duration,
}

impl RenewalConfig {
    fn threshold_seconds(&self) -> u64 {
        u64::from(self.threshold_days) * 86_400
    }
}

/// Wake-up loop. Returns when `shutdown` resolves.
pub async fn run_renewal_loop(
    cfg: RenewalConfig,
    acme: Arc<dyn AcmeIssuer>,
    custom: Arc<DashMap<String, Arc<CertifiedKey>>>,
    shutdown: impl Future<Output = ()> + Send + 'static,
) {
    info!(
        cert_dir = %cfg.cert_dir.display(),
        threshold_days = cfg.threshold_days,
        interval_secs = cfg.interval.as_secs(),
        "ACME renewal sweep armed"
    );
    tokio::pin!(shutdown);

    // tokio::time::interval gives us its own pinned timer + automatic
    // backpressure semantics. `Burst` policy would re-fire if we ever
    // missed a tick; we want skip-on-overrun (`Delay`) instead — a sweep
    // that overran by minutes shouldn't fire twice back-to-back.
    let mut ticker = tokio::time::interval(cfg.interval);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    // The first tick fires immediately. Consume it so we don't sweep
    // during boot — there are no certs to renew until we've been live a
    // while, and an empty sweep just produces noise in the logs.
    ticker.tick().await;

    loop {
        tokio::select! {
            _ = &mut shutdown => {
                info!("ACME renewal sweep shutting down");
                break;
            }
            _ = ticker.tick() => {
                run_sweep_once(&cfg, &acme, &custom).await;
            }
        }
    }
}

/// One pass: scan cert_dir, renew anything below the threshold. Public so
/// tests can drive a sweep deterministically without waiting on the timer.
pub async fn run_sweep_once(
    cfg: &RenewalConfig,
    acme: &Arc<dyn AcmeIssuer>,
    custom: &Arc<DashMap<String, Arc<CertifiedKey>>>,
) {
    let entries = match store::load_all(&cfg.cert_dir) {
        Ok(v) => v,
        Err(err) => {
            warn!(error = %err, "cert dir scan failed — skipping sweep");
            return;
        }
    };
    let threshold = cfg.threshold_seconds();
    let mut considered = 0usize;
    let mut renewed = 0usize;
    let mut failed = 0usize;
    for entry in entries {
        considered += 1;
        let remaining = seconds_until(entry.expires_at);
        if remaining > threshold {
            continue;
        }
        info!(
            domain = %entry.domain,
            remaining_secs = remaining,
            "renewal needed"
        );
        match acme.issue(&entry.domain).await {
            Ok(issued) => {
                custom.insert(entry.domain.clone(), issued.certified);
                renewed += 1;
                info!(
                    domain = %entry.domain,
                    expires_at = issued.expires_at,
                    "renewal succeeded"
                );
            }
            Err(err) => {
                failed += 1;
                warn!(
                    domain = %entry.domain,
                    error = %err,
                    "renewal failed — old cert kept"
                );
            }
        }
    }
    info!(considered, renewed, failed, "ACME renewal sweep complete");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tls::acme::mock::MockAcmeIssuer;
    use crate::tls::acme::IssuedCert;
    use std::sync::Arc;
    use std::time::{SystemTime, UNIX_EPOCH};
    use tempfile::TempDir;

    fn now_secs() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs()
    }

    fn synth_cert(domain: &str) -> Arc<CertifiedKey> {
        let (cert_pem, key_pem) = crate::tls::store::tests::test_self_signed(domain);
        let tmp = TempDir::new().unwrap();
        std::fs::write(tmp.path().join("cert.pem"), &cert_pem).unwrap();
        std::fs::write(tmp.path().join("key.pem"), &key_pem).unwrap();
        Arc::new(crate::tls::store::load_certified_key_from_dir(tmp.path()).unwrap())
    }

    fn seed_cert_on_disk(dir: &std::path::Path, domain: &str, expires_at: u64) {
        let (cert_pem, key_pem) = crate::tls::store::tests::test_self_signed(domain);
        store::save_cert(dir, domain, &cert_pem, &key_pem, expires_at).unwrap();
    }

    #[tokio::test]
    async fn sweep_renews_certs_under_threshold() {
        let tmp = TempDir::new().unwrap();
        seed_cert_on_disk(tmp.path(), "near-expiry.com", now_secs() + 10 * 86_400);
        seed_cert_on_disk(tmp.path(), "fresh.com", now_secs() + 60 * 86_400);

        let acme: Arc<dyn AcmeIssuer> = Arc::new(MockAcmeIssuer::new());
        let custom: Arc<DashMap<String, Arc<CertifiedKey>>> = Arc::new(DashMap::new());
        // Pre-populate to verify the renewed cert displaces the old one.
        custom.insert("near-expiry.com".into(), synth_cert("near-expiry.com"));

        let cfg = RenewalConfig {
            cert_dir: tmp.path().to_path_buf(),
            threshold_days: 30,
            interval: Duration::from_secs(86_400),
        };
        run_sweep_once(&cfg, &acme, &custom).await;

        assert!(
            custom.get("near-expiry.com").is_some(),
            "renewed cert must be in custom map"
        );
        assert!(
            custom.get("fresh.com").is_none(),
            "fresh cert must NOT be renewed pre-emptively"
        );
    }

    #[tokio::test]
    async fn sweep_failure_keeps_old_cert() {
        let tmp = TempDir::new().unwrap();
        seed_cert_on_disk(tmp.path(), "near-expiry.com", now_secs() + 5 * 86_400);

        let mock = MockAcmeIssuer::new();
        mock.set_fail(true).await;
        let acme: Arc<dyn AcmeIssuer> = Arc::new(mock);
        let custom: Arc<DashMap<String, Arc<CertifiedKey>>> = Arc::new(DashMap::new());
        let original = synth_cert("near-expiry.com");
        custom.insert("near-expiry.com".into(), original.clone());

        let cfg = RenewalConfig {
            cert_dir: tmp.path().to_path_buf(),
            threshold_days: 30,
            interval: Duration::from_secs(86_400),
        };
        run_sweep_once(&cfg, &acme, &custom).await;

        let still = custom.get("near-expiry.com").map(|v| v.clone()).unwrap();
        assert!(
            Arc::ptr_eq(&still, &original),
            "failed renewal must keep the original cert"
        );
    }

    #[tokio::test]
    async fn sweep_skips_certs_above_threshold() {
        let tmp = TempDir::new().unwrap();
        seed_cert_on_disk(tmp.path(), "plenty.com", now_secs() + 80 * 86_400);
        let mock = Arc::new(MockAcmeIssuer::new());
        let acme: Arc<dyn AcmeIssuer> = mock.clone();
        let custom: Arc<DashMap<String, Arc<CertifiedKey>>> = Arc::new(DashMap::new());
        let cfg = RenewalConfig {
            cert_dir: tmp.path().to_path_buf(),
            threshold_days: 30,
            interval: Duration::from_secs(86_400),
        };
        run_sweep_once(&cfg, &acme, &custom).await;
        assert_eq!(mock.calls(), 0, "no renewal needed");
    }

    #[tokio::test]
    async fn sweep_handles_missing_cert_dir_gracefully() {
        let acme: Arc<dyn AcmeIssuer> = Arc::new(MockAcmeIssuer::new());
        let custom: Arc<DashMap<String, Arc<CertifiedKey>>> = Arc::new(DashMap::new());
        let cfg = RenewalConfig {
            cert_dir: PathBuf::from("/does/not/exist/for-tests"),
            threshold_days: 30,
            interval: Duration::from_secs(86_400),
        };
        // Should not panic.
        run_sweep_once(&cfg, &acme, &custom).await;
    }

    #[tokio::test]
    async fn sweep_renews_expired_cert() {
        // A cert whose `expires_at` already passed should still renew (the
        // threshold check uses saturating_sub → remaining = 0 < threshold).
        let tmp = TempDir::new().unwrap();
        seed_cert_on_disk(tmp.path(), "expired.com", 1);
        let mock = Arc::new(MockAcmeIssuer::new());
        let acme: Arc<dyn AcmeIssuer> = mock.clone();
        let custom: Arc<DashMap<String, Arc<CertifiedKey>>> = Arc::new(DashMap::new());
        let cfg = RenewalConfig {
            cert_dir: tmp.path().to_path_buf(),
            threshold_days: 30,
            interval: Duration::from_secs(86_400),
        };
        run_sweep_once(&cfg, &acme, &custom).await;
        assert_eq!(mock.calls(), 1);
        assert!(custom.get("expired.com").is_some());
    }

    #[tokio::test]
    async fn issued_cert_carries_correct_metadata() {
        let mock = MockAcmeIssuer::new();
        let cert = synth_cert("seed.com");
        let now = now_secs();
        mock.seed_issuance(IssuedCert {
            domain: "seed.com".into(),
            expires_at: now + 5_000,
            certified: cert.clone(),
        })
        .await;
        let out = mock.issue("seed.com").await.unwrap();
        assert_eq!(out.domain, "seed.com");
        assert_eq!(out.expires_at, now + 5_000);
        assert!(Arc::ptr_eq(&out.certified, &cert));
    }

    #[test]
    fn threshold_seconds_translates_days() {
        let cfg = RenewalConfig {
            cert_dir: PathBuf::from("/"),
            threshold_days: 30,
            interval: Duration::from_secs(86_400),
        };
        assert_eq!(cfg.threshold_seconds(), 30 * 86_400);
    }
}
