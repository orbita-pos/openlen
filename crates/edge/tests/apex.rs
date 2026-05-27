//! Integration tests for apex / www host routing — the cases that the
//! migration runbook relies on.
//!
//! Each test spawns:
//!   * a mock Node app on `127.0.0.1:<rand>` (returns 200 with a stable body)
//!   * a tempdir uploads_root + next_static_root seeded with known files
//!   * an edge with `proxy_hosts = ["openlen.com", "www.openlen.com"]`,
//!     pointing at the mock for everything that isn't a shared-disk route.
//!
//! The three assertions mirror the post-cutover smoke checks the operator
//! runs on Hetzner (see `infra/edge/smoke-test.sh`).

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::time::Duration;

use axum::body::Body;
use axum::http::{Response, StatusCode};
use axum::response::IntoResponse;
use axum::routing::any;
use axum::Router;
use rcgen::{generate_simple_self_signed, CertifiedKey};
use tempfile::TempDir;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio::time::timeout;

use openlen_edge::{bind, load_wildcard, EdgeConfig};

const FIXTURE_ROOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/publish-root");

const MOCK_APEX_BODY: &str = "MOCK-APEX-OK";

// ─── Mock Node ───────────────────────────────────────────────────────────

struct MockNode {
    addr: SocketAddr,
    shutdown: Option<oneshot::Sender<()>>,
    handle: Option<tokio::task::JoinHandle<()>>,
}

impl Drop for MockNode {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
        if let Some(h) = self.handle.take() {
            h.abort();
        }
    }
}

impl MockNode {
    fn url(&self) -> String {
        format!("http://{}", self.addr)
    }
}

async fn apex_handler() -> Response<Body> {
    (StatusCode::OK, MOCK_APEX_BODY).into_response()
}

async fn start_mock_node() -> MockNode {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("mock listen");
    let addr = listener.local_addr().expect("local_addr");
    let app = Router::new().fallback(any(apex_handler));
    let (tx, rx) = oneshot::channel::<()>();
    let handle = tokio::spawn(async move {
        let _ = axum::serve(listener, app.into_make_service())
            .with_graceful_shutdown(async move {
                let _ = rx.await;
            })
            .await;
    });
    MockNode {
        addr,
        shutdown: Some(tx),
        handle: Some(handle),
    }
}

// ─── Edge harness ────────────────────────────────────────────────────────

struct Edge {
    addr: SocketAddr,
    shutdown: Option<oneshot::Sender<()>>,
    handle: Option<tokio::task::JoinHandle<anyhow::Result<()>>>,
    _tempdir: TempDir,
}

