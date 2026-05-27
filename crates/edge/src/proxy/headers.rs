use std::net::SocketAddr;

use axum::http::header::HeaderMap;
use axum::http::{HeaderName, HeaderValue};

const HOP_BY_HOP: &[&str] = &[
    "connection",
    "keep-alive",
    "proxy-connection",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
];

/// Strip hop-by-hop headers from `headers` per RFC 7230 §6.1 / RFC 9110 §7.6.1.
/// Also removes any field listed in `Connection:` (per the same RFC clause) and
/// any remaining `Proxy-*` header, defensively.
pub fn strip_hop_by_hop(headers: &mut HeaderMap) {
    let conn_names: Vec<HeaderName> = headers
        .get_all("connection")
        .iter()
        .filter_map(|v| v.to_str().ok())
        .flat_map(|s| s.split(','))
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .filter_map(|s| HeaderName::try_from(s).ok())
        .collect();

    for h in HOP_BY_HOP {
        headers.remove(*h);
    }
    for h in conn_names {
        headers.remove(h);
    }

    let proxy_names: Vec<HeaderName> = headers
        .keys()
        .filter(|k| k.as_str().to_ascii_lowercase().starts_with("proxy-"))
        .cloned()
        .collect();
    for h in proxy_names {
        headers.remove(h);
    }
}

/// Rewrite the inbound request's header map for forwarding to the upstream
/// Node app:
///
/// * strip hop-by-hop fields (Connection, Upgrade, Proxy-*, Transfer-Encoding…)
/// * `Host` ← `incoming_host` so Next.js sees the original hostname
/// * append `peer.ip()` to `X-Forwarded-For` (preserve any existing chain)
/// * `X-Forwarded-Proto: https` (TLS terminates at this hop)
/// * `X-Forwarded-Host: incoming_host`
/// * `X-Real-IP: peer.ip()`
pub fn prepare_for_upstream(headers: &mut HeaderMap, incoming_host: &str, peer: SocketAddr) {
    strip_hop_by_hop(headers);

    if let Ok(v) = HeaderValue::from_str(incoming_host) {
        headers.insert(axum::http::header::HOST, v);
    }

    let peer_ip = peer.ip().to_string();

    let xff = match headers
        .get("x-forwarded-for")
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned)
    {
        Some(existing) => format!("{existing}, {peer_ip}"),
        None => peer_ip.clone(),
    };
    if let Ok(v) = HeaderValue::from_str(&xff) {
        headers.insert("x-forwarded-for", v);
    }

    headers.insert("x-forwarded-proto", HeaderValue::from_static("https"));
    if let Ok(v) = HeaderValue::from_str(incoming_host) {
        headers.insert("x-forwarded-host", v);
    }
    if let Ok(v) = HeaderValue::from_str(&peer_ip) {
        headers.insert("x-real-ip", v);
    }
}

