use std::env;
use std::net::{IpAddr, SocketAddr};
use std::path::PathBuf;

use anyhow::{Context, Result};

const ENV_BIND: &str = "OPENLEN_EDGE_BIND";
const ENV_BIND_HTTP: &str = "OPENLEN_EDGE_BIND_HTTP";
const ENV_CERT: &str = "OPENLEN_EDGE_CERT";
const ENV_KEY: &str = "OPENLEN_EDGE_KEY";
const ENV_PUBLISH_ROOT: &str = "OPENLEN_EDGE_PUBLISH_ROOT";
const ENV_UPLOADS_ROOT: &str = "OPENLEN_EDGE_UPLOADS_ROOT";
const ENV_NEXT_STATIC_ROOT: &str = "OPENLEN_EDGE_NEXT_STATIC_ROOT";
const ENV_MAX_INFLIGHT: &str = "OPENLEN_EDGE_MAX_INFLIGHT";
const ENV_NODE_URL: &str = "OPENLEN_EDGE_NODE_URL";
const ENV_PROXY_HOSTS: &str = "OPENLEN_EDGE_PROXY_HOSTS";
const ENV_PROXY_PATHS: &str = "OPENLEN_EDGE_PROXY_PATHS";
const ENV_CUSTOM_DOMAIN_PROXY_PATHS: &str = "OPENLEN_EDGE_CUSTOM_DOMAIN_PROXY_PATHS";
const ENV_NODE_TIMEOUT_SECS: &str = "OPENLEN_EDGE_NODE_TIMEOUT_SECS";
const ENV_PROXY_BODY_IDLE_TIMEOUT_SECS: &str = "OPENLEN_EDGE_PROXY_BODY_IDLE_TIMEOUT_SECS";
const ENV_DATABASE_URL: &str = "OPENLEN_EDGE_DATABASE_URL";
const ENV_DB_POOL_MAX: &str = "OPENLEN_EDGE_DB_POOL_MAX";
const ENV_DOMAIN_CACHE_TTL_SECS: &str = "OPENLEN_EDGE_DOMAIN_CACHE_TTL_SECS";
const ENV_DOMAIN_NEGATIVE_TTL_SECS: &str = "OPENLEN_EDGE_DOMAIN_NEGATIVE_TTL_SECS";
const ENV_DOMAIN_CACHE_MAX: &str = "OPENLEN_EDGE_DOMAIN_CACHE_MAX";
const ENV_DOMAIN_REVAL_CONCURRENCY: &str = "OPENLEN_EDGE_DOMAIN_REVAL_CONCURRENCY";
const ENV_INTERNAL_API_BIND: &str = "OPENLEN_EDGE_INTERNAL_API_BIND";
const ENV_ACME_CONTACT: &str = "OPENLEN_EDGE_ACME_CONTACT";
const ENV_ACME_DIRECTORY_URL: &str = "OPENLEN_EDGE_ACME_DIRECTORY_URL";
const ENV_CERT_DIR: &str = "OPENLEN_EDGE_CERT_DIR";
const ENV_ACME_ENABLED: &str = "OPENLEN_EDGE_ACME_ENABLED";
const ENV_CERT_RENEWAL_THRESHOLD_DAYS: &str = "OPENLEN_EDGE_CERT_RENEWAL_THRESHOLD_DAYS";
const ENV_CERT_RENEWAL_INTERVAL_SECS: &str = "OPENLEN_EDGE_CERT_RENEWAL_INTERVAL_SECS";
const ENV_METRICS_BIND: &str = "OPENLEN_EDGE_METRICS_BIND";
const ENV_RATE_LIMIT_ENABLED: &str = "OPENLEN_EDGE_RATE_LIMIT_ENABLED";
const ENV_RATE_LIMIT_PER_IP_PER_MIN: &str = "OPENLEN_EDGE_RATE_LIMIT_PER_IP_PER_MIN";
const ENV_RATE_LIMIT_PER_IP_PER_HOUR: &str = "OPENLEN_EDGE_RATE_LIMIT_PER_IP_PER_HOUR";
const ENV_RATE_LIMIT_EXEMPT_PATHS: &str = "OPENLEN_EDGE_RATE_LIMIT_EXEMPT_PATHS";
const ENV_RATE_LIMIT_TRUSTED_PROXIES: &str = "OPENLEN_EDGE_RATE_LIMIT_TRUSTED_PROXIES";

