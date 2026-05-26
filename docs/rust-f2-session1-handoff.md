# Rust F2 — Session 1 handoff

**Branch:** `rust/f2-edge-proxy` (off `master`)
**Date:** 2026-05-26
**Scope shipped:** F2 Sem 1-2 — axum server + static-wildcard TLS

## TL;DR

`crates/edge/` boots: a 3.8 MB Rust binary terminates TLS (HTTP/2 + HTTP/1.1) for any host and replies with a sentinel body. Hooks are in place — config, TLS loader, graceful shutdown, JSON logs — so Sem 3-4 can add real routing without touching plumbing.

## Commits on this branch

```
d8e5d9d feat(rust/edge): F2 Sem 1-2 — axum + tokio-rustls listener with static wildcard TLS
f32b2d9 chore(rust): bootstrap openlen-edge crate skeleton
```

Both forked off `master @ 5f109b9` (F1 Session 1 merge). They do not touch `crates/html-engine/` — the parallel F1 Session 3 (sanitize) is unaffected.

## Milestones covered (vs the 12-week F2 plan)

| Sem | Scope | State |
|---|---|---|
| **1-2** | **axum server + static wildcard TLS** | **done** |
| 3-4 | wildcard subdomain → disk + cache headers | pending |
| 5-6 | proxy to Node `:3000` for dynamic routes | pending |
| 7-8 | custom domain serving + LRU + singleflight | pending |
| 9-10 | ACME on-demand (`instant-acme`) | pending |
| 11 | Prometheus + Grafana | pending |
| 12 | blue-green migration on Hetzner | pending |

## What's in `crates/edge/`

```
crates/edge/
├── Cargo.toml                       axum, tokio-rustls, hyper-util, tracing
├── README.md                        rationale + run-local recipe
├── examples/gen_dev_cert.rs         rcgen self-signed cert generator
├── systemd/openlen-edge.service     deploy stub (NOT installed)
├── src/
│   ├── main.rs                      env → config → tls → bind → serve
│   ├── lib.rs                       module re-exports + ensure_crypto_provider()
│   ├── config.rs                    EdgeConfig{ bind, cert, key, publish_root } + builder
│   ├── observability/{mod,logs}.rs  tracing-subscriber JSON, OPENLEN_EDGE_LOG_FORMAT
│   ├── tls/{mod,wildcard}.rs        PEM loader → Arc<ServerConfig>, ALPN h2/h1
│   └── server.rs                    bind() → BoundServer.serve(shutdown)
└── tests/handshake.rs               6 real-TLS integration tests
```

Modules absent from this commit but in the target tree (deferred to Sem 3+): `routing/`, `files/`, `lookup/`, `tls/acme.rs`, `tls/resolver.rs`, `singleflight.rs`, `observability/metrics.rs`.

## Sem 1-2 acceptance — verde vs rojo

| Gate | Expected | Result |
|---|---|---|
| Workspace `cargo build` (debug, incl. html-engine) | green | green (52.3 s clean rebuild) |
| `cargo build -p openlen-edge --release` | green | green (52.6 s release, 3.8 MB stripped) |
| TLS handshake works against self-signed | green | green |
| Integration tests pass | 3-5 | **6/6 (0.07 s release wall)** |
| Unit tests pass | green | 4/4 |
| `cargo fmt -- --check` clean | green | green |
| `cargo clippy --all-targets -- -D warnings` clean | green | green |
| README.md run-local recipe | present | present |

Test breakdown:

- `handshake_succeeds_and_returns_200` — full TLS round-trip yields HTTP 200.
- `body_announces_edge_alive` — body contains the `OpenLen edge alive` sentinel.
- `body_echoes_host_header` — `Host:` header lands in the response body via `axum::extract::Host`.
- `server_header_identifies_edge` — `Server: openlen-edge/<version>` populated by `SetResponseHeaderLayer`.
- `version_endpoint_returns_json` — `/_edge/version` returns JSON with the crate version.
- `alpn_negotiates_http2` — `reqwest::http2_prior_knowledge()` client successfully negotiates h2.

## Decisiones técnicas

### axum vs pingora

Picked **axum 0.7** for Sem 1-2. Rationale:

1. **Ecosystem fit.** Cloudflare's pingora is purpose-built for proxying and is great at it, but Sem 3-4 + Sem 7-8 of the plan need *static file serving* and *routing logic* against a Postgres lookup, which is bread-and-butter axum/tower territory. We'd end up reinventing in pingora what axum + tower-http hand us for free (`ServeFile`, `SetResponseHeaderLayer`, `CompressionLayer`).
2. **Skill match.** The repo already has TypeScript handlers wired through Next.js routes; axum's `Handler` traits map cleanly to that mental model, which matters when one human maintains the binary alongside the Node app.
3. **hyper interop.** We still get hyper's HTTP/2 implementation underneath (axum → tower → hyper-util). The `hyper_util::server::conn::auto::Builder` we wire is the same plumbing pingora wraps; we're not paying a tax for choosing the higher-level surface.
4. **Escape hatch.** Nothing in this session locks us in. Bytes flow `TcpStream → TlsAcceptor → TokioIo → hyper_util::auto`, with axum as a `tower::Service` on the inner side. Replacing axum with a hand-written `Service` (or pingora) later is a localized change to `server.rs`.

If Sem 7-8 lookup-LRU or Sem 11 metrics surface a hot-path regression that's clearly axum's fault, we revisit. The bet is that we won't.

