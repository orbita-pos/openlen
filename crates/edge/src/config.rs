use std::env;
use std::net::SocketAddr;
use std::path::PathBuf;

use anyhow::{Context, Result};

const ENV_BIND: &str = "OPENLEN_EDGE_BIND";
const ENV_CERT: &str = "OPENLEN_EDGE_CERT";
const ENV_KEY: &str = "OPENLEN_EDGE_KEY";
const ENV_PUBLISH_ROOT: &str = "OPENLEN_EDGE_PUBLISH_ROOT";

const DEFAULT_BIND: &str = "0.0.0.0:443";
const DEFAULT_CERT: &str = "/etc/letsencrypt/live/openlen.com/fullchain.pem";
const DEFAULT_KEY: &str = "/etc/letsencrypt/live/openlen.com/privkey.pem";
const DEFAULT_PUBLISH_ROOT: &str = "/var/www/openlen";

#[derive(Debug, Clone)]
pub struct EdgeConfig {
    pub bind: SocketAddr,
    pub cert_path: PathBuf,
    pub key_path: PathBuf,
    pub publish_root: PathBuf,
}

impl EdgeConfig {
    pub fn from_env() -> Result<Self> {
        let bind_raw = env::var(ENV_BIND).unwrap_or_else(|_| DEFAULT_BIND.into());
        let bind: SocketAddr = bind_raw
            .parse()
            .with_context(|| format!("{ENV_BIND}={bind_raw} is not a valid socket address"))?;

        let cert_path = PathBuf::from(env::var(ENV_CERT).unwrap_or_else(|_| DEFAULT_CERT.into()));
        let key_path = PathBuf::from(env::var(ENV_KEY).unwrap_or_else(|_| DEFAULT_KEY.into()));
        let publish_root = PathBuf::from(
            env::var(ENV_PUBLISH_ROOT).unwrap_or_else(|_| DEFAULT_PUBLISH_ROOT.into()),
        );

        Ok(Self {
            bind,
            cert_path,
            key_path,
            publish_root,
        })
    }

    pub fn builder() -> EdgeConfigBuilder {
        EdgeConfigBuilder::default()
    }
}

#[derive(Debug, Default, Clone)]
pub struct EdgeConfigBuilder {
    bind: Option<SocketAddr>,
    cert_path: Option<PathBuf>,
    key_path: Option<PathBuf>,
    publish_root: Option<PathBuf>,
}

impl EdgeConfigBuilder {
    pub fn bind(mut self, addr: SocketAddr) -> Self {
        self.bind = Some(addr);
        self
    }

    pub fn cert_path(mut self, path: PathBuf) -> Self {
        self.cert_path = Some(path);
        self
    }

    pub fn key_path(mut self, path: PathBuf) -> Self {
        self.key_path = Some(path);
        self
    }

    pub fn publish_root(mut self, path: PathBuf) -> Self {
        self.publish_root = Some(path);
        self
    }

    pub fn build(self) -> Result<EdgeConfig> {
        Ok(EdgeConfig {
            bind: self
                .bind
                .context("EdgeConfigBuilder: bind address is required")?,
            cert_path: self
                .cert_path
                .context("EdgeConfigBuilder: cert_path is required")?,
            key_path: self
                .key_path
                .context("EdgeConfigBuilder: key_path is required")?,
            publish_root: self
                .publish_root
                .unwrap_or_else(|| PathBuf::from(DEFAULT_PUBLISH_ROOT)),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builder_requires_bind_cert_key() {
        let err = EdgeConfig::builder().build().unwrap_err();
        let msg = format!("{err:#}");
        assert!(msg.contains("bind"), "expected error about bind: {msg}");
    }

    #[test]
    fn builder_fills_defaults_for_publish_root() {
        let cfg = EdgeConfig::builder()
            .bind("127.0.0.1:0".parse().unwrap())
            .cert_path(PathBuf::from("/tmp/cert.pem"))
            .key_path(PathBuf::from("/tmp/key.pem"))
            .build()
            .unwrap();
        assert_eq!(cfg.publish_root, PathBuf::from(DEFAULT_PUBLISH_ROOT));
    }
}
