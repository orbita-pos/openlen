use std::future::Future;
use std::net::SocketAddr;
use std::sync::Arc;

use anyhow::{Context, Result};
use axum::extract::Host;
use axum::http::{header, HeaderValue};
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use hyper_util::rt::{TokioExecutor, TokioIo};
use rustls::ServerConfig;
use tokio::net::TcpListener;
use tokio::sync::watch;
use tokio_rustls::TlsAcceptor;
use tower::ServiceExt;
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::trace::TraceLayer;
use tracing::{debug, error, info, warn};

use crate::config::EdgeConfig;

pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const SERVER_HEADER_VALUE: &str = concat!("openlen-edge/", env!("CARGO_PKG_VERSION"));

pub fn router() -> Router {
    Router::new()
        .route("/", get(hello))
        .route("/_edge/version", get(version))
        .layer(SetResponseHeaderLayer::overriding(
            header::SERVER,
            HeaderValue::from_static(SERVER_HEADER_VALUE),
        ))
        .layer(TraceLayer::new_for_http())
}

async fn hello(Host(host): Host) -> impl IntoResponse {
    debug!(%host, "hello");
    (
        [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
        format!("OpenLen edge alive ({host})\n"),
    )
}

async fn version() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "application/json")],
        format!(r#"{{"version":"{VERSION}"}}"#),
    )
}

#[derive(Debug)]
pub struct BoundServer {
    pub local_addr: SocketAddr,
    listener: TcpListener,
    tls_config: Arc<ServerConfig>,
    router: Router,
}

pub async fn bind(config: &EdgeConfig, tls_config: Arc<ServerConfig>) -> Result<BoundServer> {
    let listener = TcpListener::bind(config.bind)
        .await
        .with_context(|| format!("failed to bind {}", config.bind))?;
    let local_addr = listener
        .local_addr()
        .context("listener.local_addr() failed")?;
    info!(addr = %local_addr, "openlen-edge listening");
    Ok(BoundServer {
        local_addr,
        listener,
        tls_config,
        router: router(),
    })
}

impl BoundServer {
    pub async fn serve(self, shutdown: impl Future<Output = ()> + Send + 'static) -> Result<()> {
        let acceptor = TlsAcceptor::from(self.tls_config);
        let app = self.router;
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

            let acceptor = acceptor.clone();
            let app = app.clone();
            let close_rx = close_rx.clone();

            tokio::spawn(async move {
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
        .into_make_service()
        .oneshot(())
        .await
        .expect("axum IntoMakeService is infallible");
    let svc = hyper_util::service::TowerToHyperService::new(svc);

    if let Err(err) = hyper_util::server::conn::auto::Builder::new(TokioExecutor::new())
        .serve_connection_with_upgrades(io, svc)
        .await
    {
        warn!(%peer, error = %err, "hyper serve_connection ended");
    }
    Ok(())
}
