use std::future::Future;
use std::net::SocketAddr;
use std::sync::Arc;

use anyhow::{Context, Result};
use axum::extract::{Host, Path, State};
use axum::http::{header, HeaderValue, StatusCode, Uri};
use axum::response::IntoResponse;
use axum::routing::{any, get};
use axum::Router;
use tokio::net::TcpListener;
use tracing::{debug, info, warn};

use crate::tls::AcmeIssuer;

/// State plumbed to the redirect/challenge router. `acme` is `None` when
/// no ACME client is configured — `/.well-known/acme-challenge/*` then
/// always returns 404 instead of looking anything up.
#[derive(Clone)]
pub struct RedirectState {
    pub acme: Option<Arc<dyn AcmeIssuer>>,
}

/// Run a plaintext HTTP listener that serves ACME HTTP-01 challenges and
/// 301-redirects every other request to its HTTPS counterpart. Returns
/// once `shutdown` resolves and in-flight connections drain.
pub async fn run_http_redirect(
    bind: SocketAddr,
    acme: Option<Arc<dyn AcmeIssuer>>,
    shutdown: impl Future<Output = ()> + Send + 'static,
) -> Result<()> {
    let state = RedirectState { acme };
    let app = Router::new()
        .route("/.well-known/acme-challenge/:token", get(challenge_handler))
        .fallback(any(redirect_handler))
        .with_state(state);
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

async fn challenge_handler(
    State(state): State<RedirectState>,
    Path(token): Path<String>,
) -> impl IntoResponse {
    let Some(acme) = state.acme.as_ref() else {
        debug!(%token, "ACME challenge requested but ACME is disabled");
        return (StatusCode::NOT_FOUND, "Not Found\n").into_response();
    };
    match acme.get_challenge(&token) {
        Some(key_auth) => {
            debug!(%token, "serving ACME challenge");
            (
                StatusCode::OK,
                [(header::CONTENT_TYPE, "text/plain")],
                key_auth,
            )
                .into_response()
        }
        None => {
            debug!(%token, "ACME challenge token unknown");
            (StatusCode::NOT_FOUND, "Not Found\n").into_response()
        }
    }
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
    use crate::tls::acme::mock::MockAcmeIssuer;
    use std::time::Duration;
    use tokio::sync::oneshot;
    use tokio::time::timeout;

    async fn spawn_app(
        acme: Option<Arc<dyn AcmeIssuer>>,
    ) -> (SocketAddr, oneshot::Sender<()>, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let state = RedirectState { acme };
        let app = Router::new()
            .route("/.well-known/acme-challenge/:token", get(challenge_handler))
            .fallback(any(redirect_handler))
            .with_state(state);
        let (tx, rx) = oneshot::channel::<()>();
        let handle = tokio::spawn(async move {
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
        (addr, tx, handle)
    }

    #[tokio::test]
    async fn redirects_preserves_path_and_query() {
        let (addr, tx, handle) = spawn_app(None).await;

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
        handle.await.unwrap();
    }

    #[tokio::test]
    async fn acme_challenge_returns_key_authorization_when_token_known() {
        let mock = MockAcmeIssuer::new();
        mock.store_challenge("abc123", "key-auth-payload");
        let acme: Arc<dyn AcmeIssuer> = Arc::new(mock);
        let (addr, tx, handle) = spawn_app(Some(acme)).await;

        let resp = reqwest::Client::new()
            .get(format!("http://{addr}/.well-known/acme-challenge/abc123"))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 200);
        let body = resp.text().await.unwrap();
        assert_eq!(body, "key-auth-payload");

        let _ = tx.send(());
        handle.await.unwrap();
    }

    #[tokio::test]
    async fn acme_challenge_returns_404_when_token_unknown() {
        let mock = MockAcmeIssuer::new();
        let acme: Arc<dyn AcmeIssuer> = Arc::new(mock);
        let (addr, tx, handle) = spawn_app(Some(acme)).await;

        let resp = reqwest::Client::new()
            .get(format!(
                "http://{addr}/.well-known/acme-challenge/missing-token"
            ))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 404);

        let _ = tx.send(());
        handle.await.unwrap();
    }

    #[tokio::test]
    async fn acme_challenge_returns_404_when_acme_disabled() {
        let (addr, tx, handle) = spawn_app(None).await;
        let resp = reqwest::Client::new()
            .get(format!(
                "http://{addr}/.well-known/acme-challenge/any-token"
            ))
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 404);
        let _ = tx.send(());
        handle.await.unwrap();
    }

    #[tokio::test]
    async fn non_challenge_path_falls_through_to_redirect_even_when_acme_set() {
        let mock = MockAcmeIssuer::new();
        let acme: Arc<dyn AcmeIssuer> = Arc::new(mock);
        let (addr, tx, handle) = spawn_app(Some(acme)).await;

        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        let resp = client
            .get(format!("http://{addr}/random/path"))
            .header("host", "openlen.com")
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status(), 301);

        let _ = tx.send(());
        handle.await.unwrap();
    }
}
