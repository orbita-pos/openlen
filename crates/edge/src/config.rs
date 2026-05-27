use std::env;
use std::net::SocketAddr;
use std::path::PathBuf;

use anyhow::{Context, Result};

const ENV_BIND: &str = "OPENLEN_EDGE_BIND";
const ENV_BIND_HTTP: &str = "OPENLEN_EDGE_BIND_HTTP";
const ENV_CERT: &str = "OPENLEN_EDGE_CERT";
const ENV_KEY: &str = "OPENLEN_EDGE_KEY";
const ENV_PUBLISH_ROOT: &str = "OPENLEN_EDGE_PUBLISH_ROOT";
const ENV_MAX_INFLIGHT: &str = "OPENLEN_EDGE_MAX_INFLIGHT";
const ENV_NODE_URL: &str = "OPENLEN_EDGE_NODE_URL";
const ENV_PROXY_HOSTS: &str = "OPENLEN_EDGE_PROXY_HOSTS";
const ENV_PROXY_PATHS: &str = "OPENLEN_EDGE_PROXY_PATHS";
const ENV_NODE_TIMEOUT_SECS: &str = "OPENLEN_EDGE_NODE_TIMEOUT_SECS";

const DEFAULT_BIND: &str = "0.0.0.0:443";
const DEFAULT_BIND_HTTP: &str = "0.0.0.0:80";
const DEFAULT_CERT: &str = "/etc/letsencrypt/live/openlen.com/fullchain.pem";
const DEFAULT_KEY: &str = "/etc/letsencrypt/live/openlen.com/privkey.pem";
const DEFAULT_PUBLISH_ROOT: &str = "/var/www/openlen";
const DEFAULT_MAX_INFLIGHT: usize = 4096;
const DEFAULT_NODE_URL: &str = "http://127.0.0.1:3000";
const DEFAULT_PROXY_HOSTS: &str = "openlen.com,www.openlen.com";
const DEFAULT_PROXY_PATHS: &str = "/c/";
const DEFAULT_NODE_TIMEOUT_SECS: u64 = 30;

#[derive(Debug, Clone)]
pub struct EdgeConfig {
    pub bind: SocketAddr,
    pub bind_http: Option<SocketAddr>,
    pub cert_path: PathBuf,
    pub key_path: PathBuf,
    pub publish_root: PathBuf,
    pub max_inflight: usize,
    pub node_url: String,
    pub proxy_hosts: Vec<String>,
    pub proxy_paths: Vec<String>,
    pub node_timeout_secs: u64,
}

fn parse_csv_lower(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty())
        .collect()
}

fn parse_csv(raw: &str) -> Vec<String> {
    raw.split(',')
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
        .collect()
}

impl EdgeConfig {
    pub fn from_env() -> Result<Self> {
        let bind_raw = env::var(ENV_BIND).unwrap_or_else(|_| DEFAULT_BIND.into());
        let bind: SocketAddr = bind_raw
            .parse()
            .with_context(|| format!("{ENV_BIND}={bind_raw} is not a valid socket address"))?;

        let bind_http =
            match env::var(ENV_BIND_HTTP) {
                Ok(raw) if raw.eq_ignore_ascii_case("off") || raw.is_empty() => None,
                Ok(raw) => Some(raw.parse().with_context(|| {
                    format!("{ENV_BIND_HTTP}={raw} is not a valid socket address")
                })?),
                Err(_) => Some(DEFAULT_BIND_HTTP.parse().unwrap()),
            };

        let cert_path = PathBuf::from(env::var(ENV_CERT).unwrap_or_else(|_| DEFAULT_CERT.into()));
        let key_path = PathBuf::from(env::var(ENV_KEY).unwrap_or_else(|_| DEFAULT_KEY.into()));
        let publish_root = PathBuf::from(
            env::var(ENV_PUBLISH_ROOT).unwrap_or_else(|_| DEFAULT_PUBLISH_ROOT.into()),
        );

        let max_inflight = match env::var(ENV_MAX_INFLIGHT) {
            Ok(raw) => raw.parse::<usize>().with_context(|| {
                format!("{ENV_MAX_INFLIGHT}={raw} is not a non-negative integer")
            })?,
            Err(_) => DEFAULT_MAX_INFLIGHT,
        };

        let node_url = env::var(ENV_NODE_URL).unwrap_or_else(|_| DEFAULT_NODE_URL.into());
        let proxy_hosts = parse_csv_lower(
            &env::var(ENV_PROXY_HOSTS).unwrap_or_else(|_| DEFAULT_PROXY_HOSTS.into()),
        );
        let proxy_paths =
            parse_csv(&env::var(ENV_PROXY_PATHS).unwrap_or_else(|_| DEFAULT_PROXY_PATHS.into()));
        let node_timeout_secs = match env::var(ENV_NODE_TIMEOUT_SECS) {
            Ok(raw) => raw.parse::<u64>().with_context(|| {
                format!("{ENV_NODE_TIMEOUT_SECS}={raw} is not a non-negative integer")
            })?,
            Err(_) => DEFAULT_NODE_TIMEOUT_SECS,
        };

        Ok(Self {
            bind,
            bind_http,
            cert_path,
            key_path,
            publish_root,
            max_inflight,
            node_url,
            proxy_hosts,
            proxy_paths,
            node_timeout_secs,
        })
    }

    pub fn builder() -> EdgeConfigBuilder {
        EdgeConfigBuilder::default()
    }
}

#[derive(Debug, Default, Clone)]
pub struct EdgeConfigBuilder {
    bind: Option<SocketAddr>,
    bind_http: Option<Option<SocketAddr>>,
    cert_path: Option<PathBuf>,
    key_path: Option<PathBuf>,
    publish_root: Option<PathBuf>,
    max_inflight: Option<usize>,
    node_url: Option<String>,
    proxy_hosts: Option<Vec<String>>,
    proxy_paths: Option<Vec<String>>,
    node_timeout_secs: Option<u64>,
}

