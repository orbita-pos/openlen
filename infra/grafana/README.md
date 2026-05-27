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

## Alert rules (F2 S7)

`openlen-edge-alerts.yaml` is a Prometheus rule file covering the
F2 S7 soak window's automated gates — error rate, p99 latency, cert
renewal-due, cert issuance failures, proxy upstream errors, and
handshake cap saturation.

### Loading the rules

Add the rule file to Prometheus' `rule_files:` block:

```yaml
# /etc/prometheus/prometheus.yml
rule_files:
  - /etc/prometheus/rules/openlen-edge-alerts.yaml

scrape_configs:
  - job_name: openlen-edge
    scrape_interval: 15s
    metrics_path: /metrics
    static_configs:
      - targets: ["127.0.0.1:9090"]
        labels:
          service: openlen-edge
```

Copy / symlink the file to that path, then reload Prometheus without
restart:

```bash
sudo install -d /etc/prometheus/rules
sudo install -m 0644 infra/grafana/openlen-edge-alerts.yaml \
                     /etc/prometheus/rules/openlen-edge-alerts.yaml
curl -X POST http://127.0.0.1:9090/-/reload
```

Verify the rules loaded:

```bash
curl -s http://127.0.0.1:9090/api/v1/rules | jq '.data.groups[] | select(.name=="openlen-edge.health")'
```

### Tuning

Every alert thresholds was chosen for the first 7 days of soak — strict
enough to catch a regression, loose enough to skip the noise floor of
a healthy steady state. Re-tune AFTER you have baseline data:

- `EdgeHighLatency` p99 > 1s is conservative. Once you have a week of
  bench-baseline p99 you can probably drop this to 250-500 ms.
- `EdgeProxyUpstreamErrors` > 1/s should drop to 0.1/s once you confirm
  Node is steady.
- `EdgeHandshakeCapApproaching` is harmless until traffic doubles —
  silence it if you raise `OPENLEN_EDGE_MAX_INFLIGHT`.
