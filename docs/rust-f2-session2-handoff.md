# Rust F2 — Session 2 handoff

**Branch:** `rust/f2-session2-routing` (off `rust/f2-edge-proxy`)
**Date:** 2026-05-26
**Scope shipped:** F2 Sem 3-4 — wildcard subdomain → disk + cache headers + HTTP→HTTPS redirect + connection cap

## TL;DR

`crates/edge/` now serves real content: `https://<sub>.openlen.com/...` resolves to `${OPENLEN_EDGE_PUBLISH_ROOT}/<sub>/current/...` using nginx-style try-files semantics, sets per-extension `Cache-Control` headers, and 301s plaintext `:80` traffic to HTTPS. The accept loop is semaphore-bounded (4096 default) so a hostile peer can't OOM the box during a handshake storm. Peer `SocketAddr` is back in handlers for access logs. All five Sem 1-2 open questions that landed in scope (#1, #4, #6) are resolved; #2 (keep-alive timeouts) and #5 (cert hot-reload) remain deferred per the plan.

64 tests pass cold and warm. 3,718 RPS / p95 = 20 ms on Windows loopback against the fixture under k6 (`50 VUs × 20s`, 0 failures over 74,406 requests).

## Pre-flight discrepancy worth flagging

The session prompt said *"F2 Session 1 ya está en master"*. It is **not** — `rust/f2-edge-proxy` (3 commits, including the F2 S1 handoff) was never merged. This branch was forked from `rust/f2-edge-proxy` instead of `master`, so S1's axum+TLS work is included. Recommend merging both into `master` together once review is happy.

## Commits on this branch

```
<pending>  docs(rust): F2 session-2 handoff — Sem 3-4 routing shipped
2fd0b9f    feat(rust/edge): F2 Sem 3-4 — wildcard subdomain routing + try-files + cache + redirect + conn cap
```

Forked off `rust/f2-edge-proxy @ 779fdaf`. They do not touch `crates/html-engine/` — the parallel F1 Session 3 (sanitize) on `rust/f1-session3-sanitize` is unaffected.

## Milestones covered (vs the 12-week F2 plan)

| Sem | Scope | State |
|---|---|---|
| 1-2 | axum server + static wildcard TLS | done (S1) |
| **3-4** | **wildcard subdomain → disk + cache headers + redirect + conn cap** | **done (this session)** |
| 5-6 | proxy to Node `:3000` for dynamic routes | pending |
| 7-8 | custom domain serving + LRU + singleflight | pending |
| 9-10 | ACME on-demand (`instant-acme`) | pending |
| 11 | Prometheus + Grafana | pending |
| 12 | blue-green migration on Hetzner | pending |

## What's new in `crates/edge/`

```
crates/edge/
├── Cargo.toml                            +regex, mime_guess, percent-encoding, once_cell
│                                          reqwest dev-dep pinned to ["rustls-tls", "http2"]
├── README.md                             updated env-var table + status table
├── bench/k6-static-html.js               new — 50 VUs × 20 s static-HTML bench
├── tests/
│   ├── handshake.rs                      6 S1 tests adapted to fixture-routed world
│   ├── routing.rs                        new — 18 integration tests
│   └── fixtures/publish-root/demo/current/
│       ├── index.html                    new — fixture for `demo.openlen.com/`
│       ├── about/index.html              new — directory-index test
│       ├── assets/logo.svg               new — SVG cache-header test
│       └── assets/app.css                new — CSS cache-header test
└── src/
    ├── config.rs                         +bind_http: Option<SocketAddr>, +max_inflight: usize
    ├── lib.rs                            +files, +routing modules; exports AppState
    ├── main.rs                           dual-listener (TLS + redirect) with Notify shutdown
    ├── server.rs                         +AppState, +semaphore cap, +ConnectInfo wiring,
    │                                      fallback handler → subdomain → resolve → file
    ├── files/
    │   ├── mod.rs                        new
    │   ├── cache.rs                      new — cache_control_for(extension)
    │   └── serve.rs                      new — resolve() with try-files + traversal defense
    └── routing/
        ├── mod.rs                        new
        ├── subdomain.rs                  new — extract_subdomain(host) via DNS-label regex
        └── redirect.rs                   new — run_http_redirect() axum listener on :80
```

