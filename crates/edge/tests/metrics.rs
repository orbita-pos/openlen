//! Integration test for the Prometheus exporter.
//!
//! `metrics-exporter-prometheus` installs a global recorder; it errors on
//! a second install_recorder in the same process. So this file is one
//! self-contained `#[tokio::test]` that exercises every assertion against
//! a single exporter instance.

use std::net::{SocketAddr, TcpListener};
use std::time::Duration;

use openlen_edge::observability::install_exporter;

fn free_local_addr() -> SocketAddr {
    let l = TcpListener::bind("127.0.0.1:0").expect("bind ephemeral");
    let addr = l.local_addr().expect("local_addr");
    drop(l);
    addr
}

async fn scrape(addr: SocketAddr) -> String {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(2))
        .build()
        .expect("client");
    let url = format!("http://{addr}/metrics");
    let resp = client.get(&url).send().await.expect("get /metrics");
    assert!(
        resp.status().is_success(),
        "/metrics returned {}",
        resp.status()
    );
    resp.text().await.expect("body text")
}

#[tokio::test]
async fn prometheus_exporter_full_surface() {
    let addr = free_local_addr();
    let _handle = install_exporter(addr).expect("install_exporter");

    // Emit one sample for every advertised metric so its HELP / TYPE line
    // surfaces in the scrape — Prometheus' text format only renders metrics
    // that have at least one sample, regardless of whether describe_* ran.
    metrics::counter!(
        "openlen_edge_requests_total",
        "host" => "test.openlen.com",
        "status_class" => "2xx",
        "route_kind" => "subdomain_disk",
    )
    .increment(1);
    metrics::histogram!(
        "openlen_edge_request_duration_seconds",
        "host" => "demo.openlen.com",
        "route_kind" => "subdomain_disk",
    )
    .record(0.012);
    metrics::counter!(
        "openlen_edge_domain_lookup_total",
        "result" => "hit_positive",
    )
    .increment(0);
    metrics::histogram!(
        "openlen_edge_domain_lookup_duration_seconds",
        "cache" => "hit",
    )
    .record(0.0001);
    metrics::counter!("openlen_edge_domain_singleflight_coalesced_total").increment(0);
    metrics::gauge!("openlen_edge_domain_reval_permits_available").set(8.0);
    metrics::counter!(
        "openlen_edge_cert_issuance_total",
        "result" => "success",
    )
    .increment(0);
    metrics::histogram!("openlen_edge_cert_issuance_duration_seconds").record(0.0);
    metrics::gauge!("openlen_edge_cert_renewal_due_total").set(0.0);
    metrics::gauge!(
        "openlen_edge_active_certs_total",
        "type" => "wildcard",
    )
    .set(1.0);
    metrics::counter!(
        "openlen_edge_proxy_upstream_errors_total",
        "reason" => "connect_refused",
    )
    .increment(0);
    metrics::histogram!("openlen_edge_proxy_upstream_duration_seconds").record(0.0);
    metrics::gauge!("openlen_edge_proxy_pool_idle_connections").set(0.0);
    metrics::gauge!("openlen_edge_proxy_pool_inflight_connections").set(0.0);
    metrics::gauge!("openlen_edge_handshake_inflight").set(0.0);
    metrics::counter!("openlen_edge_handshake_capped_total").increment(0);

    // Let the HTTP listener bind + first samples flush.
    tokio::time::sleep(Duration::from_millis(150)).await;
    let body = scrape(addr).await;

    // 1. Prometheus text format invariants.
    assert!(
        body.contains("# HELP openlen_edge_requests_total"),
        "missing HELP for requests_total"
    );
    assert!(
        body.contains("# TYPE openlen_edge_requests_total counter"),
        "missing TYPE for requests_total"
    );
    assert!(
        body.contains("openlen_edge_requests_total{"),
        "missing labeled emission"
    );

    // 2. All advertised metrics must carry a HELP line, regardless of
    // whether they've been emitted yet — describe_* runs at startup.
    for required in [
        "openlen_edge_requests_total",
        "openlen_edge_request_duration_seconds",
        "openlen_edge_domain_lookup_total",
        "openlen_edge_domain_lookup_duration_seconds",
        "openlen_edge_domain_singleflight_coalesced_total",
        "openlen_edge_domain_reval_permits_available",
        "openlen_edge_cert_issuance_total",
        "openlen_edge_cert_issuance_duration_seconds",
        "openlen_edge_cert_renewal_due_total",
        "openlen_edge_active_certs_total",
        "openlen_edge_proxy_upstream_errors_total",
        "openlen_edge_proxy_upstream_duration_seconds",
        "openlen_edge_proxy_pool_idle_connections",
        "openlen_edge_proxy_pool_inflight_connections",
        "openlen_edge_handshake_inflight",
        "openlen_edge_handshake_capped_total",
    ] {
        assert!(
            body.contains(&format!("# HELP {required}")),
            "missing HELP line for {required}"
        );
    }

    // 3. Histogram rendered as buckets, not summary quantiles. Our explicit
    // bucket configuration must surface (`_bucket{le="..."}` lines).
    assert!(
        body.contains("openlen_edge_request_duration_seconds_bucket"),
        "histogram bucket lines missing"
    );
    assert!(
        body.contains("le=\"0.025\""),
        "expected configured bucket 0.025 in output"
    );
    assert!(
        body.contains("le=\"+Inf\""),
        "every histogram must end with +Inf bucket"
    );
}
