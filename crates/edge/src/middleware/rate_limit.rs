//! IP-based rate-limit Tower middleware.
//!
//! Sits at the edge, between TLS handshake and the routing layer. Decisions
//! are made against [`openlen_rate_limit::SmartCache`] using two windows
//! per IP — per-minute (burst) and per-hour (sustained). Blocked requests
//! short-circuit a 429 response with `Retry-After` and `X-RateLimit-*`
//! headers; allowed requests pass through to the inner service unchanged.
//!
//! ## Defense-in-depth posture
//!
//! Node-side rate limits (the TS callers migrated in F4 S1) own *per-userId*
//! quotas — plan enforcement, generation cost, signed-in surfaces. The edge
//! middleware adds a coarser *per-IP* layer in front of Node so abusive
//! traffic never gets to spend Node CPU / DB connections / auth lookups.
//! The two layers coexist; neither replaces the other.
//!
//! ## Client IP resolution
//!
//! Cloudflare sits in front of openlen.com, so `cf-connecting-ip` is the
//! authoritative source. Behind nginx (or during local dev) `x-real-ip`
//! takes over. As a last resort the TCP peer address from
//! [`axum::extract::ConnectInfo`] is used. Trust order is configurable via
//! [`IpExtractConfig::trusted_proxies`] — if the peer isn't in the trusted
//! set, header values are ignored (a hostile client can't spoof its IP by
//! sending `cf-connecting-ip: 127.0.0.1` from outside).
//!
//! ## Exempt paths
//!
//! Some paths bypass rate-limiting entirely:
//! - `/c/` — analytics beacons; rate-limited Node-side already.
//! - `/.well-known/acme-challenge/` — HTTP-01 challenge responder;
//!   blocking these would break cert issuance.
//! - Custom prefixes can be configured per deploy.
//!
//! ## What the middleware does NOT do
//!
//! - **Per-userId limits.** Would require session decryption at the edge —
//!   out of scope. Node-side limits cover this.
//! - **Distributed coordination.** Single-instance posture; memory is
//!   per-process. A two-pod future will need a different design.
//! - **Cost-aware limits.** Every request consumes one token regardless of
//!   payload size. Bigger requests are throttled by upstream timeouts.

use std::future::Future;
use std::net::{IpAddr, SocketAddr};
use std::pin::Pin;
use std::str::FromStr;
use std::sync::Arc;
use std::task::{Context, Poll};
use std::time::Instant;

use axum::body::Body;
use axum::extract::ConnectInfo;
use axum::http::{header, HeaderName, HeaderValue, Request, Response, StatusCode};
use openlen_rate_limit::{LimitWindow, SmartCache};
use tower::{Layer, Service};
use tracing::{debug, trace};

/// Where the client IP was sourced from. Used as a metric label.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClientIpSource {
    CfConnectingIp,
    XRealIp,
    PeerAddr,
    /// Fallback when none of the above resolves — the middleware uses the
    /// string `"unknown"` as the rate-limit key. Lets the limiter still cap
    /// the worst case (all unknown-source IPs share one bucket).
    Unknown,
}

impl ClientIpSource {
    pub fn as_label(self) -> &'static str {
        match self {
            ClientIpSource::CfConnectingIp => "cf_connecting_ip",
            ClientIpSource::XRealIp => "x_real_ip",
            ClientIpSource::PeerAddr => "peer_addr",
            ClientIpSource::Unknown => "unknown",
        }
    }
}

/// How to pick the client IP from request metadata.
#[derive(Debug, Clone)]
pub struct IpExtractConfig {
    /// Peer addresses (TCP layer) that we trust to forward proxy headers.
    /// Empty = trust all peers (use for local dev only); non-empty = only
    /// these peers can attribute via `cf-connecting-ip` / `x-real-ip`.
    pub trusted_proxies: Vec<IpAddr>,
    /// Header names to consult in order. Defaults to
    /// `["cf-connecting-ip", "x-real-ip"]`.
    pub headers: Vec<HeaderName>,
}

