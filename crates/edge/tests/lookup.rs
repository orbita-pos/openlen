//! End-to-end integration tests for the custom-domain lookup path.
//!
//! All tests use a [`MockDomainLookup`] injected via `bind_with_lookup`. The
//! Mock surfaces a controllable call counter so cache + singleflight behavior
//! can be asserted from the outside.
//!
//! The HTTPS-bearing tests follow the same harness pattern as
//! `tests/routing.rs`: a self-signed cert covering localhost + 127.0.0.1, the
//! edge binding to `127.0.0.1:0`, and reqwest with `danger_accept_invalid_certs`.
//!
//! The internal-API tests bind on a separate plain-HTTP loopback port and
//! issue plain reqwest::get against it.

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use rcgen::{generate_simple_self_signed, CertifiedKey};
use tempfile::TempDir;
use tokio::sync::oneshot;
use tokio::time::timeout;

use openlen_edge::{
    bind_with_lookup, load_wildcard, serve_internal_api, DomainLookup, EdgeConfig,
    InternalApiState, LayeredLookup, MockDomainLookup,
};

const FIXTURE_ROOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/publish-root");

struct Harness {
    addr: SocketAddr,
    /// The raw mock — tests use this for `.calls()` / `.insert()`.
    mock: Arc<MockDomainLookup>,
    /// The layered (cache + singleflight) facade above the mock — needed when
    /// tests want to invalidate the cache without going through the API.
    layered: Arc<LayeredLookup>,
    shutdown: Option<oneshot::Sender<()>>,
    handle: Option<tokio::task::JoinHandle<anyhow::Result<()>>>,
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

#[derive(Default, Clone)]
struct HarnessOpts {
    /// (host, sub) pairs to seed in the mock.
    entries: Vec<(String, String)>,
    /// Override the cache TTL. Default = 60s.
    cache_ttl: Option<Duration>,
    /// Override the negative cache TTL. Default = 60s.
    negative_ttl: Option<Duration>,
}

impl HarnessOpts {
    fn entry(mut self, host: &str, sub: &str) -> Self {
        self.entries.push((host.into(), sub.into()));
        self
    }
}

async fn spawn(opts: HarnessOpts) -> Harness {
    let tempdir = TempDir::new().expect("tempdir");
    let (cert_path, key_path) = write_self_signed(tempdir.path(), &["localhost", "127.0.0.1"]);

    let cfg = EdgeConfig::builder()
        .bind("127.0.0.1:0".parse().unwrap())
        .cert_path(cert_path.clone())
        .key_path(key_path.clone())
        .publish_root(PathBuf::from(FIXTURE_ROOT))
        .max_inflight(4096)
        .domain_cache_ttl_secs(opts.cache_ttl.map(|d| d.as_secs()).unwrap_or(60))
        .domain_negative_ttl_secs(opts.negative_ttl.map(|d| d.as_secs()).unwrap_or(60))
        .build()
        .expect("build cfg");

    let mock = Arc::new(MockDomainLookup::new());
    for (host, sub) in &opts.entries {
        mock.insert(host, sub).await;
    }

    let layered = Arc::new(LayeredLookup::new(
        mock.clone() as Arc<dyn DomainLookup>,
        10_000,
        opts.cache_ttl.unwrap_or(Duration::from_secs(60)),
        opts.negative_ttl.unwrap_or(Duration::from_secs(60)),
    ));

    let tls = load_wildcard(&cert_path, &key_path).expect("load tls");
    let bound = bind_with_lookup(&cfg, tls, layered.clone() as Arc<dyn DomainLookup>)
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
        mock,
        layered,
        shutdown: Some(tx),
        handle: Some(handle),
        _tempdir: tempdir,
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

fn https_client() -> reqwest::Client {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(5))
        .build()
        .expect("client")
}

async fn https_get(addr: SocketAddr, host: &str, path: &str) -> reqwest::Response {
    timeout(
        Duration::from_secs(5),
        https_client()
            .get(format!("https://{addr}{path}"))
            .header("host", host)
            .send(),
    )
    .await
    .expect("did not time out")
    .expect("request ok")
}

// ────────────────────────────── disk path ─────────────────────────────────

#[tokio::test]
async fn custom_domain_hit_serves_disk_index_html() {
    let h = spawn(HarnessOpts::default().entry("mybrand.com", "mybrand")).await;
    let resp = https_get(h.addr, "mybrand.com", "/").await;
    assert_eq!(resp.status(), 200);
    let ctype = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    assert!(ctype.starts_with("text/html"), "got content-type={ctype}");
    let body = resp.text().await.unwrap();
    assert!(body.contains("mybrand custom domain home"), "body={body}");
}

#[tokio::test]
async fn custom_domain_uppercase_host_resolves() {
    let h = spawn(HarnessOpts::default().entry("mybrand.com", "mybrand")).await;
    let resp = https_get(h.addr, "MyBrand.COM", "/").await;
    assert_eq!(resp.status(), 200);
    let body = resp.text().await.unwrap();
    assert!(body.contains("mybrand custom domain home"));
}

#[tokio::test]
async fn custom_domain_with_port_in_host_header_resolves() {
    let h = spawn(HarnessOpts::default().entry("mybrand.com", "mybrand")).await;
    let resp = https_get(h.addr, "mybrand.com:443", "/").await;
    assert_eq!(resp.status(), 200);
}

#[tokio::test]
async fn custom_domain_about_directory_index() {
    let h = spawn(HarnessOpts::default().entry("mybrand.com", "mybrand")).await;
    let resp = https_get(h.addr, "mybrand.com", "/about").await;
    assert_eq!(resp.status(), 200);
    let body = resp.text().await.unwrap();
    assert!(body.contains("about mybrand"), "body={body}");
}

#[tokio::test]
async fn custom_domain_asset_serves_with_immutable_cache() {
    let h = spawn(HarnessOpts::default().entry("mybrand.com", "mybrand")).await;
    let resp = https_get(h.addr, "mybrand.com", "/assets/logo.svg").await;
    assert_eq!(resp.status(), 200);
    let ctype = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    assert!(ctype.starts_with("image/svg"));
    let cache = resp
        .headers()
        .get(reqwest::header::CACHE_CONTROL)
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    assert!(cache.contains("immutable"), "cache={cache}");
}

#[tokio::test]
async fn custom_domain_unknown_returns_404() {
    let h = spawn(HarnessOpts::default()).await;
    let resp = https_get(h.addr, "ghost.example.com", "/").await;
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn custom_domain_unverified_acts_as_unknown() {
    // The mock only has verified hosts; a domain not in the mock simulates an
    // unverified (or absent) row in customDomains.
    let h = spawn(HarnessOpts::default().entry("verified.com", "verified")).await;
    let resp = https_get(h.addr, "claimed-but-unverified.com", "/").await;
    assert_eq!(resp.status(), 404);
}

// ────────────────────────────── routing edges ─────────────────────────────

#[tokio::test]
async fn subdomain_request_does_not_call_lookup() {
    // *.openlen.com goes straight to disk; the lookup mock must never see it.
    let h = spawn(HarnessOpts::default().entry("mybrand.com", "mybrand")).await;
    let resp = https_get(h.addr, "demo.openlen.com", "/").await;
    assert_eq!(resp.status(), 200);
    assert_eq!(h.mock.calls(), 0, "wildcard subdomain must skip lookup");
}

#[tokio::test]
async fn nested_openlen_zone_stays_404_no_lookup() {
    let h = spawn(HarnessOpts::default()).await;
    let resp = https_get(h.addr, "a.b.openlen.com", "/").await;
    assert_eq!(resp.status(), 404);
    assert_eq!(h.mock.calls(), 0, "nested zone must skip lookup");
}

#[tokio::test]
async fn apex_proxy_path_does_not_call_lookup() {
    // Apex proxies to (down) Node → 502. Lookup must not be called.
    let h = spawn(HarnessOpts::default()).await;
    let resp = https_get(h.addr, "openlen.com", "/").await;
    assert_eq!(resp.status(), 502);
    assert_eq!(h.mock.calls(), 0);
}

#[tokio::test]
async fn custom_domain_c_path_proxies_to_node_no_lookup() {
    // /c/<id> on a custom domain is an analytics beacon — goes to Node, lookup
    // is bypassed (matching the wildcard subdomain behavior).
    let h = spawn(HarnessOpts::default().entry("mybrand.com", "mybrand")).await;
    let resp = https_get(h.addr, "mybrand.com", "/c/abc123").await;
    // No Node listening → 502.
    assert_eq!(resp.status(), 502);
    assert_eq!(h.mock.calls(), 0, "/c/ path must not call lookup");
}

#[tokio::test]
async fn custom_domain_localhost_host_header_returns_404_no_lookup() {
    let h = spawn(HarnessOpts::default()).await;
    let resp = https_get(h.addr, "localhost", "/").await;
    assert_eq!(resp.status(), 404);
    assert_eq!(h.mock.calls(), 0, "non-public host must skip lookup");
}

#[tokio::test]
async fn custom_domain_garbage_host_skips_lookup() {
    let h = spawn(HarnessOpts::default()).await;
    // reqwest sends a default Host derived from the URL when the override is
    // a bogus value, but our handler reads whatever lands; the regex filter in
    // looks_like_public_hostname rejects this and short-circuits to 404 with
    // no DB call.
    let resp = https_get(h.addr, "bad_host", "/").await;
    assert_eq!(resp.status(), 404);
    assert_eq!(h.mock.calls(), 0);
}

// ────────────────────────────── caching + singleflight ─────────────────────

#[tokio::test]
async fn custom_domain_second_request_hits_cache() {
    let h = spawn(HarnessOpts::default().entry("mybrand.com", "mybrand")).await;
    let _ = https_get(h.addr, "mybrand.com", "/").await;
    let _ = https_get(h.addr, "mybrand.com", "/").await;
    assert_eq!(
        h.mock.calls(),
        1,
        "second request should hit cache, not call lookup again"
    );
}

#[tokio::test]
async fn custom_domain_concurrent_requests_share_one_lookup_call() {
    let h = Arc::new(spawn(HarnessOpts::default().entry("mybrand.com", "mybrand")).await);
    h.mock.set_delay_ms(30).await;
    let mut handles = Vec::with_capacity(50);
    for _ in 0..50 {
        let addr = h.addr;
        handles.push(tokio::spawn(async move {
            https_get(addr, "mybrand.com", "/").await
        }));
    }
    for fut in handles {
        let resp = fut.await.expect("task");
        assert_eq!(resp.status(), 200);
    }
    // Singleflight ⇒ all concurrent requests coalesce into one underlying call.
    assert_eq!(
        h.mock.calls(),
        1,
        "50 concurrent requests should call lookup exactly once"
    );
}

#[tokio::test]
async fn custom_domain_negative_cache_suppresses_repeat_misses() {
    let h = spawn(HarnessOpts::default()).await;
    let _ = https_get(h.addr, "ghost.example.com", "/").await;
    let _ = https_get(h.addr, "ghost.example.com", "/").await;
    let _ = https_get(h.addr, "ghost.example.com", "/").await;
    assert_eq!(
        h.mock.calls(),
        1,
        "repeated misses must be served from negative cache"
    );
}

#[tokio::test]
async fn custom_domain_lookup_error_is_not_cached() {
    let h = spawn(HarnessOpts::default()).await;
    h.mock.set_error_mode(true).await;
    let _ = https_get(h.addr, "mybrand.com", "/").await;
    let _ = https_get(h.addr, "mybrand.com", "/").await;
    // Each errored request must re-call the base, never cache.
    assert_eq!(
        h.mock.calls(),
        2,
        "transient lookup errors must NOT be cached"
    );
}

#[tokio::test]
async fn custom_domain_lookup_error_surfaces_as_404() {
    // Server-side graceful degradation: DB errors don't crash, they 404.
    let h = spawn(HarnessOpts::default()).await;
    h.mock.set_error_mode(true).await;
    let resp = https_get(h.addr, "mybrand.com", "/").await;
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn custom_domain_invalidate_forces_relookup() {
    let h = spawn(HarnessOpts::default().entry("mybrand.com", "mybrand")).await;
    let _ = https_get(h.addr, "mybrand.com", "/").await;
    assert_eq!(h.mock.calls(), 1);
    h.layered.invalidate("mybrand.com").await;
    let _ = https_get(h.addr, "mybrand.com", "/").await;
    assert_eq!(
        h.mock.calls(),
        2,
        "after invalidation the next request must re-query the base"
    );
}

#[tokio::test]
async fn custom_domain_separate_hosts_get_separate_cache_entries() {
    let h = spawn(
        HarnessOpts::default()
            .entry("alpha.com", "alpha-sub")
            .entry("beta.com", "beta-sub"),
    )
    .await;
    let _ = https_get(h.addr, "alpha.com", "/").await;
    let _ = https_get(h.addr, "beta.com", "/").await;
    let _ = https_get(h.addr, "alpha.com", "/").await;
    let _ = https_get(h.addr, "beta.com", "/").await;
    assert_eq!(
        h.mock.calls(),
        2,
        "alpha + beta share one lookup each (4 reqs → 2 calls)"
    );
}

// ───────────────────────────── internal API ───────────────────────────────

struct InternalApiHarness {
    addr: SocketAddr,
    shutdown: Option<oneshot::Sender<()>>,
    handle: Option<tokio::task::JoinHandle<anyhow::Result<()>>>,
    mock: Arc<MockDomainLookup>,
    #[allow(dead_code)]
    layered: Arc<LayeredLookup>,
}

impl Drop for InternalApiHarness {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
        if let Some(h) = self.handle.take() {
            h.abort();
        }
    }
}

async fn spawn_internal_api(entries: &[(&str, &str)]) -> InternalApiHarness {
    let mock = Arc::new(MockDomainLookup::new());
    for (h, s) in entries {
        mock.insert(h, s).await;
    }
    let layered = Arc::new(LayeredLookup::new(
        mock.clone() as Arc<dyn DomainLookup>,
        10_000,
        Duration::from_secs(60),
        Duration::from_secs(60),
    ));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind internal api");
    let addr = listener.local_addr().unwrap();

    let (tx, rx) = oneshot::channel::<()>();
    let state = InternalApiState {
        lookup: layered.clone() as Arc<dyn DomainLookup>,
        layered: Some(layered.clone()),
    };
    let handle = tokio::spawn(async move {
        serve_internal_api(listener, state, async move {
            let _ = rx.await;
        })
        .await
    });
    InternalApiHarness {
        addr,
        shutdown: Some(tx),
        handle: Some(handle),
        mock,
        layered,
    }
}

fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .expect("client")
}

#[tokio::test]
async fn internal_api_lookup_hit_returns_200_with_subdomain_json() {
    let h = spawn_internal_api(&[("mybrand.com", "mybrand")]).await;
    let resp = http_client()
        .get(format!(
            "http://{}/internal/domains/lookup?domain=mybrand.com",
            h.addr
        ))
        .send()
        .await
        .expect("request");
    assert_eq!(resp.status(), 200);
    let body_str = resp.text().await.unwrap();
    let body: serde_json::Value = serde_json::from_str(&body_str).expect("valid JSON");
    assert_eq!(body["ok"], 1);
    assert_eq!(body["subdomain"], "mybrand");
}

#[tokio::test]
async fn internal_api_lookup_miss_returns_404() {
    let h = spawn_internal_api(&[("mybrand.com", "mybrand")]).await;
    let resp = http_client()
        .get(format!(
            "http://{}/internal/domains/lookup?domain=ghost.example.com",
            h.addr
        ))
        .send()
        .await
        .expect("request");
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn internal_api_lookup_accepts_host_alias_query_param() {
    let h = spawn_internal_api(&[("mybrand.com", "mybrand")]).await;
    let resp = http_client()
        .get(format!(
            "http://{}/internal/domains/lookup?host=mybrand.com",
            h.addr
        ))
        .send()
        .await
        .expect("request");
    assert_eq!(resp.status(), 200);
}

#[tokio::test]
async fn internal_api_lookup_missing_param_returns_400() {
    let h = spawn_internal_api(&[]).await;
    let resp = http_client()
        .get(format!("http://{}/internal/domains/lookup", h.addr))
        .send()
        .await
        .expect("request");
    assert_eq!(resp.status(), 400);
}

#[tokio::test]
async fn internal_api_lookup_error_returns_503() {
    let h = spawn_internal_api(&[("mybrand.com", "mybrand")]).await;
    h.mock.set_error_mode(true).await;
    let resp = http_client()
        .get(format!(
            "http://{}/internal/domains/lookup?domain=mybrand.com",
            h.addr
        ))
        .send()
        .await
        .expect("request");
    assert_eq!(resp.status(), 503);
}

#[tokio::test]
async fn internal_api_invalidate_single_clears_cache_for_host() {
    let h = spawn_internal_api(&[("mybrand.com", "mybrand")]).await;
    // Warm the cache via a lookup.
    let _ = http_client()
        .get(format!(
            "http://{}/internal/domains/lookup?domain=mybrand.com",
            h.addr
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(h.mock.calls(), 1);
    let _ = http_client()
        .get(format!(
            "http://{}/internal/domains/lookup?domain=mybrand.com",
            h.addr
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(h.mock.calls(), 1, "second lookup cached");

    let resp = http_client()
        .post(format!(
            "http://{}/internal/domains/invalidate?domain=mybrand.com",
            h.addr
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let _ = http_client()
        .get(format!(
            "http://{}/internal/domains/lookup?domain=mybrand.com",
            h.addr
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(h.mock.calls(), 2, "invalidated cache → fresh lookup");
}

#[tokio::test]
async fn internal_api_invalidate_all_clears_entire_cache() {
    let h = spawn_internal_api(&[("a.com", "a"), ("b.com", "b")]).await;
    let _ = http_client()
        .get(format!(
            "http://{}/internal/domains/lookup?domain=a.com",
            h.addr
        ))
        .send()
        .await
        .unwrap();
    let _ = http_client()
        .get(format!(
            "http://{}/internal/domains/lookup?domain=b.com",
            h.addr
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(h.mock.calls(), 2);

    let resp = http_client()
        .post(format!(
            "http://{}/internal/domains/invalidate?all=true",
            h.addr
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    // wait for moka pending tasks to flush — the layered invalidate_all already
    // waits for run_pending_tasks, so subsequent reads will miss.
    let _ = http_client()
        .get(format!(
            "http://{}/internal/domains/lookup?domain=a.com",
            h.addr
        ))
        .send()
        .await
        .unwrap();
    let _ = http_client()
        .get(format!(
            "http://{}/internal/domains/lookup?domain=b.com",
            h.addr
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(h.mock.calls(), 4, "all-flush → both hosts re-query");
}

#[tokio::test]
async fn internal_api_lookup_lowercases_host() {
    let h = spawn_internal_api(&[("mybrand.com", "mybrand")]).await;
    let resp = http_client()
        .get(format!(
            "http://{}/internal/domains/lookup?domain=MyBrand.COM",
            h.addr
        ))
        .send()
        .await
        .expect("request");
    assert_eq!(resp.status(), 200);
}

#[tokio::test]
async fn internal_api_invalidate_without_host_or_all_returns_400() {
    let h = spawn_internal_api(&[]).await;
    let resp = http_client()
        .post(format!("http://{}/internal/domains/invalidate", h.addr))
        .send()
        .await
        .expect("request");
    assert_eq!(resp.status(), 400);
}

#[tokio::test]
async fn https_edge_and_internal_api_share_cache_state() {
    // Cross-listener sanity: a request through the HTTPS edge warms the cache,
    // then a follow-up internal API lookup uses the same cached entry.
    let h = spawn(HarnessOpts::default().entry("mybrand.com", "mybrand")).await;
    let _ = https_get(h.addr, "mybrand.com", "/").await;
    assert_eq!(h.mock.calls(), 1);

    // The layered lookup is shared via `h.layered` — internal API would
    // resolve from the same cache. Verify by calling the layered facade
    // directly (proves cache shared).
    let direct = h.layered.lookup("mybrand.com").await.unwrap();
    assert_eq!(direct.as_deref(), Some("mybrand"));
    assert_eq!(
        h.mock.calls(),
        1,
        "direct layered call after HTTPS warm-up must be cached"
    );
}

#[tokio::test]
async fn custom_domain_pool_handles_many_concurrent_distinct_hosts() {
    // Smoke test: 16 distinct hosts × 4 concurrent each. The default builder
    // pool/cache settings must handle this without deadlock.
    let mut opts = HarnessOpts::default();
    for i in 0..16 {
        opts = opts.entry(&format!("brand{i}.com"), &format!("brand{i}"));
    }
    let h = Arc::new(spawn(opts).await);

    let mut handles = vec![];
    for i in 0..16 {
        for _ in 0..4 {
            let addr = h.addr;
            let host = format!("brand{i}.com");
            handles.push(tokio::spawn(
                async move { https_get(addr, &host, "/").await },
            ));
        }
    }
    for fut in handles {
        let _ = fut.await.expect("task");
    }
    // Each distinct host triggers one underlying lookup → 16 calls.
    assert_eq!(h.mock.calls(), 16);
}
