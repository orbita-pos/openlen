use std::future::Future;
use std::net::SocketAddr;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use axum::body::Body;
use axum::extract::{ConnectInfo, State};
use axum::http::{header, HeaderName, HeaderValue, Request, Response, StatusCode};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use hyper_util::rt::{TokioExecutor, TokioIo, TokioTimer};
use rustls::ServerConfig;
use tokio::net::TcpListener;
use tokio::sync::{watch, Semaphore};
use tokio_rustls::TlsAcceptor;
use tower::ServiceExt;
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;
use tracing::{debug, error, info, warn};

use crate::ab::{
    evaluate_request, is_blocked_internal_path, AbDecision, AbManifestCache, AssignSource, Variant,
};
use crate::config::EdgeConfig;
use crate::files::{cache_control_for, resolve, resolve_strict, Resolved, AB_HTML_CACHE_CONTROL};
use crate::lookup::{DomainLookup, MockDomainLookup};
use crate::middleware::RateLimitLayer;
use crate::proxy::{self, decide_route, disk_base_for, DiskBase, NodeClient, RouteAction};
use crate::routing::extract_subdomain;

/// Cache-Control for files served out of the shared uploads root. 30 days
/// immutable matches nginx's `expires 30d; Cache-Control: public, immutable`
/// and Caddy's `public, immutable, max-age=2592000` — uploads are content-
/// hashed by the workspace flow, so they don't change in place.
const SHARED_UPLOADS_CACHE_CONTROL: &str = "public, immutable, max-age=2592000";

/// Cache-Control for files under `/_next/static/`. Next.js hashes the build
/// output, so 1 year + immutable is correct. Matches nginx + Caddy.
const NEXT_STATIC_CACHE_CONTROL: &str = "public, immutable, max-age=31536000";

/// Security headers applied to every response — values match nginx
/// `add_header ... always` + Caddy `header { ... }` parity. Set with
/// `SetResponseHeaderLayer::overriding`, so an upstream that tries to set a
/// weaker policy gets canonicalised at the edge.
const HSTS_VALUE: &str = "max-age=31536000; includeSubDomains";
const X_CTO_VALUE: &str = "nosniff";
const X_FRAME_OPTIONS_VALUE: &str = "SAMEORIGIN";
const REFERRER_POLICY_VALUE: &str = "strict-origin-when-cross-origin";
const PERMISSIONS_POLICY_VALUE: &str = "camera=(self), microphone=(self), geolocation=(self)";

/// Permissions-Policy isn't a `http::header::HeaderName` constant in the
/// current http crate version. `HeaderName::from_static` is a cheap
/// validation, but `router()` runs once on startup so we still construct it
/// inline at the call site rather than caching.
const PERMISSIONS_POLICY_NAME: &str = "permissions-policy";

/// Bucket labels matching the response status class. Cheap match instead of
/// re-formatting on every emission.
fn status_class(code: u16) -> &'static str {
    match code / 100 {
        2 => "2xx",
        3 => "3xx",
        4 => "4xx",
        5 => "5xx",
        _ => "other",
    }
}

fn route_kind_label(action: &RouteAction) -> &'static str {
    match action {
        RouteAction::Disk { .. } => "subdomain_disk",
        RouteAction::CustomDomain { .. } => "custom_domain_disk",
        RouteAction::Proxy => "proxy",
        RouteAction::SharedUploads => "shared_uploads",
        RouteAction::NextStatic => "next_static",
        RouteAction::NotFound => "not_found",
    }
}

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const SERVER_HEADER_VALUE: &str = concat!("openlen-edge/", env!("CARGO_PKG_VERSION"));

/// HTTP/1.1 idle-pool tuning for the upstream Node client. Chosen so the pool
/// can amortize a steady stream of forwarded requests without holding too many
/// FDs open against a single Node process.
const NODE_POOL_IDLE: Duration = Duration::from_secs(90);
const NODE_POOL_MAX_IDLE_PER_HOST: usize = 32;

/// Cap on inbound HTTP/1.1 header read. Closes Slowloris-style requests that
/// dribble headers across many TCP segments. Matches the value we'll add to the
/// upstream client pool.
const HEADER_READ_TIMEOUT: Duration = Duration::from_secs(30);

