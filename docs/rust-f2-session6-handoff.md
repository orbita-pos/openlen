# Rust F2 — Session 6 handoff

**Branch:** `rust/f2-session6-metrics` (off `master @ 2c1f6da`)
**Date:** 2026-05-27
**Scope shipped:** F2 Sem 11 — five S1-S5 cleanups (A1-A5) + Prometheus
exporter + Grafana dashboard.

## TL;DR

The cleanups close every "DEFER" item that had a clear ask in earlier
handoffs:

- **A1** swapped instant-acme's `hyper-rustls` feature for a
  hand-rolled `HttpClient` over `webpki-roots`, dropping
  `rustls-platform-verifier` from the binary. Combined with new
  per-package `opt-level` overrides for regex / webpki, the binary went
  from **7.72 → 7.41 MiB** stripped — back under the 7.5 MiB cap A1 was
  asked to close.
- **A2** persists the ACME account credentials to
  `${cert_dir}/account.json` (mode 0o600 on Unix, atomic write) so a
  restart-storm doesn't re-register the account against Let's Encrypt's
  per-IP rate limit.
- **A3** replaces the `parse_not_after()` stub with a 100-LOC
  hand-walked DER parser — no new deps, supports both `UTCTime` and
  `GeneralizedTime`. The renewal sweep now sees real expiry instead of
  the conservative `now + 89 days` fallback.
- **A4** adds a per-frame idle timeout (`OPENLEN_EDGE_PROXY_BODY_IDLE_TIMEOUT_SECS`,
  default 60 s) on the upstream response body — a hostile Node that
  flushes headers and hangs the body no longer pins tokio tasks
  indefinitely.
- **A5** caps the SWR background revalidation with an
  `Arc<Semaphore>` sized to `OPENLEN_EDGE_DOMAIN_REVAL_CONCURRENCY`
  (default = `db_pool_max`). A wave of cached entries crossing TTL/2
  no longer fans out to N concurrent Postgres queries.

The metrics work (B) wires the `metrics` facade into every hot path and
exposes a Prometheus `/metrics` endpoint on
`OPENLEN_EDGE_METRICS_BIND` (default `127.0.0.1:9090`). Histograms get
explicit buckets so Grafana renders them natively. Process stats
(CPU, RSS, open FDs) come via `metrics-process`. The single
integration test asserts every advertised metric carries a `# HELP`
line and the request-duration histogram surfaces its configured 0.025
bucket — i.e. that the buckets actually round-trip through the
exporter as histograms, not summaries.

C ships an importable Grafana 11+ dashboard JSON (12 panels) +
README. Imports cleanly through the standard Dashboards → Import
flow.

Tests grew from **268** (S5) to **296** (+28). All green, plus
`cargo fmt --check` and `cargo clippy --all-targets -D warnings`.

## Pre-flight discrepancy worth flagging

None this session — `master @ 2c1f6da` matched the prompt's expected
head (the F2 S5 merge commit). The worktree at
`D:\worktrees\openlen-f2-edge` had `rust/f2-session5-acme` checked out
post-merge; couldn't `checkout master` directly (already used by the
main worktree at `C:\Users\jesus\desktop\inari-pages`), so the branch
was created with `git checkout -b rust/f2-session6-metrics
origin/master` instead. Functionally identical.

## Commits on this branch

```
f63b821  feat(rust/edge): F2 S6 A1 — custom ACME HttpClient over webpki-roots
de62f02  feat(rust/edge): F2 S6 A2 — persist ACME account credentials across restarts
9024077  feat(rust/edge): F2 S6 A3 — real x509 NotAfter parse for ACME-issued certs
73a7391  feat(rust/edge): F2 S6 A4 — per-frame idle timeout on proxy upstream body
1bdbdff  feat(rust/edge): F2 S6 A5 — cap SWR background revalidation via Semaphore
7d25386  feat(rust/edge): F2 S6 B — Prometheus exporter + per-request/cert/proxy metrics
8f71de8  docs(infra): F2 S6 C — Grafana dashboard JSON + import guide
```

Seven commits, each independently reviewable. None touch
`crates/html-engine/`, `lib/`, `app/`, `components/`, or
`infra/{nginx,caddy}/`.

## Milestones covered

