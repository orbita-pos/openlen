//! `ResolvesServerCert` implementation that knows three categories of host:
//!
//! 1. `*.openlen.com` + apex `openlen.com` — served by the wildcard cert that
//!    certbot keeps fresh on disk (and the file watcher in [`reload`] swaps
//!    when certbot rotates it).
//! 2. Custom domains we've already issued — looked up in an in-memory
//!    `DashMap` populated on startup (from [`store::load_all`]) and updated
//!    on successful ACME issuance / renewal.
//! 3. Custom domains we've never seen — when `acme_client` is `Some`,
//!    spawn an async issuance task gated by [`DomainLookup`]. The handshake
//!    fails immediately (returns `None`); the issuance runs in the
//!    background and the *next* connection benefits from the cached cert.
//!    Bailing fast is the whole point — we never block a handshake on a
//!    ~10 s ACME round trip.
//!
//! The resolver is shared across every handshake (rustls caches the
//! `Arc<ServerConfig>` it was built into), so all fields are `Arc`-cheap to
//! clone.
//!
//! [`reload`]: super::reload
//! [`store::load_all`]: super::store::load_all

use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use dashmap::DashMap;
use rustls::server::{ClientHello, ResolvesServerCert};
use rustls::sign::CertifiedKey;
use tracing::{debug, info, warn};

use crate::lookup::DomainLookup;
use crate::routing::{is_openlen_zone, looks_like_public_hostname};
use crate::tls::acme::AcmeIssuer;

/// Minimum seconds between issuance attempts for the same domain. Stops a
/// malicious / misconfigured client that keeps reconnecting under different
/// SNI from burning Let's Encrypt rate limits.
const MIN_ISSUANCE_RETRY_INTERVAL: Duration = Duration::from_secs(300);

/// Maximum simultaneous issuances in flight across all domains. Soft cap
/// inside the resolver; combined with the per-domain throttle it keeps a
/// boot-time storm from saturating tokio with stalled HTTP-01 sleeps.
const MAX_INFLIGHT_ISSUANCES: usize = 16;

#[derive(Clone)]
pub struct DynamicCertResolver {
    /// Wildcard slot — read on every handshake for `*.openlen.com` + apex.
    /// `RwLock` because the file watcher swaps it on certbot renewal; readers
    /// take the read side and never wait (writers are once-every-90-days).
    wildcard: Arc<RwLock<Arc<CertifiedKey>>>,
    /// Issued-already cache for custom domains. Populated on startup from
    /// disk, then mutated by the ACME issuance task + renewal sweep.
    custom: Arc<DashMap<String, Arc<CertifiedKey>>>,
    /// `None` disables on-demand issuance entirely. Tests that don't want
    /// to spawn issuance tasks (or production deployments that haven't
    /// finished registering an ACME account) leave this empty — the
    /// resolver then returns `None` for unknown hosts and the handshake
    /// fails cleanly.
    acme: Option<Arc<dyn AcmeIssuer>>,
    /// Gate for spawning ACME issuance — checked before we even reach
    /// out to the lookup. A `verifiedAt = NULL` row in Postgres comes back
    /// from `lookup` as `Ok(None)` and we *don't* attempt issuance.
    lookup: Arc<dyn DomainLookup>,
    /// Last-attempt timestamp per domain — gates the next issuance.
    last_attempt: Arc<DashMap<String, Instant>>,
    /// Currently-in-flight issuance set (per-domain). Acquired on spawn,
    /// released on completion.
    in_flight: Arc<DashMap<String, ()>>,
}

impl std::fmt::Debug for DynamicCertResolver {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DynamicCertResolver")
            .field("custom_count", &self.custom.len())
            .field("acme_enabled", &self.acme.is_some())
            .field("in_flight", &self.in_flight.len())
            .finish()
    }
}

impl DynamicCertResolver {
    pub fn new(
        wildcard: Arc<RwLock<Arc<CertifiedKey>>>,
        custom: Arc<DashMap<String, Arc<CertifiedKey>>>,
        acme: Option<Arc<dyn AcmeIssuer>>,
        lookup: Arc<dyn DomainLookup>,
    ) -> Self {
        Self {
            wildcard,
            custom,
            acme,
            lookup,
            last_attempt: Arc::new(DashMap::new()),
            in_flight: Arc::new(DashMap::new()),
        }
    }

