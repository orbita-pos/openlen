# OpenLen edge bench harness

Compares the edge (Rust) against nginx (incumbent) under realistic traffic
shapes, so the operator can prove RPS / p99 parity before the swap. Drives
k6 at the box from the same box — no internet hop, no Cloudflare in the
path; we want the raw server delta.

## Prerequisites

- **k6** on the bench box. Install on Hetzner Ubuntu:
  ```bash
  sudo apt-get install -y gnupg
  sudo gpg -k
  sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
  echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
  sudo apt-get update
  sudo apt-get install -y k6
  ```
- **Python 3.8+** for `diff.py` (already on every Ubuntu 22.04+ box).
- A **subdomain that's actually deployed** (`/var/www/openlen/<sub>/current/index.html` exists). Default: `mirror`. Override with `OPENLEN_SUB`.
- A **verified custom domain pointing at the box's IP** for the custom-domain scenario. Default: `mybrand.com`. Override with `OPENLEN_CUSTOM_HOST`. The DNS A record must resolve to the box; for the bench loopback target you can either point DNS first OR use `--resolve` overrides via curl in a smoke check and pass the literal IP via `OPENLEN_TARGET=https://178.156.175.171:443` with the host in the script's `Host:` header — the bench scripts only set `Host:`, they don't depend on DNS.

## The four scenarios

| Script | RPS | Duration | What it exercises |
|---|---|---|---|
| `k6/apex-proxy.js` | 200 | 60 s | `Host: openlen.com` → proxy to Node :3000 |
| `k6/wildcard-static.js` | 500 | 60 s | `Host: <sub>.openlen.com` → disk serve |
| `k6/custom-domain.js` | 100 | 60 s | `Host: <custom>` → lookup + disk serve |
| `k6/mixed-traffic.js` | 300 total | 60 s | 70 % wildcard + 20 % apex + 10 % custom |

The wildcard scenario is the gate that matters most — published landings are the dominant traffic class.

## Running the bench

### 1. Baseline (nginx still on :443)

```bash
cd /opt/openlen-app   # or wherever the repo lives
bash bench/run-baseline.sh
```

Writes JSON summaries to `bench/results/baseline/`.

### 2. Edge sidecar (nginx still on :443, edge on :8443)

Per the cutover runbook (`infra/edge/CUTOVER.md` step 4d), start the edge with `OPENLEN_EDGE_BIND=0.0.0.0:8443` so it doesn't fight nginx for the public ports.

```bash
bash bench/run-edge.sh
```

Writes JSON summaries to `bench/results/edge/`.

### 3. Compare and gate

```bash
python3 bench/diff.py
```

Prints a per-scenario table and applies the acceptance gates:

- **edge median RPS ≥ 95 % of nginx median RPS**
- **edge p99 latency ≤ 120 % of nginx p99 latency**
- **edge error rate ≤ nginx error rate + 0.1 pp**

Exits 0 on all-pass, 1 otherwise. Chain everything together in CI / runbook:

```bash
bash bench/run-baseline.sh && bash bench/run-edge.sh && python3 bench/diff.py
```

If `diff.py` exits non-zero, **STOP** — the cutover is not GO. Diagnose before retrying.

## Tuning

Each script honors env-var overrides:

| Var | Default | Notes |
|---|---|---|
| `OPENLEN_TARGET` | `https://127.0.0.1:443` (baseline) / `:8443` (edge) | Target URL of the listener under test |
| `OPENLEN_HOST` | `openlen.com` | Apex Host header for apex / mixed |
| `OPENLEN_SUB` | `mirror` | Subdomain label; full host is `<sub>.openlen.com` |
| `OPENLEN_CUSTOM_HOST` | `mybrand.com` | Verified custom domain |
| `RPS` | per-script | Override the rate for a single-scenario run |
| `DURATION` | `60s` | Per scenario |
| `TOTAL_RPS` | `300` | Mixed-traffic total (split 70/20/10) |

For a quick smoke against a single scenario (e.g. while debugging):

```bash
k6 run --insecure-skip-tls-verify -e OPENLEN_TARGET=https://127.0.0.1:8443 -e OPENLEN_SUB=mirror bench/k6/wildcard-static.js
```

## Why not run from the laptop?

A laptop bench over the open internet adds round-trip variance (Cloudflare, ISP route, the box's NIC queue) that overwhelms the ~5 % delta we're actually measuring. Run on the box and you measure the listener.

## Results dir is gitignored

`bench/results/` is excluded from version control — JSON dumps go in there and don't need to be reviewed. Commit the scripts, share the numbers via the cutover Slack thread.
