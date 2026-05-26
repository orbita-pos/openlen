use std::future::Future;
use std::net::SocketAddr;

use anyhow::{Context, Result};
use axum::extract::Host;
use axum::http::{header, HeaderValue, StatusCode, Uri};
use axum::response::IntoResponse;
use axum::routing::any;
use axum::Router;
use tokio::net::TcpListener;
use tracing::{info, warn};

/// Run a plaintext HTTP listener that 301-redirects every request to its
/// HTTPS counterpart. Returns once `shutdown` resolves and in-flight
/// connections drain.
pub async fn run_http_redirect(
    bind: SocketAddr,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> Result<()> {
    let app = Router::new().fallback(any(redirect_handler));
    let listener = TcpListener::bind(bind)
        .await
        .with_context(|| format!("failed to bind HTTP redirect on {bind}"))?;
    let local = listener
        .local_addr()
        .context("HTTP redirect listener.local_addr() failed")?;
    info!(addr = %local, "openlen-edge HTTP redirect listening");

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown)
    .await
    .context("HTTP redirect listener failed")?;

    info!("HTTP redirect listener shut down cleanly");
    Ok(())
}

async fn redirect_handler(host: Option<Host>, uri: Uri) -> impl IntoResponse {
    let raw_host = host.as_ref().map(|Host(h)| h.as_str()).unwrap_or("");
    let host_no_port = raw_host.split(':').next().unwrap_or("");

    if host_no_port.is_empty() {
        warn!("HTTP redirect: missing Host header");
        return (StatusCode::BAD_REQUEST, "missing Host header\n").into_response();
    }

    let path_and_query = uri.path_and_query().map(|p| p.as_str()).unwrap_or("/");
    let target = format!("https://{host_no_port}{path_and_query}");

    let location = match HeaderValue::try_from(&target) {
        Ok(v) => v,
        Err(_) => {
            warn!(host = host_no_port, "HTTP redirect: target not header-safe");
            return (StatusCode::BAD_REQUEST, "bad request\n").into_response();
        }
    };

    (
        StatusCode::MOVED_PERMANENTLY,
        [(header::LOCATION, location)],
    )
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use tokio::sync::oneshot;
    use tokio::time::timeout;

    #[tokio::test]
    async fn redirects_preserves_path_and_query() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let app = Router::new().fallback(any(redirect_handler));
        let (tx, rx) = oneshot::channel::<()>();
        let server = tokio::spawn(async move {
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .with_graceful_shutdown(async move {
                let _ = rx.await;
            })
            .await
            .unwrap();
        });

        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();

        let resp = timeout(
            Duration::from_secs(3),
            client
                .get(format!("http://{addr}/pricing?ref=hn"))
                .header("host", "demo.openlen.com")
                .send(),
        )
        .await
        .unwrap()
        .unwrap();

        assert_eq!(resp.status(), 301);
        let loc = resp.headers().get("location").unwrap().to_str().unwrap();
        assert_eq!(loc, "https://demo.openlen.com/pricing?ref=hn");

        let _ = tx.send(());
        server.await.unwrap();
    }
}