const DEFAULT_BIND: &str = "0.0.0.0:443";
const DEFAULT_BIND_HTTP: &str = "0.0.0.0:80";
const DEFAULT_CERT: &str = "/etc/letsencrypt/live/openlen.com/fullchain.pem";
const DEFAULT_KEY: &str = "/etc/letsencrypt/live/openlen.com/privkey.pem";
const DEFAULT_PUBLISH_ROOT: &str = "/var/www/openlen";
/// Shared uploads root — `<UPLOADS_DIR>` in `openlen-app.service`. Served
/// direct from disk on every host (apex, wildcard subdomain, custom domain)
/// when the URL starts with `/uploads/`, bypassing Node.
const DEFAULT_UPLOADS_ROOT: &str = "/var/openlen/uploads";
/// Next.js build-time static assets root. Served direct from disk on the
/// apex/www hosts only when the URL starts with `/_next/static/`. The path
/// matches the `cp` step in `infra/scripts/deploy.sh`.
const DEFAULT_NEXT_STATIC_ROOT: &str = "/opt/openlen-app/.next/static";
const DEFAULT_MAX_INFLIGHT: usize = 4096;
const DEFAULT_NODE_URL: &str = "http://127.0.0.1:3000";
const DEFAULT_PROXY_HOSTS: &str = "openlen.com,www.openlen.com";
/// Path prefixes proxied to Node on wildcard subdomain hosts. `/c/` is the
/// analytics beacon; `/api/f/` is lead-capture form submissions. Both are
/// public/anonymous endpoints — broader `/api/*` access is deliberately not
/// granted to subdomain hosts (that would expose the auth-gated app API to
/// any user-deployed page).
const DEFAULT_PROXY_PATHS: &str = "/c/,/api/f/";
/// Path prefixes proxied to Node on custom-domain hosts. Broader than
/// `proxy_paths` — custom domains alias a single project, so the full
/// `/api/*` surface is fine to expose (most endpoints 401 without a cookie;
/// the public ones — `/api/f/`, `/c/` — keep working). Mirrors the Caddyfile
/// `@passthrough path /api/* /c/*` matcher we used in F2's plan B.
const DEFAULT_CUSTOM_DOMAIN_PROXY_PATHS: &str = "/c/,/api/";
const DEFAULT_NODE_TIMEOUT_SECS: u64 = 30;
/// Default idle window between upstream body frames before the proxy drops
/// the connection. 60 s is generous enough for SSE keep-alives (Node Next.js
/// defaults to sending a ping every 30 s) while still capping a hostile
/// upstream that sends headers and hangs the body indefinitely.
const DEFAULT_PROXY_BODY_IDLE_TIMEOUT_SECS: u64 = 60;
const DEFAULT_DB_POOL_MAX: u32 = 8;
const DEFAULT_DOMAIN_CACHE_TTL_SECS: u64 = 60;
const DEFAULT_DOMAIN_NEGATIVE_TTL_SECS: u64 = 60;
const DEFAULT_DOMAIN_CACHE_MAX: u64 = 10_000;
/// Default Let's Encrypt production directory URL. Set
/// `OPENLEN_EDGE_ACME_DIRECTORY_URL` to the staging endpoint
/// (`https://acme-staging-v02.api.letsencrypt.org/directory`) for tests + dry
/// runs.
const DEFAULT_ACME_DIRECTORY_URL: &str = "https://acme-v02.api.letsencrypt.org/directory";
const DEFAULT_CERT_DIR: &str = "/var/openlen/certs";
const DEFAULT_CERT_RENEWAL_THRESHOLD_DAYS: u32 = 30;
const DEFAULT_CERT_RENEWAL_INTERVAL_SECS: u64 = 24 * 60 * 60;
/// Loopback-only by default — Prometheus servers scrape locally / via a
/// node-local sidecar. Production operators can flip the bind to expose
/// metrics on a trusted interface.
const DEFAULT_METRICS_BIND: &str = "127.0.0.1:9090";
/// Per-IP, per-minute burst limit. Tuned so a Cloudflare-fronted scrape that
/// runs ~5 reqs/sec for sustained periods (the default for most bot
/// crawlers) sits comfortably below; abusive bursts above 5 rps trip
/// quickly.
const DEFAULT_RATE_LIMIT_PER_IP_PER_MIN: u32 = 300;
/// Per-IP, per-hour sustained limit. Caps a steady ~1.4 rps over an hour —
/// enough headroom for shared NAT (small office, hotel WiFi) while still
/// flagging single-IP scrapers/bots.
const DEFAULT_RATE_LIMIT_PER_IP_PER_HOUR: u32 = 5000;
/// Comma-separated exempt path prefixes. `/c/` analytics beacons are
/// already rate-limited Node-side and account for the highest steady-state
/// volume; ACME HTTP-01 challenges must never be blocked or cert issuance
/// fails.
const DEFAULT_RATE_LIMIT_EXEMPT_PATHS: &str = "/c/,/.well-known/acme-challenge/";