impl Default for IpExtractConfig {
    fn default() -> Self {
        Self {
            // Trust-all default — fine for the current Hetzner box where
            // Cloudflare is the only inbound path. Production overrides
            // via env (Phase D).
            trusted_proxies: Vec::new(),
            headers: vec![
                HeaderName::from_static("cf-connecting-ip"),
                HeaderName::from_static("x-real-ip"),
            ],
        }
    }
}

/// Configuration for the layer.
#[derive(Clone)]
pub struct RateLimitConfig {
    pub smart_cache: SmartCache,
    pub windows: Arc<Vec<LimitWindow>>,
    pub exempt_path_prefixes: Arc<Vec<String>>,
    pub ip_config: IpExtractConfig,
}

impl std::fmt::Debug for RateLimitConfig {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("RateLimitConfig")
            .field("smart_cache", &self.smart_cache)
            .field("windows", &self.windows)
            .field("exempt_path_prefixes", &self.exempt_path_prefixes)
            .field("ip_config_headers", &self.ip_config.headers)
            .finish()
    }
}

/// Tower [`Layer`] that wraps an inner service with rate-limit checks.
#[derive(Clone, Debug)]
pub struct RateLimitLayer {
    config: RateLimitConfig,
}

impl RateLimitLayer {
    pub fn new(config: RateLimitConfig) -> Self {
        Self { config }
    }
}

impl<S> Layer<S> for RateLimitLayer {
    type Service = RateLimitMiddleware<S>;

    fn layer(&self, inner: S) -> Self::Service {
        RateLimitMiddleware {
            inner,
            config: self.config.clone(),
        }
    }
}

/// The wrapped service. Holds a clone of `inner` and the shared config;
/// per-call state lives in the response future.
#[derive(Clone)]
pub struct RateLimitMiddleware<S> {
    inner: S,
    config: RateLimitConfig,
}

impl<S> Service<Request<Body>> for RateLimitMiddleware<S>
where
    S: Service<Request<Body>, Response = Response<Body>> + Send + Clone + 'static,
    S::Future: Send + 'static,
    S::Error: Send + 'static,
{
    type Response = Response<Body>;
    type Error = S::Error;
    type Future = Pin<Box<dyn Future<Output = Result<Self::Response, Self::Error>> + Send>>;

    fn poll_ready(&mut self, cx: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        self.inner.poll_ready(cx)
    }

    fn call(&mut self, req: Request<Body>) -> Self::Future {
        // Tower's contract: `inner` may not be in a polled-ready state for
        // the new request after `call`. The idiomatic workaround is to
        // clone the upstream service and call into the fresh clone (which
        // is automatically ready). See tower::ServiceExt and the
        // tower-http middleware crates for the exact pattern.
        let clone = self.inner.clone();
        let mut inner = std::mem::replace(&mut self.inner, clone);
        let config = self.config.clone();

        Box::pin(async move {
            let started = Instant::now();
            let path = req.uri().path().to_owned();

            // 1. Exempt paths short-circuit BEFORE the cache lookup.
            if config
                .exempt_path_prefixes
                .iter()
                .any(|p| path.starts_with(p.as_str()))
            {
                trace!(path, "rate-limit exempt path");
                metrics::counter!(
                    "openlen_edge_rate_limit_decisions_total",
                    "result" => "exempt",
                )
                .increment(1);
                return inner.call(req).await;
            }

            // 2. Identify the client.
            let (ip, source) = extract_client_ip(&req, &config.ip_config);
            let key = ip
                .as_deref()
                .map(|s| format!("ip:{s}"))
                .unwrap_or_else(|| "ip:unknown".to_owned());

            // 3. Decision.
            let decision = match config
                .smart_cache
                .check_and_consume(&key, &config.windows)
                .await
            {
                Ok(d) => d,
                Err(err) => {
                    // Fail open — a broken limiter must not take down traffic.
                    debug!(error = %err, key, "rate-limit decision errored — failing open");
                    metrics::counter!(
                        "openlen_edge_rate_limit_decisions_total",
                        "result" => "error",
                    )
                    .increment(1);
                    return inner.call(req).await;
                }
            };

            // 4. Metrics on every decision (allow + block) regardless of path.
            metrics::histogram!("openlen_edge_rate_limit_decision_duration_seconds")
                .record(started.elapsed().as_secs_f64());
            metrics::counter!(
                "openlen_edge_rate_limit_memory_hits_total",
                "source" => source.as_label(),
            )
            .increment(1);

            if decision.ok {
                metrics::counter!(
                    "openlen_edge_rate_limit_decisions_total",
                    "result" => "allowed",
                )
                .increment(1);
                return inner.call(req).await;
            }

            // 5. Blocked → 429 short-circuit.
            metrics::counter!(
                "openlen_edge_rate_limit_decisions_total",
                "result" => "blocked",
            )
            .increment(1);

            let blocked = decision.blocked.as_ref();
            let limit_value = blocked.map(|w| w.max).unwrap_or(0);
            let remaining_value = decision
                .remaining
                .iter()
                .find(|r| blocked.map(|b| b.label == r.window.label).unwrap_or(false))
                .map(|r| r.remaining)
                .unwrap_or(0);
            let reset_unix = decision
                .reset_at
                .map(|t| t.timestamp().max(0) as u64)
                .unwrap_or(0);
            let retry_after_secs = decision
                .reset_at
                .map(|t| {
                    let now = chrono::Utc::now();
                    let delta = t.signed_duration_since(now).num_seconds();
                    if delta < 0 {
                        1
                    } else {
                        delta as u64
                    }
                })
                .unwrap_or(60);

            debug!(
                key,
                source = source.as_label(),
                path,
                window = blocked.map(|w| w.label.as_str()).unwrap_or("?"),
                retry_after_secs,
                "rate-limit blocked"
            );

            Ok(blocked_response(
                limit_value,
                remaining_value,
                reset_unix,
                retry_after_secs,
            ))
        })
    }
}

