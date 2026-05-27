use std::sync::Arc;

use anyhow::Result;
use tokio::signal;
use tokio::sync::Notify;
use tracing::{info, warn};

use openlen_edge::{
    bind_with_lookup, build_lookup_from_config, ensure_crypto_provider, load_wildcard,
    observability, run_http_redirect, run_internal_api, EdgeConfig, InternalApiState,
};

#[tokio::main]
async fn main() -> Result<()> {
    observability::try_init_logs();
    ensure_crypto_provider();

    let cfg = EdgeConfig::from_env()?;
    info!(
        bind = %cfg.bind,
        bind_http = ?cfg.bind_http,
        cert = %cfg.cert_path.display(),
        publish_root = %cfg.publish_root.display(),
        max_inflight = cfg.max_inflight,
        node_url = %cfg.node_url,
        node_timeout_secs = cfg.node_timeout_secs,
        proxy_hosts = ?cfg.proxy_hosts,
        proxy_paths = ?cfg.proxy_paths,
        database = if cfg.database_url.is_some() { "configured" } else { "none" },
        db_pool_max = cfg.db_pool_max,
        domain_cache_max = cfg.domain_cache_max,
        domain_cache_ttl_secs = cfg.domain_cache_ttl_secs,
        internal_api_bind = ?cfg.internal_api_bind,
        "openlen-edge starting"
    );

    let lookup = build_lookup_from_config(&cfg).await?;
    let tls = load_wildcard(&cfg.cert_path, &cfg.key_path)?;
    let tls_server = bind_with_lookup(&cfg, tls, lookup.clone()).await?;

    let shutdown = Arc::new(Notify::new());

    let tls_shutdown = shutdown.clone();
    let tls_task = tokio::spawn(async move {
        let signal = async move { tls_shutdown.notified().await };
        tls_server.serve(signal).await
    });

    let redirect_task = if let Some(bind_http) = cfg.bind_http {
        let redirect_shutdown = shutdown.clone();
        Some(tokio::spawn(async move {
            let signal = async move { redirect_shutdown.notified().await };
            run_http_redirect(bind_http, signal).await
        }))
    } else {
        None
    };

    let internal_api_task = if let Some(bind_addr) = cfg.internal_api_bind {
        if !bind_addr.ip().is_loopback() {
            warn!(
                addr = %bind_addr,
                "internal API bind is not loopback — refusing to start it externally"
            );
            None
        } else {
            let internal_shutdown = shutdown.clone();
            let state = InternalApiState {
                lookup: lookup.clone() as Arc<dyn openlen_edge::DomainLookup>,
                layered: Some(lookup.clone()),
            };
            Some(tokio::spawn(async move {
                let signal = async move { internal_shutdown.notified().await };
                run_internal_api(bind_addr, state, signal).await
            }))
        }
    } else {
        None
    };

    shutdown_signal().await;
    shutdown.notify_waiters();

    let tls_result = tls_task.await?;
    if let Err(err) = &tls_result {
        warn!(error = %err, "TLS listener exited with error");
    }
    if let Some(handle) = redirect_task {
        match handle.await {
            Ok(Ok(())) => {}
            Ok(Err(err)) => warn!(error = %err, "HTTP redirect exited with error"),
            Err(err) => warn!(error = %err, "HTTP redirect task panicked"),
        }
    }
    if let Some(handle) = internal_api_task {
        match handle.await {
            Ok(Ok(())) => {}
            Ok(Err(err)) => warn!(error = %err, "internal API exited with error"),
            Err(err) => warn!(error = %err, "internal API task panicked"),
        }
    }

    tls_result
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
