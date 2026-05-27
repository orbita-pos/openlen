//! Tiny standalone "Node app" used by `crates/edge/bench/k6-apex-proxy.js`.
//! Serves a static HTML body on every route, with `DefaultBodyLimit::disable()`
//! so the apex POST/SSE scenarios can exercise large payloads later.
//!
//! Usage:
//!   cargo run -p openlen-edge --release --example mock_node -- 127.0.0.1:13030

use std::env;
use std::net::SocketAddr;

use axum::extract::DefaultBodyLimit;
use axum::http::header;
use axum::response::IntoResponse;
use axum::routing::any;
use axum::Router;
use tokio::net::TcpListener;

const BODY: &str = "<!doctype html><html><body><h1>node-stub</h1></body></html>";

async fn handler() -> impl IntoResponse {
    (
        [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
        BODY.to_string(),
    )
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let bind = env::args()
        .nth(1)
        .unwrap_or_else(|| "127.0.0.1:13030".into());
    let addr: SocketAddr = bind.parse()?;
    let listener = TcpListener::bind(addr).await?;
    eprintln!("mock_node listening on http://{addr}");
    let app = Router::new()
        .fallback(any(handler))
        .layer(DefaultBodyLimit::disable());
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await?;
    Ok(())
}
