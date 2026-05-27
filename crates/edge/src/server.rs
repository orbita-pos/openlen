use std::future::Future;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use axum::body::Body;
use axum::extract::{ConnectInfo, State};
use axum::http::{header, HeaderValue, Request, Response, StatusCode};
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

use crate::config::EdgeConfig;
use crate::files::{cache_control_for, resolve, Resolved};
use crate::lookup::{DomainLookup, MockDomainLookup};
use crate::proxy::{self, decide_route, NodeClient, RouteAction};

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
    pub node_client: NodeClient,
    pub proxy_hosts: Arc<Vec<String>>,
    pub proxy_paths: Arc<Vec<String>>,
    pub domain_lookup: Arc<dyn DomainLookup>,
}

impl std::fmt::Debug for AppState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AppState")
            .field("publish_root", &self.publish_root)
            .field("node_client", &self.node_client)
            .field("proxy_hosts", &self.proxy_hosts)
            .field("proxy_paths", &self.proxy_paths)
            .field("domain_lookup", &self.domain_lookup)
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
            node_client,
            proxy_hosts: Arc::new(config.proxy_hosts.clone()),
            proxy_paths: Arc::new(config.proxy_paths.clone()),
            domain_lookup,
        })
    }
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/_edge/version", get(version))
        .fallback(serve_or_proxy)
        .with_state(state)
        .layer(SetResponseHeaderLayer::overriding(
            header::SERVER,
            HeaderValue::from_static(SERVER_HEADER_VALUE),
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

    match decide_route(&host, &url_path, &state.proxy_hosts, &state.proxy_paths) {
        RouteAction::Proxy => proxy::forward(&state.node_client, peer, host, req).await,
        RouteAction::Disk { sub } => serve_from_disk(&state, peer, &sub, &url_path).await,
        RouteAction::CustomDomain { host: custom_host } => {
            match state.domain_lookup.lookup(&custom_host).await {
                Ok(Some(sub)) => {
                    debug!(%peer, host = %custom_host, %sub, "custom domain resolved");
                    serve_from_disk(&state, peer, &sub, &url_path).await
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
        RouteAction::NotFound => {
            debug!(%host, %peer, "host did not match any route");
            not_found()
        }
    }
}

async fn serve_from_disk(
    state: &AppState,
    peer: SocketAddr,
    sub: &str,
    url_path: &str,
) -> Response<Body> {
    let sub_root = state.publish_root.join(sub).join("current");

    match resolve(&sub_root, url_path) {
        Resolved::File(path) => match tokio::fs::read(&path).await {
            Ok(bytes) => {
                let ext = path.extension().and_then(|s| s.to_str());
                let cache_ctl = cache_control_for(ext);
                let mime = mime_guess::from_path(&path).first_or_octet_stream();
                debug!(
                    %peer, sub, path = %url_path, file = %path.display(),
                    bytes = bytes.len(), "serve file"
                );
                Response::builder()
                    .status(StatusCode::OK)
                    .header(header::CONTENT_TYPE, mime.as_ref())
                    .header(header::CACHE_CONTROL, cache_ctl)
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
        "openlen-edge listening"
    );
    let state = AppState::with_lookup(config, domain_lookup)?;
    Ok(BoundServer {
        local_addr,
        listener,
        tls_config,
        router: router(state),
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
                    drop(stream);
                    continue;
                }
            };

            let acceptor = acceptor.clone();
            let app = app.clone();
            let close_rx = close_rx.clone();

            tokio::spawn(async move {
                let _permit = permit;
                if let Err(err) = serve_one(acceptor, stream, peer, app).await {
                    debug!(%peer, error = %err, "connection ended with error");
                }
                drop(close_rx);
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