/// Per-request state injected into the router. Holds the canonicalized publish
/// root so the file resolver never re-canonicalises on the hot path, a
/// pre-built [`NodeClient`] + proxy decision lists for the proxy module, and a
/// trait-object [`DomainLookup`] for resolving custom domains.
#[derive(Clone)]
pub struct AppState {
    pub publish_root: Arc<PathBuf>,
    /// Canonical shared-uploads root. Serves `<uploads_root>/<path>` for any
    /// host whose URL starts with `/uploads/`.
    pub uploads_root: Arc<PathBuf>,
    /// Canonical Next.js static root. Serves `<next_static_root>/<path>` for
    /// apex/www hosts whose URL starts with `/_next/static/`.
    pub next_static_root: Arc<PathBuf>,
    pub node_client: NodeClient,
    pub proxy_hosts: Arc<Vec<String>>,
    pub proxy_paths: Arc<Vec<String>>,
    pub custom_domain_proxy_paths: Arc<Vec<String>>,
    pub domain_lookup: Arc<dyn DomainLookup>,
    /// Optional per-release `ab.json` manifest cache. `None` when A/B routing
    /// is disabled (`OPENLEN_EDGE_AB_ENABLED=false`).
    pub ab_cache: Option<Arc<AbManifestCache>>,
}

impl std::fmt::Debug for AppState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AppState")
            .field("publish_root", &self.publish_root)
            .field("uploads_root", &self.uploads_root)
            .field("next_static_root", &self.next_static_root)
            .field("node_client", &self.node_client)
            .field("proxy_hosts", &self.proxy_hosts)
            .field("proxy_paths", &self.proxy_paths)
            .field("custom_domain_proxy_paths", &self.custom_domain_proxy_paths)
            .field("domain_lookup", &self.domain_lookup)
            .field("ab_enabled", &self.ab_cache.is_some())
            .finish()
    }
}

impl AppState {
    /// Build an [`AppState`] with an empty in-memory custom-domain mock. The
    /// mock never matches, so custom-domain requests fall through to 404 —
    /// useful for the routing/proxy integration tests which don't exercise the
    /// lookup path. Production callers should use [`AppState::with_lookup`]
    /// (or [`bind_with_lookup`]) to inject a real lookup.
    pub fn from_config(config: &EdgeConfig) -> Result<Self> {
        Self::with_lookup(config, Arc::new(MockDomainLookup::new()))
    }

    /// Build an [`AppState`] with the supplied custom-domain lookup.
    pub fn with_lookup(config: &EdgeConfig, domain_lookup: Arc<dyn DomainLookup>) -> Result<Self> {
        let canonical = config
            .publish_root
            .canonicalize()
            .unwrap_or_else(|_| config.publish_root.clone());
        // Falling back to the un-canonicalized path lets tests / dev boots
        // succeed before the dir exists on disk; `resolve_strict` will just
        // return NotFound on the first lookup and the operator gets a clean
        // 404 instead of a startup crash.
        let uploads_canonical = config
            .uploads_root
            .canonicalize()
            .unwrap_or_else(|_| config.uploads_root.clone());
        let next_static_canonical = config
            .next_static_root
            .canonicalize()
            .unwrap_or_else(|_| config.next_static_root.clone());
        let body_idle = if config.proxy_body_idle_timeout_secs == 0 {
            None
        } else {
            Some(Duration::from_secs(config.proxy_body_idle_timeout_secs))
        };
        let node_client = NodeClient::new(
            &config.node_url,
            NODE_POOL_IDLE,
            NODE_POOL_MAX_IDLE_PER_HOST,
            Duration::from_secs(config.node_timeout_secs),
            body_idle,
        )
        .context("constructing upstream NodeClient")?;
        Ok(Self {
            publish_root: Arc::new(canonical),
            uploads_root: Arc::new(uploads_canonical),
            next_static_root: Arc::new(next_static_canonical),
            node_client,
            proxy_hosts: Arc::new(config.proxy_hosts.clone()),
            proxy_paths: Arc::new(config.proxy_paths.clone()),
            custom_domain_proxy_paths: Arc::new(config.custom_domain_proxy_paths.clone()),
            domain_lookup,
            ab_cache: config
                .ab_enabled
                .then(|| Arc::new(AbManifestCache::new(config.ab_manifest_cache_max))),
        })
    }
}

