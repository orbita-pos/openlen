# openlen-edge

Rust edge proxy that fronts OpenLen. Replaces the current `nginx + Caddy + Node /served/[host]` chain with a single binary that:

1. Terminates TLS on `:443` — wildcard cert for `openlen.com` + `*.openlen.com` (loaded from PEM) plus per-host ACME for custom domains (later).
2. Resolves the requested host to a published-project directory and serves `index.html` straight from disk.
3. Proxies non-static routes (`/api/*`, auth, dashboard) to the Next.js standalone server on `:3000`.

## Why a separate crate

Today `*.openlen.com` is fast (nginx → disk, ~5 ms p99) but custom domains hop through the Node app (`80–150 ms p99`). Folding both code paths into one Rust binary fixes the asymmetry and removes the Caddy lookup round-trip.

## Status

| Session | Scope | State |
|---|---|---|
| F2 S1 | axum bootstrap + static-wildcard TLS on `:3443` | done |
| F2 S2 (this) | wildcard subdomain → disk + cache headers + HTTP→HTTPS + conn cap | done |
| F2 S3 | proxy to Node `:3000` for dynamic routes | pending |
| F2 S4 | custom domain serving + LRU + singleflight | pending |
| F2 S5 | ACME on-demand (`instant-acme`) | pending |
| F2 S6 | Prometheus + Grafana | pending |
| F2 S7 | Blue-green migration on Hetzner | pending |

## Run it locally

```bash
# Generate a self-signed dev cert (one-off — re-run if you delete dev-certs/)
cargo run -p openlen-edge --example gen-dev-cert -- dev-certs

# Boot the edge on https://localhost:3443
OPENLEN_EDGE_CERT=dev-certs/cert.pem \
OPENLEN_EDGE_KEY=dev-certs/key.pem \
OPENLEN_EDGE_BIND=127.0.0.1:3443 \
RUST_LOG=info,openlen_edge=debug \
cargo run -p openlen-edge --release

# In another shell
curl --insecure https://localhost:3443/
```

The dev cert is self-signed so `curl` needs `--insecure` (or `--cacert dev-certs/cert.pem`). Production loads the real wildcard from `/etc/letsencrypt/live/openlen.com/`.

## Environment variables

| Var | Default | Purpose |
|---|---|---|
| `OPENLEN_EDGE_BIND` | `0.0.0.0:443` | TLS listener address |
| `OPENLEN_EDGE_BIND_HTTP` | `0.0.0.0:80` (set `off` to disable) | Plaintext HTTP listener that 301-redirects to HTTPS |
| `OPENLEN_EDGE_CERT` | `/etc/letsencrypt/live/openlen.com/fullchain.pem` | Wildcard cert chain (PEM) |
| `OPENLEN_EDGE_KEY` | `/etc/letsencrypt/live/openlen.com/privkey.pem` | Wildcard private key (PEM) |
| `OPENLEN_EDGE_PUBLISH_ROOT` | `/var/www/openlen` | Resolved as `<root>/<sub>/current/<path>` for each `*.openlen.com` request |
| `OPENLEN_EDGE_MAX_INFLIGHT` | `4096` | Semaphore cap on concurrent in-flight TLS connections; over-cap accepts are dropped |
| `RUST_LOG` | — | Standard tracing filter, e.g. `info,openlen_edge=debug` |

Future sessions add `DATABASE_URL`, `OPENLEN_EDGE_UPSTREAM`, `OPENLEN_EDGE_ACME_DIR`, etc.

## Not in this crate

- The HTML engine (`crates/html-engine`) — separate concern, no link-time dep here.
- nginx / Caddy configs in `infra/` — those stay until the blue-green migration (Session 7).
- Anything Vercel-shaped. OpenLen self-hosts; see `infra/scripts/deploy.sh`.