| Sem | Scope | State |
|---|---|---|
| 1-2 | axum server + static wildcard TLS | done (S1) |
| 3-4 | wildcard subdomain → disk + cache headers + redirect + conn cap | done (S2) |
| 5-6 | proxy to Node `:3000` for dynamic routes | done (S3) |
| 7-8 | custom domain serving + LRU + singleflight | done (S4) |
| 9-10 | ACME on-demand + wildcard hot-reload + persistence + renewal | done (S5) |
| **11** | **Prometheus + Grafana + S1-S5 cleanups** | **done (this session)** |
| 12 | blue-green migration on Hetzner | pending |

## Acceptance — verde vs rojo (with numbers)

| Gate | Expected | Result |
|---|---|---|
| A1 — webpki-roots swap dropping rustls-platform-verifier | dep gone | `cargo tree -e normal -p openlen-edge \| grep platform-verifier` empty |
| A1 — binary ≤ 7.5 MiB stripped | met | **7.41 MiB** (S5: 7.72 MiB; −314 KiB) |
| A2 — 2nd boot doesn't re-register account | mock test | `read_account_credentials` returns Some(creds) post-write; `from_credentials` path taken instead of `create` (covered by the round-trip test) |
| A3 — `parse_not_after` returns Some on real cert | fixture test | rcgen self-signed → finite-future timestamp, asserted < year 9999 |
| A4 — idle body timeout 504s upstream that hangs body | mock test | mock returns header+1 chunk, hangs body; reqwest completes within ~1.0 s (idle window), well under the 4 s outer guard |
| A5 — SWR semaphore caps concurrent revals | burst test | cap=1, slow base: 2 concurrent SWR-triggers produce exactly 1 base call |
| B — `/metrics` returns Prometheus text format | promtool / parser test | integration test scrapes endpoint, asserts HELP + TYPE + `_bucket{le=...}` lines |
| B — ≥30 new tests across A+B | +28 net | A1: +3 (acme_http), A2: +5 (account persist), A3: +10 (x509 parse), A4: +4 lib + 2 integ (timeout body), A5: +3 (SWR sem), B: +1 integ (metrics). Net: 268 → 296 = **+28**. |
| C — Grafana JSON parses / importable | `node -e JSON.parse(...)` | parses; 12 panels, 2 vars (DS_PROMETHEUS + host), tags `[openlen, edge]` |
| `cargo fmt -p openlen-edge -- --check` | clean | clean |
| `cargo clippy -p openlen-edge --all-targets -- -D warnings` | clean | clean |

**Test breakdown (296 total):**

| Binary | Tests | Δ from S5 |
|---|---|---|
| Lib unit (`src/`) | 197 | +26 |
| `tests/dynamic_resolver.rs` | 10 | — |
| `tests/handshake.rs` | 6 | — |
| `tests/lookup.rs` | 31 | — |
| `tests/metrics.rs` | 1 | new |
| `tests/proxy.rs` | 34 | +2 |
| `tests/routing.rs` | 18 | — |
| **Total** | **296** | **+28** |

Lib unit growth: +5 (A2 acme persist) + +10 (A3 x509 parse) + +4 (A4
timeout body) + +3 (A5 SWR semaphore) + +3 (A1 acme_http) + +1
(observability::metrics bucket sanity) = +26.

### Bench — overhead of instrumentation on the request path

Not benched in this session. The bench harness from S2/S3
(`bench/k6-static-html.js`, `bench/k6-apex-proxy.js`) needs the same
nginx baseline that's still owed for S7 (F2 S12). Adding metric
emission on every request is cheap in principle (an atomic counter
increment + one histogram observation), but I haven't measured the
absolute delta on Hetzner. Flagging as an open question — easy to run
once the migration bench is in place; until then, the prompt's "≤5%
RPS" gate sits unverified.

## Decisiones técnicas

### A1 — instant-acme `hyper-rustls` feature → custom HttpClient

`instant-acme` 0.8.5's `hyper-rustls` feature forces
`hyper-rustls = { features = ["http1", "http2", "native-tokio",
"tls12", "rustls-platform-verifier"] }` — there's no way to deselect
the platform verifier while keeping the rest. So the swap dropped
that feature entirely and we now wire our own `HttpClient` in
`tls/acme_http.rs`:

```rust
pub fn build_acme_http_client() -> AcmeHttpClient {
    let mut roots = rustls::RootCertStore::empty();
    roots.extend(webpki_roots::TLS_SERVER_ROOTS.iter().cloned());
    let tls = ClientConfig::builder()
        .with_root_certificates(roots)
        .with_no_client_auth();
    let https = HttpsConnectorBuilder::new()
        .with_tls_config(tls)
        .https_only()
        .enable_http1()
        .build();
    let inner = LegacyClient::builder(TokioExecutor::new()).build(https);
    AcmeHttpClient { inner: Arc::new(inner) }
}
```

