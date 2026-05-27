//! Internal HTTP API for lookup. Exposed on a separate listener (default off)
//! so Caddy's `on_demand_tls.ask` directive can hit it during the blue-green
//! migration window when both Caddy + the Rust edge are running side-by-side.
//!
//! Hard rules:
//! - bind to `127.0.0.1:*` by default — never expose externally.
//! - reject non-loopback peers at the handler level (defense in depth even if
//!   the bind is misconfigured).
//! - response shape is `{"ok":1,"subdomain":"..."}` on hit, `404` on miss,
//!   `503` on transient error. Caddy only inspects the status code; the JSON
//!   body is for human + tooling debug visibility.

use std::net::SocketAddr;
use std::sync::Arc;

use anyhow::Context;
use axum::extract::{ConnectInfo, Query, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use serde::Deserialize;
use tokio::net::TcpListener;
use tracing::{debug, info, warn};

use super::{DomainLookup, LayeredLookup};

#[derive(Clone)]
pub struct InternalApiState {
    pub lookup: Arc<dyn DomainLookup>,
    /// Optional handle on the layered lookup so the invalidate endpoint can
    /// reach the cache. None when the underlying lookup isn't layered (tests).
    pub layered: Option<Arc<LayeredLookup>>,
}

impl std::fmt::Debug for InternalApiState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("InternalApiState")
            .field("lookup", &self.lookup)
            .field("has_layered", &self.layered.is_some())
            .finish()
    }
}

pub fn router(state: InternalApiState) -> Router {
    Router::new()
        .route("/internal/domains/lookup", get(lookup_handler))
        .route("/internal/domains/invalidate", post(invalidate_handler))
        .with_state(state)
}

#[derive(Debug, Deserialize)]
struct LookupQuery {
    /// Caddy's `on_demand_tls.ask` directive sends `?domain=<host>`. We also
    /// accept `?host=` as an alias.
    domain: Option<String>,
    host: Option<String>,
}

#[derive(Debug, Deserialize)]
struct InvalidateQuery {
    domain: Option<String>,
    host: Option<String>,
    all: Option<bool>,
}

fn extract_host(domain: Option<String>, host: Option<String>) -> Option<String> {
    domain
        .or(host)
        .map(|h| h.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty())
}

/// Reject non-loopback peers. The internal API binds to 127.0.0.1 by default,
/// but a misconfiguration that exposes it externally must not leak the lookup.
fn peer_is_loopback(peer: SocketAddr) -> bool {
    peer.ip().is_loopback()
}

/// Inline JSON-string escape: the subdomain regex restricts the value to
/// `[a-z0-9-]` so the only characters we'd need to escape are not allowed in
/// practice, but the function stays defensive against schema drift.
fn json_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out
}

fn json_response(status: StatusCode, body: String) -> Response {
    (status, [(header::CONTENT_TYPE, "application/json")], body).into_response()
}

async fn lookup_handler(
    State(state): State<InternalApiState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Query(q): Query<LookupQuery>,
) -> Response {
    if !peer_is_loopback(peer) {
        warn!(%peer, "internal API request from non-loopback peer; rejected");
        return (StatusCode::FORBIDDEN, "loopback only").into_response();
    }
    let host = match extract_host(q.domain, q.host) {
        Some(h) => h,
        None => return (StatusCode::BAD_REQUEST, "missing domain").into_response(),
    };
    match state.lookup.lookup(&host).await {
        Ok(Some(sub)) => {
            debug!(%host, %sub, "internal lookup hit");
            json_response(
                StatusCode::OK,
                format!(r#"{{"ok":1,"subdomain":"{}"}}"#, json_escape(&sub)),
            )
        }
        Ok(None) => {
            debug!(%host, "internal lookup miss");
            (StatusCode::NOT_FOUND, "not found").into_response()
        }
        Err(err) => {
            warn!(%host, error = %err, "internal lookup errored");
            (StatusCode::SERVICE_UNAVAILABLE, "lookup error").into_response()
        }
    }
}

async fn invalidate_handler(
    State(state): State<InternalApiState>,
    ConnectInfo(peer): ConnectInfo<SocketAddr>,
    Query(q): Query<InvalidateQuery>,
) -> Response {
    if !peer_is_loopback(peer) {
        return (StatusCode::FORBIDDEN, "loopback only").into_response();
    }
    let Some(layered) = state.layered.as_ref() else {
        return (StatusCode::NOT_IMPLEMENTED, "lookup is not cache-backed").into_response();
    };
    if q.all.unwrap_or(false) {
        layered.cache().invalidate_all().await;
        return json_response(StatusCode::OK, r#"{"ok":1,"scope":"all"}"#.to_owned());
    }
    let Some(host) = extract_host(q.domain, q.host) else {
        return (StatusCode::BAD_REQUEST, "missing domain or all=true").into_response();
    };
    layered.invalidate(&host).await;
    json_response(
        StatusCode::OK,
        format!(
            r#"{{"ok":1,"scope":"single","domain":"{}"}}"#,
            json_escape(&host)
        ),
    )
}

pub async fn run_internal_api(
    bind: SocketAddr,
    state: InternalApiState,
    shutdown: impl std::future::Future<Output = ()> + Send + 'static,
) -> anyhow::Result<()> {
    let listener = TcpListener::bind(bind)
        .await
        .with_context(|| format!("internal-api bind {bind} failed"))?;
    serve_internal_api(listener, state, shutdown).await
}

/// Serve the internal API on an already-bound listener. Lets tests grab the
/// port deterministically without a bind-then-rebind race window.
pub async fn serve_internal_api(
    listener: TcpListener,
    state: InternalApiState,
    shutdown: impl std::future::Future<Output = ()> + Send + 'static,
) -> anyhow::Result<()> {
    let actual = listener.local_addr().context("internal-api local_addr")?;
    info!(addr = %actual, "openlen-edge internal API listening");
    let app = router(state).into_make_service_with_connect_info::<SocketAddr>();
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown)
        .await
        .context("internal-api serve")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_is_allowed() {
        let peer: SocketAddr = "127.0.0.1:12345".parse().unwrap();
        assert!(peer_is_loopback(peer));
        let peer_v6: SocketAddr = "[::1]:12345".parse().unwrap();
        assert!(peer_is_loopback(peer_v6));
    }

    #[test]
    fn non_loopback_is_rejected() {
        let peer: SocketAddr = "10.0.0.1:12345".parse().unwrap();
        assert!(!peer_is_loopback(peer));
        let peer2: SocketAddr = "192.168.1.5:12345".parse().unwrap();
        assert!(!peer_is_loopback(peer2));
        let peer3: SocketAddr = "[2001:db8::1]:12345".parse().unwrap();
        assert!(!peer_is_loopback(peer3));
    }

    #[test]
    fn extract_host_prefers_domain_over_host() {
        assert_eq!(
            extract_host(Some("a.com".into()), Some("b.com".into())),
            Some("a.com".into())
        );
    }

    #[test]
    fn extract_host_falls_back_to_host_alias() {
        assert_eq!(
            extract_host(None, Some("b.com".into())),
            Some("b.com".into())
        );
    }

    #[test]
    fn extract_host_lowercases_and_trims() {
        assert_eq!(
            extract_host(Some("  EXAMPLE.com ".into()), None),
            Some("example.com".into())
        );
    }

    #[test]
    fn extract_host_rejects_empty() {
        assert_eq!(extract_host(Some("".into()), Some("".into())), None);
        assert_eq!(extract_host(None, None), None);
        assert_eq!(extract_host(Some("   ".into()), None), None);
    }
}
