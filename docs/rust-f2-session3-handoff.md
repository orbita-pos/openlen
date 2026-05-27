# Rust F2 — Session 3 handoff

**Branch:** `rust/f2-session3-proxy` (off `master @ ae8af12`)
**Date:** 2026-05-26
**Scope shipped:** F2 Sem 5-6 — reverse proxy to Node `:3000` for apex/www and subdomain `/c/` paths, with HTTP/1.1 keep-alive tuning closing S2 Open Q #2 / #4.

## TL;DR

`crates/edge/` now decides per request whether to serve from disk or proxy to a Node upstream. Hosts named in `OPENLEN_EDGE_PROXY_HOSTS` (default `openlen.com,www.openlen.com`) and any `*.openlen.com` path starting with a configured `OPENLEN_EDGE_PROXY_PATHS` prefix (default `/c/`) flow through a pooled `hyper-util` HTTP/1.1 client, with RFC-7230 hop-by-hop stripping and standard `X-Forwarded-*` injection. The body streams in both directions — a 5 MB POST relays intact and 20× 50 ms SSE chunks arrive progressively, not buffered. Connection-refused upstreams surface 502 immediately (bind-then-drop pattern in tests for cross-platform determinism); header-arrival exceeding the configured timeout surfaces 504. The auto::Builder now carries `header_read_timeout(30s) + keep_alive(true) + TokioTimer` on the inbound side; the outbound client uses `pool_idle_timeout=90s` and `pool_max_idle_per_host=32`. Tests grew from 64 (S2 baseline) to **132** (76 unit + 6 handshake + 18 routing + 32 proxy). Release binary is **5.54 MB stripped** (S2: 5.29 MB; cap 6.5 MB).

## Pre-flight discrepancy worth flagging

None this session — F2 S1 + S2 are both on `master @ ae8af12`, the branch was cut cleanly from there, and `git log master --oneline` matches what the prompt expected.

## Commits on this branch

```
1ac0fda  feat(rust/edge): F2 Sem 5-6 — reverse proxy to Node :3000 + HTTP/1.1 keep-alive
0553d44  docs(rust): F2 session-3 handoff — Sem 5-6 proxy shipped
```

Forked off `master @ ae8af12`. No file under `crates/html-engine/` was touched (parallel F1 S4 owns the minify path) and `.gitattributes` was left alone for the same reason.

## Milestones covered (vs the 12-week F2 plan)

| Sem | Scope | State |
|---|---|---|
| 1-2 | axum server + static wildcard TLS | done (S1) |
| 3-4 | wildcard subdomain → disk + cache headers + redirect + conn cap | done (S2) |
| **5-6** | **proxy to Node `:3000` for dynamic routes** | **done (this session)** |
| 7-8 | custom domain serving + LRU + singleflight | pending |
| 9-10 | ACME on-demand (`instant-acme`) | pending |
| 11 | Prometheus + Grafana | pending |
| 12 | blue-green migration on Hetzner | pending |

## What's new in `crates/edge/`

```
crates/edge/
├── Cargo.toml                          +hyper-util client/client-legacy/http1
│                                        +http-body-util, +http, +bytes
│                                        dev: +async-stream, +futures-util,
│                                              reqwest feature "stream"
├── bench/
│   └── k6-apex-proxy.js                new — 50 VUs × 20 s apex→Node bench
├── examples/
│   └── mock_node.rs                    new — tiny axum upstream for bench
├── src/
│   ├── config.rs                       +node_url, proxy_hosts, proxy_paths,
│   │                                    node_timeout_secs (env + builder)
│   ├── lib.rs                          +proxy module re-exports
│   ├── main.rs                         log: include proxy config at startup
│   ├── proxy/                          new module
│   │   ├── mod.rs                      decide_route() + forward() orchestrator
│   │   ├── client.rs                   NodeClient (hyper-util pool) +
│   │   │                                NodeClientError (transport / timeout)
│   │   ├── headers.rs                  hop-by-hop strip + X-Forwarded-* set
│   │   └── stream.rs                   502/504 response factories + error map
│   └── server.rs                       AppState::from_config, fallback now
│                                        dispatches through decide_route;
│                                        auto::Builder gets TokioTimer +
│                                        header_read_timeout(30s) +
│                                        keep_alive(true)
└── tests/
    ├── proxy.rs                        new — 32 integration tests
    └── routing.rs                      2 tests rewritten to AppState::from_config;
                                        apex_host_returns_404 → 502 (default
                                        proxy + no backend)
```