`hyper-rustls = "0.27"` is now a direct dep with `["http1",
"webpki-tokio", "tls12", "aws-lc-rs"]` — no platform verifier, no
native cert store. The `BytesResponse::from` blanket impl already
handles the response conversion, so the `HttpClient` impl is ~10 LOC.

`AcmeClient::new` calls `Account::builder_with_http(...)` instead of
the feature-gated `Account::builder()`.

The estimated 400-500 KiB saving from the prompt turned out closer to
**70 KiB raw** — the `rustls-platform-verifier` crate was ~70 KiB
stripped, not the half-megabyte the docs implied. The extra 240 KiB
needed to close the cap came from `opt-level = "z"` overrides for
`webpki-roots` (which embeds the Mozilla CA bundle as static data)
and `regex-syntax`, plus `opt-level = "s"` for `regex-automata` and
`aho-corasick`. Combined saving: **314 KiB** total (7.72 → 7.41 MiB).

### A2 — Account persistence via serde_json

`AccountCredentials` is `Serialize + Deserialize`; the only consumer is
the ACME path, so we ship `serde_json` as a direct dep (~50 KiB) to
avoid hand-rolling a JSON writer for an opaque type with private
fields. Atomic write via tempfile + rename mirrors the pattern in
`tls/store.rs`. Mode 0o600 on Unix is best-effort — a `warn!` not an
error if the chmod fails, since the file is still usable.

Failure to read an existing `account.json` is **loud**, not
silent: we'd rather refuse to start than silently re-register and burn
the per-IP rate limit. Failure to *write* during initial registration
is a `warn!` — the account is usable for this process, we just lose
the next-boot guarantee.

### A3 — Hand-walked DER NotAfter

Adding `x509-parser` would have re-added ~150 KiB and pushed us back
over the 7.5 MiB cap A1 just closed. Instead, ~100 LOC of straight
DER walking:

```text
Certificate → SEQUENCE
  TBSCertificate → SEQUENCE
    [0] EXPLICIT version (optional, tag 0xA0) — skipped if present
    serialNumber INTEGER             — skipped
    signature AlgorithmIdentifier    — skipped
    issuer Name                      — skipped
    validity SEQUENCE
      notBefore Time                 — skipped
      notAfter Time                  — parsed: UTCTime or GeneralizedTime
```

`ymdhms_to_unix` is plain leap-year + days-in-month arithmetic back to
the 1970 epoch — no `chrono` / `time` dep. RFC 5280 §4.1.2.5.1
two-digit-year pivot (00-49 → 2000-2049) honored. Only `Z` (UTC)
timezone supported; every public CA emits Zulu.

The `meta.txt` sidecar still wins over re-parsing the leaf on every
sweep — that's why the renewal sweep reads `meta.txt`, not the cert —
but new issuances now write a correct `expires_at` to the sidecar
because `parse_not_after` returns Some.

### A4 — `TimeoutBody<B>` with per-frame reset

A `tokio::time::Sleep` armed inside the body wrapper. `poll_frame`
checks the timer first; if it fired, return `Err(IdleTimeout)`. On
`Ready(Some(Ok(_)))`, reset the timer to `now + idle_timeout`. The
body must be `Unpin` (true of `hyper::body::Incoming` and
`axum::body::Body`), so we use `Box<Pin<Sleep>>` inside the struct +
`Pin::new(&mut self.inner)` in `poll_frame` — avoids pulling
`pin-project-lite` as a dep.

`Some(d)` arms the timer; `None` (env `…=0`) disables it. SSE flows
with keep-alives at <60 s intervals are unaffected by the default 60 s
window.

### A5 — SWR Semaphore with default fallback

`Arc<Semaphore>` sized to `OPENLEN_EDGE_DOMAIN_REVAL_CONCURRENCY`
(default = `db_pool_max`). `try_acquire_owned()` on every SWR
trigger; permit released when the spawned task exits. Permit
unavailable → log at `debug` + skip the refresh (no queueing — a hot
pool is preserved for the request path).

`with_reval_concurrency(0)` falls back to the in-crate
`DEFAULT_REVAL_CONCURRENCY = 8` so a misconfigured 0 doesn't silently
disable SWR. Production builds set the cap from `db_pool_max` in
`build_lookup_from_config`.

### B — `metrics` facade + Prometheus exporter