/// Walks `headers` then peer-addr per the configured order and returns the
/// first IP that parses. Untrusted peers cause header values to be ignored.
pub fn extract_client_ip(
    req: &Request<Body>,
    cfg: &IpExtractConfig,
) -> (Option<String>, ClientIpSource) {
    let peer_ip = req
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ci| ci.0.ip());
    let peer_trusted = match peer_ip {
        None => false,
        Some(_) if cfg.trusted_proxies.is_empty() => true,
        Some(ip) => cfg.trusted_proxies.contains(&ip),
    };

    if peer_trusted {
        for header_name in &cfg.headers {
            if let Some(val) = req.headers().get(header_name).and_then(|v| v.to_str().ok()) {
                // Header may carry a comma-separated chain ("client, prox1,
                // prox2"); the first entry is the original client.
                let first = val.split(',').next().unwrap_or(val).trim();
                if first.is_empty() {
                    continue;
                }
                if IpAddr::from_str(first).is_ok() {
                    let source = if header_name == "cf-connecting-ip" {
                        ClientIpSource::CfConnectingIp
                    } else if header_name == "x-real-ip" {
                        ClientIpSource::XRealIp
                    } else {
                        ClientIpSource::PeerAddr
                    };
                    return (Some(first.to_owned()), source);
                }
            }
        }
    }

    match peer_ip {
        Some(ip) => (Some(ip.to_string()), ClientIpSource::PeerAddr),
        None => (None, ClientIpSource::Unknown),
    }
}