Modules still absent (deferred to later sessions): `lookup/` (Postgres custom-domain table), `tls/acme.rs`, `tls/resolver.rs`, `singleflight.rs`, `observability/metrics.rs`.

## Sem 3-4 acceptance — verde vs rojo (with numbers)

| Gate | Expected | Result |
|---|---|---|
| `cargo build -p openlen-edge` (debug) | green | green — 1 m 21 s clean rebuild |
| `cargo build -p openlen-edge --release` | green | green — 2 m 26 s release; **5.29 MB stripped** (up from 3.8 MB in S1, +regex/mime/encoding) |
| `cargo fmt -- --check` | green | green |
| `cargo clippy -p openlen-edge --all-targets -- -D warnings` | green | green |
| Unit tests (lib) | ≥ 20 | **40 / 40** in 0.03 s — config (3), files::cache (6), files::serve (12), routing::subdomain (16), routing::redirect (1), tls::wildcard (2) |
| Integration tests | ≥ 15 | **18 / 18** in `tests/routing.rs` + 6 / 6 in `tests/handshake.rs` (S1 regression suite, adapted to fixture) |
| **Bench** vs nginx baseline ±1 ms p95 | green | **partial** — k6 on Windows loopback gives openlen-edge **3,718 RPS, p95 20.1 ms, p99 23.6 ms, 0 failures over 74,406 reqs / 20 s**. Linux + nginx comparison is deferred to F2 S7 (Hetzner blue-green) — `nginx` is not installable on this Windows dev box without WSL/Docker, and a self-vs-self bench would not satisfy the gate. See **Open Question #1** below. |
| No regression on S1 handshake tests | 10 / 10 | **10 / 10** — 4 lib unit tests untouched; 3 `/`-sentinel integration tests adapted (see "Decisions" §3) |

Total green: **40 unit + 24 integration = 64 tests** in 0.30 s (release build, parallel).

### Test breakdown — `tests/routing.rs` (18 cases)

End-to-end through TLS + axum:

- `known_subdomain_serves_index_html` — `demo.openlen.com/` → 200 + `text/html` + fixture body.
- `html_cache_control_short_browser_long_cdn_swr` — HTML carries `max-age=60, s-maxage=3600, stale-while-revalidate=86400`.
- `svg_cache_control_immutable_30d` — SVG carries `max-age=2592000, immutable`; content-type is `image/svg`.
- `css_cache_control_immutable_30d` — CSS gets the same long immutable cache.
- `directory_index_served_for_about` — `/about` resolves to `about/index.html`.
- `spa_fallback_for_unknown_route` — `/some/deep/unknown` (no extension) falls back to `/index.html`.
- `missing_asset_returns_404_not_spa` — `/assets/missing.png` (has extension) → 404, never a 200 HTML for a missing PNG.
- `apex_host_returns_404` — `openlen.com` → 404 (no subdomain match).
- `nested_subdomain_returns_404` — `a.b.openlen.com` → 404 (regex anchors disallow nested labels).
- `wrong_zone_returns_404` — `demo.example.com` → 404.
- `unknown_subdomain_returns_404` — `ghost.openlen.com` → 404 (no fixture, no SPA to fall back to).
- `router_rejects_encoded_parent_dir` — tower-oneshot path (bypasses URL parsing) sends `/%2E%2E/%2E%2E/etc/passwd` and asserts 400. See "Decisions" §2.
- `router_rejects_null_byte_in_path` — same approach, `/index.html%00.png` → 400.
- `cap_zero_drops_connections` — `OPENLEN_EDGE_MAX_INFLIGHT=0` → connection-level drop manifests as a `reqwest` transport error.
- `high_cap_serves_many_concurrent_requests` — `cap=4096`, 20 concurrent `Host: demo.openlen.com` requests, all 200.
- `version_endpoint_still_returns_json` — `/_edge/version` regression.
- `server_header_still_identifies_edge` — `Server: openlen-edge/...` regression.
- `host_with_port_still_routes` — `Host: demo.openlen.com:443` strips port and routes.

### Test breakdown — adapted `tests/handshake.rs` (6 cases)

The original sentinel-body tests are obsolete (`/` no longer returns `OpenLen edge alive`, it serves a fixture). The 6 tests remain — same TLS invariants, body assertions point at the fixture:

- `handshake_succeeds_and_returns_200` — `Host: demo.openlen.com` → 200.
- `body_serves_subdomain_index` (was `body_announces_edge_alive`) — body contains `demo home`.
- `host_header_routes_to_subdomain` (was `body_echoes_host_header`) — `demo.openlen.com` → fixture body, `ghost.openlen.com` → 404, proves Host-driven routing.
- `server_header_identifies_edge` — unchanged.
- `version_endpoint_returns_json` — unchanged.
- `alpn_negotiates_http2` — unchanged.

### Bench numbers in detail

```
k6 run --insecure-skip-tls-verify crates/edge/bench/k6-static-html.js
  50 VUs × 20 s, Host: demo.openlen.com, GET / (170-byte index.html)

  http_reqs ....................: 74,406    3,718 / s
  http_req_failed ..............: 0.00 %   (0 / 74,406)
  http_req_duration:
    min ........................: 0.52 ms
    median .....................: 13.16 ms
    avg ........................: 13.34 ms
    p(95) ......................: 20.13 ms
    p(99) ......................: 23.60 ms
    max ........................: 36.56 ms
  data_received ................: 17 MB    (824 kB/s)
  release binary, RUST_LOG=warn
```

The 20 ms p95 is dominated by Windows loopback + k6's per-iteration HTTPS+keep-alive cost, not the server. On Hetzner Linux + Wireguard the file-serve path should sit at the syscall floor (≤ 1 ms p95). Real numbers land in S7.

## Decisiones técnicas

### 1. Try-files chain mirrors nginx, but asset misses are honest 404s

```text
GET / → /index.html
GET /pricing → /pricing            (literal file)  if exists
            → /pricing/index.html  (directory index) if exists
            → /index.html          (SPA fallback)
GET /assets/missing.png → 404 (no SPA fallback for extensioned URLs)
```

The "has extension → no fallback" rule is the bit nginx doesn't enforce by default and which the existing OpenLen-on-nginx production has had to paper over with regex `try_files` rules. A request for `/assets/missing.png` returning a 200 HTML response corrupts asset pipelines, breaks `<link rel=preload>`, and confuses tools that probe for file presence. The rule we ship: any URL with `Path::extension().is_some()` is "an asset request" and gets `Resolved::NotFound` if missing — `image/png` was requested, so HTML is never the right answer.

### 2. Path-traversal defense lives in `resolve()`, and the integration test bypasses URL parsing

`resolve()` percent-decodes the URL path, walks `Path::components()`, and rejects anything that is not `Normal` or `CurDir` — i.e., `ParentDir`, `RootDir`, and Windows `Prefix` (drive letters) are all 400 BadRequest. Resolved paths are canonicalized after lookup and verified to live inside the canonicalized publish root, so symlinks pointing outside cannot escape either.

Initial integration test sent `/../../etc/passwd` via `reqwest`; the assertion was that we get 400. We did not — we got 200 (SPA fallback). The reason is that **WHATWG URL parsers normalize the path client-side** before sending: `reqwest` runs the `url` crate, which decodes `%2E` to `.` then applies dot-segment removal. By the time the request hits the wire, the path is already `/etc/passwd`, which `is_safe()` correctly accepts (no `..` components), and the SPA fallback then serves `index.html` for the unknown route. The server is doing the right thing.

To test that the *server-side* defense actually catches a real attacker who uses a non-normalizing HTTP client, we use `tower::ServiceExt::oneshot(req)` directly on the `axum::Router`, feeding `/%2E%2E/%2E%2E/etc/passwd` verbatim. This bypasses both `reqwest` and the `url` crate, exercises the full axum pipeline (extractors + handler), and proves that the traversal hits our resolver and returns 400. A null-byte test follows the same pattern.

### 3. S1 sentinel tests adapted, not preserved as-is

S1's `/` handler returned `OpenLen edge alive ({host})` — a placeholder explicitly meant to be replaced in Sem 3-4. Three of the 6 handshake integration tests asserted that string. We could have kept the sentinel as a side-route (e.g. `/_edge/hello`) and left the tests unchanged, but that adds a vestigial endpoint to the production binary forever. Instead, we updated the three tests to assert the same TLS-handshake invariants against the new file-serving world (fixture index body instead of sentinel body, Host-driven routing instead of Host echo). All 10 S1 tests (4 lib + 6 integration) remain green; the *behavior* under test is now what Sem 3-4 promised.