impl EdgeConfigBuilder {
    pub fn bind(mut self, addr: SocketAddr) -> Self {
        self.bind = Some(addr);
        self
    }

    pub fn bind_http(mut self, addr: Option<SocketAddr>) -> Self {
        self.bind_http = Some(addr);
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

    pub fn max_inflight(mut self, cap: usize) -> Self {
        self.max_inflight = Some(cap);
        self
    }

    pub fn node_url(mut self, url: impl Into<String>) -> Self {
        self.node_url = Some(url.into());
        self
    }

    pub fn proxy_hosts(mut self, hosts: Vec<String>) -> Self {
        self.proxy_hosts = Some(hosts.into_iter().map(|s| s.to_ascii_lowercase()).collect());
        self
    }

    pub fn proxy_paths(mut self, paths: Vec<String>) -> Self {
        self.proxy_paths = Some(paths);
        self
    }

    pub fn node_timeout_secs(mut self, secs: u64) -> Self {
        self.node_timeout_secs = Some(secs);
        self
    }

    pub fn build(self) -> Result<EdgeConfig> {
        Ok(EdgeConfig {
            bind: self
                .bind
                .context("EdgeConfigBuilder: bind address is required")?,
            bind_http: self.bind_http.unwrap_or(None),
            cert_path: self
                .cert_path
                .context("EdgeConfigBuilder: cert_path is required")?,
            key_path: self
                .key_path
                .context("EdgeConfigBuilder: key_path is required")?,
            publish_root: self
                .publish_root
                .unwrap_or_else(|| PathBuf::from(DEFAULT_PUBLISH_ROOT)),
            max_inflight: self.max_inflight.unwrap_or(DEFAULT_MAX_INFLIGHT),
            node_url: self.node_url.unwrap_or_else(|| DEFAULT_NODE_URL.into()),
            proxy_hosts: self
                .proxy_hosts
                .unwrap_or_else(|| parse_csv_lower(DEFAULT_PROXY_HOSTS)),
            proxy_paths: self
                .proxy_paths
                .unwrap_or_else(|| parse_csv(DEFAULT_PROXY_PATHS)),
            node_timeout_secs: self.node_timeout_secs.unwrap_or(DEFAULT_NODE_TIMEOUT_SECS),
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
    fn builder_fills_defaults_for_publish_root_and_max_inflight() {
        let cfg = EdgeConfig::builder()
            .bind("127.0.0.1:0".parse().unwrap())
            .cert_path(PathBuf::from("/tmp/cert.pem"))
            .key_path(PathBuf::from("/tmp/key.pem"))
            .build()
            .unwrap();
        assert_eq!(cfg.publish_root, PathBuf::from(DEFAULT_PUBLISH_ROOT));
        assert_eq!(cfg.max_inflight, DEFAULT_MAX_INFLIGHT);
        assert!(cfg.bind_http.is_none());
    }

    #[test]
    fn builder_accepts_explicit_bind_http_and_cap() {
        let cfg = EdgeConfig::builder()
            .bind("127.0.0.1:0".parse().unwrap())
            .bind_http(Some("127.0.0.1:8080".parse().unwrap()))
            .cert_path(PathBuf::from("/tmp/cert.pem"))
            .key_path(PathBuf::from("/tmp/key.pem"))
            .max_inflight(8)
            .build()
            .unwrap();
        assert_eq!(cfg.bind_http.unwrap().port(), 8080);
        assert_eq!(cfg.max_inflight, 8);
    }

    #[test]
    fn builder_fills_proxy_defaults() {
        let cfg = EdgeConfig::builder()
            .bind("127.0.0.1:0".parse().unwrap())
            .cert_path(PathBuf::from("/tmp/cert.pem"))
            .key_path(PathBuf::from("/tmp/key.pem"))
            .build()
            .unwrap();
        assert_eq!(cfg.node_url, "http://127.0.0.1:3000");
        assert_eq!(cfg.proxy_hosts, vec!["openlen.com", "www.openlen.com"]);
        assert_eq!(cfg.proxy_paths, vec!["/c/"]);
        assert_eq!(cfg.node_timeout_secs, DEFAULT_NODE_TIMEOUT_SECS);
    }

    #[test]
    fn builder_accepts_explicit_proxy_settings() {
        let cfg = EdgeConfig::builder()
            .bind("127.0.0.1:0".parse().unwrap())
            .cert_path(PathBuf::from("/tmp/cert.pem"))
            .key_path(PathBuf::from("/tmp/key.pem"))
            .node_url("http://10.0.0.5:8080")
            .proxy_hosts(vec!["Example.COM".into(), "api.example.com".into()])
            .proxy_paths(vec!["/api/".into(), "/c/".into()])
            .node_timeout_secs(15)
            .build()
            .unwrap();
        assert_eq!(cfg.node_url, "http://10.0.0.5:8080");
        assert_eq!(cfg.proxy_hosts, vec!["example.com", "api.example.com"]);
        assert_eq!(cfg.proxy_paths, vec!["/api/", "/c/"]);
        assert_eq!(cfg.node_timeout_secs, 15);
    }

    #[test]
    fn parse_csv_lower_trims_and_lowercases() {
        let v = parse_csv_lower(" Openlen.COM , www.openlen.com , ");
        assert_eq!(v, vec!["openlen.com", "www.openlen.com"]);
    }

    #[test]
    fn parse_csv_preserves_case() {
        let v = parse_csv(" /API/ , /c/ ");
        assert_eq!(v, vec!["/API/", "/c/"]);
    }
}
