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
    /// Serve from `<publish_root>/<sub>/current/` on disk (or
    /// `<publish_root>/<sub>/` when the URL starts with `/assets/` — see
    /// `server::serve_from_disk` for the base-dir choice).
    Disk { sub: String },
    /// Proxy the request to the configured Node upstream as-is.
    Proxy,
    /// `host` is a candidate custom domain — caller must async-resolve it via
    /// the `DomainLookup` layer and route to disk on a hit, or 404 on a miss.
    /// The host string is already port-stripped + lowercased.
    CustomDomain { host: String },
    /// Serve from the shared uploads root (`<UPLOADS_DIR>` in
    /// `openlen-app.service`). Triggered for `/uploads/*` on any host. The
    /// router strips the `/uploads/` prefix and looks the rest up against the
    /// configured `uploads_root`.
    SharedUploads,
    /// Serve from the Next.js build-time static-assets root
    /// (`/opt/openlen-app/.next/static`). Triggered for `/_next/static/*` on
    /// the apex / www hosts only.
    NextStatic,
    /// No matching route — caller should respond 404.
    NotFound,
}

/// Tells the caller whether a `Disk { sub }` action should serve the URL out
/// of `<sub>/current/` (default — the rotated release dir) or out of `<sub>/`
/// itself (for the `/assets/*` sibling tree, which survives release
/// rotations).
pub fn disk_base_for(url_path: &str) -> DiskBase {
    if url_path.starts_with("/assets/") {
        DiskBase::Sibling
    } else {
        DiskBase::Current
    }
}

/// Which directory inside `<publish_root>/<sub>/` a [`RouteAction::Disk`]
/// request should resolve against.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DiskBase {
    /// `<publish_root>/<sub>/current/` — the rotating release symlink.
    Current,
    /// `<publish_root>/<sub>/` — direct sibling of `current/`, used for the
    /// `/assets/*` tree that persists across deploys.
    Sibling,
}

