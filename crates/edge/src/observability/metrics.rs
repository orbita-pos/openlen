//! Prometheus metrics — registration + exporter setup.
//!
//! We use the `metrics` crate (facade) so call sites stay agnostic to the
//! exporter; the binding to `metrics-exporter-prometheus` happens here at
//! startup. Histograms get explicit bucket lists so the rendered output is
//! Prometheus-native (not summaries), which Grafana likes for
//! `histogram_quantile`.
//!
//! Naming convention: every metric is `openlen_edge_<area>_<unit>` so the
//! Grafana templates can group on a stable prefix.

use std::net::SocketAddr;
use std::time::Duration;

use anyhow::{Context, Result};
use metrics_exporter_prometheus::{Matcher, PrometheusBuilder, PrometheusHandle};
use metrics_process::Collector;

/// Request-duration buckets in seconds. Covers the realistic edge latency
/// distribution from a cached static hit (~1 ms) up to a slow Node round-trip
/// at p99 (~10 s).
pub const REQUEST_DURATION_BUCKETS: &[f64] = &[
    0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0,
];

/// Cert issuance duration buckets in seconds. ACME orders typically land in
/// 5-30 s; the tail goes long when the directory is throttling.
pub const CERT_ISSUANCE_BUCKETS: &[f64] = &[1.0, 5.0, 10.0, 30.0, 60.0, 120.0, 300.0];

/// Cache + lookup duration buckets in seconds. Dominated by Postgres p99 +
/// pool wait; covers ~10 µs (cache hit) to 1 s (DB cold-pool).
pub const LOOKUP_DURATION_BUCKETS: &[f64] = &[
    0.00001, 0.00005, 0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1.0,
];

/// Rate-limit decision duration buckets in seconds. Memory-bucket math
/// runs in ~1 µs; the 1 ms tail covers a worst-case allocation under
/// load. Includes a 10 ms bucket for when the cache ever consults PG
/// (today never — edge runs memory-only).
pub const RATE_LIMIT_DURATION_BUCKETS: &[f64] = &[
    0.000_001, 0.000_005, 0.000_010, 0.000_050, 0.000_100, 0.000_500, 0.001, 0.005, 0.010,
];

/// Stand-up the global recorder + the `/metrics` HTTP listener.
///
/// `bind` is the listener address. Returns the [`PrometheusHandle`] so the
/// caller can render to text inside tests or behind a separate route. The
/// builder also spawns a tokio task for the HTTP listener.
pub fn install_exporter(bind: SocketAddr) -> Result<PrometheusHandle> {
    let mut builder = PrometheusBuilder::new().with_http_listener(bind);

    // Histogram bucket overrides — match by full metric name so the exporter
    // renders them as true histograms instead of summaries.
    for name in [
        "openlen_edge_request_duration_seconds",
        "openlen_edge_proxy_upstream_duration_seconds",
    ] {
        builder = builder
            .set_buckets_for_metric(Matcher::Full(name.to_owned()), REQUEST_DURATION_BUCKETS)
            .with_context(|| format!("registering buckets for {name}"))?;
    }
    builder = builder
        .set_buckets_for_metric(
            Matcher::Full("openlen_edge_cert_issuance_duration_seconds".to_owned()),
            CERT_ISSUANCE_BUCKETS,
        )
        .context("registering cert issuance buckets")?;
    for name in [
        "openlen_edge_domain_lookup_duration_seconds",
        "openlen_edge_domain_cache_age_seconds",
    ] {
        builder = builder
            .set_buckets_for_metric(Matcher::Full(name.to_owned()), LOOKUP_DURATION_BUCKETS)
            .with_context(|| format!("registering buckets for {name}"))?;
    }
    builder = builder
        .set_buckets_for_metric(
            Matcher::Full("openlen_edge_rate_limit_decision_duration_seconds".to_owned()),
            RATE_LIMIT_DURATION_BUCKETS,
        )
        .context("registering rate-limit decision duration buckets")?;

    // `build()` gives us both the recorder + the HTTP listener future; we
    // install the recorder globally + spawn the future ourselves so the
    // /metrics endpoint actually starts serving. `install()` / `install_recorder()`
    // either spawn but-not-return-handle or return-handle-without-spawn — we
    // need both, so go through `build()`.
    let (recorder, listener) = builder.build().context("building Prometheus recorder")?;
    let handle = recorder.handle();
    metrics::set_global_recorder(recorder).context("installing PrometheusRecorder")?;
    tokio::spawn(async move {
        if let Err(err) = listener.await {
            tracing::warn!(error = ?err, "Prometheus HTTP listener exited");
        }
    });
    register_descriptions();
    Ok(handle)
}