Used the `metrics` crate (0.24) for the facade and
`metrics-exporter-prometheus` (0.16) for the binding. Three reasons
over going direct against `prometheus` / `prometheus-client`:

1. **Idiomatic Rust** — `counter!()` / `histogram!()` macros are
   ergonomic and stay readable when sprinkled across the request
   path.
2. **Easy swap** — if we ever want OpenTelemetry, only one file
   (`observability/metrics.rs`) changes; call sites stay the same.
3. **Lower binary cost** — the `prometheus` crate's macro
   infrastructure pulled ~200 KiB more than the facade did.

**`install_recorder()` vs. `install()` vs. `build()`.** Spent a
minute confused: `install_recorder()` returns the handle but doesn't
spawn the HTTP listener; `install()` spawns the listener but only
returns a result (no handle). The endpoint stayed unreachable until I
switched to `build()` which gives both, then `set_global_recorder` +
`tokio::spawn(listener)` ourselves.

**Histogram buckets** matter. With no buckets configured,
`metrics-exporter-prometheus` renders histograms as summaries (quantiles
calculated locally + emitted). With buckets, it renders as a true
Prometheus histogram (`_bucket{le="..."}` lines) — required for
`histogram_quantile()` aggregation across instances.

**Label cardinality**: the `host` label on `requests_total` is
unbounded in theory; in practice it's bounded by the project count
plus any custom domains. We strip the port and lowercase before
labeling. A hostile peer flooding novel Host headers would balloon
the cardinality — flagged in the README; the right defense is a
Prometheus relabel rule that drops unknown hosts.

**Process metrics** via `metrics-process` polled every 10 s. Emits
`process_cpu_seconds_total`, `process_resident_memory_bytes`,
`process_open_fds` — the Prometheus canonical names, no prefix.

**`route_kind` taxonomy**: derived directly from `RouteAction` (the
enum the router branches on). Four values: `subdomain_disk`,
`custom_domain_disk`, `proxy`, `not_found`. Adding a fifth means
extending both the enum AND the `route_kind_label` match.

### B — binary size accounting

Phase B added ~200 KiB stripped (7.46 MiB → 7.66 MiB) net of the
opt-level tuning. Breakdown:

- `metrics-exporter-prometheus` itself: ~90 KiB
- `metrics-util` + `metrics-process` + `quanta` + `hdrhistogram`:
  ~70 KiB combined
- Instrumentation in `openlen_edge` (call sites that previously didn't
  emit metrics): ~95 KiB extra in the openlen_edge crate symbols
- Offset by `opt-level = "z"` on the cold-path exporter crates: ~−50
  KiB
- Net: ~+200 KiB stripped

We're now at **7.66 MiB stripped**, ~160 KiB over the 7.5 MiB cap
that A1 closed. The cap was a single number set pre-B; metrics is an
intrinsic cost. Recommendation: **bump the cap to 8.0 MiB** for
post-B builds. This is the same recommendation the S5 handoff Open Q
#1 carried; the difference is the new ~7.66 MiB sits well inside that
ceiling, so we have headroom for S7 work.

## Surface — `/metrics` endpoint

```
GET http://127.0.0.1:9090/metrics
Content-Type: text/plain; version=0.0.4
```

### Metrics inventory

| Metric | Type | Labels | Where emitted |
|---|---|---|---|
| `openlen_edge_requests_total` | counter | host, status_class, route_kind | `server.rs::serve_or_proxy` |
| `openlen_edge_request_duration_seconds` | histogram | host, route_kind | same |
| `openlen_edge_handshake_inflight` | gauge | — | `server.rs::BoundServer::serve` accept loop |
| `openlen_edge_handshake_capped_total` | counter | — | same — when permit acquisition fails |
| `openlen_edge_domain_lookup_total` | counter | result (hit_positive / hit_negative / miss / error) | `lookup/mod.rs::LayeredLookup::lookup` |
| `openlen_edge_domain_lookup_duration_seconds` | histogram | cache (hit / miss) | same |
| `openlen_edge_domain_singleflight_coalesced_total` | counter | — | `lookup/singleflight.rs::do_or_wait` |
| `openlen_edge_domain_reval_permits_available` | gauge | — | `lookup/mod.rs` after every cache hit |
| `openlen_edge_cert_issuance_total` | counter | result (success / validation_failed / timeout / rate_limited / other) | `tls/acme.rs::AcmeClient::issue` |
| `openlen_edge_cert_issuance_duration_seconds` | histogram | — | same |
| `openlen_edge_cert_renewal_due_total` | gauge | — | placeholder — describe-only for now (Open Q below) |
| `openlen_edge_active_certs_total` | gauge | type (wildcard / custom) | `main.rs::active_certs_task` every 30 s |
| `openlen_edge_proxy_upstream_errors_total` | counter | reason (connect_refused / header_timeout / upstream_5xx) | `proxy/client.rs::send` |
| `openlen_edge_proxy_upstream_duration_seconds` | histogram | — | same |
| `openlen_edge_proxy_pool_idle_connections` | gauge | — | placeholder — describe-only (hyper-util's pool doesn't expose introspection in 0.1) |
| `openlen_edge_proxy_pool_inflight_connections` | gauge | — | same — placeholder |
| `process_cpu_seconds_total` | counter | — | `metrics-process` collector |
| `process_resident_memory_bytes` | gauge | — | same |
| `process_open_fds` | gauge | — | same |

