use std::fs::File;
use std::io::BufReader;
use std::path::Path;
use std::sync::Arc;

use rustls::pki_types::{CertificateDer, PrivateKeyDer};
use rustls::server::ResolvesServerCert;
use rustls::ServerConfig;
use thiserror::Error;

#[derive(Debug, Error)]
pub enum WildcardCertError {
    #[error("failed to open {what} at {path}: {source}")]
    Open {
        what: &'static str,
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("failed to read {what} at {path}: {source}")]
    Read {
        what: &'static str,
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("no certificates found in {0}")]
    NoCertificates(String),
    #[error("no private key found in {0}")]
    NoPrivateKey(String),
    #[error("rustls rejected the cert/key pair: {0}")]
    Rustls(#[from] rustls::Error),
}

pub fn load_wildcard(
    cert_path: &Path,
    key_path: &Path,
) -> Result<Arc<ServerConfig>, WildcardCertError> {
    crate::ensure_crypto_provider();

    let certs = load_certs(cert_path)?;
    let key = load_private_key(key_path)?;

    let mut cfg = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(certs, key)?;

    cfg.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];

    Ok(Arc::new(cfg))
}

/// Build a `ServerConfig` backed by an arbitrary
/// [`ResolvesServerCert`] (the dynamic-cert flow uses this with our
/// [`super::resolver::DynamicCertResolver`]). Picks the same ALPN list as
/// [`load_wildcard`] so HTTP/2 + HTTP/1.1 keep working.
pub fn build_dynamic_config(resolver: Arc<dyn ResolvesServerCert>) -> Arc<ServerConfig> {
    crate::ensure_crypto_provider();
    let mut cfg = ServerConfig::builder()
        .with_no_client_auth()
        .with_cert_resolver(resolver);
    cfg.alpn_protocols = vec![b"h2".to_vec(), b"http/1.1".to_vec()];
    Arc::new(cfg)
}

fn load_certs(path: &Path) -> Result<Vec<CertificateDer<'static>>, WildcardCertError> {
    let file = File::open(path).map_err(|source| WildcardCertError::Open {
        what: "cert",
        path: path.display().to_string(),
        source,
    })?;
    let mut reader = BufReader::new(file);
    let mut certs = Vec::new();
    for entry in rustls_pemfile::certs(&mut reader) {
        let cert = entry.map_err(|source| WildcardCertError::Read {
            what: "cert",
            path: path.display().to_string(),
            source,
        })?;
        certs.push(cert);
    }
    if certs.is_empty() {
        return Err(WildcardCertError::NoCertificates(
            path.display().to_string(),
        ));
    }
    Ok(certs)
}

fn load_private_key(path: &Path) -> Result<PrivateKeyDer<'static>, WildcardCertError> {
    let file = File::open(path).map_err(|source| WildcardCertError::Open {
        what: "key",
        path: path.display().to_string(),
        source,
    })?;
    let mut reader = BufReader::new(file);
    let key =
        rustls_pemfile::private_key(&mut reader).map_err(|source| WildcardCertError::Read {
            what: "key",
            path: path.display().to_string(),
            source,
        })?;
    key.ok_or_else(|| WildcardCertError::NoPrivateKey(path.display().to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    fn write_temp(contents: &[u8]) -> NamedTempFile {
        let mut f = NamedTempFile::new().expect("temp file");
        f.write_all(contents).expect("write");
        f
    }

    #[test]
    fn missing_cert_file_errors_with_path() {
        let err = load_wildcard(
            Path::new("/nonexistent/cert.pem"),
            Path::new("/nonexistent/key.pem"),
        )
        .unwrap_err();
        let msg = format!("{err}");
        assert!(msg.contains("/nonexistent/cert.pem"), "got: {msg}");
    }

    #[test]
    fn empty_cert_file_errors() {
        let cert = write_temp(b"");
        let key = write_temp(b"");
        let err = load_wildcard(cert.path(), key.path()).unwrap_err();
        assert!(matches!(err, WildcardCertError::NoCertificates(_)));
    }

    #[test]
    fn build_dynamic_config_sets_alpn_h2_h1() {
        use std::sync::Arc;

        #[derive(Debug)]
        struct AlwaysNone;
        impl rustls::server::ResolvesServerCert for AlwaysNone {
            fn resolve(
                &self,
                _: rustls::server::ClientHello,
            ) -> Option<Arc<rustls::sign::CertifiedKey>> {
                None
            }
        }

        let cfg = build_dynamic_config(Arc::new(AlwaysNone));
        assert_eq!(
            cfg.alpn_protocols,
            vec![b"h2".to_vec(), b"http/1.1".to_vec()]
        );
    }
}
