use std::net::SocketAddr;
use std::path::Path;
use std::time::Duration;

use rcgen::{generate_simple_self_signed, CertifiedKey};
use tempfile::TempDir;
use tokio::sync::oneshot;
use tokio::time::timeout;

use openlen_edge::{bind, load_wildcard, EdgeConfig};

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

async fn spawn_edge() -> Harness {
    let tempdir = TempDir::new().expect("tempdir");
    let (cert_path, key_path) = write_self_signed(tempdir.path(), &["localhost", "127.0.0.1"]);

    let cfg = EdgeConfig::builder()
        .bind("127.0.0.1:0".parse().unwrap())
        .cert_path(cert_path.clone())
        .key_path(key_path.clone())
        .build()
        .expect("build config");

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

fn write_self_signed(dir: &Path, sans: &[&str]) -> (std::path::PathBuf, std::path::PathBuf) {
    let CertifiedKey { cert, key_pair } =
        generate_simple_self_signed(sans.iter().map(|s| s.to_string()).collect::<Vec<_>>())
            .expect("generate cert");
    let cert_path = dir.join("cert.pem");
    let key_path = dir.join("key.pem");
    std::fs::write(&cert_path, cert.pem()).expect("write cert");
    std::fs::write(&key_path, key_pair.serialize_pem()).expect("write key");
    (cert_path, key_path)
}

fn client_h1() -> reqwest::Client {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(5))
        .build()
        .expect("client")
}

fn client_h2() -> reqwest::Client {
    reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(Duration::from_secs(5))
        .http2_prior_knowledge()
        .build()
        .expect("client")
}

#[tokio::test]
async fn handshake_succeeds_and_returns_200() {
    let h = spawn_edge().await;
    let url = format!("https://{}/", h.addr);
    let resp = timeout(Duration::from_secs(5), client_h1().get(&url).send())
        .await
        .expect("did not time out")
        .expect("request ok");
    assert_eq!(resp.status(), 200, "status was {}", resp.status());
}

#[tokio::test]
async fn body_announces_edge_alive() {
    let h = spawn_edge().await;
    let url = format!("https://{}/", h.addr);
    let body = client_h1()
        .get(&url)
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(
        body.contains("OpenLen edge alive"),
        "body did not include marker: {body:?}"
    );
}

#[tokio::test]
async fn body_echoes_host_header() {
    let h = spawn_edge().await;
    let url = format!("https://{}/", h.addr);
    let body = client_h1()
        .get(&url)
        .header("host", "example.openlen.com")
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert!(
        body.contains("example.openlen.com"),
        "host header not reflected: {body:?}"
    );
}

#[tokio::test]
async fn server_header_identifies_edge() {
    let h = spawn_edge().await;
    let url = format!("https://{}/", h.addr);
    let resp = client_h1().get(&url).send().await.unwrap();
    let server = resp
        .headers()
        .get(reqwest::header::SERVER)
        .expect("Server header present")
        .to_str()
        .unwrap()
        .to_owned();
    assert!(
        server.starts_with("openlen-edge/"),
        "unexpected Server header: {server}"
    );
}

#[tokio::test]
async fn version_endpoint_returns_json() {
    let h = spawn_edge().await;
    let url = format!("https://{}/_edge/version", h.addr);
    let resp = client_h1().get(&url).send().await.unwrap();
    assert_eq!(resp.status(), 200);
    let ctype = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    assert!(ctype.starts_with("application/json"), "got {ctype}");
    let body = resp.text().await.unwrap();
    assert!(body.contains("\"version\""), "body = {body:?}");
}

#[tokio::test]
async fn alpn_negotiates_http2() {
    let h = spawn_edge().await;
    let url = format!("https://{}/", h.addr);
    let resp = client_h2().get(&url).send().await.unwrap();
    assert_eq!(resp.version(), reqwest::Version::HTTP_2);
}