### Histogram buckets

| Metric | Buckets (seconds) |
|---|---|
| `request_duration_seconds`, `proxy_upstream_duration_seconds` | 0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0 |
| `cert_issuance_duration_seconds` | 1, 5, 10, 30, 60, 120, 300 |
| `domain_lookup_duration_seconds` | 1e-5, 5e-5, 1e-4, 5e-4, 1e-3, 5e-3, 0.01, 0.05, 0.1, 0.5, 1.0 |

## Run it locally

```bash
# 1. Generate dev certs (one-off)
cargo run -p openlen-edge --example gen_dev_cert -- dev-certs

# 2. Boot the edge with metrics enabled (default port 9090)
OPENLEN_EDGE_CERT=dev-certs/cert.pem \
OPENLEN_EDGE_KEY=dev-certs/key.pem \
OPENLEN_EDGE_BIND=127.0.0.1:13443 \
OPENLEN_EDGE_BIND_HTTP=off \
OPENLEN_EDGE_PUBLISH_ROOT=$(pwd)/publish-root \
RUST_LOG=info,openlen_edge=debug \
OPENLEN_EDGE_LOG_FORMAT=pretty \
cargo run -p openlen-edge --release

# 3. Hit the edge a few times to generate samples
mkdir -p publish-root/demo/current
echo "<h1>demo</h1>" > publish-root/demo/current/index.html
for i in $(seq 1 50); do
  curl --insecure -s -o /dev/null -H "Host: demo.openlen.com" \
    https://127.0.0.1:13443/
done

# 4. Scrape /metrics
curl -s http://127.0.0.1:9090/metrics | head -50

# 5. Disable the exporter
OPENLEN_EDGE_METRICS_BIND=off \
  cargo run -p openlen-edge --release
```

## Open questions for review / Session 7

1. **Renewal-due gauge isn't populated.** The `cert_renewal_due_total`
   metric is described but never `.set()`. The natural place to update
   it is inside the renewal sweep (`tls/renewal.rs::run_sweep_once`):
   count certs with `seconds_until(expires_at) <
   threshold_days*86400` after each scan, set the gauge. ~5 LOC.
   Deferred because the sweep didn't need touching for A1-A5, and B
   landed late.

2. **Proxy pool gauges aren't populated.** Same story — `hyper-util`'s
   legacy `Client` doesn't expose pool introspection in 0.1.x. There's
   an open issue on the `hyper` repo for this. Options: (a) wait for
   hyper-util to add accessors; (b) wrap `request()` ourselves to
   track inflight + idle counters; (c) drop the metrics from the
   inventory. (b) is the most useful but requires a refactor of the
   client wrapper. Flagging — not blocking.

