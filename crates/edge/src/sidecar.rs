//! `openlen-edge --ab-sidecar` (or `OPENLEN_EDGE_MODE=ab-sidecar`): the process Caddy delegates an
//! experiment's pages and files to (infra/AB_TESTING_RUNBOOK.md).
//!
//! Caddy stays the web tier. This mode binds ONLY the loopback A/B listener (default
//! `127.0.0.1:8085`): no TLS, no :80/:443, no ACME, no database, no certificates, so it can run
//! beside Caddy without fighting it for a port and without any of the full edge's secrets. A bind
//! that fails (the port is taken, the address is not loopback) is logged at STARTUP and the process
//! exits non-zero — systemd shows a failed unit, and Caddy's fail-open serves control meanwhile.

use std::net::SocketAddr;

use anyhow::Result;
use tokio::signal;
use tracing::{error, info, warn};

use crate::config::EdgeConfig;
use crate::observability::install_exporter;
use crate::server::{run_ab_loopback, AppState};

/// Where the sidecar listens unless `OPENLEN_EDGE_AB_LOOPBACK_BIND` says otherwise. The Caddyfile's
/// `reverse_proxy` points here.
pub const DEFAULT_SIDECAR_BIND: &str = "127.0.0.1:8085";

/// Resolves on SIGTERM or Ctrl-C.
pub async fn shutdown_signal() {
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

/// Run the sidecar until a shutdown signal. Any failure to start is logged as an error and returned
/// (the binary then exits non-zero).
pub async fn run_ab_sidecar(mut cfg: EdgeConfig) -> Result<()> {
    cfg.ab_enabled = true;
    cfg.ab_sidecar_only = true;
    let bind: SocketAddr = match cfg.ab_loopback_bind {
        Some(addr) => addr,
        None => DEFAULT_SIDECAR_BIND.parse()?,
    };
    info!(
        bind = %bind,
        publish_root = %cfg.publish_root.display(),
        publish_hosts = ?cfg.publish_hosts,
        manifest_cache_max = cfg.ab_manifest_cache_max,
        "openlen-edge A/B sidecar starting"
    );

    // The full edge's exporter defaults to :9090; here it runs only when asked for by name.
    let _metrics = match (std::env::var_os("OPENLEN_EDGE_METRICS_BIND"), cfg.metrics_bind) {
        (Some(_), Some(addr)) => match install_exporter(addr) {
            Ok(handle) => Some(handle),
            Err(err) => {
                warn!(addr = %addr, error = %err, "metrics exporter install failed — continuing without metrics");
                None
            }
        },
        _ => None,
    };

    let state = match AppState::from_config(&cfg) {
        Ok(state) => state,
        Err(err) => {
            error!(error = %err, "A/B sidecar failed to start");
            return Err(err);
        }
    };
    match run_ab_loopback(bind, state, shutdown_signal()).await {
        Ok(()) => {
            info!("openlen-edge A/B sidecar stopped");
            Ok(())
        }
        Err(err) => {
            error!(error = %format!("{err:#}"), "A/B sidecar failed to start or died");
            Err(err)
        }
    }
}