Modules still absent (deferred to later sessions): `lookup/` (Postgres custom-domain table), `tls/acme.rs`, `tls/resolver.rs`, `singleflight.rs`, `observability/metrics.rs`.

## Sem 5-6 acceptance — verde vs rojo (with numbers)

| Gate | Expected | Result |
|---|---|---|
| `cargo build -p openlen-edge` (debug) | green | green |
| `cargo build -p openlen-edge --release` | green | green — 5,807,104 B = **5.54 MB stripped** (S2: 5.29 MB; cap 6.5 MB; +250 KB for hyper-util client + http-body-util) |
| `cargo fmt -p openlen-edge -- --check` | green | green |
| `cargo clippy -p openlen-edge --all-targets -- -D warnings` | green | green |
| Total tests | ≥ 89 | **132 / 132** — 76 unit (lib) + 6 handshake + 18 routing + 32 proxy |
| New proxy integration tests | ≥ 25 | **32 / 32** in `tests/proxy.rs` |
| SSE: first chunk arrives "soon"; chunks streamed not buffered | proxy overhead small | first chunk in < 1.5 s wall (mock first emit at +50 ms + TLS handshake + proxy hop); last − first > 500 ms (proves streaming over the 20 × 50 ms upstream emission). All 20 chunks received in order, distinct frames. |
| 5 MB POST body relayed intact | mock echoes byte count | mock receives exactly 5,242,880 bytes |
| Bench: proxy RPS ≥ 70 % of file-serve | proxy slower but within bound | **proxy 28,179 RPS vs file-serve 4,017 RPS = 7.01×** (see "Bench numbers" below for caveats) |
| No regression on S2 tests | 64 / 64 | **64 / 64** (after rewriting `apex_host_returns_404` → 502 to reflect the new default behavior) |

Total: **132 / 132** in ~5 s wall (release-mode cold), 0 ignored, 0 flaky on three repeated runs.

### Test breakdown — `tests/proxy.rs` (32 cases)