impl Drop for Edge {
    fn drop(&mut self) {
        if let Some(tx) = self.shutdown.take() {
            let _ = tx.send(());
        }
        if let Some(h) = self.handle.take() {
            h.abort();
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

async fn start_edge(node_url: &str, uploads_root: &Path, next_static_root: &Path) -> Edge {
    let tempdir = TempDir::new().expect("tempdir");
    let (cert_path, key_path) = write_self_signed(tempdir.path(), &["localhost", "127.0.0.1"]);
    let cfg = EdgeConfig::builder()
        .bind("127.0.0.1:0".parse().unwrap())
        .cert_path(cert_path.clone())
        .key_path(key_path.clone())
        .publish_root(PathBuf::from(FIXTURE_ROOT))
        .uploads_root(uploads_root.to_path_buf())
        .next_static_root(next_static_root.to_path_buf())
        .max_inflight(4096)
        .node_url(node_url)
        .build()
        .expect("EdgeConfig::build");
    let tls = load_wildcard(&cert_path, &key_path).expect("load_wildcard");
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
    Edge {
        addr,
        shutdown: Some(tx),
        handle: Some(handle),
        _tempdir: tempdir,
    }
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

fn seed(dir: &Path, name: &str, content: &[u8]) {
    std::fs::write(dir.join(name), content).expect("seed write");
}

// ─── Tests ───────────────────────────────────────────────────────────────

#[tokio::test]
async fn apex_root_proxies_to_node_and_returns_200() {
    let node = start_mock_node().await;
    let uploads = TempDir::new().unwrap();
    let next_static = TempDir::new().unwrap();
    let edge = start_edge(&node.url(), uploads.path(), next_static.path()).await;

    for host in ["openlen.com", "www.openlen.com"] {
        let resp = get(edge.addr, host, "/").await;
        assert_eq!(resp.status(), 200, "host={host}");
        let body = resp.text().await.unwrap();
        assert_eq!(body, MOCK_APEX_BODY, "host={host}");
    }
}

#[tokio::test]
async fn apex_uploads_served_direct_with_immutable_cache() {
    let node = start_mock_node().await;
    let uploads = TempDir::new().unwrap();
    let next_static = TempDir::new().unwrap();
    seed(uploads.path(), "logo.png", b"\x89PNG-apex-upload");
    let edge = start_edge(&node.url(), uploads.path(), next_static.path()).await;

    let resp = get(edge.addr, "openlen.com", "/uploads/logo.png").await;
    assert_eq!(resp.status(), 200);
    let cache = resp
        .headers()
        .get(reqwest::header::CACHE_CONTROL)
        .expect("cache-control")
        .to_str()
        .unwrap()
        .to_owned();
    assert!(cache.contains("immutable"), "cache={cache}");
    assert!(cache.contains("max-age=2592000"), "cache={cache}");
    let bytes = resp.bytes().await.unwrap();
    assert_eq!(bytes.as_ref(), b"\x89PNG-apex-upload");
}

#[tokio::test]
async fn apex_next_static_served_direct_with_one_year_immutable_cache() {
    let node = start_mock_node().await;
    let uploads = TempDir::new().unwrap();
    let next_static = TempDir::new().unwrap();
    seed(next_static.path(), "abc.js", b"export const x=1;");
    let edge = start_edge(&node.url(), uploads.path(), next_static.path()).await;

    let resp = get(edge.addr, "openlen.com", "/_next/static/abc.js").await;
    assert_eq!(resp.status(), 200);
    let cache = resp
        .headers()
        .get(reqwest::header::CACHE_CONTROL)
        .expect("cache-control")
        .to_str()
        .unwrap()
        .to_owned();
    assert!(cache.contains("immutable"), "cache={cache}");
    assert!(cache.contains("max-age=31536000"), "cache={cache}");
    let body = resp.text().await.unwrap();
    assert_eq!(body, "export const x=1;");
}

#[tokio::test]
async fn apex_uploads_missing_file_returns_404_not_proxy() {
    // A miss under /uploads/ must NOT fall through to Node — the strict
    // resolver returns NotFound and the edge surfaces a 404. Stops the
    // Caddyfile-era pattern where a 404 from disk would silently retry as
    // a proxied request to Node.
    let node = start_mock_node().await;
    let uploads = TempDir::new().unwrap();
    let next_static = TempDir::new().unwrap();
    let edge = start_edge(&node.url(), uploads.path(), next_static.path()).await;

    let resp = get(edge.addr, "openlen.com", "/uploads/missing.png").await;
    assert_eq!(resp.status(), 404);
    let body = resp.text().await.unwrap();
    assert!(
        !body.contains(MOCK_APEX_BODY),
        "must not fall through to Node, body={body}"
    );
}

#[tokio::test]
async fn apex_next_static_missing_returns_404_not_proxy() {
    let node = start_mock_node().await;
    let uploads = TempDir::new().unwrap();
    let next_static = TempDir::new().unwrap();
    let edge = start_edge(&node.url(), uploads.path(), next_static.path()).await;

    let resp = get(edge.addr, "openlen.com", "/_next/static/missing.js").await;
    assert_eq!(resp.status(), 404);
    let body = resp.text().await.unwrap();
    assert!(
        !body.contains(MOCK_APEX_BODY),
        "must not fall through to Node, body={body}"
    );
}