### 4. Connection cap = honest TCP drop, not 503

When the in-flight semaphore is exhausted, we `drop(stream)` after accept — the client sees a RST/FIN with zero TLS bytes. We considered (a) responding with a TLS-terminated 503, (b) backing off with `accept` deferred, and (c) the current approach. The trade-off:

- (a) costs a full TLS handshake under load — exactly what we're capped to avoid; defeats the purpose.
- (b) lets the SYN queue back-pressure into the kernel, which OOMs differently and slowly. Doesn't help.
- (c) is what nginx's `worker_connections` does and what HAProxy's `maxconn` does. The client sees a clean transport error and can retry against another peer.

The cap defaults to 4096, which is roughly the upper bound of concurrent TLS handshakes a single tokio worker can amortize on a Hetzner CX22 (per `aws-lc-rs` benchmarks). It is configurable via `OPENLEN_EDGE_MAX_INFLIGHT`. Cap = 0 disables service (used in `cap_zero_drops_connections` to exercise the path).

### 5. HTTP→HTTPS redirect is its own listener task, not a TLS-side fallback

We bind a second `TcpListener` on `OPENLEN_EDGE_BIND_HTTP` (default `:80`) and let `axum::serve` handle plaintext requests. Setting `OPENLEN_EDGE_BIND_HTTP=off` disables it (useful for local dev where binding `:80` requires root). The handler:

- Reads `Host` (or returns 400 if missing).
- Strips any `:port` suffix.
- Builds `https://<host>/<path-and-query>` and 301s.
- Per RFC 9110, the recommended permanent redirect that *changes* method is 301; 308 preserves method. For static-page traffic this distinction doesn't matter, but 301 is what nginx defaults to and what every CDN expects.

Shutdown is coordinated via a single `tokio::sync::Notify` shared between the TLS and HTTP tasks — when the parent receives SIGTERM/Ctrl-C, both listeners drain in parallel.

### 6. ConnectInfo back via `into_make_service_with_connect_info::<SocketAddr>().oneshot(peer)`

S1 removed `ConnectInfo` because the `Infallible` error type collided with `anyhow::Error`'s `From` impls. The fix turned out to be three characters: the `IntoMakeServiceWithConnectInfo<S, C>: Service<T>` impl works fine — it's `oneshot(peer)` that feeds the connection address through, and the `expect("infallible")` discharges the `Result<_, Infallible>` honestly because `axum`'s make-service really cannot fail. Handlers now extract `ConnectInfo<SocketAddr>` for access logs (`peer = %addr` lands in every file-serve trace event).

### 7. Reqwest TLS feature pin closes Open Q #6 cleanly for the prod tree

`reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "http2"] }` switches reqwest's TLS implementation from `rustls-tls-manual-roots` (which pulls `ring`) to `rustls-tls` (which pulls `aws-lc-rs` like our server). `cargo tree -e normal` for `openlen-edge` no longer mentions `ring` — production binaries link only `aws-lc-rs`. The dev tree still shows `ring` because `rcgen` 0.13 has a hard `ring` dependency for cert generation, but `rcgen` is dev-only and does not enter the release binary. The "two crypto providers" finding from S1 is therefore resolved for prod; the dev-side residue is `rcgen`'s problem, not reqwest's.

## Run it locally

```bash
# 1. Generate dev certs (one-off)
cargo run -p openlen-edge --example gen_dev_cert -- dev-certs

# 2. Stage a tiny "demo" project so the subdomain routes somewhere
mkdir -p publish-root/demo/current
echo "<h1>hello from demo</h1>" > publish-root/demo/current/index.html

# 3. Boot the edge — TLS on 3443, plain redirect listener disabled
OPENLEN_EDGE_CERT=dev-certs/cert.pem \
OPENLEN_EDGE_KEY=dev-certs/key.pem \
OPENLEN_EDGE_BIND=127.0.0.1:3443 \
OPENLEN_EDGE_BIND_HTTP=off \
OPENLEN_EDGE_PUBLISH_ROOT=$(pwd)/publish-root \
RUST_LOG=info,openlen_edge=debug \
OPENLEN_EDGE_LOG_FORMAT=pretty \
cargo run -p openlen-edge --release

# 4. Hit it (curl needs --insecure for the self-signed cert)
curl --insecure -H "Host: demo.openlen.com" https://127.0.0.1:3443/
# → <h1>hello from demo</h1>

curl --insecure -H "Host: openlen.com" -I https://127.0.0.1:3443/
# → HTTP/1.1 404 Not Found  (apex has no subdomain match)
```