pub fn router(state: AppState) -> Router {
    router_with_layers(state, None)
}

/// Build the router with optional extra layers. The rate-limit layer is
/// attached innermost (closest to the handler) so blocked responses still
/// pick up the SetResponseHeader layers on the way back out.
pub fn router_with_layers(state: AppState, rate_limit: Option<RateLimitLayer>) -> Router {
    let mut r = Router::new()
        .route("/_edge/version", get(version))
        .fallback(serve_or_proxy)
        .with_state(state);
    if let Some(layer) = rate_limit {
        r = r.layer(layer);
    }
    r.layer(SetResponseHeaderLayer::overriding(
        header::SERVER,
        HeaderValue::from_static(SERVER_HEADER_VALUE),
    ))
    .layer(SetResponseHeaderLayer::overriding(
        header::STRICT_TRANSPORT_SECURITY,
        HeaderValue::from_static(HSTS_VALUE),
    ))
    .layer(SetResponseHeaderLayer::overriding(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static(X_CTO_VALUE),
    ))
    .layer(SetResponseHeaderLayer::overriding(
        header::X_FRAME_OPTIONS,
        HeaderValue::from_static(X_FRAME_OPTIONS_VALUE),
    ))
    .layer(SetResponseHeaderLayer::overriding(
        header::REFERRER_POLICY,
        HeaderValue::from_static(REFERRER_POLICY_VALUE),
    ))
    .layer(SetResponseHeaderLayer::overriding(
        HeaderName::from_static(PERMISSIONS_POLICY_NAME),
        HeaderValue::from_static(PERMISSIONS_POLICY_VALUE),
    ))
    .layer(TraceLayer::new_for_http())
}

async fn version() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "application/json")],
        format!(r#"{{"version":"{VERSION}"}}"#),
    )
}

async fn serve_or_proxy(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    req: Request<Body>,
) -> Response<Body> {
    let host = req
        .headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned)
        .or_else(|| req.uri().authority().map(|a| a.as_str().to_owned()))
        .unwrap_or_default();
    let url_path = req.uri().path().to_owned();
    let query = req.uri().query().map(str::to_owned);

    let started = std::time::Instant::now();
    let action = decide_route(
        &host,
        &url_path,
        &state.proxy_hosts,
        &state.proxy_paths,
        &state.custom_domain_proxy_paths,
    );
    let route_kind = route_kind_label(&action);

    let response = match action {
        RouteAction::Proxy => proxy::forward(&state.node_client, peer, host.clone(), req).await,
        RouteAction::Disk { sub } => {
            serve_from_disk(
                &state,
                peer,
                &sub,
                &url_path,
                query.as_deref(),
                req.headers(),
                true,
            )
            .await
        }
        RouteAction::CustomDomain { host: custom_host } => {
            match state.domain_lookup.lookup(&custom_host).await {
                Ok(Some(sub)) => {
                    debug!(%peer, host = %custom_host, %sub, "custom domain resolved");
                    serve_from_disk(
                        &state,
                        peer,
                        &sub,
                        &url_path,
                        query.as_deref(),
                        req.headers(),
                        true,
                    )
                    .await
                }
                Ok(None) => {
                    debug!(%peer, host = %custom_host, "custom domain unknown or unverified");
                    not_found()
                }
                Err(err) => {
                    warn!(%peer, host = %custom_host, error = %err, "custom domain lookup errored");
                    not_found()
                }
            }
        }
        RouteAction::SharedUploads => {
            // `/uploads/foo.png` resolves to `<uploads_root>/foo.png`. Strip
            // the leading prefix before handing the path to the strict
            // resolver — anything outside the configured root surfaces as
            // 404, never SPA fallback.
            let rel = url_path
                .strip_prefix("/uploads/")
                .unwrap_or(url_path.as_str());
            serve_shared(&state.uploads_root, rel, SHARED_UPLOADS_CACHE_CONTROL, peer).await
        }
        RouteAction::NextStatic => {
            let rel = url_path
                .strip_prefix("/_next/static/")
                .unwrap_or(url_path.as_str());
            serve_shared(
                &state.next_static_root,
                rel,
                NEXT_STATIC_CACHE_CONTROL,
                peer,
            )
            .await
        }
        RouteAction::NotFound => {
            debug!(%host, %peer, "host did not match any route");
            not_found()
        }
    };

    // Cardinality control: use the bare host without the port for the label.
    // Per-host cardinality is unbounded in theory; production should rely on
    // Prometheus relabel rules if a hostile peer floods Host headers.
    let host_label = host.split(':').next().unwrap_or(&host).to_ascii_lowercase();
    let status = response.status().as_u16();
    metrics::counter!(
        "openlen_edge_requests_total",
        "host" => host_label.clone(),
        "status_class" => status_class(status),
        "route_kind" => route_kind,
    )
    .increment(1);
    metrics::histogram!(
        "openlen_edge_request_duration_seconds",
        "host" => host_label,
        "route_kind" => route_kind,
    )
    .record(started.elapsed().as_secs_f64());

    response
}

