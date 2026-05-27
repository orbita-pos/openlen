//! Response builders for proxy error mapping.
//!
//! The body bridging itself is handled inline by `axum::body::Body::new(...)`
//! around the upstream `hyper::body::Incoming`, which polls frames lazily and
//! forwards them to the client connection without buffering. This module just
//! holds the canonical 5xx responses we return when the upstream is unreachable
//! or slow.

use axum::body::Body;
use axum::http::{header, Response, StatusCode};

use super::client::NodeClientError;

/// 502 Bad Gateway with a brief plaintext body. Used when we cannot reach the
/// upstream (connect refused, DNS failure, transport error).
pub fn bad_gateway() -> Response<Body> {
    Response::builder()
        .status(StatusCode::BAD_GATEWAY)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(Body::from("502 Bad Gateway\n"))
        .expect("static response is valid")
}

/// 504 Gateway Timeout — emitted when the upstream accepted the connection but
/// did not return response headers within the configured connect timeout.
pub fn gateway_timeout() -> Response<Body> {
    Response::builder()
        .status(StatusCode::GATEWAY_TIMEOUT)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
        .body(Body::from("504 Gateway Timeout\n"))
        .expect("static response is valid")
}

/// Translate a [`NodeClientError`] into the appropriate downstream response.
pub fn error_to_response(err: NodeClientError) -> Response<Body> {
    match err {
        NodeClientError::HeadersTimeout(_) => gateway_timeout(),
        NodeClientError::Transport(_)
        | NodeClientError::InvalidUpstreamUri(_)
        | NodeClientError::InvalidNodeUrl(_) => bad_gateway(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bad_gateway_is_502_plain_text() {
        let r = bad_gateway();
        assert_eq!(r.status(), StatusCode::BAD_GATEWAY);
        let ct = r.headers().get(header::CONTENT_TYPE).unwrap();
        assert!(ct.to_str().unwrap().starts_with("text/plain"));
    }

    #[test]
    fn gateway_timeout_is_504_plain_text() {
        let r = gateway_timeout();
        assert_eq!(r.status(), StatusCode::GATEWAY_TIMEOUT);
    }

    #[test]
    fn timeout_error_maps_to_504() {
        let r = error_to_response(NodeClientError::HeadersTimeout(
            std::time::Duration::from_secs(30),
        ));
        assert_eq!(r.status(), StatusCode::GATEWAY_TIMEOUT);
    }

    #[test]
    fn transport_error_maps_to_502() {
        let r = error_to_response(NodeClientError::Transport("connection refused".into()));
        assert_eq!(r.status(), StatusCode::BAD_GATEWAY);
    }
}
