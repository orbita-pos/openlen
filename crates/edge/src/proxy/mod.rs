pub mod client;
pub mod headers;
pub mod stream;
pub mod timeout_body;

pub use client::{NodeClient, NodeClientError};
pub use stream::{bad_gateway, error_to_response, gateway_timeout};
pub use timeout_body::TimeoutBody;

use std::net::SocketAddr;

use axum::body::Body;
use axum::http::{Request, Response, Version};
use tracing::{debug, warn};

use crate::routing::subdomain::normalize_host;
use crate::routing::{extract_subdomain, is_openlen_zone, looks_like_public_hostname};

/// Where a request should be handled.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RouteAction {
    /// Serve from `<publish_root>/<sub>/current/` on disk.
    Disk { sub: String },
    /// Proxy the request to the configured Node upstream as-is.
    Proxy,
    /// `host` is a candidate custom domain — caller must async-resolve it via
    /// the `DomainLookup` layer and route to disk on a hit, or 404 on a miss.
    /// The host string is already port-stripped + lowercased.
    CustomDomain { host: String },
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
/// 3. `host` is in the `openlen.com` zone but didn't match step 1 or 2
///    (nested subdomain like `a.b.openlen.com`, or apex absent from
///    `proxy_hosts`)                                       → [`RouteAction::NotFound`]
/// 4. `host` does not look like a public hostname          → [`RouteAction::NotFound`]
/// 5. `host` is a candidate custom domain:
///    - `path` starts with any prefix in `proxy_paths`     → [`RouteAction::Proxy`]
///      (Node owns `/c/` analytics + `/api/f/` form submissions even on
///      custom domains; that's deliberate — see F2 S4 handoff §4)
///    - otherwise                                          → [`RouteAction::CustomDomain`]
pub fn decide_route(
    host: &str,
    path: &str,
    proxy_hosts: &[String],
    proxy_paths: &[String],
) -> RouteAction {
    let host_lc = normalize_host(host);

    if proxy_hosts.iter().any(|h| h == &host_lc) {
        return RouteAction::Proxy;
    }

    if let Some(sub) = extract_subdomain(host) {
        if proxy_paths.iter().any(|p| path.starts_with(p.as_str())) {
            return RouteAction::Proxy;
        }
        return RouteAction::Disk { sub };
    }

    if is_openlen_zone(&host_lc) {
        return RouteAction::NotFound;
    }

    if !looks_like_public_hostname(&host_lc) {
        return RouteAction::NotFound;
    }

    if proxy_paths.iter().any(|p| path.starts_with(p.as_str())) {
        return RouteAction::Proxy;
    }

    RouteAction::CustomDomain { host: host_lc }
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
    fn external_hostname_becomes_custom_domain_candidate() {
        // With F2 S4, any well-formed public hostname OUTSIDE the openlen.com
        // zone is a candidate for a custom-domain lookup. The lookup itself
        // happens in the server layer; decide_route just classifies.
        let a = decide_route("ghost.example.com", "/", &default_hosts(), &default_paths());
        assert_eq!(
            a,
            RouteAction::CustomDomain {
                host: "ghost.example.com".into()
            }
        );
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
        // openlen.com no longer proxied — still in our zone → NotFound.
        assert_eq!(
            decide_route("openlen.com", "/", &hosts, &paths),
            RouteAction::NotFound
        );
        // api.example.com is in proxy_hosts → Proxy.
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

    #[test]
    fn custom_domain_candidate_returns_customdomain() {
        let a = decide_route("mybrand.com", "/", &default_hosts(), &default_paths());
        assert_eq!(
            a,
            RouteAction::CustomDomain {
                host: "mybrand.com".into()
            }
        );
    }

    #[test]
    fn custom_domain_subdomain_returns_customdomain() {
        let a = decide_route(
            "landing.miempresa.com",
            "/about",
            &default_hosts(),
            &default_paths(),
        );
        assert_eq!(
            a,
            RouteAction::CustomDomain {
                host: "landing.miempresa.com".into()
            }
        );
    }

    #[test]
    fn custom_domain_with_port_returns_normalized_host() {
        let a = decide_route("mybrand.com:443", "/", &default_hosts(), &default_paths());
        assert_eq!(
            a,
            RouteAction::CustomDomain {
                host: "mybrand.com".into()
            }
        );
    }

    #[test]
    fn custom_domain_uppercase_normalized() {
        let a = decide_route("Mybrand.COM", "/", &default_hosts(), &default_paths());
        assert_eq!(
            a,
            RouteAction::CustomDomain {
                host: "mybrand.com".into()
            }
        );
    }

    #[test]
    fn custom_domain_with_proxy_path_routes_to_proxy() {
        // /c/abc on a custom domain still goes to Node (analytics beacon).
        let a = decide_route("mybrand.com", "/c/abc", &default_hosts(), &default_paths());
        assert_eq!(a, RouteAction::Proxy);
    }

    #[test]
    fn apex_without_proxy_hosts_stays_not_found() {
        // openlen.com NOT in proxy_hosts list, and it's our zone → NotFound,
        // never CustomDomain.
        let hosts: Vec<String> = vec![];
        let a = decide_route("openlen.com", "/", &hosts, &default_paths());
        assert_eq!(a, RouteAction::NotFound);
    }

    #[test]
    fn garbage_host_stays_not_found() {
        let a = decide_route("not a host", "/", &default_hosts(), &default_paths());
        assert_eq!(a, RouteAction::NotFound);
    }

    #[test]
    fn localhost_stays_not_found() {
        // No dot → not a public hostname → 404, not a custom-domain lookup.
        let a = decide_route("localhost", "/", &default_hosts(), &default_paths());
        assert_eq!(a, RouteAction::NotFound);
    }

    #[test]
    fn ip_literal_stays_not_found() {
        let a = decide_route("127.0.0.1", "/", &default_hosts(), &default_paths());
        assert_eq!(a, RouteAction::NotFound);
    }
}