/// Resolve a Variant B candidate file strictly inside `release_root` without
/// SPA fallback to Control A's `/index.html`.
fn resolve_variant_b_strict(release_root: &Path, variant_b_path: &str, is_page: bool) -> Resolved {
    if let r @ Resolved::File(_) = resolve_strict(release_root, variant_b_path) {
        return r;
    }
    if is_page {
        let trimmed = variant_b_path.trim_end_matches('/');
        if !trimmed.ends_with(".html") && !trimmed.ends_with(".htm") {
            let idx = format!("{trimmed}/index.html");
            if let r @ Resolved::File(_) = resolve_strict(release_root, &idx) {
                return r;
            }
        }
    }
    Resolved::NotFound
}

async fn serve_from_disk(
    state: &AppState,
    peer: SocketAddr,
    sub: &str,
    url_path: &str,
    query: Option<&str>,
    req_headers: &axum::http::HeaderMap,
    secure_cookie: bool,
) -> Response<Body> {
    // Never expose internal A/B manifests or `_ab/` directories directly over HTTP.
    if is_blocked_internal_path(url_path) {
        debug!(%peer, sub, path = %url_path, "blocked direct access to internal A/B path");
        return not_found();
    }

    // /assets/* lives at `<publish>/<sub>/assets/...` — a sibling of `current/`
    // managed by the publish flow. Keeping it outside `current/` lets the
    // file survive release rotations (the assets dir is shared across deploys).
    let base = disk_base_for(url_path);
    let mut sub_root = match base {
        DiskBase::Current => state.publish_root.join(sub).join("current"),
        DiskBase::Sibling => state.publish_root.join(sub),
    };

    let mut ab_decision: Option<AbDecision> = None;
    let mut resolved_file: Option<Resolved> = None;

    if matches!(base, DiskBase::Current) {
        if let Some(cache) = &state.ab_cache {
            let (decision, release_dir) = evaluate_request(
                cache,
                &state.publish_root,
                sub,
                url_path,
                query,
                req_headers,
                peer,
                secure_cookie,
            )
            .await;
            if let Some(dir) = release_dir {
                sub_root = dir;
            }
            if let Some(mut d) = decision {
                if let Some(ref path_b) = d.variant_b_path {
                    match resolve_variant_b_strict(&sub_root, path_b, d.is_page_route) {
                        Resolved::File(p) => {
                            resolved_file = Some(Resolved::File(p));
                            ab_decision = Some(d);
                        }
                        _ => {
                            // Variant B did not ship this specific locale/asset file:
                            // gracefully serve Control A without misreporting Variant B.
                            if d.is_page_route {
                                d.variant = Variant::A;
                                d.variant_b_path = None;
                                ab_decision = Some(d);
                            }
                        }
                    }
                } else {
                    ab_decision = Some(d);
                }
            }
        }
    }

    let resolved = resolved_file.unwrap_or_else(|| resolve(&sub_root, url_path));

    match resolved {
        Resolved::File(path) => match tokio::fs::read(&path).await {
            Ok(bytes) => {
                let ext = path.extension().and_then(|s| s.to_str());
                let mime = mime_guess::from_path(&path).first_or_octet_stream();
                let cache_ctl = if ab_decision.is_some() {
                    AB_HTML_CACHE_CONTROL
                } else {
                    cache_control_for(ext)
                };
                debug!(
                    %peer, sub, path = %url_path, file = %path.display(),
                    bytes = bytes.len(), ab = ?ab_decision.as_ref().map(|d| (&d.experiment_id, d.variant)),
                    "serve file"
                );
                let mut builder = Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, mime.as_ref())
                    .header(header::CACHE_CONTROL, cache_ctl);

                if let Some(d) = ab_decision {
                    builder = builder.header(header::VARY, "Cookie");
                    let ab_hdr = if d.source == AssignSource::Bot {
                        format!("{}:a-bot", d.experiment_id)
                    } else {
                        format!("{}:{}", d.experiment_id, d.variant.as_str())
                    };
                    if let Ok(val) = HeaderValue::from_str(&ab_hdr) {
                        builder = builder.header(HeaderName::from_static("x-openlen-ab"), val);
                    }
                    let etag = format!(
                        "W/\"{}-{}-{}\"",
                        d.experiment_id,
                        d.variant.as_str(),
                        bytes.len()
                    );
                    if let Ok(val) = HeaderValue::from_str(&etag) {
                        builder = builder.header(header::ETAG, val);
                    }
                    if let Some(cookie) = d.set_cookie {
                        if let Ok(val) = HeaderValue::from_str(&cookie) {
                            builder = builder.header(header::SET_COOKIE, val);
                        }
                    }
                    if d.is_override {
                        builder = builder.header(
                            HeaderName::from_static("x-robots-tag"),
                            HeaderValue::from_static("noindex"),
                        );
                    }
                }

                builder
                    .body(Body::from(bytes))
                    .expect("response is valid")
            }
            Err(err) => {
                warn!(
                    %peer, sub, path = %url_path,
                    file = %path.display(), error = %err, "file read failed"
                );
                not_found()
            }
        },
        Resolved::NotFound => {
            debug!(%peer, sub, path = %url_path, "file not found");
            not_found()
        }
        Resolved::BadRequest => {
            warn!(%peer, sub, path = %url_path, "rejected unsafe path");
            (StatusCode::BAD_REQUEST, "bad request\n").into_response()
        }
    }
}