Re-run with `OPENLEN_EDGE_BIND_HTTP=127.0.0.1:3080` and curl `http://127.0.0.1:3080/` to see the 301.

## Open questions for review / Session 3

1. **Bench vs real nginx is still owed.** k6 on Windows loopback hit 3.7 k RPS / p95 20 ms — good enough to confirm the path isn't pathologically slow, but a meaningful nginx-baseline comparison needs Linux + a real on-host nginx. I'd fold this into the F2 S7 blue-green migration: bench both binaries against the same `/var/www/openlen/<sub>/current/index.html` on the Hetzner box, before flipping nginx off. If we want a closer baseline earlier, the cheap move is `cargo install oha` + Docker-Compose with nginx 1.27 on a Linux laptop, then `oha -n 100000 -c 50` against both. I haven't done this — flag if you want me to.

2. **Mid-handshake drop on cap exhaustion is a TCP RST, not a TLS Close.** The `cap_zero_drops_connections` test passes because `reqwest`'s `error_for_status` surfaces the transport error, but a TCP RST is mildly hostile to debugging tools — `curl` reports `Empty reply from server`. An alternative is to accept the TCP connection, run the TLS handshake, then return a `503 Service Unavailable` with a `Retry-After` header. That costs us the very thing we're capping (the TLS handshake), so I went with the honest drop. Open to opinions — if you want a graceful 503 path, it's a small follow-up.

3. **The bench fixture is a 170-byte index.html.** Real OpenLen pages are 5-50 KB after Tailwind+content. Bench numbers will look different on real content (the syscall-and-copy cost grows linearly). Not a blocker — pinning this to "load actual landing-page templates" is part of the S7 migration plan.

4. **HTTP/1.1 keep-alive timeouts (Open Q #2 from S1) still default.** Untouched this session. `hyper_util::server::conn::auto::Builder::new()` runs library defaults. Hetzner-bound traffic deserves an explicit `http1().keep_alive(true)` + `header_read_timeout(30s)` once we know real client mix — propose folding into S5 (proxy session), where we'll be tuning the upstream client at the same time.

5. **Cert hot-reload (Open Q #5 from S1) still requires restart.** Same status. Will land naturally in S9 alongside per-host ACME, because the `Arc<RwLock<ServerConfig>>` resolver pattern is shared.

6. **Subdomain regex is hard-coded to `openlen.com`.** If we ever serve a sister product (`*.something-else.com`) from the same binary, this needs to be a config value. Today nobody asks; not building it speculatively. The regex lives in `routing::subdomain` and is a 3-line change when it does.

7. **`AppState::new` calls `canonicalize` once at boot.** If `OPENLEN_EDGE_PUBLISH_ROOT` is a symlink that gets re-pointed mid-run, the edge won't notice until restart. That's the same behavior nginx has, and it's the behavior we want for the publish-atomic-rename flow. Worth confirming in the S7 migration plan that publish-side writes always go via `rename(2)` (TS code in `lib/publish/filesystem.ts` says they do).

## What this session did NOT touch

- `crates/html-engine/` — owned by the parallel F1 Session 3 (sanitize) on `rust/f1-session3-sanitize`.
- `infra/` (nginx, Caddy, systemd installs on Hetzner).
- Production. All work is local.
- `app/`, `lib/`, `components/` — zero TS code changes.
- Database. No `lookup/` module yet; the custom-domain story starts in S7.

## Worktree note for the reviewer

All work was performed in `D:\worktrees\openlen-f2-edge` (same worktree S1 used, switched to a new branch). `git worktree list` from the main repo shows it. Local review:

```bash
git fetch
git checkout rust/f2-session2-routing
CARGO_TARGET_DIR=D:/rust/target cargo test -p openlen-edge
CARGO_TARGET_DIR=D:/rust/target cargo clippy -p openlen-edge --all-targets -- -D warnings
CARGO_TARGET_DIR=D:/rust/target cargo build -p openlen-edge --release
```

No PR opened — per session contract, this handoff goes to the reviewer first.