    /// Accessor for tests + the renewal sweep — lets callers reach into the
    /// custom-cert map without taking the resolver apart.
    pub fn custom(&self) -> Arc<DashMap<String, Arc<CertifiedKey>>> {
        self.custom.clone()
    }

    /// Accessor for tests — observe whether issuance is enabled.
    pub fn acme_enabled(&self) -> bool {
        self.acme.is_some()
    }

    /// Decide whether we should spawn an issuance for `host` *right now*.
    /// Pulls in the per-domain throttle + global in-flight cap.
    fn allow_issuance(&self, host: &str) -> bool {
        if self.in_flight.len() >= MAX_INFLIGHT_ISSUANCES {
            debug!(host, count = self.in_flight.len(), "issuance cap reached");
            return false;
        }
        if let Some(last) = self.last_attempt.get(host) {
            if last.elapsed() < MIN_ISSUANCE_RETRY_INTERVAL {
                debug!(host, "issuance throttled");
                return false;
            }
        }
        true
    }

    fn record_attempt(&self, host: &str) {
        self.last_attempt.insert(host.to_owned(), Instant::now());
        self.in_flight.insert(host.to_owned(), ());
    }

    fn complete_attempt(&self, host: &str) {
        self.in_flight.remove(host);
    }
}

impl ResolvesServerCert for DynamicCertResolver {
    fn resolve(&self, hello: ClientHello) -> Option<Arc<CertifiedKey>> {
        // Step 1 — extract SNI. Without it we have nothing to route on; the
        // wildcard cert may still be useful (a TLS-1.2 client without SNI is
        // ancient but valid). Default to wildcard.
        let server_name = match hello.server_name() {
            Some(s) => s.to_ascii_lowercase(),
            None => {
                if let Ok(g) = self.wildcard.read() {
                    return Some(g.clone());
                }
                return None;
            }
        };

        // Step 2 — wildcard zone (apex + *.openlen.com).
        if is_openlen_zone(&server_name) {
            if let Ok(g) = self.wildcard.read() {
                return Some(g.clone());
            }
            return None;
        }

        // Step 3 — custom domain we've already issued.
        if let Some(cert) = self.custom.get(&server_name) {
            return Some(cert.clone());
        }

        // Step 4 — unknown host. If ACME is disabled, refuse the handshake.
        let Some(acme) = self.acme.clone() else {
            debug!(host = %server_name, "unknown SNI, ACME disabled — refusing");
            return None;
        };

        // Cheap pre-filter so a flood of garbage SNI ("localhost",
        // underscore hosts, IP literals) never reaches Postgres or ACME.
        if !looks_like_public_hostname(&server_name) {
            debug!(host = %server_name, "unknown SNI not a public hostname — refusing");
            return None;
        }

        if !self.allow_issuance(&server_name) {
            return None;
        }

        // Step 5 — spawn the async issuance. Returns `None` from the
        // resolver so the client retries; the cert lands in `custom` by
        // the time it does.
        let lookup = self.lookup.clone();
        let custom = self.custom.clone();
        let in_flight_guard = self.clone();
        let host = server_name;
        self.record_attempt(&host);
        tokio::spawn(async move {
            issuance_task(host.clone(), acme, lookup, custom).await;
            in_flight_guard.complete_attempt(&host);
        });
        None
    }
}

