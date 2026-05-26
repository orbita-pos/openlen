use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::Request;
use rcgen::{generate_simple_self_signed, CertifiedKey};
use tempfile::TempDir;
use tokio::sync::oneshot;
use tokio::time::timeout;
use tower::ServiceExt;

use openlen_edge::{bind, load_wildcard, router, AppState, EdgeConfig};

const FIXTURE_ROOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/publish-root");

struct Harness {
    addr: SocketAddr,
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

async fn spawn_with(publish_root: PathBuf, max_inflight: usize) -> Harness {
    let tempdir = TempDir::new().expect("tempdir");
    let (cert_path, key_path) = write_self_signed(tempdir.path(), &["localhost", "127.0.0.1"]);

    let cfg = EdgeConfig::builder()
        .bind("127.0.0.1:0".parse().unwrap())
        .cert_path(cert_path.clone())
        .key_path(key_path.clone())
        .publish_root(publish_root)
        .max_inflight(max_inflight)
        .build()
        .expect("build cfg");

    let tls = load_wildcard(&cert_path, &key_path).expect("load tls");
    let bound = bind(&cfg, tls).await.expect("bind");
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
        _tempdir: tempdir,
    }
}

async fn spawn_edge() -> Harness {
    spawn_with(PathBuf::from(FIXTURE_ROOT), 4096).await
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

async fn get(addr: SocketAddr, host: &str, path: &str) -> reqwest::Response {
    timeout(
        Duration::from_secs(5),
        client()
            .get(format!("https://{addr}{path}"))
            .header("host", host)
            .send(),
    )
    .await
    .expect("did not time out")
    .expect("request ok")
}

#[tokio::test]
async fn known_subdomain_serves_index_html() {
    let h = spawn_edge().await;
    let resp = get(h.addr, "demo.openlen.com", "/").await;
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
    assert!(body.contains("demo home"), "body={body}");
}

#[tokio::test]
async fn html_cache_control_short_browser_long_cdn_swr() {
    let h = spawn_edge().await;
    let resp = get(h.addr, "demo.openlen.com", "/").await;
    let cache = resp
        .headers()
        .get(reqwest::header::CACHE_CONTROL)
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    assert!(cache.contains("max-age=60"), "cache={cache}");
    assert!(cache.contains("s-maxage=3600"), "cache={cache}");
    assert!(
        cache.contains("stale-while-revalidate=86400"),
        "cache={cache}"
    );
}

#[tokio::test]
async fn svg_cache_control_immutable_30d() {
    let h = spawn_edge().await;
    let resp = get(h.addr, "demo.openlen.com", "/assets/logo.svg").await;
    assert_eq!(resp.status(), 200);
    let ctype = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    assert!(ctype.starts_with("image/svg"), "ctype={ctype}");
    let cache = resp
        .headers()
        .get(reqwest::header::CACHE_CONTROL)
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    assert!(cache.contains("immutable"), "cache={cache}");
    assert!(cache.contains("max-age=2592000"), "cache={cache}");
}

#[tokio::test]
async fn css_cache_control_immutable_30d() {
    let h = spawn_edge().await;
    let resp = get(h.addr, "demo.openlen.com", "/assets/app.css").await;
    assert_eq!(resp.status(), 200);
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
async fn directory_index_served_for_about() {
    let h = spawn_edge().await;
    let resp = get(h.addr, "demo.openlen.com", "/about").await;
    assert_eq!(resp.status(), 200);
    let body = resp.text().await.unwrap();
    assert!(body.contains("about demo"), "body={body}");
}

#[tokio::test]
async fn spa_fallback_for_unknown_route() {
    let h = spawn_edge().await;
    let resp = get(h.addr, "demo.openlen.com", "/some/deep/unknown").await;
    assert_eq!(resp.status(), 200);
    let body = resp.text().await.unwrap();
    assert!(
        body.contains("demo home"),
        "expected SPA fallback body, got {body}"
    );
}

#[tokio::test]
async fn missing_asset_returns_404_not_spa() {
    let h = spawn_edge().await;
    let resp = get(h.addr, "demo.openlen.com", "/assets/missing.png").await;
    assert_eq!(resp.status(), 404);
    let body = resp.text().await.unwrap();
    assert!(
        !body.contains("demo home"),
        "should not serve SPA fallback for asset miss: {body}"
    );
}

#[tokio::test]
async fn apex_host_returns_404() {
    let h = spawn_edge().await;
    let resp = get(h.addr, "openlen.com", "/").await;
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn nested_subdomain_returns_404() {
    let h = spawn_edge().await;
    let resp = get(h.addr, "a.b.openlen.com", "/").await;
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn wrong_zone_returns_404() {
    let h = spawn_edge().await;
    let resp = get(h.addr, "demo.example.com", "/").await;
    assert_eq!(resp.status(), 404);
}

#[tokio::test]
async fn unknown_subdomain_returns_404() {
    let h = spawn_edge().await;
    let resp = get(h.addr, "ghost.openlen.com", "/").await;
    // ghost has no fixture directory, so resolve() can't find any file
    assert_eq!(resp.status(), 404);
}

/// Both reqwest and `Url::parse` apply WHATWG URL normalization (percent-decode
/// `%2E`, then dot-segment removal), so a high-level client can never deliver
/// a `..` to our handler. The tower oneshot path bypasses URL parsing and
/// feeds the raw bytes through axum, which is what a hostile non-normalising
/// HTTP client would do.
fn raw_router_request(uri: &str, host: &str) -> Request<Body> {
    let mut req = Request::builder()
        .uri(uri)
        .header("host", host)
        .body(Body::empty())
        .expect("request builder");
    req.extensions_mut()
        .insert(ConnectInfo::<SocketAddr>("127.0.0.1:1234".parse().unwrap()));
    req
}

#[tokio::test]
async fn router_rejects_encoded_parent_dir() {
    let state = AppState::new(PathBuf::from(FIXTURE_ROOT));
    let app = router(state);
    let resp = app
        .oneshot(raw_router_request(
            "/%2E%2E/%2E%2E/etc/passwd",
            "demo.openlen.com",
        ))
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);
}

#[tokio::test]
async fn router_rejects_null_byte_in_path() {
    let state = AppState::new(PathBuf::from(FIXTURE_ROOT));
    let app = router(state);
    let resp = app
        .oneshot(raw_router_request("/index.html%00.png", "demo.openlen.com"))
        .await
        .unwrap();
    assert_eq!(resp.status(), 400);
}

#[tokio::test]
async fn cap_zero_drops_connections() {
    let h = spawn_with(PathBuf::from(FIXTURE_ROOT), 0).await;
    let result = timeout(
        Duration::from_secs(3),
        client()
            .get(format!("https://{}/", h.addr))
            .header("host", "demo.openlen.com")
            .send(),
    )
    .await
    .expect("did not time out");
    assert!(
        result.is_err(),
        "expected connection drop, got response {:?}",
        result
    );
}

#[tokio::test]
async fn high_cap_serves_many_concurrent_requests() {
    let h = Arc::new(spawn_with(PathBuf::from(FIXTURE_ROOT), 4096).await);
    let mut handles = Vec::new();
    for _ in 0..20 {
        let addr = h.addr;
        handles.push(tokio::spawn(async move {
            let resp = client()
                .get(format!("https://{addr}/"))
                .header("host", "demo.openlen.com")
                .send()
                .await?;
            anyhow::Ok(resp.status().as_u16())
        }));
    }
    let mut ok = 0;
    for h in handles {
        match h.await.unwrap() {
            Ok(200) => ok += 1,
            other => panic!("unexpected response: {other:?}"),
        }
    }
    assert_eq!(ok, 20);
}

#[tokio::test]
async fn version_endpoint_still_returns_json() {
    let h = spawn_edge().await;
    let resp = get(h.addr, "demo.openlen.com", "/_edge/version").await;
    assert_eq!(resp.status(), 200);
    let body = resp.text().await.unwrap();
    assert!(body.contains("\"version\""), "body={body}");
}

#[tokio::test]
async fn server_header_still_identifies_edge() {
    let h = spawn_edge().await;
    let resp = get(h.addr, "demo.openlen.com", "/").await;
    let s = resp
        .headers()
        .get(reqwest::header::SERVER)
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    assert!(s.starts_with("openlen-edge/"), "Server={s}");
}

#[tokio::test]
async fn host_with_port_still_routes() {
    let h = spawn_edge().await;
    let resp = get(h.addr, "demo.openlen.com:443", "/").await;
    assert_eq!(resp.status(), 200);
}