/// Validate a subdomain slug passed via `X-OpenLen-Sub` from Caddy loopback.
fn is_valid_sub_header(sub: &str) -> bool {
    !sub.is_empty()
        && sub.len() <= 63
        && !sub.starts_with('-')
        && !sub.ends_with('-')
        && sub
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}

async fn ab_loopback_handler(
    State(state): State<AppState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    req: Request<Body>,
) -> Response<Body> {
    if !peer.ip().is_loopback() {
        warn!(%peer, "rejected non-loopback peer on A/B sidecar listener");
        return (StatusCode::FORBIDDEN, "forbidden\n").into_response();
    }
    let sub = req
        .headers()
        .get("x-openlen-sub")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| is_valid_sub_header(s))
        .map(str::to_owned)
        .or_else(|| {
            req.headers()
                .get(header::HOST)
                .and_then(|v| v.to_str().ok())
                .and_then(extract_subdomain)
        });

    let Some(sub) = sub else {
        return not_found();
    };
    let url_path = req.uri().path().to_owned();
    let query = req.uri().query().map(str::to_owned);
    serve_from_disk(
        &state,
        peer,
        &sub,
        &url_path,
        query.as_deref(),
        req.headers(),
        true,
    )
    .await
}

/// Router for the loopback-only Caddy `@has_ab` sidecar listener (`127.0.0.1:8085`).
pub fn ab_loopback_router(state: AppState) -> Router {
    Router::new()
        .route("/_edge/version", get(version))
        .fallback(ab_loopback_handler)
        .with_state(state)
        .layer(SetResponseHeaderLayer::overriding(
            header::SERVER,
            HeaderValue::from_static(SERVER_HEADER_VALUE),
        ))
}