async fn issuance_task(
    host: String,
    acme: Arc<dyn AcmeIssuer>,
    lookup: Arc<dyn DomainLookup>,
    custom: Arc<DashMap<String, Arc<CertifiedKey>>>,
) {
    match lookup.lookup(&host).await {
        Ok(Some(sub)) => {
            debug!(%host, %sub, "ACME issuance: domain verified, starting");
        }
        Ok(None) => {
            debug!(%host, "ACME issuance: domain not verified — skipping");
            return;
        }
        Err(err) => {
            warn!(%host, error = %err, "ACME issuance: domain lookup failed — skipping");
            return;
        }
    };
    match acme.issue(&host).await {
        Ok(issued) => {
            let cert = issued.certified.clone();
            custom.insert(host.clone(), cert);
            info!(
                %host,
                expires_at = issued.expires_at,
                "ACME issuance complete"
            );
        }
        Err(err) => {
            warn!(%host, error = %err, "ACME issuance failed");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lookup::MockDomainLookup;

    fn wildcard_slot() -> Arc<RwLock<Arc<CertifiedKey>>> {
        let (cert_pem, key_pem) = crate::tls::store::tests::test_self_signed("openlen.com");
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::write(tmp.path().join("cert.pem"), &cert_pem).unwrap();
        std::fs::write(tmp.path().join("key.pem"), &key_pem).unwrap();
        let certified = crate::tls::store::load_certified_key_from_dir(tmp.path()).unwrap();
        Arc::new(RwLock::new(Arc::new(certified)))
    }

    fn custom_cert(domain: &str) -> Arc<CertifiedKey> {
        let (cert_pem, key_pem) = crate::tls::store::tests::test_self_signed(domain);
        let tmp = tempfile::TempDir::new().unwrap();
        std::fs::write(tmp.path().join("cert.pem"), &cert_pem).unwrap();
        std::fs::write(tmp.path().join("key.pem"), &key_pem).unwrap();
        Arc::new(crate::tls::store::load_certified_key_from_dir(tmp.path()).unwrap())
    }

    /// Tiny helper: invoke `resolve` with a synthetic ClientHello. We can't
    /// build `ClientHello` directly in user code, so these tests exercise
    /// the routing logic by calling internal helpers. (Full
    /// `ResolvesServerCert::resolve` paths are exercised end-to-end in
    /// `tests/acme.rs`.)
    fn dummy_resolver(
        custom_map: Arc<DashMap<String, Arc<CertifiedKey>>>,
        acme: Option<Arc<dyn AcmeIssuer>>,
        lookup: Arc<dyn DomainLookup>,
    ) -> DynamicCertResolver {
        DynamicCertResolver::new(wildcard_slot(), custom_map, acme, lookup)
    }

    #[test]
    fn is_openlen_zone_routes_to_wildcard_via_helper() {
        // is_openlen_zone (proxied from routing module) returns true for
        // anything inside the openlen.com zone — the wildcard cert covers
        // *.openlen.com (any depth in the SAN list); nested subdomains
        // still 404 at the routing layer but the resolver hands out the
        // wildcard cert without spawning ACME.
        assert!(is_openlen_zone("openlen.com"));
        assert!(is_openlen_zone("demo.openlen.com"));
        assert!(is_openlen_zone("a.b.openlen.com"));
        assert!(!is_openlen_zone("mybrand.com"));
        assert!(!is_openlen_zone("openlen.com.evil.com"));
    }

    #[test]
    fn custom_map_lookup_is_case_insensitive_on_normalised_input() {
        let custom: Arc<DashMap<String, Arc<CertifiedKey>>> = Arc::new(DashMap::new());
        custom.insert("mybrand.com".into(), custom_cert("mybrand.com"));
        // Resolver lowercases SNI before lookup. The test directly probes
        // the map after normalisation — proves the map is the
        // case-canonical layer.
        assert!(custom.get(&"MyBrand.COM".to_ascii_lowercase()).is_some());
        assert!(custom.get("mybrand.com").is_some());
        assert!(custom.get("mybrand.com.").is_none());
    }

    #[test]
    fn resolver_reports_acme_disabled_when_none() {
        let custom: Arc<DashMap<String, Arc<CertifiedKey>>> = Arc::new(DashMap::new());
        let lookup: Arc<dyn DomainLookup> = Arc::new(MockDomainLookup::new());
        let resolver = dummy_resolver(custom, None, lookup);
        assert!(!resolver.acme_enabled());
        assert!(resolver.custom().is_empty());
    }

    #[test]
    fn allow_issuance_throttles_repeat_calls_for_same_host() {
        let custom: Arc<DashMap<String, Arc<CertifiedKey>>> = Arc::new(DashMap::new());
        let lookup: Arc<dyn DomainLookup> = Arc::new(MockDomainLookup::new());
        let resolver = dummy_resolver(custom, None, lookup);
        assert!(resolver.allow_issuance("a.com"));
        resolver.record_attempt("a.com");
        assert!(
            !resolver.allow_issuance("a.com"),
            "same host within 5min should be throttled"
        );
        assert!(
            resolver.allow_issuance("b.com"),
            "different host should pass"
        );
    }

    #[test]
    fn allow_issuance_blocks_when_global_cap_hit() {
        let custom: Arc<DashMap<String, Arc<CertifiedKey>>> = Arc::new(DashMap::new());
        let lookup: Arc<dyn DomainLookup> = Arc::new(MockDomainLookup::new());
        let resolver = dummy_resolver(custom, None, lookup);
        for i in 0..MAX_INFLIGHT_ISSUANCES {
            resolver.in_flight.insert(format!("d{i}.com"), ());
        }
        assert!(!resolver.allow_issuance("new.com"));
    }

    #[test]
    fn complete_attempt_removes_from_inflight() {
        let custom: Arc<DashMap<String, Arc<CertifiedKey>>> = Arc::new(DashMap::new());
        let lookup: Arc<dyn DomainLookup> = Arc::new(MockDomainLookup::new());
        let resolver = dummy_resolver(custom, None, lookup);
        resolver.record_attempt("a.com");
        assert!(resolver.in_flight.contains_key("a.com"));
        resolver.complete_attempt("a.com");
        assert!(!resolver.in_flight.contains_key("a.com"));
    }

    #[test]
    fn looks_like_public_hostname_filters_garbage_before_lookup() {
        // The resolver short-circuits these without spawning issuance.
        assert!(!looks_like_public_hostname("localhost"));
        assert!(!looks_like_public_hostname("bad_underscore.com"));
        assert!(!looks_like_public_hostname("192.168.1.1"));
        // Real hostnames pass.
        assert!(looks_like_public_hostname("mybrand.com"));
        assert!(looks_like_public_hostname("blog.example.org"));
    }

    #[test]
    fn debug_format_includes_custom_count() {
        let custom: Arc<DashMap<String, Arc<CertifiedKey>>> = Arc::new(DashMap::new());
        custom.insert("a.com".into(), custom_cert("a.com"));
        custom.insert("b.com".into(), custom_cert("b.com"));
        let lookup: Arc<dyn DomainLookup> = Arc::new(MockDomainLookup::new());
        let resolver = dummy_resolver(custom, None, lookup);
        let s = format!("{resolver:?}");
        assert!(s.contains("custom_count: 2"), "{s}");
        assert!(s.contains("acme_enabled: false"));
    }

    #[test]
    fn clone_share_underlying_state_via_arc() {
        let custom: Arc<DashMap<String, Arc<CertifiedKey>>> = Arc::new(DashMap::new());
        let lookup: Arc<dyn DomainLookup> = Arc::new(MockDomainLookup::new());
        let r1 = dummy_resolver(custom.clone(), None, lookup);
        let r2 = r1.clone();
        r1.record_attempt("a.com");
        assert!(r2.in_flight.contains_key("a.com"));
    }

    /// Sanity: tokio-spawned issuance must not panic when the lookup
    /// returns `Ok(None)`. We use a counter the mock increments to verify
    /// the lookup *was* called, then assert no cert lands in `custom`.
    #[tokio::test]
    async fn issuance_task_skips_when_lookup_says_unverified() {
        let custom: Arc<DashMap<String, Arc<CertifiedKey>>> = Arc::new(DashMap::new());
        let mock = Arc::new(MockDomainLookup::new());
        let lookup: Arc<dyn DomainLookup> = mock.clone();
        // No issuance attempt — but we exercise the lookup-fail branch.
        // The acme arg only matters when lookup says Ok(Some(_)), so we
        // pass a dummy that's never called.
        let calls_before = mock.calls();
        let host = String::from("unverified.com");
        let acme: Arc<dyn AcmeIssuer> = Arc::new(crate::tls::acme::mock::MockAcmeIssuer::new());
        issuance_task(host.clone(), acme, lookup, custom.clone()).await;
        assert!(mock.calls() > calls_before, "lookup must have been called");
        assert!(custom.is_empty(), "no cert should land when unverified");
    }

    /// Sanity: when lookup errors, issuance_task surfaces the error path
    /// (logs + skips) without spawning ACME issuance.
    #[tokio::test]
    async fn issuance_task_skips_when_lookup_errors() {
        let custom: Arc<DashMap<String, Arc<CertifiedKey>>> = Arc::new(DashMap::new());
        let mock = Arc::new(MockDomainLookup::new());
        mock.set_error_mode(true).await;
        let lookup: Arc<dyn DomainLookup> = mock.clone();
        let acme: Arc<dyn AcmeIssuer> = Arc::new(crate::tls::acme::mock::MockAcmeIssuer::new());
        issuance_task("err.com".into(), acme, lookup, custom.clone()).await;
        assert!(custom.is_empty(), "no cert when lookup errored");
    }
}