/// Decide where a request goes. First match wins inside each host class:
///
/// **Apex / www host** (`host` ∈ `proxy_hosts`):
/// 1. `/_next/static/*` → [`RouteAction::NextStatic`]
/// 2. `/uploads/*`      → [`RouteAction::SharedUploads`]
/// 3. anything else     → [`RouteAction::Proxy`]
///
/// **Wildcard subdomain host** (`*.openlen.com`):
/// 1. path matches any prefix in `proxy_paths` (default `/c/`, `/api/f/`) →
///    [`RouteAction::Proxy`]
/// 2. `/uploads/*` → [`RouteAction::SharedUploads`]
/// 3. anything else → [`RouteAction::Disk { sub }`] (caller picks
///    `current/` vs sibling via [`disk_base_for`])
///
/// **In-zone but not a valid sub** (`a.b.openlen.com`, apex absent from
/// `proxy_hosts`, etc.) → [`RouteAction::NotFound`].
///
/// **Non-public hostname** → [`RouteAction::NotFound`].
///
/// **Custom-domain candidate** (any other public hostname):
/// 1. path matches any prefix in `custom_domain_proxy_paths` (default `/c/`,
///    `/api/`) → [`RouteAction::Proxy`]
/// 2. `/uploads/*` → [`RouteAction::SharedUploads`]
/// 3. anything else → [`RouteAction::CustomDomain { host }`]; caller must
///    resolve it via the lookup layer and dispatch to disk.
pub fn decide_route(
    host: &str,
    path: &str,
    proxy_hosts: &[String],
    proxy_paths: &[String],
    custom_domain_proxy_paths: &[String],
) -> RouteAction {
    let host_lc = normalize_host(host);

    if proxy_hosts.iter().any(|h| h == &host_lc) {
        if path.starts_with("/_next/static/") {
            return RouteAction::NextStatic;
        }
        if path.starts_with("/uploads/") {
            return RouteAction::SharedUploads;
        }
        return RouteAction::Proxy;
    }

    if let Some(sub) = extract_subdomain(host) {
        if proxy_paths.iter().any(|p| path.starts_with(p.as_str())) {
            return RouteAction::Proxy;
        }
        if path.starts_with("/uploads/") {
            return RouteAction::SharedUploads;
        }
        return RouteAction::Disk { sub };
    }

    if is_openlen_zone(&host_lc) {
        return RouteAction::NotFound;
    }

    if !looks_like_public_hostname(&host_lc) {
        return RouteAction::NotFound;
    }

    if custom_domain_proxy_paths
        .iter()
        .any(|p| path.starts_with(p.as_str()))
    {
        return RouteAction::Proxy;
    }
    if path.starts_with("/uploads/") {
        return RouteAction::SharedUploads;
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
        vec!["/c/".into(), "/api/f/".into()]
    }
    fn default_custom_paths() -> Vec<String> {
        vec!["/c/".into(), "/api/".into()]
    }
    fn decide(host: &str, path: &str) -> RouteAction {
        decide_route(
            host,
            path,
            &default_hosts(),
            &default_paths(),
            &default_custom_paths(),
        )
    }

    #[test]
    fn apex_proxies() {
        assert_eq!(decide("openlen.com", "/foo"), RouteAction::Proxy);
    }

    #[test]
    fn www_proxies() {
        assert_eq!(decide("www.openlen.com", "/auth/login"), RouteAction::Proxy);
    }

    #[test]
    fn apex_with_port_proxies() {
        assert_eq!(decide("openlen.com:443", "/"), RouteAction::Proxy);
    }

    #[test]
    fn apex_uppercase_proxies() {
        assert_eq!(decide("Openlen.COM", "/"), RouteAction::Proxy);
    }

    #[test]
    fn apex_uploads_routes_to_shared_uploads() {
        // Apex /uploads/* skips Node and serves direct from disk to mirror
        // nginx's `location /uploads/` + Caddy's `handle_path /uploads/*`.
        assert_eq!(
            decide("openlen.com", "/uploads/abc.png"),
            RouteAction::SharedUploads
        );
        assert_eq!(
            decide("www.openlen.com", "/uploads/x/y/z.png"),
            RouteAction::SharedUploads
        );
    }

    #[test]
    fn apex_next_static_routes_to_next_static() {
        assert_eq!(
            decide("openlen.com", "/_next/static/chunks/main.js"),
            RouteAction::NextStatic
        );
        assert_eq!(
            decide("www.openlen.com", "/_next/static/abc.js"),
            RouteAction::NextStatic
        );
    }

    #[test]
    fn apex_arbitrary_api_still_proxies() {
        // /api/foo on apex is for the Next API surface — proxy, not disk.
        assert_eq!(
            decide("openlen.com", "/api/projects/123"),
            RouteAction::Proxy
        );
    }

    #[test]
    fn subdomain_root_disk() {
        assert_eq!(
            decide("demo.openlen.com", "/"),
            RouteAction::Disk { sub: "demo".into() }
        );
    }

    #[test]
    fn subdomain_c_path_proxies() {
        assert_eq!(decide("demo.openlen.com", "/c/abc123"), RouteAction::Proxy);
    }

    #[test]
    fn subdomain_api_f_proxies() {
        // /api/f/<sub> is the form-submission endpoint — Node handles it.
        assert_eq!(
            decide("demo.openlen.com", "/api/f/mirror"),
            RouteAction::Proxy
        );
    }

    #[test]
    fn subdomain_api_other_does_not_proxy() {
        // /api/projects/... must NOT proxy on a published subdomain — only
        // /api/f/ does. Otherwise a user-deployed page could hammer the
        // app's private API surface.
        assert_eq!(
            decide("demo.openlen.com", "/api/projects/1"),
            RouteAction::Disk { sub: "demo".into() }
        );
    }

    #[test]
    fn subdomain_uploads_routes_to_shared_uploads() {
        // /uploads/* on a subdomain skips per-sub disk — Caddy mirrors
        // this with `handle_path /uploads/*` reading from
        // /var/openlen/uploads.
        assert_eq!(
            decide("demo.openlen.com", "/uploads/foo.png"),
            RouteAction::SharedUploads
        );
    }

    #[test]
    fn subdomain_assets_stays_disk() {
        // /assets/* stays Disk { sub } at the routing layer; serve_from_disk
        // picks the sibling base via disk_base_for().
        assert_eq!(
            decide("demo.openlen.com", "/assets/style.css"),
            RouteAction::Disk { sub: "demo".into() }
        );
    }

    #[test]
    fn subdomain_unrelated_path_disk() {
        assert_eq!(
            decide("demo.openlen.com", "/about"),
            RouteAction::Disk { sub: "demo".into() }
        );
    }

    #[test]
    fn external_hostname_becomes_custom_domain_candidate() {
        // With F2 S4, any well-formed public hostname OUTSIDE the openlen.com
        // zone is a candidate for a custom-domain lookup. The lookup itself
        // happens in the server layer; decide_route just classifies.
        assert_eq!(
            decide("ghost.example.com", "/"),
            RouteAction::CustomDomain {
                host: "ghost.example.com".into()
            }
        );
    }

    #[test]
    fn nested_subdomain_not_found() {
        assert_eq!(decide("a.b.openlen.com", "/c/x"), RouteAction::NotFound);
    }

    #[test]
    fn custom_hosts_swap_apex_behavior() {
        let hosts = vec!["api.example.com".into()];
        let paths = vec!["/c/".into()];
        let cd_paths = vec!["/c/".into(), "/api/".into()];
        // openlen.com no longer proxied — still in our zone → NotFound.
        assert_eq!(
            decide_route("openlen.com", "/", &hosts, &paths, &cd_paths),
            RouteAction::NotFound
        );
        // api.example.com is in proxy_hosts → Proxy.
        assert_eq!(
            decide_route("api.example.com", "/x", &hosts, &paths, &cd_paths),
            RouteAction::Proxy
        );
    }

    #[test]
    fn custom_proxy_paths_match_prefix() {
        let hosts = vec!["openlen.com".into()];
        let paths = vec!["/api/".into(), "/c/".into()];
        let cd_paths = vec!["/c/".into(), "/api/".into()];
        assert_eq!(
            decide_route("demo.openlen.com", "/api/x", &hosts, &paths, &cd_paths),
            RouteAction::Proxy
        );
        assert_eq!(
            decide_route("demo.openlen.com", "/c/x", &hosts, &paths, &cd_paths),
            RouteAction::Proxy
        );
        assert_eq!(
            decide_route(
                "demo.openlen.com",
                "/assets/x.css",
                &hosts,
                &paths,
                &cd_paths
            ),
            RouteAction::Disk { sub: "demo".into() }
        );
    }

    #[test]
    fn proxy_path_prefix_is_literal_not_regex() {
        // "/c/" as prefix means /c/foo proxies but /cool/ does not
        let hosts: Vec<String> = vec![];
        let paths = vec!["/c/".into()];
        let cd_paths = vec!["/c/".into()];
        assert_eq!(
            decide_route("demo.openlen.com", "/c/foo", &hosts, &paths, &cd_paths),
            RouteAction::Proxy
        );
        assert_eq!(
            decide_route("demo.openlen.com", "/cool/foo", &hosts, &paths, &cd_paths),
            RouteAction::Disk { sub: "demo".into() }
        );
    }

    #[test]
    fn custom_domain_candidate_returns_customdomain() {
        assert_eq!(
            decide("mybrand.com", "/"),
            RouteAction::CustomDomain {
                host: "mybrand.com".into()
            }
        );
    }

    #[test]
    fn custom_domain_subdomain_returns_customdomain() {
        assert_eq!(
            decide("landing.miempresa.com", "/about"),
            RouteAction::CustomDomain {
                host: "landing.miempresa.com".into()
            }
        );
    }

    #[test]
    fn custom_domain_with_port_returns_normalized_host() {
        assert_eq!(
            decide("mybrand.com:443", "/"),
            RouteAction::CustomDomain {
                host: "mybrand.com".into()
            }
        );
    }

    #[test]
    fn custom_domain_uppercase_normalized() {
        assert_eq!(
            decide("Mybrand.COM", "/"),
            RouteAction::CustomDomain {
                host: "mybrand.com".into()
            }
        );
    }

    #[test]
    fn custom_domain_with_proxy_path_routes_to_proxy() {
        // /c/abc on a custom domain → Node (analytics beacon).
        assert_eq!(decide("mybrand.com", "/c/abc"), RouteAction::Proxy);
    }

    #[test]
    fn custom_domain_api_passes_through() {
        // /api/* on a custom domain → Node (broader than wildcard subdomain
        // — custom domains alias a single project and the auth surface is
        // safe to expose; most endpoints 401 without a cookie).
        assert_eq!(decide("mybrand.com", "/api/projects/1"), RouteAction::Proxy);
        assert_eq!(decide("mybrand.com", "/api/f/sub"), RouteAction::Proxy);
    }

    #[test]
    fn custom_domain_uploads_routes_to_shared_uploads() {
        // Custom domain /uploads/* skips the per-host lookup AND the disk
        // serve out of <sub>/current — straight to the shared uploads root.
        assert_eq!(
            decide("mybrand.com", "/uploads/foo.png"),
            RouteAction::SharedUploads
        );
    }

    #[test]
    fn apex_without_proxy_hosts_stays_not_found() {
        // openlen.com NOT in proxy_hosts list, and it's our zone → NotFound,
        // never CustomDomain.
        let hosts: Vec<String> = vec![];
        assert_eq!(
            decide_route(
                "openlen.com",
                "/",
                &hosts,
                &default_paths(),
                &default_custom_paths()
            ),
            RouteAction::NotFound
        );
    }

    #[test]
    fn garbage_host_stays_not_found() {
        assert_eq!(decide("not a host", "/"), RouteAction::NotFound);
    }

    #[test]
    fn localhost_stays_not_found() {
        // No dot → not a public hostname → 404, not a custom-domain lookup.
        assert_eq!(decide("localhost", "/"), RouteAction::NotFound);
    }

    #[test]
    fn ip_literal_stays_not_found() {
        assert_eq!(decide("127.0.0.1", "/"), RouteAction::NotFound);
    }

    #[test]
    fn disk_base_for_assets_returns_sibling() {
        assert_eq!(disk_base_for("/assets/foo.css"), DiskBase::Sibling);
        assert_eq!(disk_base_for("/assets/"), DiskBase::Sibling);
    }

    #[test]
    fn disk_base_for_other_paths_returns_current() {
        assert_eq!(disk_base_for("/"), DiskBase::Current);
        assert_eq!(disk_base_for("/about"), DiskBase::Current);
        assert_eq!(disk_base_for("/asset"), DiskBase::Current);
        assert_eq!(disk_base_for("/assetstuff"), DiskBase::Current);
    }
}