/// Sanitize headers on an upstream response before relaying to the client.
/// Strips only hop-by-hop fields; body/cache headers are preserved.
pub fn sanitize_response(headers: &mut HeaderMap) {
    strip_hop_by_hop(headers);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn peer() -> SocketAddr {
        "203.0.113.7:51234".parse().unwrap()
    }

    fn hm(pairs: &[(&str, &str)]) -> HeaderMap {
        let mut h = HeaderMap::new();
        for (k, v) in pairs {
            h.append(
                HeaderName::try_from(*k).unwrap(),
                HeaderValue::from_str(v).unwrap(),
            );
        }
        h
    }

    #[test]
    fn strips_listed_hop_by_hop_fields() {
        let mut h = hm(&[
            ("connection", "close"),
            ("keep-alive", "timeout=5"),
            ("transfer-encoding", "chunked"),
            ("upgrade", "websocket"),
            ("te", "trailers"),
            ("trailer", "expires"),
            ("proxy-authorization", "Bearer xyz"),
            ("proxy-authenticate", "Basic"),
            ("proxy-connection", "keep-alive"),
            ("content-type", "text/plain"),
        ]);
        strip_hop_by_hop(&mut h);
        for k in HOP_BY_HOP {
            assert!(h.get(*k).is_none(), "{k} should be stripped");
        }
        assert!(h.get("content-type").is_some(), "content-type kept");
    }

    #[test]
    fn strips_fields_listed_in_connection_header() {
        let mut h = hm(&[
            ("connection", "x-foo, x-bar, close"),
            ("x-foo", "1"),
            ("x-bar", "2"),
            ("x-keep", "3"),
        ]);
        strip_hop_by_hop(&mut h);
        assert!(h.get("connection").is_none());
        assert!(h.get("x-foo").is_none(), "connection-listed x-foo stripped");
        assert!(h.get("x-bar").is_none(), "connection-listed x-bar stripped");
        assert_eq!(h.get("x-keep").unwrap(), "3");
    }

    #[test]
    fn strips_extra_proxy_prefixed_headers() {
        let mut h = hm(&[("proxy-foo", "1"), ("proxy-bar", "2"), ("not-proxy", "3")]);
        strip_hop_by_hop(&mut h);
        assert!(h.get("proxy-foo").is_none());
        assert!(h.get("proxy-bar").is_none());
        assert_eq!(h.get("not-proxy").unwrap(), "3");
    }

    #[test]
    fn sets_host_to_incoming() {
        let mut h = hm(&[("host", "127.0.0.1:1234")]);
        prepare_for_upstream(&mut h, "openlen.com", peer());
        assert_eq!(h.get("host").unwrap(), "openlen.com");
    }

    #[test]
    fn xff_appended_when_present() {
        let mut h = hm(&[("x-forwarded-for", "1.2.3.4, 5.6.7.8")]);
        prepare_for_upstream(&mut h, "openlen.com", peer());
        let xff = h.get("x-forwarded-for").unwrap().to_str().unwrap();
        assert_eq!(xff, "1.2.3.4, 5.6.7.8, 203.0.113.7");
    }

    #[test]
    fn xff_set_when_absent() {
        let mut h = HeaderMap::new();
        prepare_for_upstream(&mut h, "openlen.com", peer());
        let xff = h.get("x-forwarded-for").unwrap().to_str().unwrap();
        assert_eq!(xff, "203.0.113.7");
    }

    #[test]
    fn xfproto_always_https() {
        let mut h = hm(&[("x-forwarded-proto", "http")]);
        prepare_for_upstream(&mut h, "openlen.com", peer());
        assert_eq!(h.get("x-forwarded-proto").unwrap(), "https");
    }

    #[test]
    fn xfhost_equals_incoming() {
        let mut h = HeaderMap::new();
        prepare_for_upstream(&mut h, "demo.openlen.com", peer());
        assert_eq!(h.get("x-forwarded-host").unwrap(), "demo.openlen.com");
    }

    #[test]
    fn xrealip_is_peer_ip_only_no_port() {
        let mut h = HeaderMap::new();
        prepare_for_upstream(&mut h, "openlen.com", peer());
        assert_eq!(h.get("x-real-ip").unwrap(), "203.0.113.7");
    }

    #[test]
    fn prepare_strips_hop_by_hop_then_sets_forwarded() {
        let mut h = hm(&[
            ("connection", "upgrade"),
            ("upgrade", "websocket"),
            ("authorization", "Bearer ok"),
        ]);
        prepare_for_upstream(&mut h, "openlen.com", peer());
        assert!(h.get("connection").is_none());
        assert!(h.get("upgrade").is_none());
        assert_eq!(h.get("authorization").unwrap(), "Bearer ok");
        assert!(h.get("x-forwarded-for").is_some());
    }

    #[test]
    fn sanitize_response_strips_hop_by_hop() {
        let mut h = hm(&[
            ("connection", "close"),
            ("content-type", "text/event-stream"),
        ]);
        sanitize_response(&mut h);
        assert!(h.get("connection").is_none());
        assert_eq!(h.get("content-type").unwrap(), "text/event-stream");
    }
}