fn blocked_response(
    limit: u32,
    remaining: u32,
    reset_unix: u64,
    retry_after_secs: u64,
) -> Response<Body> {
    let body = "Too Many Requests\n";
    let mut builder = Response::builder()
        .status(StatusCode::TOO_MANY_REQUESTS)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(header::RETRY_AFTER, retry_after_secs);
    if let Ok(v) = HeaderValue::from_str(&limit.to_string()) {
        builder = builder.header(HeaderName::from_static("x-ratelimit-limit"), v);
    }
    if let Ok(v) = HeaderValue::from_str(&remaining.to_string()) {
        builder = builder.header(HeaderName::from_static("x-ratelimit-remaining"), v);
    }
    if let Ok(v) = HeaderValue::from_str(&reset_unix.to_string()) {
        builder = builder.header(HeaderName::from_static("x-ratelimit-reset"), v);
    }
    builder
        .body(Body::from(body))
        .expect("static blocked response is valid")
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::extract::ConnectInfo;
    use openlen_rate_limit::{SmartCache, SmartCacheConfig};
    use std::convert::Infallible;
    use std::net::SocketAddr;
    use tower::ServiceExt;

    fn windows() -> Vec<LimitWindow> {
        vec![LimitWindow {
            window_ms: 60_000,
            max: 3,
            label: "per_min".into(),
        }]
    }

    fn cache() -> (SmartCache, openlen_rate_limit::SmartCacheBackground) {
        SmartCache::start_memory_only(SmartCacheConfig::default())
    }

    fn make_config(
        smart_cache: SmartCache,
        exempt: Vec<String>,
        trust_all: bool,
    ) -> RateLimitConfig {
        let trusted_proxies = if trust_all {
            Vec::new()
        } else {
            vec!["127.0.0.1".parse().unwrap()]
        };
        let ip_config = IpExtractConfig {
            trusted_proxies,
            ..IpExtractConfig::default()
        };
        RateLimitConfig {
            smart_cache,
            windows: Arc::new(windows()),
            exempt_path_prefixes: Arc::new(exempt),
            ip_config,
        }
    }

    fn req_with(path: &str, peer: &str) -> Request<Body> {
        let mut req = Request::builder().uri(path).body(Body::empty()).unwrap();
        let addr: SocketAddr = peer.parse().unwrap();
        req.extensions_mut().insert(ConnectInfo(addr));
        req
    }

    fn req_with_header(
        path: &str,
        peer: &str,
        header_name: &'static str,
        header_val: &str,
    ) -> Request<Body> {
        let mut req = req_with(path, peer);
        req.headers_mut().insert(
            HeaderName::from_static(header_name),
            HeaderValue::from_str(header_val).unwrap(),
        );
        req
    }

    /// Trivial inner service that returns 200 OK with a marker header so we
    /// can tell allow vs blocked apart.
    #[derive(Clone)]
    struct DummyInner;
    impl Service<Request<Body>> for DummyInner {
        type Response = Response<Body>;
        type Error = Infallible;
        type Future = Pin<Box<dyn Future<Output = Result<Self::Response, Self::Error>> + Send>>;
        fn poll_ready(&mut self, _: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
            Poll::Ready(Ok(()))
        }
        fn call(&mut self, _: Request<Body>) -> Self::Future {
            Box::pin(async {
                Ok(Response::builder()
                    .status(StatusCode::OK)
                    .header("x-passed-through", "1")
                    .body(Body::from("ok"))
                    .unwrap())
            })
        }
    }

    #[tokio::test]
    async fn allows_within_limit() {
        let (cache, _bg) = cache();
        let config = make_config(cache, vec![], true);
        let layer = RateLimitLayer::new(config);
        let svc = layer.layer(DummyInner);

        for _ in 0..3 {
            let svc = svc.clone();
            let resp = svc.oneshot(req_with("/", "8.8.8.8:1234")).await.unwrap();
            assert_eq!(resp.status(), StatusCode::OK);
            assert!(resp.headers().contains_key("x-passed-through"));
        }
    }

    #[tokio::test]
    async fn blocks_past_limit_with_429_headers() {
        let (cache, _bg) = cache();
        let config = make_config(cache, vec![], true);
        let layer = RateLimitLayer::new(config);
        let svc = layer.layer(DummyInner);

        for _ in 0..3 {
            let s = svc.clone();
            let _ = s.oneshot(req_with("/", "1.2.3.4:99")).await.unwrap();
        }
        let s = svc.clone();
        let resp = s.oneshot(req_with("/", "1.2.3.4:99")).await.unwrap();
        assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
        assert!(!resp.headers().contains_key("x-passed-through"));
        assert!(resp.headers().contains_key(header::RETRY_AFTER));
        assert!(resp.headers().contains_key("x-ratelimit-limit"));
        assert!(resp.headers().contains_key("x-ratelimit-remaining"));
        assert!(resp.headers().contains_key("x-ratelimit-reset"));
        assert_eq!(
            resp.headers()
                .get("x-ratelimit-limit")
                .unwrap()
                .to_str()
                .unwrap(),
            "3"
        );
        assert_eq!(
            resp.headers()
                .get("x-ratelimit-remaining")
                .unwrap()
                .to_str()
                .unwrap(),
            "0"
        );
    }

    #[tokio::test]
    async fn exempt_path_bypasses_limit() {
        let (cache, _bg) = cache();
        let config = make_config(cache, vec!["/c/".into()], true);
        let layer = RateLimitLayer::new(config);
        let svc = layer.layer(DummyInner);

        // Burn the limit on a non-exempt path.
        for _ in 0..3 {
            let s = svc.clone();
            let _ = s.oneshot(req_with("/", "9.9.9.9:1")).await.unwrap();
        }
        // The 4th non-exempt request would be blocked …
        let s = svc.clone();
        let resp = s.oneshot(req_with("/", "9.9.9.9:1")).await.unwrap();
        assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
        // … but /c/ is exempt and still passes.
        let s = svc.clone();
        let resp = s.oneshot(req_with("/c/abc", "9.9.9.9:1")).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn different_ips_have_independent_buckets() {
        let (cache, _bg) = cache();
        let config = make_config(cache, vec![], true);
        let layer = RateLimitLayer::new(config);
        let svc = layer.layer(DummyInner);

        for _ in 0..3 {
            let s = svc.clone();
            let _ = s.oneshot(req_with("/", "1.1.1.1:1")).await.unwrap();
        }
        // Same IP -> blocked
        let s = svc.clone();
        let resp = s.oneshot(req_with("/", "1.1.1.1:1")).await.unwrap();
        assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
        // Different IP -> fresh bucket
        let s = svc.clone();
        let resp = s.oneshot(req_with("/", "2.2.2.2:1")).await.unwrap();
        assert_eq!(resp.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn cf_connecting_ip_takes_precedence_when_trusted() {
        let (cache, _bg) = cache();
        let config = make_config(cache, vec![], true);
        let layer = RateLimitLayer::new(config.clone());
        let svc = layer.layer(DummyInner);

        // All requests have peer=8.8.8.8 (trusted) but a different
        // cf-connecting-ip per request — they should each be a fresh
        // bucket.
        for ip in ["1.2.3.4", "5.6.7.8", "9.9.9.9", "10.10.10.10"] {
            let s = svc.clone();
            let resp = s
                .oneshot(req_with_header("/", "8.8.8.8:1", "cf-connecting-ip", ip))
                .await
                .unwrap();
            assert_eq!(
                resp.status(),
                StatusCode::OK,
                "cf-ip={ip} should pass first time"
            );
        }
    }

    #[tokio::test]
    async fn untrusted_peer_falls_back_to_peer_addr_not_header() {
        let (cache, _bg) = cache();
        let config = make_config(cache, vec![], false); // only 127.0.0.1 trusted
        let layer = RateLimitLayer::new(config);
        let svc = layer.layer(DummyInner);

        // peer=5.5.5.5 NOT trusted; header should be ignored, peer used
        // instead. Sending many requests from the same peer should hit
        // the same bucket regardless of header IP.
        for _ in 0..3 {
            let s = svc.clone();
            let _ = s
                .oneshot(req_with_header(
                    "/",
                    "5.5.5.5:1",
                    "cf-connecting-ip",
                    "1.1.1.1",
                ))
                .await
                .unwrap();
        }
        let s = svc.clone();
        let resp = s
            .oneshot(req_with_header(
                "/",
                "5.5.5.5:1",
                "cf-connecting-ip",
                "2.2.2.2", // different header IP, still blocked
            ))
            .await
            .unwrap();
        assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
    }

    #[test]
    fn extract_client_ip_prefers_cf_header_when_trusted() {
        let ip_config = IpExtractConfig {
            trusted_proxies: vec!["127.0.0.1".parse().unwrap()],
            ..IpExtractConfig::default()
        };
        let req = req_with_header("/", "127.0.0.1:1", "cf-connecting-ip", "1.2.3.4");
        let (ip, src) = extract_client_ip(&req, &ip_config);
        assert_eq!(ip.as_deref(), Some("1.2.3.4"));
        assert_eq!(src, ClientIpSource::CfConnectingIp);
    }

    #[test]
    fn extract_client_ip_ignores_header_from_untrusted_peer() {
        let ip_config = IpExtractConfig {
            trusted_proxies: vec!["127.0.0.1".parse().unwrap()],
            ..IpExtractConfig::default()
        };
        let req = req_with_header("/", "9.9.9.9:1", "cf-connecting-ip", "1.2.3.4");
        let (ip, src) = extract_client_ip(&req, &ip_config);
        // Header ignored — peer addr used.
        assert_eq!(ip.as_deref(), Some("9.9.9.9"));
        assert_eq!(src, ClientIpSource::PeerAddr);
    }

    #[test]
    fn extract_client_ip_handles_comma_chain() {
        let ip_config = IpExtractConfig::default(); // trust-all
        let req = req_with_header("/", "1.1.1.1:1", "x-real-ip", "5.6.7.8, 192.168.1.1");
        let (ip, src) = extract_client_ip(&req, &ip_config);
        assert_eq!(ip.as_deref(), Some("5.6.7.8"));
        assert_eq!(src, ClientIpSource::XRealIp);
    }

    #[test]
    fn extract_client_ip_falls_back_to_peer_when_no_header() {
        let ip_config = IpExtractConfig::default();
        let req = req_with("/", "203.0.113.10:443");
        let (ip, src) = extract_client_ip(&req, &ip_config);
        assert_eq!(ip.as_deref(), Some("203.0.113.10"));
        assert_eq!(src, ClientIpSource::PeerAddr);
    }

    #[test]
    fn extract_client_ip_returns_none_when_no_peer_and_no_header() {
        let ip_config = IpExtractConfig::default();
        let req = Request::builder().uri("/").body(Body::empty()).unwrap();
        let (ip, src) = extract_client_ip(&req, &ip_config);
        assert_eq!(ip, None);
        assert_eq!(src, ClientIpSource::Unknown);
    }

    #[test]
    fn extract_client_ip_skips_invalid_header() {
        let ip_config = IpExtractConfig::default();
        let req = req_with_header("/", "1.1.1.1:1", "cf-connecting-ip", "not-an-ip");
        let (ip, src) = extract_client_ip(&req, &ip_config);
        // Bad header -> fall through to peer.
        assert_eq!(ip.as_deref(), Some("1.1.1.1"));
        assert_eq!(src, ClientIpSource::PeerAddr);
    }

    #[test]
    fn client_ip_source_labels_are_lowercase_underscored() {
        assert_eq!(
            ClientIpSource::CfConnectingIp.as_label(),
            "cf_connecting_ip"
        );
        assert_eq!(ClientIpSource::XRealIp.as_label(), "x_real_ip");
        assert_eq!(ClientIpSource::PeerAddr.as_label(), "peer_addr");
        assert_eq!(ClientIpSource::Unknown.as_label(), "unknown");
    }

    #[test]
    fn blocked_response_carries_all_headers_and_429() {
        let resp = blocked_response(300, 0, 1_700_000_000, 42);
        assert_eq!(resp.status(), StatusCode::TOO_MANY_REQUESTS);
        assert_eq!(
            resp.headers()
                .get(header::RETRY_AFTER)
                .unwrap()
                .to_str()
                .unwrap(),
            "42"
        );
        assert_eq!(
            resp.headers()
                .get("x-ratelimit-limit")
                .unwrap()
                .to_str()
                .unwrap(),
            "300"
        );
        assert_eq!(
            resp.headers()
                .get("x-ratelimit-reset")
                .unwrap()
                .to_str()
                .unwrap(),
            "1700000000"
        );
    }
}