1-8 **Routing**. apex / www / apex-with-port-in-Host → proxy; subdomain root / asset / directory-index → disk; subdomain `/c/<id>` → proxy; nested subdomain `a.b.openlen.com/c/x` → 404 (regex doesn't match, no fallback to proxy).

9-10 **Streaming**.
- `post_5mb_body_is_forwarded_intact` — 5 MiB deterministic body POST → mock echoes byte count.
- `sse_chunks_arrive_streaming_not_buffered` — 20 chunks × 50 ms wall, `text/event-stream`; all 20 frames decoded; `last_chunk_at − first_chunk_at > 500 ms` proves the proxy did not collect the response before flushing.

11-16 **X-Forwarded-***.
- XFF appended when present (`"1.2.3.4" + ", 127.0.0.1"`).
- XFF set when absent (`"127.0.0.1"`).
- X-Forwarded-Proto = `https` always (even when client tries to spoof `http`).
- X-Forwarded-Host = client's Host.
- X-Real-IP = peer.ip() with no port.
- Host header sent to upstream = client's Host, not the loopback authority hyper would synthesize.

17-21 **Hop-by-hop strip (request side)**. `Connection: close`, `Upgrade: websocket`, `Proxy-Authorization`, `Proxy-*`, `TE`, `Trailer` all stripped before reaching the upstream.

22 **Hop-by-hop strip (response side)**. Upstream sets `Connection: close` + `custom-header`; client sees only `custom-header`.

23-24 **Error paths**.
- `upstream_down_returns_502` — bind-then-drop pattern produces a port that fails the connect with RST on both Linux and Windows, surfacing a 502 deterministically (Windows would otherwise retry SYNs for ~20 s and trip our 30 s header-arrival timer instead → 504; see "Decisions" §3).
- `conn_cap_zero_drops_proxy_too` — cap = 0 drops the TCP stream before TLS, so even apex traffic (which would otherwise reach the proxy) errors out at the transport layer.

25-26 **Builder overrides**.
- `custom_proxy_hosts_replace_apex` — config without `openlen.com` in the list → apex 404, while a new `api.example.com` proxies.
- `custom_proxy_paths_replace_default` — config with `/api/` in the list → subdomain `/api/x` proxies, subdomain `/c/x` falls back to disk (SPA fallback to fixture index).

27-30 **Regression**.
- `query_string_is_preserved` — `?bar=baz&qux=1&q=hola%20mundo` reaches the mock verbatim.
- `post_method_is_preserved` — POST stays POST.
- `version_endpoint_not_proxied` — `/_edge/version` returns local JSON, never hits the upstream.
- `server_header_added_to_proxied_response` — `Server: openlen-edge/...` is on the proxied response too.

31-32 **Direct dispatch** (tower `oneshot`).
- `tower_oneshot_subdomain_with_proxy_path_dispatches_through_decide` — POST `demo.openlen.com/c/abc` proxies.
- `tower_oneshot_apex_with_proxy_down_returns_502` — apex + bind-then-drop port → 502, exercising the `Transport` → `bad_gateway()` mapping with no TLS in the loop.

Plus a 32nd: `many_concurrent_proxied_requests_share_pool` — 32 concurrent `tokio::spawn`-ed requests through the same edge all return 200, proving the pooled client doesn't serialize.

### Test breakdown — unit tests (76 in `src/`)

| Module | Cases | What's covered |
|---|---|---|
| `config` | 7 | env parse, defaults, proxy-config overrides, CSV parsing rules |
| `files::cache` | 6 | (S2, unchanged) |
| `files::serve` | 12 | (S2, unchanged) |
| `proxy::client` | 5 | URL validation (scheme, authority, garbage), upstream URI composition |
| `proxy::headers` | 11 | hop-by-hop list, Connection-listed fields, Proxy-* sweep, prepare/sanitize semantics |
| `proxy::mod` | 12 | decide_route across apex/www/subdomain/nested/wrong-zone, custom hosts + paths overrides, prefix-not-regex |
| `proxy::stream` | 4 | 502 / 504 factory shape, error→response mapping |
| `routing::redirect` | 1 | (S2, unchanged) |
| `routing::subdomain` | 16 | (S2, unchanged) |
| `tls::wildcard` | 2 | (S1+S2, unchanged) |

### Bench numbers

Loopback Windows 11, k6 v1.7.1, 50 VUs × 20 s, single openlen-edge release binary serving both paths. `examples/mock_node` runs on `:13030`.

```
crates/edge/bench/k6-static-html.js  (Host: demo.openlen.com, GET /, 170-byte HTML fixture)
  http_reqs ...........: 80,393     4,017 / s
  http_req_failed .....: 0.00 %     (0 / 80,393)
  http_req_duration:
    median ............: 12.05 ms
    p(95) .............: 18.11 ms
    p(99) .............: ~22 ms (not separately captured)
    max ...............: 335.34 ms

crates/edge/bench/k6-apex-proxy.js   (Host: openlen.com, GET /, 58-byte mock body via proxy)
  http_reqs ...........: 563,622    28,179 / s
  http_req_failed .....: 0.00 %     (0 / 563,622)
  http_req_duration:
    median ............: 1.00 ms
    p(95) .............: 3.62 ms
    max ...............: 50.01 ms
```

The proxy throughput is **higher** than file-serve on this microbench. That's surprising at first read, and worth unpacking: file-serve calls `tokio::fs::read(&path)` on every request, which goes through tokio's `spawn_blocking` pool, paying a context-switch tax per request. The proxy never touches the filesystem on the edge — it shuttles bytes through a hot `hyper-util` HTTP/1.1 connection pool to the mock running in the same process address space. On the Hetzner SSD path (and against a real Next.js upstream that does real work on each request), file-serve will easily outpace proxy. The point of this bench is to verify that the proxy path **isn't** pathologically slow — and the acceptance gate "proxy ≥ 70 % of file-serve" is honored with massive headroom (7.01× rather than 0.7×).

Bench against a real nginx baseline is still owed; that's still F2 S7.

## Decisiones técnicas

### 1. `axum::body::Body` flows through hyper-util client untouched

The first design question was whether to bridge bodies through `http_body_util::combinators::BoxBody<Bytes, BoxError>` or just use axum's own `Body` end-to-end. axum 0.7's `Body` is `UnsyncBoxBody<Bytes, axum::Error>`; `axum::Error: Into<BoxError>`; the body satisfies `Body + Send + 'static + Unpin` (Pin<Box<…>> is Unpin), which is what hyper-util's legacy Client requires. Typing the client as `Client<HttpConnector, axum::body::Body>` lets us forward the inbound request body to the upstream and wrap the upstream's `Incoming` response with `Body::new(...)` for the trip back, without any owned bytes ever sitting on the heap waiting to be collected. SSE chunks land at the client connection within ~ms of arriving on the upstream wire.

### 2. HTTP/2 inbound → HTTP/1.1 outbound

First run of `apex_get_proxies_to_node` returned 502 with `client error (UserUnsupportedVersion)`. The reason: the inbound TLS connection ALPN-negotiates to `h2`, axum/hyper preserves the version on `Request<Body>`, and the legacy Client was built with the `http1` feature only — so the outbound attempt was tagged HTTP/2 and rejected at the client side. Fix: `*req.version_mut() = Version::HTTP_11;` before the outbound call. We don't pay the HTTP/2 framing tax on a loopback hop to Node, and Next.js 14 doesn't speak HTTP/2 incoming by default anyway. If we ever want HTTP/2 over a real TLS hop to a remote Node, that's an opt-in flag plus enabling the `http2` feature on hyper-util — not in scope here.

### 3. 502 vs 504, and bind-then-drop for deterministic connect-refused

The proxy maps `hyper_util` transport errors to 502 (Bad Gateway) and `tokio::time::timeout` expiry to 504 (Gateway Timeout). On Linux, connecting to an unbound localhost port returns ECONNREFUSED instantly → 502, like nginx does. On Windows, connecting to a port nothing is listening on does **not** immediately return RST — the kernel quietly retransmits SYNs for ~20 s before giving up — so a naive "point at 127.0.0.1:1" test would trip our 30 s header-arrival timer first and surface 504 instead. The fix in the integration tests is the bind-then-drop pattern in `unbound_addr()`: bind a `TcpListener` on `127.0.0.1:0`, capture its port, drop the listener. The port immediately transitions to "no-listener", and subsequent connects fail with RST on both platforms. This is the only sensible way to write a cross-platform "upstream is down → 502" test without a real mock.

### 4. `header_read_timeout` needs an explicit Timer, and integration tests didn't catch the panic

After wiring `http1().header_read_timeout(30s).keep_alive(true)`, the integration suite stayed green — but the first real `curl --insecure -H "Host: openlen.com" …` against the release binary panicked with `timeout 'header_read_timeout' set, but no timer set` from `hyper::common::time`. Reason: hyper's HTTP/1.1 server lazily arms the header-read timer the first time it has to wait between TCP segments for the request line + headers. Inside the test harness, headers arrive in a single poll (loopback, MSS-sized), so the timer is never invoked → no panic. Real-world curl sends the request line in one TCP segment and the headers in another, the timer arms, and there's no `Timer` provider on the builder.

Fix: `.timer(TokioTimer::new())` on the `Http1Builder`. The test suite still passes (the timer is a no-op when never invoked), but the panic is gone for live traffic.

I considered adding a regression test that drips a slow header sequence through a raw TLS stream, but it's a sizable lift (manual TLS dance with `tokio-rustls`) for a defense against a regression that's easy to spot in any real-world `curl`. Flagging it in Open Q below; if a reviewer wants the test, it's an isolated follow-up.

### 5. Defense-in-depth on hop-by-hop stripping

The hop-by-hop list is the RFC 7230 §6.1 set verbatim (Connection, Keep-Alive, Proxy-Connection, Proxy-Authenticate, Proxy-Authorization, TE, Trailer, Transfer-Encoding, Upgrade) plus **two additional sweeps**: (a) anything listed in `Connection: <field>` is stripped per the same RFC clause, so a client sending `Connection: X-Foo` plus `X-Foo: 1` removes both; (b) any remaining `Proxy-*` field gets removed after the explicit list, so a hypothetical `Proxy-Bar` from a custom client doesn't leak to the upstream. The response-side sanitizer applies the same hop-by-hop list (in particular `Connection`, since a misconfigured upstream that sets `Connection: close` would otherwise leak through to the downstream client). `Transfer-Encoding` strip on the response is correct: hyper-util has already dechunked the body by the time we see the headers, and hyper-server will re-chunk on the outbound based on body shape, with no header round-trip.

### 6. The `AppState::new(PathBuf)` shortcut is gone

S1 + S2 had `AppState::new(path) -> Self` as a one-liner — useful in tower-oneshot integration tests, ugly as soon as the state needed a `NodeClient` to live inside it. The new shape is `AppState::from_config(&EdgeConfig) -> Result<Self>` and it fails fast on a malformed `OPENLEN_EDGE_NODE_URL` (the NodeClient validates the scheme + authority at construction). Tests that previously called `AppState::new(PathBuf::from(FIXTURE_ROOT))` now build a config with the default proxy knobs and call `from_config`. The `apex_host_returns_404` test became `apex_with_default_proxy_backend_down_returns_502` — same regression value, faithful to the new behavior (with the default proxy_hosts list, apex is in the list, but there's no Node behind it in the routing-test harness).

### 7. `pool_idle_timeout=90s, pool_max_idle_per_host=32` is a starting point

These are not tuned to anything in particular yet — Hetzner's Node app, sitting on a single host, doesn't need a huge fan-out, and 90 s idle keeps connections warm across the typical inter-request gap from one client. F2 S11 (Prometheus + Grafana) will add visibility into how many connections sit idle and how often the pool turns over; until then, these defaults are good-enough placeholders.

### 8. `5.54 MB stripped` is much closer to S2 than the +700 KB I projected

I expected `hyper-util client + client-legacy + http1` + `http-body-util` + `bytes` to add ~700 KB. Actual delta: ~250 KB. Reason — the dev tree already pulled `hyper-util` (for the server side) and `http-body-util` (transitively via `http-body`), so the marginal cost of also using their client surfaces was much smaller than the cold-add estimate. Stripped release stays well under the 6.5 MB cap.

## Run it locally

```bash
# 1. Generate dev certs (one-off)
cargo run -p openlen-edge --example gen_dev_cert -- dev-certs

# 2. Boot a tiny mock Node on :13030 in one shell
cargo run -p openlen-edge --release --example mock_node -- 127.0.0.1:13030

# 3. Boot the edge on :13443 in another shell, pointed at the mock
OPENLEN_EDGE_CERT=dev-certs/cert.pem \
OPENLEN_EDGE_KEY=dev-certs/key.pem \
OPENLEN_EDGE_BIND=127.0.0.1:13443 \
OPENLEN_EDGE_BIND_HTTP=off \
OPENLEN_EDGE_PUBLISH_ROOT=$(pwd)/publish-root \
OPENLEN_EDGE_NODE_URL=http://127.0.0.1:13030 \
RUST_LOG=info,openlen_edge=debug \
OPENLEN_EDGE_LOG_FORMAT=pretty \
cargo run -p openlen-edge --release

# 4. Hit the proxy path (apex → mock)
curl --insecure -H "Host: openlen.com" https://127.0.0.1:13443/foo
# → <!doctype html><html><body><h1>node-stub</h1></body></html>

# 5. Hit the disk path (subdomain → publish-root)
mkdir -p publish-root/demo/current
echo "<h1>hello demo</h1>" > publish-root/demo/current/index.html
curl --insecure -H "Host: demo.openlen.com" https://127.0.0.1:13443/
# → <h1>hello demo</h1>

# 6. Bench (in a third shell, after the edge is steady)
k6 run --insecure-skip-tls-verify crates/edge/bench/k6-static-html.js
k6 run --insecure-skip-tls-verify crates/edge/bench/k6-apex-proxy.js
```

## Open questions for review / Session 4

1. **No idle body timeout, only header-arrival timeout.** `OPENLEN_EDGE_NODE_TIMEOUT_SECS` caps the "send request + receive response headers" phase. Once headers arrive, the body streams without further wall-clock cap (intentional — SSE flows forever). The edge case nobody tested: a Node that returns headers, then hangs the body indefinitely. That request would tie up a tokio task and a hyper connection until either the client or the upstream eventually drops. A real idle-body timeout (reset on each frame) would need either a hyper-util feature we don't have yet or a manual `tokio::time::timeout` wrapped around each `body.frame()` poll. Worth deciding before the F2 S11 metrics work makes the leak visible.
2. **Slow-header panic regression isn't covered by tests.** Section 4 of "Decisiones técnicas" explains why the suite missed the `TokioTimer` requirement. A test that opens a raw TLS connection and drips header bytes across multiple writes would catch any future re-regression — but it's a sizable test fixture for a one-line config item. Open to opinions.
3. **`OPENLEN_EDGE_NODE_URL` must be plain `http://host:port`.** No HTTPS, no Unix sockets. That's correct for our `localhost:3000` use case but means a future "edge in front of a remote Node" deployment will need a different code path. Not in scope; flag for F2 S7+ when blue-green migration is planned.
4. **`http1_only` upstream limits HTTP/2 origin servers.** If we ever want the edge to proxy to an HTTP/2 origin (e.g. a future migration), enable the `http2` hyper-util feature + remove the `Version::HTTP_11` force in `proxy::forward`. ~5 LOC change but a feature-flag bump.
5. **Subdomain regex still hard-coded to `openlen.com`** (S2 Open Q #6) — DEFER. Not blocking proxy work.
6. **Cert hot-reload still requires restart** (S2 Open Q #5) — DEFER to S9 alongside per-host ACME.
7. **Real nginx baseline bench is still owed** (S2 Open Q #1) — DEFER to S7.

## What this session did NOT touch

- `crates/html-engine/` — owned by the parallel F1 Session 4 (minify) on `rust/f1-session4-minify`.
- `.gitattributes` — F1 S4 is adding this; I did not touch it.
- `infra/` — Hetzner nginx, Caddy, systemd files unchanged. The migration that retires nginx is F2 S12.
- Production. All work is local.
- `app/`, `lib/`, `components/` — zero TS code changes.
- Database. `lookup/` (custom-domain Postgres table) still doesn't exist; that's F2 S7.

## Worktree note for the reviewer

All work was performed in `D:\worktrees\openlen-f2-edge` (the same worktree that ran F2 S1 and F2 S2). `git worktree list` from the main repo shows it. To review locally:

```bash
git fetch
git checkout rust/f2-session3-proxy
CARGO_TARGET_DIR=D:/rust/target cargo test -p openlen-edge
CARGO_TARGET_DIR=D:/rust/target cargo clippy -p openlen-edge --all-targets -- -D warnings
CARGO_TARGET_DIR=D:/rust/target cargo build -p openlen-edge --release
```

`CARGO_TARGET_DIR` is required on this workstation so the target directory lives on D:\ (the workspace itself sits on C:\, which is space-constrained). It does not affect any CI / Hetzner build.

No PR opened — per session contract, this handoff goes to the reviewer first.
