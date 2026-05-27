pub mod client;
pub mod headers;
pub mod stream;

pub use client::{NodeClient, NodeClientError};
pub use stream::{bad_gateway, error_to_response, gateway_timeout};

use std::net::SocketAddr;

use axum::body::Body;
use axum::http::{Request, Response, Version};
use tracing::{debug, warn};

use crate::routing::extract_subdomain;

/// Where a request should be handled.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RouteAction {
    /// Serve from `<publish_root>/<sub>/current/` on disk.
    Disk { sub: String },
    /// Proxy the request to the configured Node upstream as-is.
    Proxy,
    /// No matching route — caller should respond 404.
    NotFound,
}

/// Decide where a request goes. First match wins:
///
/// 1. `host` (port stripped, lowercased) ∈ `proxy_hosts`  → [`RouteAction::Proxy`]
///    (apex/www by default).
/// 2. `host` matches `*.openlen.com`:
///    - `path` starts with any prefix in `proxy_paths`     → [`RouteAction::Proxy`]
///      (analytics beacon `/c/` by default).
///    - otherwise                                          → [`RouteAction::Disk`]
/// 3. else                                                 → [`RouteAction::NotFound`]
pub fn decide_route(
    host: &str,
    path: &str,
    proxy_hosts: &[String],
    proxy_paths: &[String],
) -> RouteAction {
    let host_no_port = host.split(':').next().unwrap_or(host).to_ascii_lowercase();

    if proxy_hosts.iter().any(|h| h == &host_no_port) {
        return RouteAction::Proxy;
    }

    if let Some(sub) = extract_subdomain(host) {
        if proxy_paths.iter().any(|p| path.starts_with(p.as_str())) {
            return RouteAction::Proxy;
        }
        return RouteAction::Disk { sub };
    }

    RouteAction::NotFound
}

/// Forward `req` to `client`'s upstream, applying header transforms and
/// returning a 502/504 response on transport/timeout failures.
pub async fn forward(
    client: &NodeClient,
    peer: SocketAddr,
    incoming_host: String,
    mut req: Request<Body>,
) -> Response<Body> {
    let path_and_query = req
        .uri()
        .path_and_query()
        .map(|p| p.as_str())
        .unwrap_or("/")
        .to_owned();

    let upstream_uri = match client.upstream_uri(&path_and_query) {
        Ok(uri) => uri,
        Err(err) => {
            warn!(
                %peer, host = %incoming_host, path = %path_and_query, error = %err,
                "proxy: invalid upstream URI"
            );
            return stream::bad_gateway();
        }
    };
    *req.uri_mut() = upstream_uri;
    // The downstream connection may be HTTP/2 (ALPN-negotiated) but the
    // upstream client only speaks HTTP/1.1 (we don't pay an h2 tax for a
    // loopback hop). Force the outbound version so hyper-util doesn't reject
    // the request with `UserUnsupportedVersion`.
    *req.version_mut() = Version::HTTP_11;
    headers::prepare_for_upstream(req.headers_mut(), &incoming_host, peer);

    let method = req.method().clone();
    debug!(
        %peer, host = %incoming_host, %method, path = %path_and_query,
        "proxy: forwarding"
    );

    match client.send(req).await {
        Ok(mut resp) => {
            headers::sanitize_response(resp.headers_mut());
            debug!(
                %peer, host = %incoming_host, status = %resp.status(),
                "proxy: response received"
            );
            resp
        }
        Err(err) => {
            warn!(%peer, host = %incoming_host, error = %err, "proxy: upstream failed");
            stream::error_to_response(err)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_hosts() -> Vec<String> {
        vec!["openlen.com".into(), "www.openlen.com".into()]
    }
    fn default_paths() -> Vec<String> {
        vec!["/c/".into()]
    }

    #[test]
    fn apex_proxies() {
        let a = decide_route("openlen.com", "/foo", &default_hosts(), &default_paths());
        assert_eq!(a, RouteAction::Proxy);
    }

    #[test]
    fn www_proxies() {
        let a = decide_route(
            "www.openlen.com",
            "/auth/login",
            &default_hosts(),
            &default_paths(),
        );
        assert_eq!(a, RouteAction::Proxy);
    }

    #[test]
    fn apex_with_port_proxies() {
        let a = decide_route("openlen.com:443", "/", &default_hosts(), &default_paths());
        assert_eq!(a, RouteAction::Proxy);
    }

    #[test]
    fn apex_uppercase_proxies() {
        let a = decide_route("Openlen.COM", "/", &default_hosts(), &default_paths());
        assert_eq!(a, RouteAction::Proxy);
    }

    #[test]
    fn subdomain_root_disk() {
        let a = decide_route("demo.openlen.com", "/", &default_hosts(), &default_paths());
        assert_eq!(a, RouteAction::Disk { sub: "demo".into() });
    }

    #[test]
    fn subdomain_c_path_proxies() {
        let a = decide_route(
            "demo.openlen.com",
            "/c/abc123",
            &default_hosts(),
            &default_paths(),
        );
        assert_eq!(a, RouteAction::Proxy);
    }

    #[test]
    fn subdomain_unrelated_path_disk() {
        let a = decide_route(
            "demo.openlen.com",
            "/about",
            &default_hosts(),
            &default_paths(),
        );
        assert_eq!(a, RouteAction::Disk { sub: "demo".into() });
    }

    #[test]
    fn unknown_host_not_found() {
        let a = decide_route("ghost.example.com", "/", &default_hosts(), &default_paths());
        assert_eq!(a, RouteAction::NotFound);
    }

    #[test]
    fn nested_subdomain_not_found() {
        let a = decide_route(
            "a.b.openlen.com",
            "/c/x",
            &default_hosts(),
            &default_paths(),
        );
        assert_eq!(a, RouteAction::NotFound);
    }

    #[test]
    fn custom_hosts_swap_apex_behavior() {
        let hosts = vec!["api.example.com".into()];
        let paths = vec!["/c/".into()];
        // openlen.com no longer proxied
        assert_eq!(
            decide_route("openlen.com", "/", &hosts, &paths),
            RouteAction::NotFound
        );
        // api.example.com gets proxy
        assert_eq!(
            decide_route("api.example.com", "/x", &hosts, &paths),
            RouteAction::Proxy
        );
    }

    #[test]
    fn custom_proxy_paths_match_prefix() {
        let hosts = vec!["openlen.com".into()];
        let paths = vec!["/api/".into(), "/c/".into()];
        assert_eq!(
            decide_route("demo.openlen.com", "/api/x", &hosts, &paths),
            RouteAction::Proxy
        );
        assert_eq!(
            decide_route("demo.openlen.com", "/c/x", &hosts, &paths),
            RouteAction::Proxy
        );
        assert_eq!(
            decide_route("demo.openlen.com", "/assets/x.css", &hosts, &paths),
            RouteAction::Disk { sub: "demo".into() }
        );
    }

    #[test]
    fn proxy_path_prefix_is_literal_not_regex() {
        // "/c/" as prefix means /c/foo proxies but /cool/ does not
        let hosts: Vec<String> = vec![];
        let paths = vec!["/c/".into()];
        assert_eq!(
            decide_route("demo.openlen.com", "/c/foo", &hosts, &paths),
            RouteAction::Proxy
        );
        assert_eq!(
            decide_route("demo.openlen.com", "/cool/foo", &hosts, &paths),
            RouteAction::Disk { sub: "demo".into() }
        );
    }
}
