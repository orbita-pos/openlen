//! End-to-end integration tests for the Rust Edge A/B engine (`crates/edge/src/ab/`)
//! and its Caddy loopback sidecar (`ab_loopback_router`).

use std::fs;
use std::net::SocketAddr;
use std::path::Path;

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{header, Request, StatusCode};
use http_body_util::BodyExt;
use openlen_edge::{ab_loopback_router, AppState, EdgeConfig};
use tempfile::TempDir;
use tower::ServiceExt;

fn build_state(publish_root: &Path) -> AppState {
    let cfg = EdgeConfig::builder()
        .bind("127.0.0.1:0".parse().unwrap())
        .cert_path(publish_root.join("unused.crt"))
        .key_path(publish_root.join("unused.key"))
        .publish_root(publish_root.to_path_buf())
        .ab_enabled(true)
        .build()
        .expect("config");
    AppState::from_config(&cfg).expect("app state")
}

fn write_release_with_ab(root: &Path, sub: &str, sha: &str, html_a: &str, html_b: &str) {
    let rel = root.join(sub).join("releases").join(sha);
    fs::create_dir_all(rel.join("_ab/ab_9f3c2a1b/b")).unwrap();
    fs::create_dir_all(rel.join("about")).unwrap();
    fs::write(rel.join("index.html"), html_a).unwrap();
    fs::write(rel.join("about/index.html"), "<h1>About</h1>").unwrap();
    fs::write(rel.join("_ab/ab_9f3c2a1b/b/index.html"), html_b).unwrap();
    fs::write(
        rel.join("ab.json"),
        format!(
            r#"{{
              "version": 1,
              "releaseSha": "{sha}",
              "experiments": [{{
                "id": "ab_9f3c2a1b",
                "cookieName": "ol_ab_9f3c2a1b",
                "targetPath": "/",
                "includeLocales": false,
                "locales": [],
                "splitBps": 5000,
                "salt": "3f9a1c8e7b2d4012",
                "prefixB": "_ab/ab_9f3c2a1b/b",
                "overrideParam": "_ol_ab",
                "expiresAt": null
              }}]
            }}"#
        ),
    )
    .unwrap();
    // Write release pointer file (works cross-platform on Windows + Unix).
    fs::write(root.join(sub).join("current"), sha).unwrap();
}

async fn send_loopback(
    app: &axum::Router,
    sub: &str,
    uri: &str,
    ua: &str,
    cookie: Option<&str>,
    cf_ip: &str,
) -> (StatusCode, axum::http::HeaderMap, String) {
    let mut builder = Request::builder()
        .uri(uri)
        .header(header::HOST, format!("{sub}.openlen.app"))
        .header("x-openlen-sub", sub)
        .header("cf-connecting-ip", cf_ip)
        .header(header::USER_AGENT, ua)
        .header(header::ACCEPT_LANGUAGE, "es-MX,es;q=0.9");
    if let Some(c) = cookie {
        builder = builder.header(header::COOKIE, c);
    }
    let mut req = builder.body(Body::empty()).unwrap();
    req.extensions_mut()
        .insert(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 54321))));
    let resp = app.clone().oneshot(req).await.unwrap();
    let status = resp.status();
    let headers = resp.headers().clone();
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    (status, headers, String::from_utf8_lossy(&bytes).into_owned())
}

#[tokio::test]
async fn blocks_ab_json_and_internal_ab_prefix_with_404() {
    let dir = TempDir::new().unwrap();
    write_release_with_ab(dir.path(), "demo", "aaaa11112222", "<h1>A</h1>", "<h1>B</h1>");
    let app = ab_loopback_router(build_state(dir.path()));
    let chrome = "Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36";

    for path in ["/ab.json", "/_ab", "/_ab/ab_9f3c2a1b/b/index.html"] {
        let (status, _, _) = send_loopback(&app, "demo", path, chrome, None, "198.51.100.1").await;
        assert_eq!(status, StatusCode::NOT_FOUND, "path={path} must 404");
    }
}

