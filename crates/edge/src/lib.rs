pub mod ab;
pub mod config;
pub mod files;
pub mod lookup;
pub mod middleware;
pub mod observability;
pub mod proxy;
pub mod routing;
pub mod server;
pub mod sidecar;
pub mod tls;

pub use ab::{
    evaluate_manifest, evaluate_request, hash_variant, is_blocked_internal_path, parse_manifest,
    AbDecision, AbExperiment, AbManifest, AbManifestCache, AssignSource, Variant,
};
pub use config::{EdgeConfig, EdgeConfigBuilder};
pub use lookup::{
    build_lookup_from_config, run_internal_api, serve_internal_api, DomainLookup, InternalApiState,
    LayeredLookup, LookupError, LookupResult, MockDomainLookup, PostgresDomainLookup,
};
pub use middleware::{
    extract_client_ip, ClientIpSource, IpExtractConfig, RateLimitConfig, RateLimitLayer,
    RateLimitMiddleware,
};
pub use proxy::{decide_route, NodeClient, NodeClientError, RouteAction};
pub use routing::{
    extract_subdomain, is_openlen_zone, looks_like_public_hostname, run_http_redirect,
};
pub use server::{
    ab_loopback_router, bind, bind_with_lookup, bind_with_lookup_and_layers, router,
    router_with_layers, run_ab_loopback, AppState, BoundServer, SERVER_HEADER_VALUE, VERSION,
};
pub use sidecar::{run_ab_sidecar, shutdown_signal, DEFAULT_SIDECAR_BIND};
pub use tls::{
    build_dynamic_config, cert_dir_for, load_persisted_certs, load_wildcard, read_cert_pair,
    run_renewal_loop, save_cert, watch_wildcard, AcmeClient, AcmeIssuer, DynamicCertResolver,
    IssuedCert, RenewalConfig, StoredCert, WildcardCertError,
};

use std::sync::Once;

static CRYPTO_PROVIDER: Once = Once::new();

/// Install rustls's default crypto provider (aws-lc-rs). Idempotent — safe to
/// call from `main`, tests, or library entry points without coordination.
pub fn ensure_crypto_provider() {
    CRYPTO_PROVIDER.call_once(|| {
        let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    });
}
