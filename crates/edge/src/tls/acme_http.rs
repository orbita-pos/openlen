//! Custom [`instant_acme::HttpClient`] over `hyper-util` + `hyper-rustls` +
//! `webpki-roots`.
//!
//! Why this exists: `instant_acme`'s default `hyper-rustls` feature forces in
//! `rustls-platform-verifier` (~500 KB stripped, loads the OS cert store).
//! For an outbound-only ACME client we don't need OS roots — the LE / ZeroSSL
//! / Pebble endpoints are public and Mozilla's bundled root set is enough.
//!
//! By dropping the feature and supplying our own client here, the release
//! binary drops back under the 7.5 MiB cap that the S5 ACME work overshot.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use bytes::Bytes;
use http::Request;
use hyper_rustls::HttpsConnector;
use hyper_util::client::legacy::{connect::HttpConnector, Client as LegacyClient};
use hyper_util::rt::TokioExecutor;
use instant_acme::{BodyWrapper, BytesResponse, Error, HttpClient};
use rustls::ClientConfig;

/// Build a fresh [`AcmeHttpClient`] wired to Mozilla's bundled root store.
pub fn build_acme_http_client() -> AcmeHttpClient {
    crate::ensure_crypto_provider();

    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());

    let tls = ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();

    let https = hyper_rustls::HttpsConnectorBuilder::new()
        .with_tls_config(tls)
        .https_only()
        .enable_http1()
        .build();

    let inner = LegacyClient::builder(TokioExecutor::new()).build(https);

    AcmeHttpClient {
        inner: Arc::new(inner),
    }
}

/// Wrapper around a `hyper-util` legacy client that satisfies
/// [`instant_acme::HttpClient`].
#[derive(Clone)]
pub struct AcmeHttpClient {
    inner: Arc<LegacyClient<HttpsConnector<HttpConnector>, BodyWrapper<Bytes>>>,
}

impl std::fmt::Debug for AcmeHttpClient {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("AcmeHttpClient").finish_non_exhaustive()
    }
}

impl HttpClient for AcmeHttpClient {
    fn request(
        &self,
        req: Request<BodyWrapper<Bytes>>,
    ) -> Pin<Box<dyn Future<Output = Result<BytesResponse, Error>> + Send>> {
        let inner = self.inner.clone();
        Box::pin(async move {
            match inner.request(req).await {
                Ok(resp) => Ok(BytesResponse::from(resp)),
                Err(err) => Err(Error::Other(Box::new(err))),
            }
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builder_constructs_without_panic() {
        // Smoke: cert store loads + TLS config compiles + connector builds.
        // No network — we just need to know the wiring is consistent.
        let client = build_acme_http_client();
        let dbg = format!("{client:?}");
        assert!(dbg.contains("AcmeHttpClient"), "debug: {dbg}");
    }

    #[test]
    fn webpki_roots_bundle_is_non_empty() {
        assert!(
            !webpki_roots::TLS_SERVER_ROOTS.is_empty(),
            "Mozilla roots bundle must be populated"
        );
    }

    #[test]
    fn clone_shares_inner_client() {
        let a = build_acme_http_client();
        let b = a.clone();
        assert!(Arc::ptr_eq(&a.inner, &b.inner));
    }
}
