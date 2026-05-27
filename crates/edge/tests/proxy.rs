//! Integration tests for the F2 Sem 5-6 proxy module.
//!
//! Each test spawns:
//!   * a mock Node app on `127.0.0.1:<rand>` (axum)
//!   * an edge instance on `127.0.0.1:<rand>` (TLS, fixture publish-root)
//!     configured to point at the mock for apex/www/subdomain `/c/` routes
//!
//! and exercises a single behavior. The mock's responses are designed so the
//! test can assert exactly what the edge forwarded.

use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use async_stream::stream;
use axum::body::Body;
use axum::extract::{ConnectInfo, DefaultBodyLimit, Request};
use axum::http::{HeaderMap, HeaderName, Method, Response, StatusCode, Uri};
use axum::response::IntoResponse;
use axum::routing::{any, get};
use axum::Router;
use bytes::Bytes;
use futures_util::StreamExt;
use rcgen::{generate_simple_self_signed, CertifiedKey};
use tempfile::TempDir;
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio::time::timeout;

use openlen_edge::{bind, load_wildcard, EdgeConfig};

const FIXTURE_ROOT: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/publish-root");

// ---------------------------------------------------------------------------
// Mock Node
// ---------------------------------------------------------------------------

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

async fn echo_handler(method: Method, uri: Uri, headers: HeaderMap, body: Bytes) -> Response<Body> {
    let mut s = format!(
        "REQ {} {}\n",
        method,
        uri.path_and_query().map(|p| p.as_str()).unwrap_or("/")
    );
    let mut keys: Vec<_> = headers
        .keys()
        .map(|k| k.as_str().to_ascii_lowercase())
        .collect();
    keys.sort();
    keys.dedup();
    for k in &keys {
        if let Ok(name) = HeaderName::try_from(k.as_str()) {
            for v in headers.get_all(&name) {
                s.push_str(k);
                s.push_str(": ");
                s.push_str(v.to_str().unwrap_or("<binary>"));
                s.push('\n');
            }
        }
    }
    s.push_str(&format!("BODY_BYTES: {}\n", body.len()));
    (StatusCode::OK, s).into_response()
}

async fn sse_handler() -> Response<Body> {
    let s = stream! {
        for i in 0..20u32 {
            tokio::time::sleep(Duration::from_millis(50)).await;
            yield Ok::<Bytes, std::io::Error>(Bytes::from(format!("data: chunk{i}\n\n")));
        }
    };
    Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "text/event-stream")
        .header("cache-control", "no-cache")
        .body(Body::from_stream(s))
        .unwrap()
}

async fn hop_in_response() -> Response<Body> {
    // Mimic an upstream that explicitly sets a hop-by-hop response header and
    // a custom header; the proxy must strip the former and keep the latter.
    Response::builder()
        .status(StatusCode::OK)
        .header("connection", "close")
        .header("custom-header", "survives")
        .body(Body::from("hop-in-response body"))
        .unwrap()
}

async fn hang_body_handler() -> Response<Body> {
    // Headers flush immediately, body hangs forever. Exercises the per-frame
    // idle timeout in `TimeoutBody`.
    let s = stream! {
        // Send one chunk so the response is established with a body, then
        // never produce another frame.
        yield Ok::<Bytes, std::io::Error>(Bytes::from("first\n"));
        let () = std::future::pending::<()>().await;
        // unreachable, but the macro needs to see at least one trailing yield
        yield Ok(Bytes::from(""));
    };
    Response::builder()
        .status(StatusCode::OK)
        .header("content-type", "text/event-stream")
        .header("cache-control", "no-cache")
        .body(Body::from_stream(s))
        .unwrap()
}

fn mock_router() -> Router {
    Router::new()
        .route("/sse", get(sse_handler))
        .route("/hop-resp", get(hop_in_response))
        .route("/hang-body", get(hang_body_handler))
        .fallback(any(echo_handler))
        // The 5 MB body test exceeds axum's default 2 MiB extractor limit; the
        // mock needs to accept arbitrary sizes so we can assert what the edge
        // actually relayed.
        .layer(DefaultBodyLimit::disable())
}