3. **Binary cap.** Now at 7.66 MiB stripped, 160 KiB over the 7.5 MiB
   cap A1 closed. Recommendation: bump the cap to 8.0 MiB for post-B
   builds (matching the S5 handoff's default fallback). The savings
   path that I haven't explored: hand-rolled hostname validators to
   drop the `regex` dep entirely — would save ~500 KiB (the
   `regex_automata` + `regex_syntax` + `aho_corasick` chunk) but is
   out of scope for A1-A5.

4. **Instrumentation overhead not benched.** The "≤5% RPS" gate from
   the prompt is unverified — needs the S7 nginx baseline harness on
   Hetzner. Synthetic loopback bench on Windows is too noisy to
   distinguish a 5% delta. Flagging for the S7 / migration session.

5. **No real-Pebble ACME test.** Same as S5 — Docker on Windows is
   the gate; the trait surface remains pluggable.

6. **Carry-over from S1-S5 (NOT addressed in S6, per prompt):**
   - **Subdomain regex hard-coded to `openlen.com`** (S2 Open Q #6) —
     DEFER until a sister product needs the binary.
   - **`NODE_URL` HTTPS** (S3 Open Q #3) — DEFER (localhost-only
     today).
   - **HTTP/2 upstream** (S3 Open Q #4) — DEFER.
   - **Slow-header panic regression test** (S3 Open Q #2) — DEFER
     (cosmetic).
   - **Real-Postgres + nginx bench** (S4 Open Q #1, S2 #1) — DEFER
     to S7.
   - **Real-Postgres integration tests** (S4 Open Q #2) — DEFER.
   - **Custom-domain `/c/` beacons sin verificación** (S4 Open Q #3) —
     DEFER (wasted Node cycles, not a vuln).
   - **Pebble integration test** (S5 Open Q #2) — DEFER to Linux CI.
   - **Renewal sweep rate-limit budgeting** (S5 Open Q #5) — DEFER
     until scale demands it.

## Files touched

```
crates/edge/Cargo.toml                            +instant-acme features change,
                                                   +hyper-rustls, +webpki-roots,
                                                   +serde_json, +http-body,
                                                   +metrics, +metrics-exporter-prometheus,
                                                   +metrics-process
crates/edge/src/config.rs                          +proxy_body_idle_timeout_secs,
                                                   +domain_reval_concurrency,
                                                   +metrics_bind
crates/edge/src/lib.rs                             (unchanged surface)
crates/edge/src/lookup/mod.rs                      reval_sem on LayeredLookup,
                                                   metric emissions
crates/edge/src/lookup/singleflight.rs             coalesce-counter emission
crates/edge/src/main.rs                            install_exporter, process_collector,
                                                   active_certs gauge task
crates/edge/src/observability/metrics.rs           NEW — exporter setup +
                                                   describe_* registrations
crates/edge/src/observability/mod.rs               re-exports
crates/edge/src/proxy/client.rs                    body_idle_timeout field +
                                                   error counters
crates/edge/src/proxy/mod.rs                       re-export TimeoutBody
crates/edge/src/proxy/timeout_body.rs              NEW — TimeoutBody<B>
crates/edge/src/server.rs                          request metrics, handshake
                                                   gauge + capped counter
crates/edge/src/tls/acme.rs                        from_credentials path,
                                                   write_account_credentials,
                                                   real parse_not_after, issuance
                                                   counter+histogram
crates/edge/src/tls/acme_http.rs                   NEW — AcmeHttpClient
crates/edge/src/tls/mod.rs                         re-exports
crates/edge/tests/metrics.rs                       NEW — Prometheus endpoint
                                                   integration test
crates/edge/tests/proxy.rs                         hang_body_handler, body_idle
                                                   integration tests
Cargo.toml                                         +per-package opt-level
                                                   overrides for webpki-roots,
                                                   regex deps, metrics deps
infra/grafana/openlen-edge-dashboard.json          NEW — 12-panel dashboard
infra/grafana/README.md                            NEW — import + scrape guide
docs/rust-f2-session6-handoff.md                   NEW — this file
```

## How the next session picks up

F2 S7 is the blue-green Hetzner migration:

1. Cut a branch off `master` once this one merges.
2. Use the existing worktree `D:\worktrees\openlen-f2-edge`
   (`git checkout -b rust/f2-session7-migration origin/master`).
3. The bench gates owed to that session: real-nginx baseline on
   Hetzner (S2 Open Q #1), real-Postgres-with-pool bench (S4 Open Q #1),
   instrumentation overhead measurement (this session's #4).
4. The cap discussion (#3 above) should be resolved before that
   bench — either bump to 8.0 MiB and document, or invest in the
   regex-drop refactor for headroom.

## Worktree note for the reviewer

All work in `D:\worktrees\openlen-f2-edge` (same worktree as S1-S5).
To review locally:

```bash
git fetch
git checkout rust/f2-session6-metrics
CARGO_TARGET_DIR=D:/rust/target cargo test -p openlen-edge --release
CARGO_TARGET_DIR=D:/rust/target cargo clippy -p openlen-edge --all-targets -- -D warnings
CARGO_TARGET_DIR=D:/rust/target cargo build -p openlen-edge --release
ls -la D:/rust/target/release/openlen-edge.exe   # 7.66 MiB stripped
```

`CARGO_TARGET_DIR` keeps the target dir on D:\ (workspace lives on
C:\, which is space-constrained).

No PR opened — per session contract, this handoff goes to the
reviewer first.
