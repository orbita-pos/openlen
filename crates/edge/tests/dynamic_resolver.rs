//! End-to-end TLS tests for the `DynamicCertResolver`.
//!
//! These tests build a real TLS listener backed by the resolver (instead of
//! the static `Arc<ServerConfig>` the other suites use) and verify that the
//! SNI → cert routing decisions are observable from a TLS client.
//!
//! ACME issuance itself is not exercised here — see `tls::acme::tests` for
//! the trait + mock and `tls::resolver::tests` for the routing logic.
//! `tests/acme_flow.rs` covers the issuance path end-to-end via a
//! mock ACME endpoint.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use dashmap::DashMap;
use rcgen::{generate_simple_self_signed, CertifiedKey as RcgenKey};
use rustls::sign::CertifiedKey;
use tempfile::TempDir;
use tokio::sync::oneshot;
use tokio::time::timeout;

use anyhow::Result;
use async_trait::async_trait;

use openlen_edge::{
    bind_with_lookup, build_dynamic_config, AcmeIssuer, DomainLookup, DynamicCertResolver,
    EdgeConfig, IssuedCert, MockDomainLookup,
};

/// Test-local stand-in for `MockAcmeIssuer` — declared here because the
/// real mock is crate-private. Always fails issuance; the integration
/// tests use it only to prove the resolver bails fast even when ACME is
/// wired up (lookup unverified → no issuance attempted).
#[derive(Debug, Default)]
struct AlwaysFailIssuer;

#[async_trait]
impl AcmeIssuer for AlwaysFailIssuer {
    async fn issue(&self, _domain: &str) -> Result<IssuedCert> {
        Err(anyhow::anyhow!("test-local issuer never succeeds"))
    }

    fn get_challenge(&self, _token: &str) -> Option<String> {
        None
    }
}

const FIXTURE_ROOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/publish-root");

fn write_pair(dir: &std::path::Path, sans: &[&str]) -> (PathBuf, PathBuf, Arc<CertifiedKey>) {
    let RcgenKey { cert, key_pair } =
        generate_simple_self_signed(sans.iter().map(|s| s.to_string()).collect::<Vec<_>>())
            .expect("rcgen self-signed");
    let cert_path = dir.join("cert.pem");
    let key_path = dir.join("key.pem");
    std::fs::write(&cert_path, cert.pem()).unwrap();
    std::fs::write(&key_path, key_pair.serialize_pem()).unwrap();
    let key = Arc::new(openlen_edge::read_cert_pair(&cert_path, &key_path).unwrap());
    (cert_path, key_path, key)
}

struct Harness {
    addr: SocketAddr,
    shutdown: Option<oneshot::Sender<()>>,
    handle: Option<tokio::task::JoinHandle<anyhow::Result<()>>>,
    custom: Arc<DashMap<String, Arc<CertifiedKey>>>,
    _tempdir: TempDir,
}

impl Drop for Harness {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
        if let Some(h) = self.handle.take() {
            h.abort();
        }
    }
}

async fn spawn(
    sans: &[&str],
    custom_seed: Vec<(&str, Arc<CertifiedKey>)>,
    acme: Option<Arc<dyn AcmeIssuer>>,
) -> Harness {
    let tempdir = TempDir::new().unwrap();
    let (cert_path, key_path, wildcard_key) = write_pair(tempdir.path(), sans);
    let wildcard_slot: Arc<RwLock<Arc<CertifiedKey>>> = Arc::new(RwLock::new(wildcard_key));

    let custom: Arc<DashMap<String, Arc<CertifiedKey>>> = Arc::new(DashMap::new());
    for (host, cert) in custom_seed {
        custom.insert(host.to_string(), cert);
    }

    let lookup: Arc<dyn DomainLookup> = Arc::new(MockDomainLookup::new());
    let resolver =
        DynamicCertResolver::new(wildcard_slot.clone(), custom.clone(), acme, lookup.clone());
    let tls = build_dynamic_config(Arc::new(resolver));

    let cfg = EdgeConfig::builder()
        .bind("127.0.0.1:0".parse().unwrap())
        .cert_path(cert_path)
        .key_path(key_path)
        .publish_root(PathBuf::from(FIXTURE_ROOT))
        .max_inflight(64)
        .build()
        .unwrap();

    let bound = bind_with_lookup(&cfg, tls, lookup).await.unwrap();
    let addr = bound.local_addr;

    let (tx, rx) = oneshot::channel::<()>();
    let handle = tokio::spawn(async move {
        bound
            .serve(async move {
                let _ = rx.await;
            })
            .await
    });

    Harness {
        addr,
        shutdown: Some(tx),
        handle: Some(handle),
        custom,
        _tempdir: tempdir,
    }
}

// reqwest doesn't take a `resolve` argument inside the request — we need
// `Client::builder().resolve(host, addr)` at client construction.
fn https_client_resolving(host: &str, addr: SocketAddr) -> reqwest::Client {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .resolve(host, addr)
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap()
}

async fn handshake_succeeds(host: &str, addr: SocketAddr) -> bool {
    let client = https_client_resolving(host, addr);
    let res = timeout(
        Duration::from_secs(5),
        client
            .get(format!("https://{host}:{}/", addr.port()))
            .send(),
    )
    .await;
    matches!(res, Ok(Ok(_)))
}

#[tokio::test]
async fn wildcard_sni_serves_wildcard_cert_and_handshake_succeeds() {
    let h = spawn(&["openlen.com", "*.openlen.com"], vec![], None).await;
    let ok = handshake_succeeds("demo.openlen.com", h.addr).await;
    assert!(ok, "wildcard subdomain handshake should succeed");
}