/// Bind and serve the loopback-only HTTP A/B sidecar behind Caddy until `shutdown` resolves.
pub async fn run_ab_loopback(
    bind: SocketAddr,
    state: AppState,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> Result<()> {
    if !bind.ip().is_loopback() {
        anyhow::bail!("A/B loopback sidecar must bind to a loopback address, got {bind}");
    }
    let listener = TcpListener::bind(bind)
        .await
        .with_context(|| format!("failed to bind A/B sidecar on {bind}"))?;
    let local_addr = listener.local_addr()?;
    info!(addr = %local_addr, "openlen-edge A/B loopback sidecar listening");
    axum::serve(
        listener,
        ab_loopback_router(state).into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown)
    .await
    .context("A/B loopback sidecar exited with error")
}

/// Serve `<root>/<rel_path>` direct from disk for the shared-root routes
/// (`/uploads/`, `/_next/static/`). No SPA fallback, no dir-index — a miss is
/// a 404, a traversal attempt is a 400.
async fn serve_shared(
    root: &Path,
    rel_path: &str,
    cache_control: &'static str,
    peer: SocketAddr,
) -> Response<Body> {
    match resolve_strict(root, rel_path) {
        Resolved::File(path) => match tokio::fs::read(&path).await {
            Ok(bytes) => {
                let mime = mime_guess::from_path(&path).first_or_octet_stream();
                debug!(
                    %peer, rel = %rel_path, file = %path.display(),
                    bytes = bytes.len(), "serve shared file"
                );
                Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, mime.as_ref())
                    .header(header::CACHE_CONTROL, cache_control)
                    .body(Body::from(bytes))
                    .expect("response is valid")
            }
            Err(err) => {
                warn!(
                    %peer, rel = %rel_path, file = %path.display(),
                    error = %err, "shared file read failed"
                );
                not_found()
            }
        },
        Resolved::NotFound => {
            debug!(%peer, rel = %rel_path, "shared file not found");
            not_found()
        }
        Resolved::BadRequest => {
            warn!(%peer, rel = %rel_path, "rejected unsafe shared path");
            (StatusCode::BAD_REQUEST, "bad request\n").into_response()
        }
    }
}

fn not_found() -> Response<Body> {
    (StatusCode::NOT_FOUND, "Not Found\n").into_response()
}

#[derive(Debug)]
pub struct BoundServer {
    pub local_addr: SocketAddr,
    listener: TcpListener,
    tls_config: Arc<ServerConfig>,
    router: Router,
    max_inflight: usize,
}

pub async fn bind(config: &EdgeConfig, tls_config: Arc<ServerConfig>) -> Result<BoundServer> {
    bind_with_lookup(config, tls_config, Arc::new(MockDomainLookup::new())).await
}

/// Bind the TLS listener with a custom-domain lookup injected. The production
/// entry point — `main.rs` calls this with a `LayeredLookup` over Postgres.
pub async fn bind_with_lookup(
    config: &EdgeConfig,
    tls_config: Arc<ServerConfig>,
    domain_lookup: Arc<dyn DomainLookup>,
) -> Result<BoundServer> {
    bind_with_lookup_and_layers(config, tls_config, domain_lookup, None).await
}

/// Bind variant that accepts an optional rate-limit layer. Constructed in
/// `main.rs` when `OPENLEN_EDGE_RATE_LIMIT_ENABLED=1`; otherwise the
/// regular `bind_with_lookup` flow runs (no layer overhead).
pub async fn bind_with_lookup_and_layers(
    config: &EdgeConfig,
    tls_config: Arc<ServerConfig>,
    domain_lookup: Arc<dyn DomainLookup>,
    rate_limit: Option<RateLimitLayer>,
) -> Result<BoundServer> {
    let listener = TcpListener::bind(config.bind)
        .await
        .with_context(|| format!("failed to bind {}", config.bind))?;
    let local_addr = listener
        .local_addr()
        .context("listener.local_addr() failed")?;
    info!(
        addr = %local_addr,
        max_inflight = config.max_inflight,
        node_url = %config.node_url,
        node_timeout_secs = config.node_timeout_secs,
        proxy_hosts = ?config.proxy_hosts,
        proxy_paths = ?config.proxy_paths,
        domain_cache_max = config.domain_cache_max,
        domain_cache_ttl_secs = config.domain_cache_ttl_secs,
        domain_negative_ttl_secs = config.domain_negative_ttl_secs,
        has_database = config.database_url.is_some(),
        rate_limit_enabled = rate_limit.is_some(),
        "openlen-edge listening"
    );
    let state = AppState::with_lookup(config, domain_lookup)?;
    Ok(BoundServer {
        local_addr,
        listener,
        tls_config,
        router: router_with_layers(state, rate_limit),
        max_inflight: config.max_inflight,
    })
}

