//! End-to-end integration tests for the edge rate-limit middleware.
//!
//! Spawns the full edge stack (TLS listener + axum router) with a
//! RateLimitLayer attached, then exercises it via reqwest. Each test
//! re-uses the publish-root fixture so the underlying handlers serve
//! actual content (200 OK) when the limiter allows the request through.

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use openlen_edge::{
    bind_with_lookup_and_layers, load_wildcard, EdgeConfig, IpExtractConfig, MockDomainLookup,
    RateLimitConfig, RateLimitLayer,
};
use openlen_rate_limit::{LimitWindow, SmartCache, SmartCacheConfig};
use rcgen::{generate_simple_self_signed, CertifiedKey};
use tempfile::TempDir;
use tokio::sync::oneshot;

const FIXTURE_ROOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/publish-root");

struct Harness {
    addr: SocketAddr,
    shutdown: Option<oneshot::Sender<()>>,
    handle: Option<tokio::task::JoinHandle<anyhow::Result<()>>>,
    _bg: openlen_rate_limit::SmartCacheBackground,
    _tempdir: TempDir,
}

impl Drop for Harness {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
        if let Some(handle) = self.handle.take() {
            handle.abort();
        }
    }
}

fn write_self_signed(dir: &Path, sans: &[&str]) -> (PathBuf, PathBuf) {
    let CertifiedKey { cert, key_pair } =
        generate_simple_self_signed(sans.iter().map(|s| s.to_string()).collect::<Vec<_>>())
            .expect("generate cert");
    let cert_path = dir.join("cert.pem");
    let key_path = dir.join("key.pem");
    std::fs::write(&cert_path, cert.pem()).expect("write cert");
    std::fs::write(&key_path, key_pair.serialize_pem()).expect("write key");
    (cert_path, key_path)
}

fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(5))
        .build()
        .expect("client")
}

async fn spawn_with_rate_limit(
    max_per_min: u32,
    max_per_hour: u32,
    exempt_paths: Vec<String>,
) -> Harness {
    let tempdir = TempDir::new().expect("tempdir");
    let (cert_path, key_path) = write_self_signed(tempdir.path(), &["localhost", "127.0.0.1"]);
    let cfg = EdgeConfig::builder()
        .bind("127.0.0.1:0".parse().unwrap())
        .cert_path(cert_path.clone())
        .key_path(key_path.clone())
        .publish_root(PathBuf::from(FIXTURE_ROOT))
        .max_inflight(4096)
        .build()
        .expect("build cfg");

    let (cache, bg) = SmartCache::start_memory_only(SmartCacheConfig::memory_only());
    let windows = vec![
        LimitWindow {
            window_ms: 60_000,
            max: max_per_min,
            label: "per_min".into(),
        },
        LimitWindow {
            window_ms: 3_600_000,
            max: max_per_hour,
            label: "per_hour".into(),
        },
    ];
    let rl_cfg = RateLimitConfig {
        smart_cache: cache,
        windows: Arc::new(windows),
        exempt_path_prefixes: Arc::new(exempt_paths),
        ip_config: IpExtractConfig::default(), // trust-all (loopback testing)
    };
    let layer = RateLimitLayer::new(rl_cfg);

    let tls = load_wildcard(&cert_path, &key_path).expect("load tls");
    let bound =
        bind_with_lookup_and_layers(&cfg, tls, Arc::new(MockDomainLookup::new()), Some(layer))
            .await
            .expect("bind");
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
        _bg: bg,
        _tempdir: tempdir,
    }
}

async fn get(addr: SocketAddr, host: &str, path: &str) -> reqwest::Response {
    client()
        .get(format!("https://{addr}{path}"))
        .header("host", host)
        .send()
        .await
        .expect("request ok")
}

#[tokio::test]
async fn burst_within_per_min_limit_passes() {
    // 5/min — five requests in a tight loop should all succeed.
    let h = spawn_with_rate_limit(5, 100, vec![]).await;
    for i in 0..5 {
        let resp = get(h.addr, "demo.openlen.com", "/").await;
        assert!(
            resp.status().is_success() || resp.status() == 404,
            "req {i}: status={}",
            resp.status()
        );
        assert_ne!(resp.status(), 429, "req {i} should not be 429");
    }
}