/// Install descriptions for every metric so the rendered output carries
/// `# HELP` and `# TYPE` lines even before the first sample lands.
fn register_descriptions() {
    use metrics::{describe_counter, describe_gauge, describe_histogram, Unit};

    // Request path
    describe_counter!(
        "openlen_edge_requests_total",
        "Total HTTP responses returned by the edge, labeled by host, status class, and route kind."
    );
    describe_histogram!(
        "openlen_edge_request_duration_seconds",
        Unit::Seconds,
        "End-to-end response latency observed at the edge, labeled by host and route kind."
    );

    // Domain lookup
    describe_counter!(
        "openlen_edge_domain_lookup_total",
        "Domain-lookup outcomes — hit_positive / hit_negative / miss / error."
    );
    describe_histogram!(
        "openlen_edge_domain_lookup_duration_seconds",
        Unit::Seconds,
        "Time spent in the domain-lookup layer (cache hit fast path vs. miss-then-base)."
    );
    describe_counter!(
        "openlen_edge_domain_singleflight_coalesced_total",
        "Concurrent same-key lookups coalesced into one base call by the singleflight layer."
    );
    describe_gauge!(
        "openlen_edge_domain_reval_permits_available",
        "Permits available on the SWR background revalidation semaphore."
    );

    // Cert management
    describe_counter!(
        "openlen_edge_cert_issuance_total",
        "ACME issuance outcomes — success / validation_failed / timeout / rate_limited."
    );
    describe_histogram!(
        "openlen_edge_cert_issuance_duration_seconds",
        Unit::Seconds,
        "Wall-clock time spent on a single ACME issuance attempt."
    );
    describe_gauge!(
        "openlen_edge_cert_renewal_due_total",
        "Current count of stored certs whose expiry sits within the renewal threshold."
    );
    describe_gauge!(
        "openlen_edge_active_certs_total",
        "Current count of usable certs in the resolver map, by type (wildcard / custom)."
    );

    // Proxy upstream
    describe_counter!(
        "openlen_edge_proxy_upstream_errors_total",
        "Upstream proxy failures — connect_refused / header_timeout / body_idle_timeout / upstream_5xx."
    );
    describe_histogram!(
        "openlen_edge_proxy_upstream_duration_seconds",
        Unit::Seconds,
        "Time from outbound proxy request start to response headers received."
    );
    describe_gauge!(
        "openlen_edge_proxy_pool_idle_connections",
        "Approximate number of idle upstream HTTP/1.1 connections in the pool."
    );
    describe_gauge!(
        "openlen_edge_proxy_pool_inflight_connections",
        "Approximate number of in-flight upstream requests."
    );

    // Connection cap
    describe_gauge!(
        "openlen_edge_handshake_inflight",
        "Current number of TLS handshakes / requests holding the inflight semaphore."
    );
    describe_counter!(
        "openlen_edge_handshake_capped_total",
        "Connections dropped at the accept loop because the inflight cap was reached."
    );

    // Edge IP rate-limit middleware (F4 S2). Counts every decision the
    // middleware makes — exempt path / allowed / blocked / error. PG-hit
    // counter is registered even though the edge currently runs the
    // SmartCache in memory-only mode (always 0); leaving it in keeps the
    // Grafana panel template stable for the day someone wires PG.
    describe_counter!(
        "openlen_edge_rate_limit_decisions_total",
        "Rate-limit decisions — exempt / allowed / blocked / error."
    );
    describe_histogram!(
        "openlen_edge_rate_limit_decision_duration_seconds",
        Unit::Seconds,
        "End-to-end time spent in the rate-limit middleware (IP extraction + bucket check)."
    );
    describe_counter!(
        "openlen_edge_rate_limit_memory_hits_total",
        "Decisions answered from the in-process token bucket, labeled by IP source."
    );
    describe_counter!(
        "openlen_edge_rate_limit_pg_hits_total",
        "Decisions that reached the Postgres limiter (always 0 while the edge runs memory-only)."
    );
}

/// Snapshot process-level stats (CPU, RSS, open FDs). Call from a tokio
/// interval so the gauges stay fresh; the exporter scrapes whatever was last
/// published.
pub fn spawn_process_collector_loop(period: Duration) -> tokio::task::JoinHandle<()> {
    let collector = Collector::default();
    collector.describe();
    tokio::spawn(async move {
        let mut ticker = tokio::time::interval(period);
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            ticker.tick().await;
            collector.collect();
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buckets_constants_are_sorted_and_positive() {
        for buckets in [
            REQUEST_DURATION_BUCKETS,
            CERT_ISSUANCE_BUCKETS,
            LOOKUP_DURATION_BUCKETS,
            RATE_LIMIT_DURATION_BUCKETS,
        ] {
            assert!(!buckets.is_empty(), "buckets non-empty");
            assert!(buckets[0] > 0.0, "buckets[0] > 0");
            for w in buckets.windows(2) {
                assert!(w[0] < w[1], "buckets must be sorted ascending");
            }
        }
    }
}