#[derive(Debug, Clone)]
pub struct EdgeConfig {
    pub bind: SocketAddr,
    pub bind_http: Option<SocketAddr>,
    pub cert_path: PathBuf,
    pub key_path: PathBuf,
    pub publish_root: PathBuf,
    /// Shared user-uploads root. Served direct from disk when a URL starts
    /// with `/uploads/`, regardless of host.
    pub uploads_root: PathBuf,
    /// Next.js build-time static assets root. Served direct from disk on
    /// apex/www hosts only when a URL starts with `/_next/static/`.
    pub next_static_root: PathBuf,
    pub max_inflight: usize,
    pub node_url: String,
    pub proxy_hosts: Vec<String>,
    pub proxy_paths: Vec<String>,
    /// Path prefixes proxied to Node specifically on custom-domain hosts —
    /// kept separate from `proxy_paths` so the wildcard subdomain remains
    /// restricted to `/c/` + `/api/f/` while custom domains get the broader
    /// `/api/*` surface (most endpoints 401 anyway; this matters for the few
    /// public ones).
    pub custom_domain_proxy_paths: Vec<String>,
    pub node_timeout_secs: u64,
    /// Per-frame idle timeout on the upstream response body. `0` disables the
    /// timer — the body streams forever once headers arrive.
    pub proxy_body_idle_timeout_secs: u64,
    /// Postgres connection string for the custom-domain lookup. `None` /
    /// empty = run with an empty in-memory mock (custom domains never match).
    pub database_url: Option<String>,
    pub db_pool_max: u32,
    pub domain_cache_ttl_secs: u64,
    pub domain_negative_ttl_secs: u64,
    pub domain_cache_max: u64,
    /// Cap on simultaneous background stale-while-revalidate refreshes on
    /// the domain cache. Without this, a wave of entries crossing TTL/2 at
    /// the same wall clock could spawn N revalidation tasks against the
    /// Postgres pool — `0` defaults to `db_pool_max` so the worst case is
    /// pool-sized, not cache-sized.
    pub domain_reval_concurrency: u32,
    /// Bind address for the loopback-only internal API
    /// (`/internal/domains/lookup`). `None` = disabled.
    pub internal_api_bind: Option<SocketAddr>,
    /// Contact mailbox passed to the ACME registration (`mailto:<addr>`).
    /// Required by Let's Encrypt — issuance is refused without it.
    pub acme_contact: Option<String>,
    /// ACME directory URL. Defaults to Let's Encrypt production. Tests +
    /// dry-runs should point at the staging endpoint.
    pub acme_directory_url: String,
    /// On-disk root for ACME-issued cert chains. One sub-directory per
    /// domain (path-hashed); the cert + private key + chain land as PEM
    /// files inside.
    pub cert_dir: PathBuf,
    /// Master switch — when `false`, the dynamic resolver refuses to spawn
    /// any new issuance. Cert hot-reload still works; pre-loaded custom
    /// certs from `cert_dir` are still served. Defaults to `false` unless
    /// `acme_contact` is set.
    pub acme_enabled: bool,
    /// Renew certificates with less than this many days of validity left.
    pub cert_renewal_threshold_days: u32,
    /// Interval between renewal sweeps (background task).
    pub cert_renewal_interval_secs: u64,
    /// Bind address for the Prometheus `/metrics` endpoint. `None` disables
    /// the exporter.
    pub metrics_bind: Option<SocketAddr>,
    /// Master switch for the edge-side IP rate limiter. Defaults `false` so
    /// the cutover stays safe — operators flip it on after the initial
    /// soak, see `infra/edge/CUTOVER.md`.
    pub rate_limit_enabled: bool,
    /// Per-IP burst cap (token bucket size + refill window = 60 s).
    pub rate_limit_per_ip_per_min: u32,
    /// Per-IP sustained cap (token bucket size + refill window = 1 h).
    pub rate_limit_per_ip_per_hour: u32,
    /// Path prefixes that bypass the limiter entirely. Defaults cover
    /// `/c/` (analytics, rate-limited Node-side) and ACME HTTP-01.
    pub rate_limit_exempt_paths: Vec<String>,
    /// TCP peer IPs that the middleware trusts to forward proxy headers
    /// like `cf-connecting-ip`. Empty = trust all peers (fine for the
    /// current single-Cloudflare-edge posture). Restrict to the
    /// Cloudflare IP ranges if the edge ever sits behind a less-trusted
    /// proxy chain.
    pub rate_limit_trusted_proxies: Vec<IpAddr>,
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

fn parse_bool(env_name: &str, raw: &str) -> Result<bool> {
    match raw.trim().to_ascii_lowercase().as_str() {
        "1" | "true" | "yes" | "on" => Ok(true),
        "0" | "false" | "no" | "off" | "" => Ok(false),
        other => Err(anyhow::anyhow!(
            "{env_name}={other} is not a recognised boolean (use 1/true/on or 0/false/off)"
        )),
    }
}

fn parse_optional_socketaddr(env_name: &str, raw: &str) -> Result<Option<SocketAddr>> {
    if raw.is_empty() || raw.eq_ignore_ascii_case("off") {
        return Ok(None);
    }
    Ok(Some(raw.parse().with_context(|| {
        format!("{env_name}={raw} is not a valid socket address")
    })?))
}

fn parse_ip_csv(env_name: &str, raw: &str) -> Result<Vec<IpAddr>> {
    raw.split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(|s| {
            s.parse::<IpAddr>().with_context(|| {
                format!("{env_name}={raw}: entry '{s}' is not a valid IP address")
            })
        })
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
        let uploads_root = PathBuf::from(
            env::var(ENV_UPLOADS_ROOT).unwrap_or_else(|_| DEFAULT_UPLOADS_ROOT.into()),
        );
        let next_static_root = PathBuf::from(
            env::var(ENV_NEXT_STATIC_ROOT).unwrap_or_else(|_| DEFAULT_NEXT_STATIC_ROOT.into()),
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
        let custom_domain_proxy_paths = parse_csv(
            &env::var(ENV_CUSTOM_DOMAIN_PROXY_PATHS)
                .unwrap_or_else(|_| DEFAULT_CUSTOM_DOMAIN_PROXY_PATHS.into()),
        );
        let node_timeout_secs = match env::var(ENV_NODE_TIMEOUT_SECS) {
            Ok(raw) => raw.parse::<u64>().with_context(|| {
                format!("{ENV_NODE_TIMEOUT_SECS}={raw} is not a non-negative integer")
            })?,
            Err(_) => DEFAULT_NODE_TIMEOUT_SECS,
        };
        let proxy_body_idle_timeout_secs = match env::var(ENV_PROXY_BODY_IDLE_TIMEOUT_SECS) {
            Ok(raw) => raw.parse::<u64>().with_context(|| {
                format!("{ENV_PROXY_BODY_IDLE_TIMEOUT_SECS}={raw} is not a non-negative integer")
            })?,
            Err(_) => DEFAULT_PROXY_BODY_IDLE_TIMEOUT_SECS,
        };

        let database_url = env::var(ENV_DATABASE_URL).ok().filter(|s| !s.is_empty());
        let db_pool_max = match env::var(ENV_DB_POOL_MAX) {
            Ok(raw) => raw
                .parse::<u32>()
                .with_context(|| format!("{ENV_DB_POOL_MAX}={raw} is not a positive integer"))?,
            Err(_) => DEFAULT_DB_POOL_MAX,
        };
        let domain_cache_ttl_secs = match env::var(ENV_DOMAIN_CACHE_TTL_SECS) {
            Ok(raw) => raw.parse::<u64>().with_context(|| {
                format!("{ENV_DOMAIN_CACHE_TTL_SECS}={raw} is not a non-negative integer")
            })?,
            Err(_) => DEFAULT_DOMAIN_CACHE_TTL_SECS,
        };
        let domain_negative_ttl_secs = match env::var(ENV_DOMAIN_NEGATIVE_TTL_SECS) {
            Ok(raw) => raw.parse::<u64>().with_context(|| {
                format!("{ENV_DOMAIN_NEGATIVE_TTL_SECS}={raw} is not a non-negative integer")
            })?,
            Err(_) => DEFAULT_DOMAIN_NEGATIVE_TTL_SECS,
        };
        let domain_cache_max = match env::var(ENV_DOMAIN_CACHE_MAX) {
            Ok(raw) => raw.parse::<u64>().with_context(|| {
                format!("{ENV_DOMAIN_CACHE_MAX}={raw} is not a non-negative integer")
            })?,
            Err(_) => DEFAULT_DOMAIN_CACHE_MAX,
        };
        // 0 defers the default to db_pool_max so callers don't have to keep
        // two numbers in sync. Explicit overrides are honored.
        let domain_reval_concurrency = match env::var(ENV_DOMAIN_REVAL_CONCURRENCY) {
            Ok(raw) => raw.parse::<u32>().with_context(|| {
                format!("{ENV_DOMAIN_REVAL_CONCURRENCY}={raw} is not a positive integer")
            })?,
            Err(_) => db_pool_max,
        };
        let internal_api_bind = match env::var(ENV_INTERNAL_API_BIND) {
            Ok(raw) => parse_optional_socketaddr(ENV_INTERNAL_API_BIND, &raw)?,
            Err(_) => None,
        };

        let acme_contact = env::var(ENV_ACME_CONTACT).ok().filter(|s| !s.is_empty());
        let acme_directory_url =
            env::var(ENV_ACME_DIRECTORY_URL).unwrap_or_else(|_| DEFAULT_ACME_DIRECTORY_URL.into());
        let cert_dir =
            PathBuf::from(env::var(ENV_CERT_DIR).unwrap_or_else(|_| DEFAULT_CERT_DIR.into()));
        let acme_enabled = match env::var(ENV_ACME_ENABLED) {
            Ok(raw) => parse_bool(ENV_ACME_ENABLED, &raw)?,
            // Default = on whenever a contact mailbox is set. Lets `main.rs`
            // boot with ACME working out of the box once the operator
            // provides the one required value.
            Err(_) => acme_contact.is_some(),
        };
        let cert_renewal_threshold_days = match env::var(ENV_CERT_RENEWAL_THRESHOLD_DAYS) {
            Ok(raw) => raw.parse::<u32>().with_context(|| {
                format!("{ENV_CERT_RENEWAL_THRESHOLD_DAYS}={raw} is not a non-negative integer")
            })?,
            Err(_) => DEFAULT_CERT_RENEWAL_THRESHOLD_DAYS,
        };
        let cert_renewal_interval_secs = match env::var(ENV_CERT_RENEWAL_INTERVAL_SECS) {
            Ok(raw) => raw.parse::<u64>().with_context(|| {
                format!("{ENV_CERT_RENEWAL_INTERVAL_SECS}={raw} is not a non-negative integer")
            })?,
            Err(_) => DEFAULT_CERT_RENEWAL_INTERVAL_SECS,
        };
        let metrics_bind = match env::var(ENV_METRICS_BIND) {
            Ok(raw) => parse_optional_socketaddr(ENV_METRICS_BIND, &raw)?,
            Err(_) => Some(DEFAULT_METRICS_BIND.parse().unwrap()),
        };
        let rate_limit_enabled = match env::var(ENV_RATE_LIMIT_ENABLED) {
            Ok(raw) => parse_bool(ENV_RATE_LIMIT_ENABLED, &raw)?,
            Err(_) => false,
        };
        let rate_limit_per_ip_per_min = match env::var(ENV_RATE_LIMIT_PER_IP_PER_MIN) {
            Ok(raw) => raw.parse::<u32>().with_context(|| {
                format!("{ENV_RATE_LIMIT_PER_IP_PER_MIN}={raw} is not a positive integer")
            })?,
            Err(_) => DEFAULT_RATE_LIMIT_PER_IP_PER_MIN,
        };
        let rate_limit_per_ip_per_hour = match env::var(ENV_RATE_LIMIT_PER_IP_PER_HOUR) {
            Ok(raw) => raw.parse::<u32>().with_context(|| {
                format!("{ENV_RATE_LIMIT_PER_IP_PER_HOUR}={raw} is not a positive integer")
            })?,
            Err(_) => DEFAULT_RATE_LIMIT_PER_IP_PER_HOUR,
        };
        let rate_limit_exempt_paths = parse_csv(
            &env::var(ENV_RATE_LIMIT_EXEMPT_PATHS)
                .unwrap_or_else(|_| DEFAULT_RATE_LIMIT_EXEMPT_PATHS.into()),
        );
        let rate_limit_trusted_proxies = match env::var(ENV_RATE_LIMIT_TRUSTED_PROXIES) {
            Ok(raw) => parse_ip_csv(ENV_RATE_LIMIT_TRUSTED_PROXIES, &raw)?,
            Err(_) => Vec::new(),
        };

        Ok(Self {
            bind,
            bind_http,
            cert_path,
            key_path,
            publish_root,
            uploads_root,
            next_static_root,
            max_inflight,
            node_url,
            proxy_hosts,
            proxy_paths,
            custom_domain_proxy_paths,
            node_timeout_secs,
            proxy_body_idle_timeout_secs,
            database_url,
            db_pool_max,
            domain_cache_ttl_secs,
            domain_negative_ttl_secs,
            domain_cache_max,
            domain_reval_concurrency,
            internal_api_bind,
            acme_contact,
            acme_directory_url,
            cert_dir,
            acme_enabled,
            cert_renewal_threshold_days,
            cert_renewal_interval_secs,
            metrics_bind,
            rate_limit_enabled,
            rate_limit_per_ip_per_min,
            rate_limit_per_ip_per_hour,
            rate_limit_exempt_paths,
            rate_limit_trusted_proxies,
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
    uploads_root: Option<PathBuf>,
    next_static_root: Option<PathBuf>,
    max_inflight: Option<usize>,
    node_url: Option<String>,
    proxy_hosts: Option<Vec<String>>,
    proxy_paths: Option<Vec<String>>,
    custom_domain_proxy_paths: Option<Vec<String>>,
    node_timeout_secs: Option<u64>,
    proxy_body_idle_timeout_secs: Option<u64>,
    database_url: Option<Option<String>>,
    db_pool_max: Option<u32>,
    domain_cache_ttl_secs: Option<u64>,
    domain_negative_ttl_secs: Option<u64>,
    domain_cache_max: Option<u64>,
    domain_reval_concurrency: Option<u32>,
    internal_api_bind: Option<Option<SocketAddr>>,
    acme_contact: Option<Option<String>>,
    acme_directory_url: Option<String>,
    cert_dir: Option<PathBuf>,
    acme_enabled: Option<bool>,
    cert_renewal_threshold_days: Option<u32>,
    cert_renewal_interval_secs: Option<u64>,
    metrics_bind: Option<Option<SocketAddr>>,
    rate_limit_enabled: Option<bool>,
    rate_limit_per_ip_per_min: Option<u32>,
    rate_limit_per_ip_per_hour: Option<u32>,
    rate_limit_exempt_paths: Option<Vec<String>>,
    rate_limit_trusted_proxies: Option<Vec<IpAddr>>,
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

    pub fn uploads_root(mut self, path: PathBuf) -> Self {
        self.uploads_root = Some(path);
        self
    }

    pub fn next_static_root(mut self, path: PathBuf) -> Self {
        self.next_static_root = Some(path);
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

    pub fn custom_domain_proxy_paths(mut self, paths: Vec<String>) -> Self {
        self.custom_domain_proxy_paths = Some(paths);
        self
    }

    pub fn node_timeout_secs(mut self, secs: u64) -> Self {
        self.node_timeout_secs = Some(secs);
        self
    }

    pub fn proxy_body_idle_timeout_secs(mut self, secs: u64) -> Self {
        self.proxy_body_idle_timeout_secs = Some(secs);
        self
    }

    pub fn database_url(mut self, url: Option<String>) -> Self {
        self.database_url = Some(url);
        self
    }

    pub fn db_pool_max(mut self, n: u32) -> Self {
        self.db_pool_max = Some(n);
        self
    }

    pub fn domain_cache_ttl_secs(mut self, secs: u64) -> Self {
        self.domain_cache_ttl_secs = Some(secs);
        self
    }

    pub fn domain_negative_ttl_secs(mut self, secs: u64) -> Self {
        self.domain_negative_ttl_secs = Some(secs);
        self
    }

    pub fn domain_cache_max(mut self, n: u64) -> Self {
        self.domain_cache_max = Some(n);
        self
    }

    pub fn domain_reval_concurrency(mut self, n: u32) -> Self {
        self.domain_reval_concurrency = Some(n);
        self
    }

    pub fn internal_api_bind(mut self, addr: Option<SocketAddr>) -> Self {
        self.internal_api_bind = Some(addr);
        self
    }

    pub fn acme_contact(mut self, contact: Option<String>) -> Self {
        self.acme_contact = Some(contact);
        self
    }

    pub fn acme_directory_url(mut self, url: impl Into<String>) -> Self {
        self.acme_directory_url = Some(url.into());
        self
    }

    pub fn cert_dir(mut self, path: PathBuf) -> Self {
        self.cert_dir = Some(path);
        self
    }

    pub fn acme_enabled(mut self, enabled: bool) -> Self {
        self.acme_enabled = Some(enabled);
        self
    }

    pub fn cert_renewal_threshold_days(mut self, days: u32) -> Self {
        self.cert_renewal_threshold_days = Some(days);
        self
    }

    pub fn cert_renewal_interval_secs(mut self, secs: u64) -> Self {
        self.cert_renewal_interval_secs = Some(secs);
        self
    }

    pub fn metrics_bind(mut self, addr: Option<SocketAddr>) -> Self {
        self.metrics_bind = Some(addr);
        self
    }

    pub fn rate_limit_enabled(mut self, enabled: bool) -> Self {
        self.rate_limit_enabled = Some(enabled);
        self
    }

    pub fn rate_limit_per_ip_per_min(mut self, n: u32) -> Self {
        self.rate_limit_per_ip_per_min = Some(n);
        self
    }

    pub fn rate_limit_per_ip_per_hour(mut self, n: u32) -> Self {
        self.rate_limit_per_ip_per_hour = Some(n);
        self
    }

    pub fn rate_limit_exempt_paths(mut self, paths: Vec<String>) -> Self {
        self.rate_limit_exempt_paths = Some(paths);
        self
    }

    pub fn rate_limit_trusted_proxies(mut self, ips: Vec<IpAddr>) -> Self {
        self.rate_limit_trusted_proxies = Some(ips);
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
            uploads_root: self
                .uploads_root
                .unwrap_or_else(|| PathBuf::from(DEFAULT_UPLOADS_ROOT)),
            next_static_root: self
                .next_static_root
                .unwrap_or_else(|| PathBuf::from(DEFAULT_NEXT_STATIC_ROOT)),
            max_inflight: self.max_inflight.unwrap_or(DEFAULT_MAX_INFLIGHT),
            node_url: self.node_url.unwrap_or_else(|| DEFAULT_NODE_URL.into()),
            proxy_hosts: self
                .proxy_hosts
                .unwrap_or_else(|| parse_csv_lower(DEFAULT_PROXY_HOSTS)),
            proxy_paths: self
                .proxy_paths
                .unwrap_or_else(|| parse_csv(DEFAULT_PROXY_PATHS)),
            custom_domain_proxy_paths: self
                .custom_domain_proxy_paths
                .unwrap_or_else(|| parse_csv(DEFAULT_CUSTOM_DOMAIN_PROXY_PATHS)),
            node_timeout_secs: self.node_timeout_secs.unwrap_or(DEFAULT_NODE_TIMEOUT_SECS),
            proxy_body_idle_timeout_secs: self
                .proxy_body_idle_timeout_secs
                .unwrap_or(DEFAULT_PROXY_BODY_IDLE_TIMEOUT_SECS),
            database_url: self.database_url.unwrap_or(None),
            db_pool_max: self.db_pool_max.unwrap_or(DEFAULT_DB_POOL_MAX),
            domain_cache_ttl_secs: self
                .domain_cache_ttl_secs
                .unwrap_or(DEFAULT_DOMAIN_CACHE_TTL_SECS),
            domain_negative_ttl_secs: self
                .domain_negative_ttl_secs
                .unwrap_or(DEFAULT_DOMAIN_NEGATIVE_TTL_SECS),
            domain_cache_max: self.domain_cache_max.unwrap_or(DEFAULT_DOMAIN_CACHE_MAX),
            domain_reval_concurrency: self
                .domain_reval_concurrency
                .unwrap_or(self.db_pool_max.unwrap_or(DEFAULT_DB_POOL_MAX)),
            internal_api_bind: self.internal_api_bind.unwrap_or(None),
            acme_contact: {
                let contact = self.acme_contact.unwrap_or(None);
                // Promote the `acme_enabled` default exactly as `from_env`
                // does — caller can still override with `.acme_enabled(true)`.
                contact
            },
            acme_directory_url: self
                .acme_directory_url
                .unwrap_or_else(|| DEFAULT_ACME_DIRECTORY_URL.into()),
            cert_dir: self
                .cert_dir
                .unwrap_or_else(|| PathBuf::from(DEFAULT_CERT_DIR)),
            acme_enabled: self.acme_enabled.unwrap_or(false),
            cert_renewal_threshold_days: self
                .cert_renewal_threshold_days
                .unwrap_or(DEFAULT_CERT_RENEWAL_THRESHOLD_DAYS),
            cert_renewal_interval_secs: self
                .cert_renewal_interval_secs
                .unwrap_or(DEFAULT_CERT_RENEWAL_INTERVAL_SECS),
            metrics_bind: self.metrics_bind.unwrap_or(None),
            rate_limit_enabled: self.rate_limit_enabled.unwrap_or(false),
            rate_limit_per_ip_per_min: self
                .rate_limit_per_ip_per_min
                .unwrap_or(DEFAULT_RATE_LIMIT_PER_IP_PER_MIN),
            rate_limit_per_ip_per_hour: self
                .rate_limit_per_ip_per_hour
                .unwrap_or(DEFAULT_RATE_LIMIT_PER_IP_PER_HOUR),
            rate_limit_exempt_paths: self
                .rate_limit_exempt_paths
                .unwrap_or_else(|| parse_csv(DEFAULT_RATE_LIMIT_EXEMPT_PATHS)),
            rate_limit_trusted_proxies: self.rate_limit_trusted_proxies.unwrap_or_default(),
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
        assert_eq!(cfg.proxy_paths, vec!["/c/", "/api/f/"]);
        assert_eq!(cfg.custom_domain_proxy_paths, vec!["/c/", "/api/"]);
        assert_eq!(cfg.node_timeout_secs, DEFAULT_NODE_TIMEOUT_SECS);
    }

    #[test]
    fn builder_fills_disk_root_defaults() {
        let cfg = EdgeConfig::builder()
            .bind("127.0.0.1:0".parse().unwrap())
            .cert_path(PathBuf::from("/tmp/cert.pem"))
            .key_path(PathBuf::from("/tmp/key.pem"))
            .build()
            .unwrap();
        assert_eq!(cfg.uploads_root, PathBuf::from(DEFAULT_UPLOADS_ROOT));
        assert_eq!(
            cfg.next_static_root,
            PathBuf::from(DEFAULT_NEXT_STATIC_ROOT)
        );
    }

    #[test]
    fn builder_accepts_explicit_disk_roots() {
        let cfg = EdgeConfig::builder()
            .bind("127.0.0.1:0".parse().unwrap())
            .cert_path(PathBuf::from("/tmp/cert.pem"))
            .key_path(PathBuf::from("/tmp/key.pem"))
            .uploads_root(PathBuf::from("/srv/up"))
            .next_static_root(PathBuf::from("/srv/static"))
            .custom_domain_proxy_paths(vec!["/c/".into(), "/api/".into(), "/extra/".into()])
            .build()
            .unwrap();
        assert_eq!(cfg.uploads_root, PathBuf::from("/srv/up"));
        assert_eq!(cfg.next_static_root, PathBuf::from("/srv/static"));
        assert_eq!(
            cfg.custom_domain_proxy_paths,
            vec!["/c/", "/api/", "/extra/"]
        );
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
    fn builder_fills_lookup_defaults() {
        let cfg = EdgeConfig::builder()
            .bind("127.0.0.1:0".parse().unwrap())
            .cert_path(PathBuf::from("/tmp/cert.pem"))
            .key_path(PathBuf::from("/tmp/key.pem"))
            .build()
            .unwrap();
        assert!(cfg.database_url.is_none());
        assert_eq!(cfg.db_pool_max, DEFAULT_DB_POOL_MAX);
        assert_eq!(cfg.domain_cache_ttl_secs, DEFAULT_DOMAIN_CACHE_TTL_SECS);
        assert_eq!(
            cfg.domain_negative_ttl_secs,
            DEFAULT_DOMAIN_NEGATIVE_TTL_SECS
        );
        assert_eq!(cfg.domain_cache_max, DEFAULT_DOMAIN_CACHE_MAX);
        assert!(cfg.internal_api_bind.is_none());
    }

    #[test]
    fn builder_accepts_explicit_lookup_settings() {
        let cfg = EdgeConfig::builder()
            .bind("127.0.0.1:0".parse().unwrap())
            .cert_path(PathBuf::from("/tmp/cert.pem"))
            .key_path(PathBuf::from("/tmp/key.pem"))
            .database_url(Some("postgres://localhost/db".into()))
            .db_pool_max(16)
            .domain_cache_ttl_secs(120)
            .domain_negative_ttl_secs(30)
            .domain_cache_max(50_000)
            .internal_api_bind(Some("127.0.0.1:3081".parse().unwrap()))
            .build()
            .unwrap();
        assert_eq!(cfg.database_url.as_deref(), Some("postgres://localhost/db"));
        assert_eq!(cfg.db_pool_max, 16);
        assert_eq!(cfg.domain_cache_ttl_secs, 120);
        assert_eq!(cfg.domain_negative_ttl_secs, 30);
        assert_eq!(cfg.domain_cache_max, 50_000);
        assert_eq!(cfg.internal_api_bind.unwrap().port(), 3081);
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

    #[test]
    fn parse_optional_socketaddr_off_returns_none() {
        assert_eq!(parse_optional_socketaddr("X", "off").unwrap(), None);
        assert_eq!(parse_optional_socketaddr("X", "OFF").unwrap(), None);
        assert_eq!(parse_optional_socketaddr("X", "").unwrap(), None);
    }

    #[test]
    fn parse_optional_socketaddr_parses_real_addr() {
        let v = parse_optional_socketaddr("X", "127.0.0.1:3081").unwrap();
        assert_eq!(v.unwrap().port(), 3081);
    }

    #[test]
    fn parse_optional_socketaddr_rejects_garbage() {
        assert!(parse_optional_socketaddr("X", "not-an-addr").is_err());
    }

    #[test]
    fn builder_fills_acme_defaults() {
        let cfg = EdgeConfig::builder()
            .bind("127.0.0.1:0".parse().unwrap())
            .cert_path(PathBuf::from("/tmp/cert.pem"))
            .key_path(PathBuf::from("/tmp/key.pem"))
            .build()
            .unwrap();
        assert!(cfg.acme_contact.is_none());
        assert_eq!(cfg.acme_directory_url, DEFAULT_ACME_DIRECTORY_URL);
        assert_eq!(cfg.cert_dir, PathBuf::from(DEFAULT_CERT_DIR));
        assert!(!cfg.acme_enabled);
        assert_eq!(
            cfg.cert_renewal_threshold_days,
            DEFAULT_CERT_RENEWAL_THRESHOLD_DAYS
        );
        assert_eq!(
            cfg.cert_renewal_interval_secs,
            DEFAULT_CERT_RENEWAL_INTERVAL_SECS
        );
    }

    #[test]
    fn builder_accepts_explicit_acme_settings() {
        let cfg = EdgeConfig::builder()
            .bind("127.0.0.1:0".parse().unwrap())
            .cert_path(PathBuf::from("/tmp/cert.pem"))
            .key_path(PathBuf::from("/tmp/key.pem"))
            .acme_contact(Some("ops@openlen.com".into()))
            .acme_directory_url("https://acme-staging-v02.api.letsencrypt.org/directory")
            .cert_dir(PathBuf::from("/tmp/openlen-certs"))
            .acme_enabled(true)
            .cert_renewal_threshold_days(15)
            .cert_renewal_interval_secs(3600)
            .build()
            .unwrap();
        assert_eq!(cfg.acme_contact.as_deref(), Some("ops@openlen.com"));
        assert!(cfg.acme_directory_url.contains("staging"));
        assert_eq!(cfg.cert_dir, PathBuf::from("/tmp/openlen-certs"));
        assert!(cfg.acme_enabled);
        assert_eq!(cfg.cert_renewal_threshold_days, 15);
        assert_eq!(cfg.cert_renewal_interval_secs, 3600);
    }

    #[test]
    fn parse_bool_handles_common_truthy_and_falsy_values() {
        for v in ["1", "true", "TRUE", "yes", "on"] {
            assert!(parse_bool("X", v).unwrap(), "{v} should be truthy");
        }
        for v in ["0", "false", "no", "off", ""] {
            assert!(!parse_bool("X", v).unwrap(), "{v} should be falsy");
        }
    }

    #[test]
    fn parse_bool_rejects_garbage() {
        assert!(parse_bool("X", "maybe").is_err());
    }

    #[test]
    fn builder_fills_rate_limit_defaults_disabled() {
        let cfg = EdgeConfig::builder()
            .bind("127.0.0.1:0".parse().unwrap())
            .cert_path(PathBuf::from("/tmp/cert.pem"))
            .key_path(PathBuf::from("/tmp/key.pem"))
            .build()
            .unwrap();
        assert!(!cfg.rate_limit_enabled, "default must be off");
        assert_eq!(cfg.rate_limit_per_ip_per_min, DEFAULT_RATE_LIMIT_PER_IP_PER_MIN);
        assert_eq!(cfg.rate_limit_per_ip_per_hour, DEFAULT_RATE_LIMIT_PER_IP_PER_HOUR);
        assert!(cfg
            .rate_limit_exempt_paths
            .iter()
            .any(|p| p == "/c/"));
        assert!(cfg
            .rate_limit_exempt_paths
            .iter()
            .any(|p| p.starts_with("/.well-known/")));
        assert!(cfg.rate_limit_trusted_proxies.is_empty());
    }

    #[test]
    fn builder_accepts_explicit_rate_limit_overrides() {
        let cfg = EdgeConfig::builder()
            .bind("127.0.0.1:0".parse().unwrap())
            .cert_path(PathBuf::from("/tmp/cert.pem"))
            .key_path(PathBuf::from("/tmp/key.pem"))
            .rate_limit_enabled(true)
            .rate_limit_per_ip_per_min(50)
            .rate_limit_per_ip_per_hour(1000)
            .rate_limit_exempt_paths(vec!["/healthz".into()])
            .rate_limit_trusted_proxies(vec!["10.0.0.1".parse().unwrap()])
            .build()
            .unwrap();
        assert!(cfg.rate_limit_enabled);
        assert_eq!(cfg.rate_limit_per_ip_per_min, 50);
        assert_eq!(cfg.rate_limit_per_ip_per_hour, 1000);
        assert_eq!(cfg.rate_limit_exempt_paths, vec!["/healthz"]);
        assert_eq!(cfg.rate_limit_trusted_proxies.len(), 1);
    }

    #[test]
    fn parse_ip_csv_handles_v4_v6_and_whitespace() {
        let v = parse_ip_csv("X", " 1.2.3.4 , ::1 , 10.0.0.1").unwrap();
        assert_eq!(v.len(), 3);
        assert!(v.iter().any(|i| i.is_ipv4()));
        assert!(v.iter().any(|i| i.is_ipv6()));
    }

    #[test]
    fn parse_ip_csv_rejects_garbage() {
        assert!(parse_ip_csv("X", "1.2.3.4,not-an-ip").is_err());
    }

    #[test]
    fn parse_ip_csv_empty_returns_empty_vec() {
        let v = parse_ip_csv("X", "").unwrap();
        assert!(v.is_empty());
        let v = parse_ip_csv("X", " , , ").unwrap();
        assert!(v.is_empty());
    }
}
