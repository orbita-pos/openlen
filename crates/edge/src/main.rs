use std::sync::{Arc, RwLock};
use std::time::Duration;

use anyhow::Result;
use dashmap::DashMap;
use rustls::sign::CertifiedKey;
use tokio::signal;
use tokio::sync::Notify;
use tracing::{info, warn};

use observability::{install_exporter, spawn_process_collector_loop};
use openlen_edge::{
    bind_with_lookup_and_layers, build_dynamic_config, build_lookup_from_config,
    ensure_crypto_provider, load_persisted_certs, observability, read_cert_pair,
    run_http_redirect, run_internal_api, run_renewal_loop, watch_wildcard, AcmeClient,
    AcmeIssuer, DynamicCertResolver, EdgeConfig, InternalApiState, IpExtractConfig,
    RateLimitConfig, RateLimitLayer, RenewalConfig,
};
use openlen_rate_limit::{LimitWindow, SmartCache, SmartCacheConfig};

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
        cert_dir = %cfg.cert_dir.display(),
        acme_enabled = cfg.acme_enabled,
        acme_directory = %cfg.acme_directory_url,
        cert_renewal_threshold_days = cfg.cert_renewal_threshold_days,
        "openlen-edge starting"
    );

    // Metrics exporter — installed before anything else so the first request
    // / first issuance lands in the global registry. The handle stays in
    // scope so the recorder isn't dropped.
    let _metrics_handle = match cfg.metrics_bind {
        Some(addr) => match install_exporter(addr) {
            Ok(h) => {
                info!(addr = %addr, "Prometheus /metrics listener installed");
                Some(h)
            }
            Err(err) => {
                warn!(addr = %addr, error = %err, "metrics exporter install failed — continuing without metrics");
                None
            }
        },
        None => {
            info!("metrics exporter disabled (OPENLEN_EDGE_METRICS_BIND=off)");
            None
        }
    };
    let process_collector = spawn_process_collector_loop(Duration::from_secs(10));

    let lookup = build_lookup_from_config(&cfg).await?;

    // Wildcard cert slot — populated from disk, swapped by the hot-reload
    // watcher on certbot rotations.
    let wildcard_key = read_cert_pair(&cfg.cert_path, &cfg.key_path)?;
    let wildcard_slot: Arc<RwLock<Arc<CertifiedKey>>> =
        Arc::new(RwLock::new(Arc::new(wildcard_key)));

    // Custom-cert map — pre-populated from any certs persisted on disk.
    let custom: Arc<DashMap<String, Arc<CertifiedKey>>> = Arc::new(DashMap::new());
    match load_persisted_certs(&cfg.cert_dir) {
        Ok(stored) => {
            for entry in stored {
                info!(
                    domain = %entry.domain,
                    expires_at = entry.expires_at,
                    "loaded persisted cert"
                );
                custom.insert(entry.domain, entry.certified);
            }
        }
        Err(err) => warn!(
            cert_dir = %cfg.cert_dir.display(),
            error = %err,
            "failed to enumerate cert dir — starting with empty custom-cert map"
        ),
    }

    // ACME client — only constructed when both `acme_enabled` and a
    // contact mailbox are configured. Without either, the resolver
    // refuses to issue and unknown custom hosts get a clean handshake
    // failure.
    let acme_issuer: Option<Arc<dyn AcmeIssuer>> = if cfg.acme_enabled {
        match &cfg.acme_contact {
            Some(contact) if !contact.trim().is_empty() => {
                match AcmeClient::new(contact, &cfg.acme_directory_url, cfg.cert_dir.clone()).await
                {
                    Ok(client) => Some(Arc::new(client)),
                    Err(err) => {
                        warn!(error = %err, "ACME client init failed — on-demand issuance disabled");
                        None
                    }
                }
            }
            _ => {
                warn!(
                    "OPENLEN_EDGE_ACME_ENABLED=true but OPENLEN_EDGE_ACME_CONTACT is empty — on-demand issuance disabled"
                );
                None
            }
        }
    } else {
        None
    };

    let resolver = DynamicCertResolver::new(
        wildcard_slot.clone(),
        custom.clone(),
        acme_issuer.clone(),
        lookup.clone() as Arc<dyn openlen_edge::DomainLookup>,
    );
    let tls = build_dynamic_config(Arc::new(resolver));

    // Periodic refresh of cert-count gauges. Cheap (one DashMap len()).
    let active_certs_custom = custom.clone();
    let active_certs_task = tokio::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(30));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            ticker.tick().await;
            metrics::gauge!(
                "openlen_edge_active_certs_total",
                "type" => "wildcard",
            )
            .set(1.0);
            metrics::gauge!(
                "openlen_edge_active_certs_total",
                "type" => "custom",
            )
            .set(active_certs_custom.len() as f64);
        }
    });
    // Edge-side IP rate limiter. Defaults OFF — operators flip on after
    // initial soak (see infra/edge/CUTOVER.md §10). The SmartCache + its
    // background tasks live in the same scope as the TLS server so a
    // shutdown signal tears both down together.
    let (rate_limit_layer, _rate_limit_bg): (Option<RateLimitLayer>, _) = if cfg.rate_limit_enabled
    {
        let (cache, bg) =
            SmartCache::start_memory_only(SmartCacheConfig::memory_only());
        let windows = vec![
            LimitWindow {
                window_ms: 60_000,
                max: cfg.rate_limit_per_ip_per_min,
                label: "per_min".into(),
            },
            LimitWindow {
                window_ms: 3_600_000,
                max: cfg.rate_limit_per_ip_per_hour,
                label: "per_hour".into(),
            },
        ];
        let ip_config = IpExtractConfig {
            trusted_proxies: cfg.rate_limit_trusted_proxies.clone(),
            ..IpExtractConfig::default()
        };
        let rl_cfg = RateLimitConfig {
            smart_cache: cache,
            windows: Arc::new(windows),
            exempt_path_prefixes: Arc::new(cfg.rate_limit_exempt_paths.clone()),
            ip_config,
        };
        info!(
            per_min = cfg.rate_limit_per_ip_per_min,
            per_hour = cfg.rate_limit_per_ip_per_hour,
            exempt_paths = ?cfg.rate_limit_exempt_paths,
            trusted_proxies = cfg.rate_limit_trusted_proxies.len(),
            "edge rate-limit enabled"
        );
        (Some(RateLimitLayer::new(rl_cfg)), Some(bg))
    } else {
        info!("edge rate-limit disabled (OPENLEN_EDGE_RATE_LIMIT_ENABLED unset)");
        (None, None)
    };

    let tls_server = bind_with_lookup_and_layers(
        &cfg,
        tls,
        lookup.clone() as Arc<dyn openlen_edge::DomainLookup>,
        rate_limit_layer,
    )
    .await?;

    let shutdown = Arc::new(Notify::new());

    let tls_shutdown = shutdown.clone();
    let tls_task = tokio::spawn(async move {
        let signal = async move { tls_shutdown.notified().await };
        tls_server.serve(signal).await
    });

    // Wildcard cert hot-reload.
    let reload_shutdown = shutdown.clone();
    let reload_cert = cfg.cert_path.clone();
    let reload_key = cfg.key_path.clone();
    let reload_slot = wildcard_slot.clone();
    let reload_task = tokio::spawn(async move {
        let signal = async move { reload_shutdown.notified().await };
        watch_wildcard(reload_cert, reload_key, reload_slot, signal).await
    });

    // Background renewal sweep.
    let renewal_task = if let Some(acme) = acme_issuer.clone() {
        let renewal_shutdown = shutdown.clone();
        let renewal_cfg = RenewalConfig {
            cert_dir: cfg.cert_dir.clone(),
            threshold_days: cfg.cert_renewal_threshold_days,
            interval: Duration::from_secs(cfg.cert_renewal_interval_secs),
        };
        let custom_for_renewal = custom.clone();
        Some(tokio::spawn(async move {
            let signal = async move { renewal_shutdown.notified().await };
            run_renewal_loop(renewal_cfg, acme, custom_for_renewal, signal).await;
            Ok::<(), anyhow::Error>(())
        }))
    } else {
        None
    };

    let redirect_task = if let Some(bind_http) = cfg.bind_http {
        let redirect_shutdown = shutdown.clone();
        let redirect_acme = acme_issuer.clone();
        Some(tokio::spawn(async move {
            let signal = async move { redirect_shutdown.notified().await };
            run_http_redirect(bind_http, redirect_acme, signal).await
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
    if let Some(handle) = renewal_task {
        match handle.await {
            Ok(Ok(())) => {}
            Ok(Err(err)) => warn!(error = %err, "renewal task exited with error"),
            Err(err) => warn!(error = %err, "renewal task panicked"),
        }
    }
    match reload_task.await {
        Ok(Ok(())) => {}
        Ok(Err(err)) => warn!(error = %err, "wildcard reload task exited with error"),
        Err(err) => warn!(error = %err, "wildcard reload task panicked"),
    }
    active_certs_task.abort();
    process_collector.abort();

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
