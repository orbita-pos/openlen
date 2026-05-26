use std::future::Future;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::{Context, Result};
use axum::body::Body;
use axum::extract::{ConnectInfo, Host, State};
use axum::http::{header, HeaderValue, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use hyper_util::rt::{TokioExecutor, TokioIo};
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
use crate::routing::extract_subdomain;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const SERVER_HEADER_VALUE: &str = concat!("openlen-edge/", env!("CARGO_PKG_VERSION"));

/// Per-request state injected into the router. Holds the canonicalized
/// publish root so the file resolver never re-canonicalises on the hot path.
#[derive(Debug, Clone)]
pub struct AppState {
    pub publish_root: Arc<PathBuf>,
}

impl AppState {
    pub fn new(publish_root: PathBuf) -> Self {
        let canonical = publish_root.canonicalize().unwrap_or(publish_root);
        Self {
            publish_root: Arc::new(canonical),
        }
    }
}

pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/_edge/version", get(version))
        .fallback(serve_subdomain)
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

async fn serve_subdomain(
    Host(host): Host,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    State(state): State<AppState>,
    uri: Uri,
) -> Response {
    let Some(sub) = extract_subdomain(&host) else {
        debug!(%host, %peer, "host did not match *.openlen.com");
        return not_found();
    };

    let sub_root = state.publish_root.join(&sub).join("current");
    let url_path = uri.path();

    match resolve(&sub_root, url_path) {
        Resolved::File(path) => match tokio::fs::read(&path).await {
            Ok(bytes) => {
                let ext = path.extension().and_then(|s| s.to_str());
                let cache_ctl = cache_control_for(ext);
                let mime = mime_guess::from_path(&path).first_or_octet_stream();
                debug!(
                    %peer, sub=%sub, path=%url_path, file=%path.display(),
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
                    %peer, sub=%sub, path=%url_path,
                    file=%path.display(), error=%err, "file read failed"
                );
                not_found()
            }
        },
        Resolved::NotFound => {
            debug!(%peer, sub=%sub, path=%url_path, "file not found");
            not_found()
        }
        Resolved::BadRequest => {
            warn!(%peer, sub=%sub, path=%url_path, "rejected unsafe path");
            (StatusCode::BAD_REQUEST, "bad request\n").into_response()
        }
    }
}

fn not_found() -> Response {
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
    let listener = TcpListener::bind(config.bind)
        .await
        .with_context(|| format!("failed to bind {}", config.bind))?;
    let local_addr = listener
        .local_addr()
        .context("listener.local_addr() failed")?;
    info!(addr = %local_addr, max_inflight = config.max_inflight, "openlen-edge listening");
    let state = AppState::new(config.publish_root.clone());
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

    if let Err(err) = hyper_util::server::conn::auto::Builder::new(TokioExecutor::new())
        .serve_connection_with_upgrades(io, svc)
        .await
    {
        warn!(%peer, error = %err, "hyper serve_connection ended");
    }
    Ok(())
}