async fn spawn_mock_node() -> MockNode {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("bind mock");
    let addr = listener.local_addr().expect("mock local_addr");
    let (tx, rx) = oneshot::channel::<()>();
    let app = mock_router();
    let handle = tokio::spawn(async move {
        let _ = axum::serve(
            listener,
            app.into_make_service_with_connect_info::<SocketAddr>(),
        )
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

// ---------------------------------------------------------------------------
// Edge harness
// ---------------------------------------------------------------------------

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

struct EdgeOpts<'a> {
    node_url: &'a str,
    max_inflight: usize,
    proxy_hosts: Option<Vec<String>>,
    proxy_paths: Option<Vec<String>>,
    body_idle_timeout_secs: Option<u64>,
}

async fn spawn_edge(opts: EdgeOpts<'_>) -> Edge {
    let tempdir = TempDir::new().expect("tempdir");
    let (cert_path, key_path) = write_self_signed(tempdir.path(), &["localhost", "127.0.0.1"]);

    let mut builder = EdgeConfig::builder()
        .bind("127.0.0.1:0".parse().unwrap())
        .cert_path(cert_path.clone())
        .key_path(key_path.clone())
        .publish_root(PathBuf::from(FIXTURE_ROOT))
        .max_inflight(opts.max_inflight)
        .node_url(opts.node_url);
    if let Some(h) = opts.proxy_hosts {
        builder = builder.proxy_hosts(h);
    }
    if let Some(p) = opts.proxy_paths {
        builder = builder.proxy_paths(p);
    }
    if let Some(secs) = opts.body_idle_timeout_secs {
        builder = builder.proxy_body_idle_timeout_secs(secs);
    }
    let cfg = builder.build().expect("EdgeConfig::build");

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

async fn spawn_edge_default(node_url: &str) -> Edge {
    spawn_edge(EdgeOpts {
        node_url,
        max_inflight: 4096,
        proxy_hosts: None,
        proxy_paths: None,
        body_idle_timeout_secs: None,
    })
    .await
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
        .timeout(Duration::from_secs(10))
        .build()
        .expect("client")
}

async fn get_with_host(addr: SocketAddr, host: &str, path: &str) -> reqwest::Response {
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

// ---------------------------------------------------------------------------
// 1. Apex / www / subdomain routing
// ---------------------------------------------------------------------------

#[tokio::test]
async fn apex_get_proxies_to_node() {
    let node = spawn_mock_node().await;
    let edge = spawn_edge_default(&node.url()).await;
    let resp = get_with_host(edge.addr, "openlen.com", "/hello").await;
    assert_eq!(resp.status(), 200);
    let body = resp.text().await.unwrap();
    assert!(
        body.starts_with("REQ GET /hello"),
        "did not reach mock: {body}"
    );
}

#[tokio::test]
async fn www_host_also_proxies() {
    let node = spawn_mock_node().await;
    let edge = spawn_edge_default(&node.url()).await;
    let resp = get_with_host(edge.addr, "www.openlen.com", "/dashboard").await;
    assert_eq!(resp.status(), 200);
    let body = resp.text().await.unwrap();
    assert!(body.starts_with("REQ GET /dashboard"), "body={body}");
}

#[tokio::test]
async fn apex_with_port_in_host_still_proxies() {
    let node = spawn_mock_node().await;
    let edge = spawn_edge_default(&node.url()).await;
    let resp = get_with_host(edge.addr, "openlen.com:443", "/").await;
    assert_eq!(resp.status(), 200);
}

#[tokio::test]
async fn subdomain_root_serves_disk_not_proxy() {
    let node = spawn_mock_node().await;
    let edge = spawn_edge_default(&node.url()).await;
    let resp = get_with_host(edge.addr, "demo.openlen.com", "/").await;
    assert_eq!(resp.status(), 200);
    let body = resp.text().await.unwrap();
    assert!(
        body.contains("demo home"),
        "expected fixture index, got: {body}"
    );
    assert!(!body.starts_with("REQ "), "must not have hit mock: {body}");
}

#[tokio::test]
async fn subdomain_asset_serves_disk_not_proxy() {
    let node = spawn_mock_node().await;
    let edge = spawn_edge_default(&node.url()).await;
    let resp = get_with_host(edge.addr, "demo.openlen.com", "/assets/logo.svg").await;
    assert_eq!(resp.status(), 200);
    let ctype = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .unwrap()
        .to_str()
        .unwrap();
    assert!(ctype.starts_with("image/svg"), "ctype={ctype}");
}

#[tokio::test]
async fn subdomain_about_directory_index_serves_disk() {
    let node = spawn_mock_node().await;
    let edge = spawn_edge_default(&node.url()).await;
    let resp = get_with_host(edge.addr, "demo.openlen.com", "/about").await;
    assert_eq!(resp.status(), 200);
    let body = resp.text().await.unwrap();
    assert!(body.contains("about demo"), "body={body}");
}

#[tokio::test]
async fn subdomain_c_path_proxies_to_node() {
    let node = spawn_mock_node().await;
    let edge = spawn_edge_default(&node.url()).await;
    let resp = timeout(
        Duration::from_secs(5),
        client()
            .post(format!("https://{}/c/abc123", edge.addr))
            .header("host", "demo.openlen.com")
            .body("pv=1&p=/")
            .send(),
    )
    .await
    .expect("timeout")
    .expect("send");
    assert_eq!(resp.status(), 200);
    let body = resp.text().await.unwrap();
    assert!(
        body.starts_with("REQ POST /c/abc123"),
        "did not proxy POST /c/: {body}"
    );
    // "pv=1&p=/" is 8 bytes.
    assert!(body.contains("BODY_BYTES: 8"), "body=[{body}]");
}

#[tokio::test]
async fn nested_subdomain_with_c_path_not_routed() {
    // Nested subdomains (a.b.openlen.com) don't match extract_subdomain →
    // not_found, no proxy, no disk.
    let node = spawn_mock_node().await;
    let edge = spawn_edge_default(&node.url()).await;
    let resp = get_with_host(edge.addr, "a.b.openlen.com", "/c/x").await;
    assert_eq!(resp.status(), 404);
}

// ---------------------------------------------------------------------------
// 2. Streaming body + large payloads
// ---------------------------------------------------------------------------

#[tokio::test]
async fn post_5mb_body_is_forwarded_intact() {
    let node = spawn_mock_node().await;
    let edge = spawn_edge_default(&node.url()).await;
    let payload: Vec<u8> = (0..5 * 1024 * 1024).map(|i| (i % 251) as u8).collect();
    let resp = timeout(
        Duration::from_secs(15),
        client()
            .post(format!("https://{}/echo-bytes", edge.addr))
            .header("host", "openlen.com")
            .body(payload.clone())
            .send(),
    )
    .await
    .expect("timeout")
    .expect("send");
    assert_eq!(resp.status(), 200);
    let text = resp.text().await.unwrap();
    let expected = format!("BODY_BYTES: {}", payload.len());
    assert!(
        text.contains(&expected),
        "missing {expected} in mock echo: {text}"
    );
}

#[tokio::test]
async fn sse_chunks_arrive_streaming_not_buffered() {
    let node = spawn_mock_node().await;
    let edge = spawn_edge_default(&node.url()).await;
    let resp = client()
        .get(format!("https://{}/sse", edge.addr))
        .header("host", "openlen.com")
        .send()
        .await
        .expect("send");
    assert_eq!(resp.status(), 200);
    assert_eq!(
        resp.headers()
            .get(reqwest::header::CONTENT_TYPE)
            .unwrap()
            .to_str()
            .unwrap(),
        "text/event-stream"
    );

    let start = Instant::now();
    let mut first_chunk_at: Option<Duration> = None;
    let mut last_chunk_at = Duration::ZERO;
    let mut total = Vec::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let bytes = chunk.expect("chunk");
        let now = start.elapsed();
        if first_chunk_at.is_none() {
            first_chunk_at = Some(now);
        }
        last_chunk_at = now;
        total.extend_from_slice(&bytes);
    }

    let body = String::from_utf8(total).expect("utf-8");
    // Each chunk is `data: chunkN\n\n` for N in 0..20. Verify all 20 land.
    for i in 0..20u32 {
        let needle = format!("data: chunk{i}\n\n");
        assert!(
            body.contains(&needle),
            "missing {needle} in stream output: {body}"
        );
    }

    let first = first_chunk_at.expect("at least one chunk");
    // First chunk arrives reasonably quickly (proxy overhead + first 50 ms upstream sleep).
    assert!(
        first < Duration::from_millis(1500),
        "first chunk too late: {first:?}"
    );
    // Last chunk arrives well after the first — proves the proxy did NOT buffer
    // the whole response before flushing (20 chunks × 50 ms = 1 s wall).
    assert!(
        last_chunk_at - first > Duration::from_millis(500),
        "stream looked buffered: first={first:?}, last={last_chunk_at:?}"
    );
}

// ---------------------------------------------------------------------------
// 3. X-Forwarded-* header forwarding
// ---------------------------------------------------------------------------

#[tokio::test]
async fn xff_appended_when_present() {
    let node = spawn_mock_node().await;
    let edge = spawn_edge_default(&node.url()).await;
    let resp = client()
        .get(format!("https://{}/echo", edge.addr))
        .header("host", "openlen.com")
        .header("x-forwarded-for", "1.2.3.4")
        .send()
        .await
        .expect("send");
    let body = resp.text().await.unwrap();
    let line = body
        .lines()
        .find(|l| l.starts_with("x-forwarded-for: "))
        .unwrap_or_else(|| panic!("no XFF in mock echo: {body}"));
    assert!(
        line.starts_with("x-forwarded-for: 1.2.3.4, 127.0.0.1"),
        "XFF wrong: {line}"
    );
}

#[tokio::test]
async fn xff_set_when_absent() {
    let node = spawn_mock_node().await;
    let edge = spawn_edge_default(&node.url()).await;
    let resp = client()
        .get(format!("https://{}/echo", edge.addr))
        .header("host", "openlen.com")
        .send()
        .await
        .expect("send");
    let body = resp.text().await.unwrap();
    let line = body
        .lines()
        .find(|l| l.starts_with("x-forwarded-for: "))
        .unwrap_or_else(|| panic!("no XFF: {body}"));
    assert_eq!(line, "x-forwarded-for: 127.0.0.1");
}

#[tokio::test]
async fn xforwarded_proto_is_https() {
    let node = spawn_mock_node().await;
    let edge = spawn_edge_default(&node.url()).await;
    let resp = client()
        .get(format!("https://{}/echo", edge.addr))
        .header("host", "openlen.com")
        .header("x-forwarded-proto", "http") // attempted spoof
        .send()
        .await
        .expect("send");
    let body = resp.text().await.unwrap();
    assert!(
        body.contains("x-forwarded-proto: https\n"),
        "X-Forwarded-Proto not forced to https: {body}"
    );
}

#[tokio::test]
async fn xforwarded_host_equals_incoming_host() {
    let node = spawn_mock_node().await;
    let edge = spawn_edge_default(&node.url()).await;
    let resp = get_with_host(edge.addr, "openlen.com", "/echo").await;
    let body = resp.text().await.unwrap();
    assert!(
        body.contains("x-forwarded-host: openlen.com\n"),
        "X-Forwarded-Host wrong: {body}"
    );
}

#[tokio::test]
async fn xreal_ip_is_peer_ip_no_port() {
    let node = spawn_mock_node().await;
    let edge = spawn_edge_default(&node.url()).await;
    let resp = get_with_host(edge.addr, "openlen.com", "/echo").await;
    let body = resp.text().await.unwrap();
    assert!(
        body.contains("x-real-ip: 127.0.0.1\n"),
        "X-Real-IP missing/wrong: {body}"
    );
}

#[tokio::test]
async fn upstream_sees_client_host_not_localhost() {
    let node = spawn_mock_node().await;
    let edge = spawn_edge_default(&node.url()).await;
    let resp = get_with_host(edge.addr, "www.openlen.com", "/echo").await;
    let body = resp.text().await.unwrap();
    assert!(
        body.contains("host: www.openlen.com\n"),
        "Host not forwarded: {body}"
    );
    // Ensure the upstream's loopback authority is NOT what the upstream saw as Host.
    assert!(
        !body.contains("host: 127.0.0.1:"),
        "Host wrongly rewrote to mock upstream: {body}"
    );
}

// ---------------------------------------------------------------------------
// 4. Hop-by-hop strip — request side
// ---------------------------------------------------------------------------

#[tokio::test]
async fn connection_header_stripped_on_request() {
    let node = spawn_mock_node().await;
    let edge = spawn_edge_default(&node.url()).await;
    let resp = client()
        .get(format!("https://{}/echo", edge.addr))
        .header("host", "openlen.com")
        .header("connection", "close")
        .send()
        .await
        .expect("send");
    let body = resp.text().await.unwrap();
    assert!(
        !body.lines().any(|l| l.starts_with("connection: close")),
        "connection: close leaked: {body}"
    );
}

#[tokio::test]
async fn upgrade_header_stripped_on_request() {
    let node = spawn_mock_node().await;
    let edge = spawn_edge_default(&node.url()).await;
    let resp = client()
        .get(format!("https://{}/echo", edge.addr))
        .header("host", "openlen.com")
        .header("upgrade", "websocket")
        .send()
        .await
        .expect("send");
    let body = resp.text().await.unwrap();
    assert!(
        !body.lines().any(|l| l.starts_with("upgrade: ")),
        "upgrade leaked: {body}"
    );
}

#[tokio::test]
async fn proxy_authorization_stripped_on_request() {
    let node = spawn_mock_node().await;
    let edge = spawn_edge_default(&node.url()).await;
    let resp = client()
        .get(format!("https://{}/echo", edge.addr))
        .header("host", "openlen.com")
        .header("proxy-authorization", "Bearer secret")
        .header("proxy-foo", "bar")
        .send()
        .await
        .expect("send");
    let body = resp.text().await.unwrap();
    assert!(
        !body.lines().any(|l| l.starts_with("proxy-")),
        "proxy-* leaked: {body}"
    );
}

#[tokio::test]
async fn te_and_trailer_stripped_on_request() {
    let node = spawn_mock_node().await;
    let edge = spawn_edge_default(&node.url()).await;
    let resp = client()
        .get(format!("https://{}/echo", edge.addr))
        .header("host", "openlen.com")
        .header("te", "trailers")
        .header("trailer", "expires")
        .send()
        .await
        .expect("send");
    let body = resp.text().await.unwrap();
    assert!(
        !body.lines().any(|l| l.starts_with("te: ")),
        "TE leaked: {body}"
    );
    assert!(
        !body.lines().any(|l| l.starts_with("trailer: ")),
        "Trailer leaked: {body}"
    );
}

// ---------------------------------------------------------------------------
// 5. Hop-by-hop strip — response side
// ---------------------------------------------------------------------------

#[tokio::test]
async fn upstream_connection_header_stripped_on_response() {
    let node = spawn_mock_node().await;
    let edge = spawn_edge_default(&node.url()).await;
    let resp = client()
        .get(format!("https://{}/hop-resp", edge.addr))
        .header("host", "openlen.com")
        .send()
        .await
        .expect("send");
    assert_eq!(resp.status(), 200);
    assert!(
        resp.headers().get("connection").is_none(),
        "Connection header on response leaked through: {:?}",
        resp.headers()
    );
    assert_eq!(
        resp.headers()
            .get("custom-header")
            .and_then(|v| v.to_str().ok()),
        Some("survives"),
        "custom-header should pass through"
    );
}

// ---------------------------------------------------------------------------
// 6. Error paths
// ---------------------------------------------------------------------------

/// Bind a TCP listener on 127.0.0.1, capture its port, drop the listener —
/// the port is then in the kernel's "no-listener" state, so the next connect
/// attempt fails with RST immediately on both Linux and Windows. More
/// reliable than picking a "probably-unbound" port (which Windows answers
/// with a slow SYN retransmission rather than RST).
async fn unbound_addr() -> SocketAddr {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    drop(listener);
    addr
}

#[tokio::test]
async fn upstream_down_returns_502() {
    let addr = unbound_addr().await;
    let edge = spawn_edge_default(&format!("http://{addr}")).await;
    let resp = get_with_host(edge.addr, "openlen.com", "/").await;
    assert_eq!(resp.status(), 502);
    let body = resp.text().await.unwrap();
    assert!(body.contains("Bad Gateway"), "body={body}");
}

#[tokio::test]
async fn conn_cap_zero_drops_proxy_too() {
    let node = spawn_mock_node().await;
    let edge = spawn_edge(EdgeOpts {
        node_url: &node.url(),
        max_inflight: 0,
        proxy_hosts: None,
        proxy_paths: None,
        body_idle_timeout_secs: None,
    })
    .await;
    let result = timeout(
        Duration::from_secs(3),
        client()
            .get(format!("https://{}/", edge.addr))
            .header("host", "openlen.com")
            .send(),
    )
    .await
    .expect("did not time out");
    assert!(
        result.is_err(),
        "cap=0 should drop the connection even on proxy paths, got {result:?}"
    );
}

// ---------------------------------------------------------------------------
// 7. Custom proxy_hosts / proxy_paths via builder
// ---------------------------------------------------------------------------

#[tokio::test]
async fn custom_proxy_hosts_replace_apex() {
    let node = spawn_mock_node().await;
    let edge = spawn_edge(EdgeOpts {
        node_url: &node.url(),
        max_inflight: 4096,
        proxy_hosts: Some(vec!["api.example.com".into()]),
        proxy_paths: None,
        body_idle_timeout_secs: None,
    })
    .await;
    // openlen.com no longer in the proxy list → not_found
    let resp1 = get_with_host(edge.addr, "openlen.com", "/").await;
    assert_eq!(resp1.status(), 404);
    // api.example.com now proxies
    let resp2 = get_with_host(edge.addr, "api.example.com", "/x").await;
    assert_eq!(resp2.status(), 200);
    let body2 = resp2.text().await.unwrap();
    assert!(body2.starts_with("REQ GET /x"), "{body2}");
}

#[tokio::test]
async fn custom_proxy_paths_replace_default() {
    let node = spawn_mock_node().await;
    let edge = spawn_edge(EdgeOpts {
        node_url: &node.url(),
        max_inflight: 4096,
        proxy_hosts: None,
        proxy_paths: Some(vec!["/api/".into()]),
        body_idle_timeout_secs: None,
    })
    .await;
    // /api/ on a subdomain proxies
    let resp1 = client()
        .post(format!("https://{}/api/anything", edge.addr))
        .header("host", "demo.openlen.com")
        .body("payload")
        .send()
        .await
        .expect("send");
    assert_eq!(resp1.status(), 200);
    let body1 = resp1.text().await.unwrap();
    assert!(body1.starts_with("REQ POST /api/anything"), "{body1}");
    // /c/ on a subdomain no longer proxies — falls back to disk → fixture
    // has no /c/anything file, /c has no extension → SPA fallback → 200 with
    // index.html (which contains "demo home")
    let resp2 = get_with_host(edge.addr, "demo.openlen.com", "/c/anything").await;
    assert_eq!(resp2.status(), 200);
    let body2 = resp2.text().await.unwrap();
    assert!(
        body2.contains("demo home"),
        "expected SPA fallback to disk index, got: {body2}"
    );
}

// ---------------------------------------------------------------------------
// 8. Query / method / regression
// ---------------------------------------------------------------------------

#[tokio::test]
async fn query_string_is_preserved() {
    let node = spawn_mock_node().await;
    let edge = spawn_edge_default(&node.url()).await;
    let resp = client()
        .get(format!(
            "https://{}/foo?bar=baz&qux=1&q=hola%20mundo",
            edge.addr
        ))
        .header("host", "openlen.com")
        .send()
        .await
        .expect("send");
    let body = resp.text().await.unwrap();
    assert!(
        body.starts_with("REQ GET /foo?bar=baz&qux=1&q=hola%20mundo"),
        "query missing: {body}"
    );
}

#[tokio::test]
async fn post_method_is_preserved() {
    let node = spawn_mock_node().await;
    let edge = spawn_edge_default(&node.url()).await;
    let resp = client()
        .post(format!("https://{}/submit", edge.addr))
        .header("host", "openlen.com")
        .body("hello")
        .send()
        .await
        .expect("send");
    let body = resp.text().await.unwrap();
    assert!(body.starts_with("REQ POST /submit"), "{body}");
    assert!(body.contains("BODY_BYTES: 5"), "{body}");
}

#[tokio::test]
async fn version_endpoint_not_proxied() {
    let node = spawn_mock_node().await;
    let edge = spawn_edge_default(&node.url()).await;
    let resp = get_with_host(edge.addr, "openlen.com", "/_edge/version").await;
    assert_eq!(resp.status(), 200);
    let body = resp.text().await.unwrap();
    assert!(
        body.contains("\"version\""),
        "expected local version JSON, got: {body}"
    );
    assert!(
        !body.starts_with("REQ "),
        "_edge/version was proxied: {body}"
    );
}

#[tokio::test]
async fn server_header_added_to_proxied_response() {
    let node = spawn_mock_node().await;
    let edge = spawn_edge_default(&node.url()).await;
    let resp = get_with_host(edge.addr, "openlen.com", "/").await;
    let s = resp
        .headers()
        .get(reqwest::header::SERVER)
        .expect("Server")
        .to_str()
        .unwrap()
        .to_owned();
    assert!(
        s.starts_with("openlen-edge/"),
        "Server not set on proxied response: {s}"
    );
}

// ---------------------------------------------------------------------------
// 9. Tower oneshot (bypass URL parsing) — direct fallback dispatch
// ---------------------------------------------------------------------------

#[tokio::test]
async fn tower_oneshot_subdomain_with_proxy_path_dispatches_through_decide() {
    use tower::ServiceExt;

    let node = spawn_mock_node().await;
    let cfg = EdgeConfig::builder()
        .bind("127.0.0.1:0".parse().unwrap())
        .cert_path(PathBuf::from("/tmp/cert.pem"))
        .key_path(PathBuf::from("/tmp/key.pem"))
        .publish_root(PathBuf::from(FIXTURE_ROOT))
        .node_url(node.url())
        .build()
        .unwrap();
    let state = openlen_edge::AppState::from_config(&cfg).unwrap();
    let app = openlen_edge::router(state);

    let mut req = Request::builder()
        .method("POST")
        .uri("/c/abc")
        .header("host", "demo.openlen.com")
        .body(Body::from("pv=1"))
        .unwrap();
    req.extensions_mut()
        .insert(ConnectInfo::<SocketAddr>("127.0.0.1:9000".parse().unwrap()));
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), 200);
}

#[tokio::test]
async fn tower_oneshot_apex_with_proxy_down_returns_502() {
    use tower::ServiceExt;

    let addr = unbound_addr().await;
    let cfg = EdgeConfig::builder()
        .bind("127.0.0.1:0".parse().unwrap())
        .cert_path(PathBuf::from("/tmp/cert.pem"))
        .key_path(PathBuf::from("/tmp/key.pem"))
        .publish_root(PathBuf::from(FIXTURE_ROOT))
        .node_url(format!("http://{addr}"))
        .node_timeout_secs(5)
        .build()
        .unwrap();
    let state = openlen_edge::AppState::from_config(&cfg).unwrap();
    let app = openlen_edge::router(state);

    let mut req = Request::builder()
        .uri("/")
        .header("host", "openlen.com")
        .body(Body::empty())
        .unwrap();
    req.extensions_mut()
        .insert(ConnectInfo::<SocketAddr>("127.0.0.1:9000".parse().unwrap()));
    let resp = app.oneshot(req).await.unwrap();
    assert_eq!(resp.status(), 502);
}

#[tokio::test]
async fn many_concurrent_proxied_requests_share_pool() {
    let node = spawn_mock_node().await;
    let edge = Arc::new(spawn_edge_default(&node.url()).await);
    let mut handles = Vec::new();
    for i in 0..32 {
        let addr = edge.addr;
        handles.push(tokio::spawn(async move {
            client()
                .get(format!("https://{addr}/multi/{i}"))
                .header("host", "openlen.com")
                .send()
                .await
                .map(|r| r.status().as_u16())
        }));
    }
    let mut ok = 0;
    for h in handles {
        match h.await.unwrap() {
            Ok(200) => ok += 1,
            other => panic!("unexpected: {other:?}"),
        }
    }
    assert_eq!(ok, 32);
}

// ---------------------------------------------------------------------------
// 10. F2 S6 A4 — upstream body idle timeout
// ---------------------------------------------------------------------------

#[tokio::test]
async fn upstream_body_idle_timeout_truncates_response() {
    // Mock returns headers + one chunk + hangs the body forever. With a
    // 200 ms idle window the edge must error the body within ~milliseconds
    // of the second poll, not pin the tokio task waiting forever.
    let node = spawn_mock_node().await;
    let edge = spawn_edge(EdgeOpts {
        node_url: &node.url(),
        max_inflight: 4096,
        proxy_hosts: None,
        proxy_paths: None,
        body_idle_timeout_secs: Some(1),
    })
    .await;
    let started = Instant::now();
    let resp = timeout(
        Duration::from_secs(5),
        client()
            .get(format!("https://{}/hang-body", edge.addr))
            .header("host", "openlen.com")
            .send(),
    )
    .await
    .expect("send did not time out")
    .expect("send ok");
    assert_eq!(resp.status(), 200, "headers must arrive normally");

    // Reading the body must surface an error after ~1s, not hang.
    let result = timeout(Duration::from_secs(4), resp.text()).await;
    let elapsed = started.elapsed();
    assert!(
        result.is_ok(),
        "body read should not be killed by outer timeout — idle timer must fire first"
    );
    // The body either errored OR returned a truncated string; either way
    // the request completed well before the outer 4 s deadline.
    assert!(
        elapsed < Duration::from_secs(4),
        "idle-timeout teardown took too long: {elapsed:?}"
    );
    assert!(
        elapsed >= Duration::from_millis(800),
        "idle timeout fired too early: {elapsed:?}"
    );
}

#[tokio::test]
async fn upstream_body_idle_timeout_disabled_via_zero() {
    // body_idle_timeout_secs=0 disables the timer — SSE-like streams that
    // pause longer than the timer would have allowed still flow normally.
    let node = spawn_mock_node().await;
    let edge = spawn_edge(EdgeOpts {
        node_url: &node.url(),
        max_inflight: 4096,
        proxy_hosts: None,
        proxy_paths: None,
        body_idle_timeout_secs: Some(0),
    })
    .await;
    // /sse on the mock streams 20 chunks × 50 ms apart — well under any
    // realistic idle window, but here we're just proving the disabled path
    // doesn't break SSE either.
    let resp = client()
        .get(format!("https://{}/sse", edge.addr))
        .header("host", "openlen.com")
        .send()
        .await
        .expect("send");
    assert_eq!(resp.status(), 200);
    let body = resp.text().await.expect("body");
    assert!(
        body.matches("data: chunk").count() == 20,
        "expected 20 SSE chunks, got body: {body}"
    );
}
