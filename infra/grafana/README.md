# Grafana dashboard — openlen-edge

`openlen-edge-dashboard.json` is a Grafana 11+ dashboard that visualizes
the metrics exposed by `openlen-edge` on `/metrics`.

## Prerequisites

- A Prometheus instance scraping the edge's `/metrics` endpoint.
- A Grafana instance with the Prometheus datasource configured.

## Importing

```
Grafana UI → Dashboards → Import → Upload JSON file
        → select openlen-edge-dashboard.json
        → Datasource: pick your Prometheus
        → Import
```

Alternatively, paste the file's raw text into the **Import via panel
json** box on the same screen.

The dashboard declares its datasource as `${DS_PROMETHEUS}`, which is a
template variable resolved at import. If you have multiple Prometheus
datasources, choose the one that scrapes the edge.

## Prometheus scrape config

A standard scrape config for the default loopback bind:

```yaml
scrape_configs:
  - job_name: openlen-edge
    scrape_interval: 15s
    metrics_path: /metrics
    static_configs:
      - targets: ["127.0.0.1:9090"]
        labels:
          service: openlen-edge
```

In production behind a node-local Prometheus sidecar, leave the bind on
`127.0.0.1:9090` (the default). To expose the endpoint on a trusted
interface, set `OPENLEN_EDGE_METRICS_BIND=0.0.0.0:9090` (and gate it at
the firewall — the endpoint is unauthenticated).

To disable the exporter entirely, set `OPENLEN_EDGE_METRICS_BIND=off`.

## Variables

- `DS_PROMETHEUS` — datasource picker, resolved at import.
- `host` — filter every panel by the request `host` label.  Defaults to
  `All`; pick a single project subdomain or custom domain to focus on
  one tenant.

## Panels

| ID  | Title                                | Source metric(s) |
|-----|--------------------------------------|------------------|
| 1   | Request rate by host (top 20)        | `openlen_edge_requests_total` |
| 2   | Latency p50 / p95 / p99 by route kind | `openlen_edge_request_duration_seconds_bucket` |
| 3   | Status class distribution            | `openlen_edge_requests_total{status_class=...}` |
| 4   | Proxy upstream errors / sec          | `openlen_edge_proxy_upstream_errors_total{reason=...}` |
| 5   | Domain cache hit ratio               | `openlen_edge_domain_lookup_total{result=...}` |
| 6   | Singleflight coalescing rate         | `openlen_edge_domain_singleflight_coalesced_total` |
| 7   | Cert issuance outcomes               | `openlen_edge_cert_issuance_total{result=...}` |
| 8   | Certs due for renewal                | `openlen_edge_cert_renewal_due_total` |
| 9   | Active certs                         | `openlen_edge_active_certs_total{type=...}` |
| 10  | Connection cap utilization           | `openlen_edge_handshake_inflight` |
| 11  | Proxy pool                           | `openlen_edge_proxy_pool_{idle,inflight}_connections` |
| 12  | Process — CPU / RSS / FDs           | `process_cpu_seconds_total`, `process_resident_memory_bytes`, `process_open_fds` (via `metrics-process`) |

## Notes

- Panel 10 hard-codes the connection-cap denominator as `4096` (the
  default `OPENLEN_EDGE_MAX_INFLIGHT`). If you've raised it, edit the
  PromQL on the panel to match.
- The `host` label cardinality is bounded by your project count + any
  custom domains; if a misbehaving client floods the edge with novel
  `Host:` headers you may want to add a Prometheus relabel rule that
  drops unknown hosts before they reach storage.
- Refresh defaults to 30 s. Time range defaults to last 1 h.