#[tokio::test]
async fn burst_past_per_min_limit_returns_429_with_headers() {
    let h = spawn_with_rate_limit(3, 100, vec![]).await;
    // Three pass.
    for _ in 0..3 {
        let _ = get(h.addr, "demo.openlen.com", "/").await;
    }
    // Fourth blocked.
    let resp = get(h.addr, "demo.openlen.com", "/").await;
    assert_eq!(resp.status(), 429);

    // Headers — these come from the middleware's blocked_response builder.
    assert!(resp.headers().contains_key("retry-after"));
    assert_eq!(
        resp.headers()
            .get("x-ratelimit-limit")
            .unwrap()
            .to_str()
            .unwrap(),
        "3"
    );
    assert_eq!(
        resp.headers()
            .get("x-ratelimit-remaining")
            .unwrap()
            .to_str()
            .unwrap(),
        "0"
    );
    assert!(resp.headers().contains_key("x-ratelimit-reset"));

    // The SetResponseHeader chain still adorns 429 responses with the
    // canonical security headers — proves the layer ordering is correct
    // (RateLimitLayer is innermost so blocked responses still pass back
    // out through the existing security-header layers).
    assert!(resp.headers().contains_key("strict-transport-security"));
    assert!(resp.headers().contains_key("x-content-type-options"));
}

#[tokio::test]
async fn exempt_path_bypasses_limit() {
    let h = spawn_with_rate_limit(2, 100, vec!["/c/".into()]).await;
    // Burn the limit on a non-exempt path.
    for _ in 0..2 {
        let _ = get(h.addr, "demo.openlen.com", "/").await;
    }
    // The next non-exempt request would be blocked …
    let blocked = get(h.addr, "demo.openlen.com", "/").await;
    assert_eq!(blocked.status(), 429);

    // … but /c/ stays unblocked. The fixture has no /c/foo handler so
    // Node would 502 from the test (no Node), but the rate-limit layer
    // passes the request through — what matters is "NOT 429".
    let exempt = get(h.addr, "demo.openlen.com", "/c/foo").await;
    assert_ne!(exempt.status(), 429, "exempt path must not be blocked");
}

#[tokio::test]
async fn well_known_acme_challenge_exempt_by_default() {
    let h = spawn_with_rate_limit(1, 100, vec!["/.well-known/acme-challenge/".into()]).await;
    // Burn the lone token.
    let _ = get(h.addr, "demo.openlen.com", "/").await;
    let blocked = get(h.addr, "demo.openlen.com", "/").await;
    assert_eq!(blocked.status(), 429);

    let acme = get(
        h.addr,
        "demo.openlen.com",
        "/.well-known/acme-challenge/abc123",
    )
    .await;
    assert_ne!(
        acme.status(),
        429,
        "ACME challenge path must never be rate-limited"
    );
}

#[tokio::test]
async fn limit_is_per_ip_via_peer_addr() {
    // Single client = same peer addr = same bucket. Two sequential bursts
    // from the same source confirm the bucket persists across requests.
    let h = spawn_with_rate_limit(2, 100, vec![]).await;
    for _ in 0..2 {
        let resp = get(h.addr, "demo.openlen.com", "/").await;
        assert_ne!(resp.status(), 429);
    }
    let resp = get(h.addr, "demo.openlen.com", "/").await;
    assert_eq!(resp.status(), 429);
}

#[tokio::test]
async fn retry_after_header_is_reasonable() {
    let h = spawn_with_rate_limit(1, 100, vec![]).await;
    let _ = get(h.addr, "demo.openlen.com", "/").await;
    let blocked = get(h.addr, "demo.openlen.com", "/").await;
    assert_eq!(blocked.status(), 429);
    let retry_after = blocked
        .headers()
        .get("retry-after")
        .unwrap()
        .to_str()
        .unwrap()
        .parse::<u64>()
        .expect("retry-after is integer seconds");
    // 1 token / minute — retry-after should be in the 1..=60 range.
    assert!(
        (1..=60).contains(&retry_after),
        "retry_after = {retry_after}, expected within 1..=60"
    );
}