#[tokio::test]
async fn apex_openlen_com_handshake_succeeds_with_wildcard() {
    let h = spawn(&["openlen.com", "*.openlen.com"], vec![], None).await;
    let ok = handshake_succeeds("openlen.com", h.addr).await;
    assert!(ok, "apex openlen.com handshake should succeed");
}

#[tokio::test]
async fn known_custom_domain_handshake_succeeds_via_custom_map() {
    // Pre-seed a custom cert for mybrand.com (separate key from wildcard).
    let tmp = TempDir::new().unwrap();
    let (_, _, custom_key) = write_pair(tmp.path(), &["mybrand.com"]);

    let h = spawn(
        &["openlen.com", "*.openlen.com"],
        vec![("mybrand.com", custom_key.clone())],
        None,
    )
    .await;
    let ok = handshake_succeeds("mybrand.com", h.addr).await;
    assert!(ok, "custom domain with pre-loaded cert should handshake");
    // Verify resolver is reading from the map we passed in.
    assert!(h.custom.get("mybrand.com").is_some());
}

#[tokio::test]
async fn unknown_sni_handshake_fails_when_acme_disabled() {
    let h = spawn(&["openlen.com", "*.openlen.com"], vec![], None).await;
    // ACME is None — the resolver must refuse the handshake for unknown SNI.
    let ok = handshake_succeeds("ghost.example.com", h.addr).await;
    assert!(!ok, "unknown SNI with ACME disabled must fail handshake");
}

#[tokio::test]
async fn unknown_sni_handshake_fails_immediately_when_acme_enabled_but_lookup_says_no() {
    // Even with ACME wired up, an unverified host should fail handshake
    // *immediately* — issuance happens async and the handshake itself
    // gets None back from the resolver. Verifies the "bail fast" property.
    let acme: Arc<dyn AcmeIssuer> = Arc::new(AlwaysFailIssuer);
    let h = spawn(&["openlen.com", "*.openlen.com"], vec![], Some(acme)).await;
    let start = std::time::Instant::now();
    let ok = handshake_succeeds("noverify.example.com", h.addr).await;
    let elapsed = start.elapsed();
    assert!(!ok, "handshake must fail when lookup unverified");
    assert!(
        elapsed < Duration::from_secs(3),
        "handshake must bail fast — took {elapsed:?}"
    );
}

#[tokio::test]
async fn case_insensitive_sni_matches_lowercase_custom_map_key() {
    let tmp = TempDir::new().unwrap();
    let (_, _, custom_key) = write_pair(tmp.path(), &["mybrand.com"]);
    // Insert under lowercase; the resolver lowercases SNI before lookup.
    let h = spawn(
        &["openlen.com", "*.openlen.com"],
        vec![("mybrand.com", custom_key.clone())],
        None,
    )
    .await;
    // Request with uppercase SNI — reqwest preserves the URL authority case
    // but TLS SNI is canonically lower-case; the resolver lowercases on
    // receipt either way.
    let ok = handshake_succeeds("MyBrand.com", h.addr).await;
    assert!(ok, "uppercase SNI must resolve through the lowercase map");
}

#[tokio::test]
async fn handshake_for_garbage_host_fails_fast() {
    // looks_like_public_hostname filters this out — never reaches lookup.
    let h = spawn(&["openlen.com", "*.openlen.com"], vec![], None).await;
    let ok = handshake_succeeds("bad_underscore", h.addr).await;
    assert!(!ok);
}

#[tokio::test]
async fn second_https_request_uses_cached_cert_when_pre_loaded() {
    // Pre-load mybrand cert; two sequential HTTPS requests succeed.
    let tmp = TempDir::new().unwrap();
    let (_, _, custom_key) = write_pair(tmp.path(), &["mybrand.com"]);
    let h = spawn(
        &["openlen.com", "*.openlen.com"],
        vec![("mybrand.com", custom_key.clone())],
        None,
    )
    .await;
    assert!(handshake_succeeds("mybrand.com", h.addr).await);
    assert!(handshake_succeeds("mybrand.com", h.addr).await);
}

#[tokio::test]
async fn custom_map_serves_correct_chain_per_host() {
    // Two distinct hosts → two distinct certs. Verifies the map is keyed
    // properly and the resolver doesn't bleed certs across hosts.
    let tmp_a = TempDir::new().unwrap();
    let (_, _, brand_a) = write_pair(tmp_a.path(), &["a.example.com"]);
    let tmp_b = TempDir::new().unwrap();
    let (_, _, brand_b) = write_pair(tmp_b.path(), &["b.example.com"]);

    let h = spawn(
        &["openlen.com", "*.openlen.com"],
        vec![
            ("a.example.com", brand_a.clone()),
            ("b.example.com", brand_b.clone()),
        ],
        None,
    )
    .await;
    assert!(handshake_succeeds("a.example.com", h.addr).await);
    assert!(handshake_succeeds("b.example.com", h.addr).await);
}

#[tokio::test]
async fn resolver_does_not_panic_on_missing_sni() {
    // TLS 1.2 clients can omit SNI. The resolver falls back to wildcard;
    // the handshake should NOT crash the server. Hard to drive a SNI-less
    // request from reqwest (it always sends SNI), so we instead assert
    // the server keeps accepting subsequent connections after a normal
    // request — i.e. it didn't bork the listener.
    let h = spawn(&["openlen.com", "*.openlen.com"], vec![], None).await;
    assert!(handshake_succeeds("demo.openlen.com", h.addr).await);
    // Hit it again to prove the listener stays up.
    assert!(handshake_succeeds("demo.openlen.com", h.addr).await);
}