#[tokio::test]
async fn splits_traffic_sets_no_store_cookie_and_respects_bots_and_non_target_routes() {
    let dir = TempDir::new().unwrap();
    write_release_with_ab(
        dir.path(),
        "demo",
        "aaaa11112222",
        "<h1>Control A</h1>",
        "<h1>Variant B</h1>",
    );
    let app = ab_loopback_router(build_state(dir.path()));
    let chrome = "Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36";

    // First visit gets assigned + receives private, no-store + Vary: Cookie + Set-Cookie.
    let (status, headers, body) =
        send_loopback(&app, "demo", "/", chrome, None, "198.51.100.7").await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        headers.get(header::CACHE_CONTROL).unwrap(),
        "private, no-store"
    );
    assert_eq!(headers.get(header::VARY).unwrap(), "Cookie");
    let set_cookie = headers
        .get(header::SET_COOKIE)
        .expect("must mint sticky cookie")
        .to_str()
        .unwrap();
    assert!(set_cookie.starts_with("ol_ab_9f3c2a1b="));
    assert!(set_cookie.contains("SameSite=Lax"));
    assert!(body.contains("Control A") || body.contains("Variant B"));

    // Sticky cookie forces Variant B without re-minting cookie.
    let (s2, h2, b2) = send_loopback(
        &app,
        "demo",
        "/",
        chrome,
        Some("ol_ab_9f3c2a1b=b"),
        "198.51.100.7",
    )
    .await;
    assert_eq!(s2, StatusCode::OK);
    assert_eq!(b2, "<h1>Variant B</h1>");
    assert_eq!(h2.get("x-openlen-ab").unwrap(), "ab_9f3c2a1b:b");
    assert!(h2.get(header::SET_COOKIE).is_none());

    // Googlebot always gets Control A with zero Set-Cookie.
    let (sb, hb, bb) =
        send_loopback(&app, "demo", "/", "Googlebot/2.1", None, "66.249.66.1").await;
    assert_eq!(sb, StatusCode::OK);
    assert_eq!(bb, "<h1>Control A</h1>");
    assert_eq!(hb.get("x-openlen-ab").unwrap(), "ab_9f3c2a1b:a-bot");
    assert!(hb.get(header::SET_COOKIE).is_none());

    // Route outside targetPath (/about) keeps standard CDN cache headers.
    let (sa, ha, ba) = send_loopback(&app, "demo", "/about", chrome, None, "198.51.100.7").await;
    assert_eq!(sa, StatusCode::OK);
    assert_eq!(ba, "<h1>About</h1>");
    assert!(ha
        .get(header::CACHE_CONTROL)
        .unwrap()
        .to_str()
        .unwrap()
        .contains("s-maxage=3600"));
    assert!(ha.get("x-openlen-ab").is_none());
}

#[tokio::test]
async fn release_rotation_invalidates_manifest_cache_immediately() {
    let dir = TempDir::new().unwrap();
    write_release_with_ab(
        dir.path(),
        "demo",
        "111111111111",
        "<h1>A v1</h1>",
        "<h1>B v1</h1>",
    );
    let app = ab_loopback_router(build_state(dir.path()));
    let chrome = "Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36";

    let (_, _, b1) =
        send_loopback(&app, "demo", "/?_ol_ab=b", chrome, None, "198.51.100.9").await;
    assert_eq!(b1, "<h1>B v1</h1>");

    // Promote B to a clean release without ab.json and rotate `current`.
    let rel2 = dir.path().join("demo/releases/222222222222");
    fs::create_dir_all(&rel2).unwrap();
    fs::write(rel2.join("index.html"), "<h1>Promoted B</h1>").unwrap();
    fs::write(dir.path().join("demo/current"), "222222222222").unwrap();

    let (s2, h2, b2) = send_loopback(&app, "demo", "/", chrome, None, "198.51.100.9").await;
    assert_eq!(s2, StatusCode::OK);
    assert_eq!(b2, "<h1>Promoted B</h1>");
    assert!(h2.get("x-openlen-ab").is_none());
    assert!(h2
        .get(header::CACHE_CONTROL)
        .unwrap()
        .to_str()
        .unwrap()
        .contains("s-maxage=3600"));
}