impl BoundServer {
    pub async fn serve(self, shutdown: impl Future<Output = ()> + Send + 'static) -> Result<()> {
        let acceptor = TlsAcceptor::from(self.tls_config);
        let app = self.router;
        let sem = Arc::new(Semaphore::new(self.max_inflight));
        let (close_tx, close_rx) = watch::channel(());

        tokio::pin!(shutdown);

        loop {
            let (stream, peer) = tokio::select! {
                accepted = self.listener.accept() => match accepted {
                    Ok(pair) => pair,
                    Err(err) => {
                        error!(error = %err, "tcp accept failed");
                        continue;
                    }
                },
                _ = &mut shutdown => {
                    info!("shutdown signal received");
                    break;
                }
            };

            let permit = match sem.clone().try_acquire_owned() {
                Ok(p) => p,
                Err(_) => {
                    warn!(%peer, max_inflight = self.max_inflight,
                        "in-flight connection cap reached, dropping connection");
                    metrics::counter!("openlen_edge_handshake_capped_total").increment(1);
                    drop(stream);
                    continue;
                }
            };

            // Update the gauge from outside the spawn so the value reflects
            // the cap state at accept time, not after the task has had a
            // chance to run.
            let inflight_after_acquire = self.max_inflight - sem.available_permits();
            metrics::gauge!("openlen_edge_handshake_inflight").set(inflight_after_acquire as f64);

            let acceptor = acceptor.clone();
            let app = app.clone();
            let close_rx = close_rx.clone();
            let sem_for_task = sem.clone();
            let cap = self.max_inflight;

            tokio::spawn(async move {
                let _permit = permit;
                if let Err(err) = serve_one(acceptor, stream, peer, app).await {
                    debug!(%peer, error = %err, "connection ended with error");
                }
                drop(close_rx);
                // Permit drops here too; refresh the gauge so an idle period
                // doesn't leave a stale peak value.
                let now_inflight = cap - sem_for_task.available_permits();
                metrics::gauge!("openlen_edge_handshake_inflight").set(now_inflight as f64);
            });
        }

        drop(close_rx);
        info!("waiting for in-flight connections to finish");
        close_tx.closed().await;
        info!("openlen-edge shut down cleanly");
        Ok(())
    }
}

async fn serve_one(
    acceptor: TlsAcceptor,
    stream: tokio::net::TcpStream,
    peer: SocketAddr,
    app: Router,
) -> Result<()> {
    // Disable Nagle's algorithm. Without TCP_NODELAY the small TLS-framed
    // HTTP responses collide with the client's delayed-ACK timer, adding a
    // fixed ~40ms per request on every connection (Linux delayed-ACK floor).
    // Caddy/Go set this by default; tokio's TcpStream does not.
    let _ = stream.set_nodelay(true);

    let tls = acceptor
        .accept(stream)
        .await
        .with_context(|| format!("tls handshake with {peer} failed"))?;
    let io = TokioIo::new(tls);

    let svc = app
        .into_make_service_with_connect_info::<SocketAddr>()
        .oneshot(peer)
        .await
        .expect("axum IntoMakeServiceWithConnectInfo is infallible");
    let svc = hyper_util::service::TowerToHyperService::new(svc);

    let mut builder = hyper_util::server::conn::auto::Builder::new(TokioExecutor::new());
    // `header_read_timeout` requires a registered Timer (otherwise hyper
    // panics at runtime the first time it tries to arm one — surfaces on
    // any real-world client that splits the request line and headers across
    // separate TCP segments, even though loopback test traffic skates by).
    builder
        .http1()
        .timer(TokioTimer::new())
        .header_read_timeout(HEADER_READ_TIMEOUT)
        .keep_alive(true);
    if let Err(err) = builder.serve_connection_with_upgrades(io, svc).await {
        warn!(%peer, error = %err, "hyper serve_connection ended");
    }
    Ok(())
}
