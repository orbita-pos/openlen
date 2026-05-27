use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::http::{Request, Response, Uri};
use hyper::body::Incoming;
use hyper_util::client::legacy::{connect::HttpConnector, Client as LegacyClient};
use hyper_util::rt::TokioExecutor;
use thiserror::Error;

type InnerClient = LegacyClient<HttpConnector, Body>;

#[derive(Debug, Error)]
pub enum NodeClientError {
    #[error("OPENLEN_EDGE_NODE_URL `{0}` is not a valid http://host:port URL")]
    InvalidNodeUrl(String),
    #[error("constructed upstream URI `{0}` is not parseable")]
    InvalidUpstreamUri(String),
    #[error("upstream connect/transport error: {0}")]
    Transport(String),
    #[error("upstream did not return response headers within {0:?}")]
    HeadersTimeout(Duration),
}

/// Thin wrapper around a pooled hyper-util HTTP/1.1 client pointed at the Node
/// app. Holds the parsed base authority so per-request callers don't reparse.
#[derive(Clone)]
pub struct NodeClient {
    inner: Arc<InnerClient>,
    authority: Arc<String>,
    /// Cap on the "send request + receive response headers" phase. Once headers
    /// arrive the body streams with no further wall-clock cap, so SSE flows
    /// through indefinitely.
    connect_timeout: Duration,
}

impl std::fmt::Debug for NodeClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NodeClient")
            .field("authority", &self.authority)
            .field("connect_timeout", &self.connect_timeout)
            .finish_non_exhaustive()
    }
}

impl NodeClient {
    pub fn new(
        node_url: &str,
        pool_idle: Duration,
        pool_max_idle_per_host: usize,
        connect_timeout: Duration,
    ) -> Result<Self, NodeClientError> {
        let parsed: Uri = node_url
            .parse()
            .map_err(|_| NodeClientError::InvalidNodeUrl(node_url.to_owned()))?;
        if parsed.scheme_str() != Some("http") {
            return Err(NodeClientError::InvalidNodeUrl(node_url.to_owned()));
        }
        let authority = parsed
            .authority()
            .ok_or_else(|| NodeClientError::InvalidNodeUrl(node_url.to_owned()))?
            .to_string();

        let inner = LegacyClient::builder(TokioExecutor::new())
            .pool_idle_timeout(pool_idle)
            .pool_max_idle_per_host(pool_max_idle_per_host)
            .build_http::<Body>();

        Ok(Self {
            inner: Arc::new(inner),
            authority: Arc::new(authority),
            connect_timeout,
        })
    }

    /// Compose a full upstream URI by joining our base authority with the
    /// path-and-query string from the downstream request (already starts with `/`).
    pub fn upstream_uri(&self, path_and_query: &str) -> Result<Uri, NodeClientError> {
        let raw = format!("http://{}{}", self.authority, path_and_query);
        raw.parse::<Uri>()
            .map_err(|_| NodeClientError::InvalidUpstreamUri(raw))
    }

    pub fn connect_timeout(&self) -> Duration {
        self.connect_timeout
    }

    pub fn authority(&self) -> &str {
        &self.authority
    }

    /// Send `req` to the upstream. Returns a `Response<Body>` whose body
    /// streams from the upstream connection without buffering. The wall-clock
    /// timeout only covers the header-arrival phase.
    pub async fn send(&self, req: Request<Body>) -> Result<Response<Body>, NodeClientError> {
        let timeout = self.connect_timeout;
        let inner = self.inner.clone();
        let fut = async move { inner.request(req).await };
        match tokio::time::timeout(timeout, fut).await {
            Ok(Ok(resp)) => Ok(map_response(resp)),
            Ok(Err(err)) => Err(NodeClientError::Transport(err.to_string())),
            Err(_) => Err(NodeClientError::HeadersTimeout(timeout)),
        }
    }
}

fn map_response(resp: Response<Incoming>) -> Response<Body> {
    let (parts, body) = resp.into_parts();
    Response::from_parts(parts, Body::new(body))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_http_url() {
        let err = NodeClient::new(
            "https://127.0.0.1:3000",
            Duration::from_secs(90),
            32,
            Duration::from_secs(30),
        )
        .unwrap_err();
        assert!(
            matches!(err, NodeClientError::InvalidNodeUrl(_)),
            "got {err:?}"
        );
    }

    #[test]
    fn rejects_garbage_url() {
        let err = NodeClient::new(
            "not a url at all",
            Duration::from_secs(90),
            32,
            Duration::from_secs(30),
        )
        .unwrap_err();
        assert!(
            matches!(err, NodeClientError::InvalidNodeUrl(_)),
            "got {err:?}"
        );
    }

    #[test]
    fn rejects_url_without_authority() {
        let err = NodeClient::new(
            "http:///foo",
            Duration::from_secs(90),
            32,
            Duration::from_secs(30),
        )
        .unwrap_err();
        assert!(
            matches!(err, NodeClientError::InvalidNodeUrl(_)),
            "got {err:?}"
        );
    }

    #[test]
    fn accepts_default_url() {
        let c = NodeClient::new(
            "http://127.0.0.1:3000",
            Duration::from_secs(90),
            32,
            Duration::from_secs(30),
        )
        .expect("default URL parses");
        assert_eq!(c.authority(), "127.0.0.1:3000");
        assert_eq!(c.connect_timeout(), Duration::from_secs(30));
    }

    #[test]
    fn composes_upstream_uri_with_path_and_query() {
        let c = NodeClient::new(
            "http://127.0.0.1:3000",
            Duration::from_secs(90),
            32,
            Duration::from_secs(30),
        )
        .unwrap();
        let u = c.upstream_uri("/foo?x=1&y=2").unwrap();
        assert_eq!(u.scheme_str(), Some("http"));
        assert_eq!(u.authority().unwrap().as_str(), "127.0.0.1:3000");
        assert_eq!(u.path(), "/foo");
        assert_eq!(u.query(), Some("x=1&y=2"));
    }
}
