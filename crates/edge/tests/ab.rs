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
    build_state_with(publish_root, false)
}

/// `sidecar`: the `--ab-sidecar` mode, where a file is decided, not served.
fn build_state_with(publish_root: &Path, sidecar: bool) -> AppState {
    let cfg = EdgeConfig::builder()
        .bind("127.0.0.1:0".parse().unwrap())
        .cert_path(publish_root.join("unused.crt"))
        .key_path(publish_root.join("unused.key"))
        .publish_root(publish_root.to_path_buf())
        .ab_enabled(true)
        .ab_sidecar_only(sidecar)
        .build()
        .expect("config");
    AppState::from_config(&cfg).expect("app state")
}

fn write_release_with_ab(root: &Path, sub: &str, sha: &str, html_a: &str, html_b: &str) {
    let rel = root.join(sub).join("releases").join(sha);
    fs::create_dir_all(rel.join("openlen/ab/ab_9f3c2a1b/b")).unwrap();
    fs::create_dir_all(rel.join("about")).unwrap();
    fs::write(rel.join("index.html"), html_a).unwrap();
    fs::write(rel.join("about/index.html"), "<h1>About</h1>").unwrap();
    fs::write(rel.join("openlen/ab/ab_9f3c2a1b/b/index.html"), html_b).unwrap();
    fs::write(rel.join("openlen/figure-0a1b2c3d.js"), "figure()").unwrap();
    // Files: B ships its own css/site.css, and the manifest lists it (and two more).
    fs::create_dir_all(rel.join("css")).unwrap();
    fs::create_dir_all(rel.join("img")).unwrap();
    fs::create_dir_all(rel.join("fonts")).unwrap();
    fs::create_dir_all(rel.join("openlen/ab/ab_9f3c2a1b/b/css")).unwrap();
    fs::create_dir_all(rel.join("openlen/ab/ab_9f3c2a1b/b/fonts")).unwrap();
    fs::write(rel.join("css/site.css"), "body{color:red}").unwrap();
    fs::write(rel.join("openlen/ab/ab_9f3c2a1b/b/css/site.css"), "body{color:blue}").unwrap();
    fs::write(rel.join("css/other.css"), "body{margin:0}").unwrap();
    fs::write(rel.join("img/hero.png"), "PNG-A").unwrap();
    fs::write(rel.join("fonts/a b.woff2"), "WOFF-A").unwrap();
    fs::write(rel.join("openlen/ab/ab_9f3c2a1b/b/fonts/a b.woff2"), "WOFF-B").unwrap();
    fs::write(
        rel.join("openlen/ab.json"),
        format!(
            r#"{{
              "version": 1,
              "releaseSha": "{sha}",
              "overrides": ["/css/site.css", "img/hero.png", "/fonts/a b.woff2"],
              "experiments": [{{
                "id": "ab_9f3c2a1b",
                "cookieName": "ol_ab_9f3c2a1b",
                "targetPath": "/",
                "includeLocales": false,
                "locales": [],
                "splitBps": 5000,
                "salt": "3f9a1c8e7b2d4012",
                "prefixB": "openlen/ab/ab_9f3c2a1b/b",
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

    for path in [
        "/openlen/ab.json",
        "/openlen/ab",
        "/openlen/ab/ab_9f3c2a1b/b/index.html",
    ] {
        let (status, _, _) = send_loopback(&app, "demo", path, chrome, None, "198.51.100.1").await;
        assert_eq!(status, StatusCode::NOT_FOUND, "path={path} must 404");
    }
}

#[tokio::test]
async fn the_block_looks_at_the_resolved_path_not_the_raw_one() {
    let dir = TempDir::new().unwrap();
    write_release_with_ab(dir.path(), "demo", "aaaa11112222", "<h1>A</h1>", "<h1>B</h1>");
    let app = ab_loopback_router(build_state(dir.path()));
    let chrome = "Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36";

    // Each of these used to walk past the raw-path filter and answer the manifest or B's tree
    // (or the control page through the SPA fallback) after the resolver decoded it.
    for path in [
        "/openlen/ab.json/",
        "/openlen/%61b.json",
        "/openlen/%61B.JSON",
        "/openlen/./ab.json",
        "/openlen//ab.json",
        "/foo/../openlen/ab.json",
        "/openlen/ab%2Ejson",
        "/openlen%2Fab.json",
        "/openlen/%61b/ab_9f3c2a1b/b/index.html",
        "/OPENLEN/AB/ab_9f3c2a1b/b/index.html",
        "/openlen/ab/",
    ] {
        let (status, _, body) =
            send_loopback(&app, "demo", path, chrome, None, "198.51.100.1").await;
        assert_eq!(status, StatusCode::NOT_FOUND, "path={path} must 404");
        assert!(!body.contains("experiments"), "path={path} leaked the manifest");
    }
}

#[tokio::test]
async fn variant_b_still_reads_its_own_tree_even_though_visitors_cannot() {
    let dir = TempDir::new().unwrap();
    write_release_with_ab(dir.path(), "demo", "aaaa11112222", "<h1>A</h1>", "<h1>B</h1>");
    let app = ab_loopback_router(build_state(dir.path()));
    let chrome = "Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36";
    let (status, _, body) = send_loopback(
        &app,
        "demo",
        "/?_ol_ab=b",
        chrome,
        None,
        "198.51.100.1",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, "<h1>B</h1>");
}

#[tokio::test]
async fn other_files_of_the_reserved_openlen_root_keep_being_served() {
    let dir = TempDir::new().unwrap();
    write_release_with_ab(dir.path(), "demo", "aaaa11112222", "<h1>A</h1>", "<h1>B</h1>");
    let app = ab_loopback_router(build_state(dir.path()));
    let chrome = "Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36";
    let (status, _, body) = send_loopback(
        &app,
        "demo",
        "/openlen/figure-0a1b2c3d.js",
        chrome,
        None,
        "198.51.100.1",
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body, "figure()");
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

#[tokio::test]
async fn the_sidecar_serves_pages_and_only_decides_files() {
    let dir = TempDir::new().unwrap();
    write_release_with_ab(dir.path(), "demo", "aaaa11112222", "<h1>A</h1>", "<h1>B</h1>");
    let app = ab_loopback_router(build_state_with(dir.path(), true));
    let chrome = "Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36";
    let ip = "198.51.100.1";

    // A B visitor asking for a file B overrides: no bytes, the path of B's file.
    let (status, h, body) =
        send_loopback(&app, "demo", "/css/site.css", chrome, Some("ol_ab_9f3c2a1b=b"), ip).await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(body, "");
    assert_eq!(h.get("x-openlen-serve").unwrap(), "/openlen/ab/ab_9f3c2a1b/b/css/site.css");
    assert_eq!(h.get("x-openlen-ab").unwrap(), "ab_9f3c2a1b:b");
    assert_eq!(h.get(header::CACHE_CONTROL).unwrap(), "no-store");

    // Everyone else gets CONTROL's file, decided all the same (so Caddy marks it no-store).
    for cookie in [None, Some("ol_ab_9f3c2a1b=a")] {
        let (status, h, _) = send_loopback(&app, "demo", "/css/site.css", chrome, cookie, ip).await;
        assert_eq!(status, StatusCode::NO_CONTENT);
        assert_eq!(h.get("x-openlen-serve").unwrap(), "/css/site.css");
        assert_eq!(h.get("x-openlen-ab").unwrap(), "ab_9f3c2a1b:a");
    }

    // The override parameter works on a file too.
    let (_, h, _) = send_loopback(&app, "demo", "/css/site.css?_ol_ab=b", chrome, None, ip).await;
    assert_eq!(h.get("x-openlen-serve").unwrap(), "/openlen/ab/ab_9f3c2a1b/b/css/site.css");

    // A file B lists but does not ship falls back to control's file, still decided.
    let (_, h, _) =
        send_loopback(&app, "demo", "/img/hero.png", chrome, Some("ol_ab_9f3c2a1b=b"), ip).await;
    assert_eq!(h.get("x-openlen-serve").unwrap(), "/img/hero.png");
    assert_eq!(h.get("x-openlen-ab").unwrap(), "ab_9f3c2a1b:a");

    // A name with a space travels percent-encoded (Caddy rewrites to it).
    let (_, h, _) = send_loopback(
        &app,
        "demo",
        "/fonts/a%20b.woff2",
        chrome,
        Some("ol_ab_9f3c2a1b=b"),
        ip,
    )
    .await;
    assert_eq!(
        h.get("x-openlen-serve").unwrap(),
        "/openlen/ab/ab_9f3c2a1b/b/fonts/a%20b.woff2"
    );

    // A file the manifest does not list is nobody's business: 204, nothing else.
    for path in ["/css/other.css", "/img/missing.png", "/openlen/figure-0a1b2c3d.js"] {
        let (status, h, body) =
            send_loopback(&app, "demo", path, chrome, Some("ol_ab_9f3c2a1b=b"), ip).await;
        assert_eq!(status, StatusCode::NO_CONTENT, "{path}");
        assert_eq!(body, "", "{path}");
        assert!(h.get("x-openlen-serve").is_none(), "{path}");
    }

    // The internal files stay 404, decided or not.
    let (status, _, _) = send_loopback(&app, "demo", "/openlen/ab.json", chrome, None, ip).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn the_sidecars_pages_carry_final_headers_and_nothing_immutable() {
    let dir = TempDir::new().unwrap();
    write_release_with_ab(dir.path(), "demo", "aaaa11112222", "<h1>A</h1>", "<h1>B</h1>");
    let app = ab_loopback_router(build_state_with(dir.path(), true));
    let chrome = "Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36";

    // An experiment page: private, no-store, Vary, charset, no Server header (Caddy sends its own).
    let (status, h, body) = send_loopback(&app, "demo", "/", chrome, None, "198.51.100.7").await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.contains("<h1>"));
    assert_eq!(h.get(header::CACHE_CONTROL).unwrap(), "private, no-store");
    assert_eq!(h.get(header::VARY).unwrap(), "Cookie");
    assert_eq!(h.get(header::CONTENT_TYPE).unwrap(), "text/html; charset=utf-8");
    assert!(h.get(header::SERVER).is_none());
    assert_eq!(h.get_all(header::CACHE_CONTROL).iter().count(), 1);
    assert_eq!(h.get_all(header::CONTENT_TYPE).iter().count(), 1);

    // Another page of the site: Caddy's own page policy, so nothing changes for it.
    let (_, h, _) = send_loopback(&app, "demo", "/about", chrome, None, "198.51.100.7").await;
    assert_eq!(
        h.get(header::CACHE_CONTROL).unwrap(),
        "public, max-age=60, s-maxage=3600, stale-while-revalidate=86400"
    );
    assert_eq!(h.get(header::CONTENT_TYPE).unwrap(), "text/html; charset=utf-8");
    assert!(h.get("x-openlen-ab").is_none());

    // Nothing the sidecar answers is ever immutable.
    for path in ["/", "/about", "/css/site.css", "/css/other.css", "/img/hero.png"] {
        let (_, h, _) =
            send_loopback(&app, "demo", path, chrome, Some("ol_ab_9f3c2a1b=b"), "1.1.1.1").await;
        let cc = h
            .get(header::CACHE_CONTROL)
            .map(|v| v.to_str().unwrap().to_owned())
            .unwrap_or_default();
        assert!(!cc.contains("immutable"), "{path}: {cc}");
    }
}

#[tokio::test]
async fn the_sidecar_does_not_answer_the_edge_version_route() {
    let dir = TempDir::new().unwrap();
    write_release_with_ab(dir.path(), "demo", "aaaa11112222", "<h1>A</h1>", "<h1>B</h1>");
    let app = ab_loopback_router(build_state_with(dir.path(), true));
    let mut req = Request::builder()
        .uri("/_edge/version")
        .header(header::HOST, "localhost")
        .body(Body::empty())
        .unwrap();
    req.extensions_mut()
        .insert(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 54321))));
    let resp = app.clone().oneshot(req).await.unwrap();
    assert_eq!(resp.status(), StatusCode::NOT_FOUND);
    let bytes = resp.into_body().collect().await.unwrap().to_bytes();
    assert!(!String::from_utf8_lossy(&bytes).contains("version"));
}

#[tokio::test]
async fn the_site_is_found_from_the_host_under_any_publish_host() {
    let dir = TempDir::new().unwrap();
    write_release_with_ab(dir.path(), "demo", "aaaa11112222", "<h1>A</h1>", "<h1>B</h1>");
    let app = ab_loopback_router(build_state_with(dir.path(), true));
    // No X-OpenLen-Sub: the Host decides, and `.openlen.app` is a publish host (not only `.com`).
    for host in ["demo.openlen.app", "demo.openlen.com"] {
        let mut req = Request::builder()
            .uri("/?_ol_ab=b")
            .header(header::HOST, host)
            .header(header::USER_AGENT, "Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36")
            .body(Body::empty())
            .unwrap();
        req.extensions_mut()
            .insert(ConnectInfo(SocketAddr::from(([127, 0, 0, 1], 54321))));
        let resp = app.clone().oneshot(req).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK, "{host}");
        let bytes = resp.into_body().collect().await.unwrap().to_bytes();
        assert_eq!(&bytes[..], b"<h1>B</h1>", "{host}");
    }
}

#[tokio::test]
async fn the_full_edge_marks_a_decided_file_no_store_for_control_too() {
    let dir = TempDir::new().unwrap();
    write_release_with_ab(dir.path(), "demo", "aaaa11112222", "<h1>A</h1>", "<h1>B</h1>");
    // Not the sidecar: the whole web tier, which serves the bytes itself.
    let app = ab_loopback_router(build_state_with(dir.path(), false));
    let chrome = "Mozilla/5.0 Chrome/131.0.0.0 Safari/537.36";
    for (cookie, expected) in [
        (None, "body{color:red}"),
        (Some("ol_ab_9f3c2a1b=b"), "body{color:blue}"),
    ] {
        let (status, h, body) =
            send_loopback(&app, "demo", "/css/site.css", chrome, cookie, "198.51.100.1").await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(body, expected);
        assert_eq!(h.get(header::CACHE_CONTROL).unwrap(), "no-store");
        assert_eq!(h.get(header::VARY).unwrap(), "Cookie");
        assert!(h.get(header::ETAG).is_none());
    }
    // B lists the file but does not ship it: control's bytes, no-store all the same.
    let (_, h, body) = send_loopback(
        &app,
        "demo",
        "/img/hero.png",
        chrome,
        Some("ol_ab_9f3c2a1b=b"),
        "198.51.100.1",
    )
    .await;
    assert_eq!(body, "PNG-A");
    assert_eq!(h.get(header::CACHE_CONTROL).unwrap(), "no-store");
    // A file nobody decided keeps the normal policy.
    let (_, h, _) =
        send_loopback(&app, "demo", "/css/other.css", chrome, None, "198.51.100.1").await;
    assert!(h
        .get(header::CACHE_CONTROL)
        .unwrap()
        .to_str()
        .unwrap()
        .contains("immutable"));
}
