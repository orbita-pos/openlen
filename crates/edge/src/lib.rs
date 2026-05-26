pub mod config;
pub mod observability;
pub mod server;
pub mod tls;

pub use config::{EdgeConfig, EdgeConfigBuilder};
pub use server::{bind, router, BoundServer, SERVER_HEADER_VALUE, VERSION};
pub use tls::{load_wildcard, WildcardCertError};

use std::sync::Once;

static CRYPTO_PROVIDER: Once = Once::new();

/// Install rustls's default crypto provider (aws-lc-rs). Idempotent — safe to
/// call from `main`, tests, or library entry points without coordination.
pub fn ensure_crypto_provider() {
    CRYPTO_PROVIDER.call_once(|| {
        let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    });
}
