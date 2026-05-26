use anyhow::Result;
use tokio::signal;
use tracing::{info, warn};

use openlen_edge::{bind, ensure_crypto_provider, load_wildcard, observability, EdgeConfig};

#[tokio::main]
async fn main() -> Result<()> {
    observability::try_init_logs();
    ensure_crypto_provider();

    let cfg = EdgeConfig::from_env()?;
    info!(
        bind = %cfg.bind,
        cert = %cfg.cert_path.display(),
        publish_root = %cfg.publish_root.display(),
        "openlen-edge starting"
    );

    let tls = load_wildcard(&cfg.cert_path, &cfg.key_path)?;
    let server = bind(&cfg, tls).await?;
    server.serve(shutdown_signal()).await
}

async fn shutdown_signal() {
    let ctrl_c = async {
        if let Err(err) = signal::ctrl_c().await {
            warn!(error = %err, "ctrl_c handler failed");
        }
    };

    #[cfg(unix)]
    let terminate = async {
        use signal::unix::{signal, SignalKind};
        match signal(SignalKind::terminate()) {
            Ok(mut s) => {
                s.recv().await;
            }
            Err(err) => warn!(error = %err, "SIGTERM handler failed"),
        }
    };

    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => info!("ctrl-c received"),
        _ = terminate => info!("SIGTERM received"),
    }
}