### rustls aws-lc-rs vs ring

`rustls = "0.23"` ships with `aws-lc-rs` as the default crypto provider feature (replacing ring as of 0.23). My first pass installed `crypto::ring::default_provider()` and built clean in dev (because reqwest's transitive deps activated `ring`) but failed in `--release` with "cannot find ring in crypto". Switched to `crypto::aws_lc_rs::default_provider()`, which is both the official default and FIPS-eligible — a free bonus for a binary that may eventually need a compliance story.

### Graceful shutdown via `watch::channel(())`

The `BoundServer::serve(shutdown)` pattern uses a `tokio::sync::watch` channel to drain in-flight connections: every spawned task holds a `watch::Receiver`, and the server waits on `close_tx.closed().await` after the accept loop exits. This is the pattern hyper-util's docs recommend; it gives us a clean "no more accepts, but finish what you started" without an arbitrary timeout. Tests use a `oneshot::Sender<()>` to signal shutdown.

### `Host` extractor over `ConnectInfo`

I removed `ConnectInfo<SocketAddr>` from the hello handler. Reasons:

- Sem 1-2 doesn't need peer addr (yet).
- `into_make_service_with_connect_info::<SocketAddr>` returns a `MakeService<SocketAddr, _, Error=Infallible>`, and threading `Infallible` through `?` collides with `anyhow::Error: From<()>` not being implemented. Switching to `into_make_service()` + `tower::ServiceExt::oneshot(())` avoids that path entirely.
- When Sem 3-4 needs the peer for access logs, we'll add `ConnectInfo` back with the explicit type annotation pattern (`<_ as Service<SocketAddr>>::poll_ready`).

## Run it locally

```bash
# 1. Generate dev certs (one-off)
cargo run -p openlen-edge --example gen_dev_cert -- dev-certs

# 2. Boot the edge on https://localhost:3443
OPENLEN_EDGE_CERT=dev-certs/cert.pem \
OPENLEN_EDGE_KEY=dev-certs/key.pem \
OPENLEN_EDGE_BIND=127.0.0.1:3443 \
RUST_LOG=info,openlen_edge=debug \
OPENLEN_EDGE_LOG_FORMAT=pretty \
cargo run -p openlen-edge --release

# 3. Hit it
curl --insecure https://localhost:3443/
# → OpenLen edge alive (localhost:3443)

curl --insecure https://localhost:3443/_edge/version
# → {"version":"0.1.0"}
```

Default JSON logging is on; flip `OPENLEN_EDGE_LOG_FORMAT=pretty` for human-readable dev output.

## Open questions for review / Session 2

1. **Connection-level concurrency cap.** Today the accept loop spawns unbounded tokio tasks. Before Sem 3-4 wires file serving we probably want a semaphore-bounded accept (e.g. 4096 in-flight handshakes) so a hostile peer can't OOM the box during ACME storms.
2. **HTTP/1.1 keep-alive timeouts.** `hyper_util::server::conn::auto::Builder::new()` runs with library defaults — fine for now, but Hetzner-bound traffic deserves an explicit `http1().keep_alive(true)` + `header_read_timeout(30s)` once we know real client mix.
3. **`OPENLEN_EDGE_BIND` defaults to `0.0.0.0:443`** for prod parity. That's correct for `systemctl start` on Hetzner but surprising in local dev (most boxes can't bind 443). The README walks the user past it; alternative is making the default `127.0.0.1:3443` and forcing prod to set the env var. Reviewer's call — I prefer the current direction because "works in prod with zero env" is a stronger invariant than "works in local dev with zero env."
4. **HTTP→HTTPS redirect on `:80`.** Not in this session, but it's owed before Session 7's migration: a tiny secondary listener on `:80` that 301s to HTTPS. Lightweight; ~30 LOC. Suggest folding it into Sem 3-4 alongside routing.
5. **Cert hot-reload.** Today `load_wildcard` runs once at boot; if certbot rotates the wildcard, we keep serving the old chain until restart. Session 9 (ACME) needs a `Arc<RwLock<ServerConfig>>` resolver anyway, so the natural place to add wildcard hot-reload is alongside the per-host ACME resolver — but it could land sooner if it's not too much work.
6. **Crypto provider transitive feature.** `cargo clippy --all-targets` pulls both `aws-lc-rs` and `ring` (because reqwest transitively activates `ring` for the test client). Final release binary is unaffected (only `aws-lc-rs` linked), but reviewers should know the dev tree compiles both. Pin reqwest's TLS feature to `rustls-tls` (which already uses aws-lc-rs in 0.12) to make this go away if it bothers anyone.

## What this session did NOT touch

- `crates/html-engine/` — owned by the parallel F1 Session 3.
- `infra/` (nginx, Caddy, systemd installs on Hetzner).
- Production. All work is local.
- `app/`, `lib/`, `components/` — zero TS code changes.

## Worktree note for the reviewer

Work was performed in a dedicated git worktree at `D:\worktrees\openlen-f2-edge` to avoid colliding with the parallel F1 Session 3 sharing the primary working directory. The branch `rust/f2-edge-proxy` lives in `.git/worktrees/`; `git worktree list` from the main repo shows it. To review locally:

```bash
git fetch
git checkout rust/f2-edge-proxy
cargo test -p openlen-edge
cargo clippy -p openlen-edge --all-targets -- -D warnings
```

No PR was opened — per session contract, the user routes this handoff to the reviewer first.
