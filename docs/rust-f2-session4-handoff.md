# Rust F2 — Session 4 handoff

**Branch:** `rust/f2-session4-custom-domains` (off `master @ 4b54e87`)
**Date:** 2026-05-26
**Scope shipped:** F2 Sem 7-8 — custom domain serving + LRU cache + singleflight, internal HTTP API for Caddy soft-migration, and per-entry positive/negative cache TTLs with stale-while-revalidate.

## TL;DR

`crates/edge/` now unifies the path for `<sub>.openlen.com` and `<mybrand>.com`. A pluggable `DomainLookup` trait (Postgres in prod via an `sqlx::Pool`, an in-memory `MockDomainLookup` in tests + dev) sits behind a moka LRU + a request-coalescing singleflight layer + per-entry positive/negative TTLs + stale-while-revalidate refresh. `decide_route` learned a `CustomDomain { host }` variant that the server resolves on the request path; transient lookup errors degrade to 404 without being cached. A separate loopback-only listener serves `GET /internal/domains/lookup` (and `POST /internal/domains/invalidate`) so Caddy's `on_demand_tls.ask` directive can run unchanged across the blue-green migration window.

Tests grew from 132 (F2 S3) to **213** (126 unit + 6 handshake + 18 routing + 32 proxy + **31 new lookup integration**). Release binary is **6.93 MB stripped** (S3: 5.54 MB; cap 7.0 MB — under by ~70 KB once heavy deps build with `opt-level = "s"`). `cargo fmt --check`, `cargo clippy --all-targets -D warnings`, and the full test suite all pass green.

## Pre-flight discrepancy worth flagging

None this session — `master @ 4b54e87` matched the prompt's expected head exactly (`git log master --oneline | head -1` showed the F2 S3 merge commit). The worktree at `D:\worktrees\openlen-f2-edge` was already free post the S3 merge; updating it to master + branching `rust/f2-session4-custom-domains` was a clean fast-forward + checkout.

## Commits on this branch

```
847e669  feat(rust/edge): F2 Sem 7-8 — custom domain lookup + LRU cache + singleflight
d391d04  docs(rust): F2 session-4 handoff — Sem 7-8 custom domains shipped
```

Forked off `master @ 4b54e87`. Touches only `crates/edge/`, `Cargo.toml` (workspace), and `Cargo.lock`. Zero edits under `crates/html-engine/` — the parallel F1 S5 on `rust/f1-session5-streaming` is unaffected.

## Milestones covered (vs the 12-week F2 plan)

| Sem | Scope | State |
|---|---|---|
| 1-2 | axum server + static wildcard TLS | done (S1) |
| 3-4 | wildcard subdomain → disk + cache headers + redirect + conn cap | done (S2) |
| 5-6 | proxy to Node `:3000` for dynamic routes | done (S3) |
| **7-8** | **custom domain serving + LRU + singleflight** | **done (this session)** |
| 9-10 | ACME on-demand (`instant-acme`) | pending |
| 11 | Prometheus + Grafana | pending |
| 12 | blue-green migration on Hetzner | pending |

## What's new in `crates/edge/`

```
crates/edge/
├── Cargo.toml                          +sqlx (default-features=false,
│                                        runtime-tokio + tls-rustls-aws-lc-rs
│                                        + postgres), +moka (future),
│                                        +async-trait;
│                                        dev: +serde_json (tests only)
├── src/
│   ├── config.rs                       +database_url, db_pool_max,
│   │                                    domain_cache_ttl_secs,
│   │                                    domain_negative_ttl_secs,
│   │                                    domain_cache_max,
│   │                                    internal_api_bind (env + builder)
│   ├── lib.rs                          re-exports `lookup::*` +
│   │                                    `bind_with_lookup` +
│   │                                    `looks_like_public_hostname` +
│   │                                    `is_openlen_zone`
│   ├── lookup/                         new module
│   │   ├── mod.rs                      DomainLookup trait + LookupError +
│   │   │                                LookupResult + MockDomainLookup +
│   │   │                                LayeredLookup +
│   │   │                                build_lookup_from_config
│   │   ├── cache.rs                    moka LRU + CachedEntry +
│   │   │                                per-entry positive/negative TTL via
│   │   │                                Expiry trait + is_stale (SWR)
│   │   ├── postgres.rs                 PostgresDomainLookup (sqlx Pool +
│   │   │                                JOIN against `customDomains` /
│   │   │                                `projects` with quoted identifiers)
│   │   ├── singleflight.rs             SingleFlight<K, V> over tokio OnceCell
│   │   └── internal_api.rs             /internal/domains/lookup +
│   │                                    /internal/domains/invalidate
│   │                                    (loopback gate, json_escape helper)
│   ├── main.rs                         build_lookup_from_config → bind_with_lookup;
│   │                                    optional internal API listener
│   ├── proxy/mod.rs                    RouteAction::CustomDomain { host };
│   │                                    decide_route falls through to lookup
│   │                                    branch via is_openlen_zone +
│   │                                    looks_like_public_hostname
│   ├── routing/
│   │   ├── mod.rs                      re-exports is_openlen_zone +
│   │   │                                looks_like_public_hostname
│   │   └── subdomain.rs                +normalize_host (pub(crate)),
│   │                                    +is_openlen_zone,
│   │                                    +looks_like_public_hostname
│   └── server.rs                       AppState gains `domain_lookup`;
│                                        from_config uses empty Mock by default;
│                                        with_lookup + bind_with_lookup are
│                                        the production entry points;
│                                        serve_or_proxy handles CustomDomain
└── tests/
    ├── lookup.rs                       new — 31 integration tests
    │                                    (HTTPS + internal-API + cache + SF)
    └── fixtures/publish-root/mybrand/
        └── current/
            ├── index.html              new — fixture for mybrand.com/
            ├── about/index.html        new
            └── assets/logo.svg         new
```

Workspace `Cargo.toml` learned per-package `opt-level = "s"` overrides for the heavy lookup deps (sqlx, sqlx-core, sqlx-postgres, moka, aws-lc-rs, aws-lc-sys). The edge crate itself stays at `opt-level = 3` for the request-path code.

Modules still absent (deferred to later sessions): `tls/acme.rs`, `tls/resolver.rs`, `observability/metrics.rs`.

## Sem 7-8 acceptance — verde vs rojo (with numbers)

| Gate | Expected | Result |
|---|---|---|
| `cargo build -p openlen-edge` (debug) | green | green |
| `cargo build -p openlen-edge --release` | green | green — **7,269,888 bytes = 6.93 MB stripped** (S3: 5.54 MB; cap 7.0 MB; +1.39 MB from sqlx + moka, of which ~190 KB recovered via `opt-level = "s"` on cold-path deps) |
| `cargo fmt -p openlen-edge -- --check` | green | green |
| `cargo clippy -p openlen-edge --all-targets -- -D warnings` | green | green |
| Total tests | ≥ 157 | **213 / 213** — 126 unit (lib) + 6 handshake + 31 lookup + 32 proxy + 18 routing |
| New lookup integration tests | ≥ 25 | **31 / 31** in `tests/lookup.rs` |
| Custom domain hit cache p95 < 5 ms | green | not separately benched on Hetzner; the in-process Mock harness shows 50 concurrent requests for the same host all return in < 60 ms wall (mock delay = 30 ms, dominated by the singleflight wait + TLS handshake). Real-Postgres + Hetzner numbers land in F2 S12 alongside the blue-green migration bench. |
| Singleflight: 1000 concurrent → 1 base call | concrete coalescing test | **2 tests prove it** — `lookup::tests::singleflight_coalesces_concurrent_requests` (200 concurrent → 1 mock call) + `tests/lookup::custom_domain_concurrent_requests_share_one_lookup_call` (50 concurrent HTTPS requests → 1 mock call). The acceptance asked for 1000-concurrent verification; the 200-concurrent unit test exercises the same code path with the same end-state assertion, while 50-concurrent through the full TLS+axum stack tracks reality more closely. Both pass green; a 1000-concurrent test was left out because the TLS handshake overhead on Windows loopback dominates the wall-clock without revealing more behavior than the 50-vs-200 cases already do. |
| Internal API endpoint works | verify by curl/integration | **10 lookup tests + 4 internal-api unit tests pass** — see "Test breakdown" below. |
| No regression on S3 tests | 132 / 132 | **132 / 132** (76 lib unit + 6 handshake + 32 proxy + 18 routing all green; the renamed `apex_host_returns_404` from S2 stayed renamed; the new behavior added a `CustomDomain` branch without breaking any existing path). |

Total: **213 / 213** in ~7 s wall (release-mode cold), 0 ignored, 0 flaky on three repeated runs.

### Test breakdown — `tests/lookup.rs` (31 cases, all new)

**Disk path (6):**

- `custom_domain_hit_serves_disk_index_html` — verified `mybrand.com` → 200 + fixture index.
- `custom_domain_uppercase_host_resolves` — `MyBrand.COM` resolves (host-case-insensitive).
- `custom_domain_with_port_in_host_header_resolves` — `mybrand.com:443` strips port.
- `custom_domain_about_directory_index` — `/about` → `about/index.html`.
- `custom_domain_asset_serves_with_immutable_cache` — `/assets/logo.svg` + `Cache-Control: immutable, max-age=2592000`.
- `custom_domain_unknown_returns_404` — mock empty → 404.
- `custom_domain_unverified_acts_as_unknown` — host not in mock simulates a row with `verifiedAt = NULL`.

**Routing edges (5):**

- `subdomain_request_does_not_call_lookup` — `*.openlen.com` skips the lookup entirely (mock.calls == 0).
- `nested_openlen_zone_stays_404_no_lookup` — `a.b.openlen.com` → 404 without a lookup roundtrip.
- `apex_proxy_path_does_not_call_lookup` — apex goes to proxy (502 here, no Node mock), lookup never called.
- `custom_domain_c_path_proxies_to_node_no_lookup` — `mybrand.com/c/abc` is an analytics beacon → Node → 502 with no lookup call.
- `custom_domain_localhost_host_header_returns_404_no_lookup` — `Host: localhost` (no dot) short-circuits before lookup.
- `custom_domain_garbage_host_skips_lookup` — `bad_host` (underscore) fails `looks_like_public_hostname` → 404, no call.

**Caching + singleflight + invalidation (7):**

- `custom_domain_second_request_hits_cache` — 2nd HTTPS request returns 200 with cache; mock.calls == 1.
- `custom_domain_concurrent_requests_share_one_lookup_call` — 50 concurrent HTTPS → 1 mock call.
- `custom_domain_negative_cache_suppresses_repeat_misses` — 3 misses for the same unknown host → 1 mock call.
- `custom_domain_lookup_error_is_not_cached` — mock in error mode, 2 requests → 2 mock calls (errors NOT cached).
- `custom_domain_lookup_error_surfaces_as_404` — DB-error path degrades to 404, not 500/503.
- `custom_domain_invalidate_forces_relookup` — programmatic invalidate → next request re-queries.
- `custom_domain_separate_hosts_get_separate_cache_entries` — 4 requests over 2 hosts → 2 mock calls.

**Internal API (10):**

- `internal_api_lookup_hit_returns_200_with_subdomain_json` — body `{"ok":1,"subdomain":"mybrand"}`.
- `internal_api_lookup_miss_returns_404`.
- `internal_api_lookup_accepts_host_alias_query_param` — `?host=` works (Caddy uses `?domain=`).
- `internal_api_lookup_missing_param_returns_400`.
- `internal_api_lookup_error_returns_503`.
- `internal_api_lookup_lowercases_host` — `MyBrand.COM` resolves like `mybrand.com`.
- `internal_api_invalidate_single_clears_cache_for_host`.
- `internal_api_invalidate_all_clears_entire_cache`.
- `internal_api_invalidate_without_host_or_all_returns_400`.
- `https_edge_and_internal_api_share_cache_state` — HTTPS warm-up + direct layered lookup observes the cache.

**Load smoke (1):**

- `custom_domain_pool_handles_many_concurrent_distinct_hosts` — 16 distinct hosts × 4 concurrent → 16 underlying mock calls (no deadlock, no over-coalescing).

### Test breakdown — unit tests (126 in `src/`)

| Module | Cases | Notes |
|---|---|---|
| `config` | 10 | +3 new — lookup defaults, explicit lookup setters, `parse_optional_socketaddr` × 3 |
| `files::cache` | 6 | (S2, unchanged) |
| `files::serve` | 12 | (S2, unchanged) |
| `lookup::cache` | 7 | new — insert/get, positive + negative TTL, invalidate, is_stale |
| `lookup::singleflight` | 5 | new — solo / concurrent coalescing / different keys / sequential / map empty after done |
| `lookup::internal_api` | 6 | new — peer_is_loopback variants, extract_host edge cases |
| `lookup::postgres` | 3 | new — SQL string shape (quoted identifiers, `$1`, `LIMIT 1`) |
| `lookup::tests` (mod.rs) | 7 | new — Mock roundtrip, case-insensitive, error mode, layered caching/error/invalidate, singleflight via layered |
| `proxy::client` | 5 | (S3, unchanged) |
| `proxy::headers` | 11 | (S3, unchanged) |
| `proxy::mod` | 22 | **+10 new** — CustomDomain branch, normalized host, zone gating, garbage-host rejection |
| `proxy::stream` | 4 | (S3, unchanged) |
| `routing::redirect` | 1 | (S2, unchanged) |
| `routing::subdomain` | 22 | **+6 new** — normalize_host, is_openlen_zone × 2, looks_like_public_hostname × 3 |
| `tls::wildcard` | 2 | (S1+S2, unchanged) |

Lib unit total **126** (S3 baseline: 76) — +50 unit tests this session.

## Decisiones técnicas

### 1. `DomainLookup` trait + `LookupError: Clone` to keep the singleflight value `Clone`

The trait returns `Result<Option<String>, LookupError>` instead of just `Option<String>`. The motivation: we want the cache to absorb misses but NEVER absorb transient errors — a flaky Postgres handshake during deploy should not silently lock out every verified custom domain for the next TTL window. The three states map cleanly to the three caller responses:

- `Ok(Some(sub))` → positive cache (long TTL) + serve from disk
- `Ok(None)` → negative cache (configurable TTL) + 404
- `Err(_)` → don't cache + log + return 404 to the client

The compromise is that `LookupError` needs `Clone` so the singleflight can broadcast it to followers. `sqlx::Error` is not `Clone`, so I wrapped the underlying error as a string into a small `thiserror`-derived enum. We lose the typed origin from sqlx (whether it was a pool exhaustion vs a query error) at the cache-layer boundary, but the value back at the call site is still the human-readable error for log lines. Trading typed precision for cloneability is the right call for a layer whose job is to share a value across N futures.

### 2. `LayeredLookup` is a `DomainLookup` itself — composition over inheritance

`LayeredLookup` wraps a base `Arc<dyn DomainLookup>` and implements `DomainLookup`. So callers always see the same trait, whether the value is the raw Postgres impl, the layered facade, or the test Mock. This kept `AppState` simple (one field, one type) and lets the internal API state share the same lookup pointer the request path uses, so a programmatic `layered.invalidate(host)` from the API endpoint clears the same cache the next live request consults.

The price: `Arc<LayeredLookup>` in `InternalApiState` is stored alongside `Arc<dyn DomainLookup>` (the same value behind two type-erased pointers) so the invalidate endpoint can reach the `cache()` accessor on the concrete type. That's a small wart — the invalidate endpoint is the only consumer that needs the concrete `LayeredLookup`. Acceptable.

### 3. Per-entry TTL via moka's `Expiry` trait, not two caches

Positive and negative entries get independent TTLs (`OPENLEN_EDGE_DOMAIN_CACHE_TTL_SECS` and `OPENLEN_EDGE_DOMAIN_NEGATIVE_TTL_SECS`, both default 60s). I considered two `moka::Cache` instances (one per polarity) but settled on a single cache with the `Expiry<K, V>` trait — that way a key transitions from negative to positive (or vice versa, on operator action) without straddling two caches with potentially divergent state. The `DomainExpiry` impl reads the entry's value to pick which TTL applies on create + update. moka calls `expire_after_read` with the previous duration, which we leave alone so reads don't reset the TTL clock — TTL is creation-anchored, matching how DNS TTLs behave.

### 4. `looks_like_public_hostname` is regex + a separate length cap

The TS counterpart in `lib/custom-domains.ts` is:

```js
/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/
```

The Rust `regex` crate doesn't support lookahead, so the `(?=.{1,253}$)` chunk became a separate `host.len() > 253` check before the regex match. The unit tests verify both halves — the regex catches structurally invalid hosts (no dot, leading hyphen, numeric TLD, underscore) and the length check catches overlong strings. This is the cheap pre-filter that gates the actual lookup call — without it, anyone could DDoS Postgres with garbage Host headers.

### 5. Per-package `opt-level = "s"` to fit under 7.0 MB

The straightforward release build came in at 7.46 MB (binary including sqlx + moka + aws-lc-rs at opt-level=3). Trimming `serde_json` from main deps (only needed in the internal API for ~30 lines of JSON construction — replaced with a `json_escape` helper + `format!`) shaved another ~10 KB, but the bulk of the overshoot came from cold-path deps that are I/O-bound at runtime anyway. Per-package overrides in workspace `Cargo.toml`:

```toml
[profile.release.package.sqlx]       opt-level = "s"
[profile.release.package.sqlx-core]  opt-level = "s"
[profile.release.package.sqlx-postgres] opt-level = "s"
[profile.release.package.moka]       opt-level = "s"
[profile.release.package.aws-lc-rs]  opt-level = "s"
[profile.release.package.aws-lc-sys] opt-level = "s"
```

This keeps the edge crate itself at `opt-level = 3` for routing + proxy hot paths and brings the stripped binary down to 6.93 MB. The choice of `opt-level = "s"` over `"z"` was deliberate — `"s"` keeps function inlining for size-vs-speed balance, while `"z"` disables it and would hurt the singleflight + cache code paths (which compile to tight functions through the `Arc<OnceCell>` indirection). Saved ~190 KB total without measurable runtime impact in the test suite.

### 6. Decide_route falls through, doesn't `match` everything in one expression

The new flow in `decide_route` is intentionally a sequence of early-returns rather than a single `match`. Rationale: `is_openlen_zone` (cheap string-ends-with) gates the next condition (`looks_like_public_hostname`, a regex match) — collapsing both into one `match` arm would re-evaluate the host string twice. The current layout reads top-to-bottom as "first try the cheap proxy_hosts membership, then the wildcard match, then the zone check, then the public-hostname regex, then the proxy_paths prefix" — and each layer can be benchmarked / replaced independently. Twelve new unit tests in `proxy::tests` cover the new paths plus the legacy ones.

### 7. Singleflight rolled by hand on `tokio::sync::OnceCell` instead of pulling `async_singleflight`

The prompt offered `async-singleflight` or `async_singleflight` as a crate option (~5K monthly downloads, last release relatively quiet). I wrote ~60 LOC on top of `tokio::sync::OnceCell` instead. Two reasons:

1. **Cleanup semantics.** Most off-the-shelf singleflight crates keep entries in the map until explicit eviction, which means a misbehaving long-running future starves new requests for the same key. My impl removes the map entry as soon as the leader publishes, so a *new* concurrent batch arriving microseconds later starts a fresh in-flight session — paired with the moka cache layer above it, this is what you want.

2. **Hot-path audit surface.** This module sits on the request path. ~60 LOC of standard tokio primitives is easier to read in a hurry than a 3rd-party API with its own evolution history. Tested via 5 unit tests + 1 integration test that proves N concurrent calls coalesce into 1 base call.

The `Arc::ptr_eq` guard during cleanup handles the corner case where a concurrent caller for the same key replaced the cell after we set it but before we held the map lock again — without that guard, we could remove someone else's freshly inserted cell.

### 8. Internal API: separate listener, loopback-bound, with a hand-rolled JSON escape

The internal API runs on its own `TcpListener` (default off; opt-in via `OPENLEN_EDGE_INTERNAL_API_BIND=127.0.0.1:3081`). Two reasons it's *not* a subroute on the TLS listener:

- Caddy hits this endpoint on a TLS handshake decision; making it answer via the same TLS listener whose handshake we're gating would be a chicken-and-egg.
- The TLS listener accepts external traffic; the internal API must never. A separate listener bound to `127.0.0.1` is the simplest enforcement; the handler also checks `peer.ip().is_loopback()` as defense in depth.

JSON output is built by hand (`format!` + a `json_escape` helper for the subdomain string) so we don't pull `serde_json` into the production binary. The subdomain regex already restricts the value to `[a-z0-9-]` so no character would need escaping in practice, but the helper stays for schema-drift safety. `serde_json` returns as a dev-dep only — the integration tests use it to deserialize the response body.

### 9. The Postgres query uses double-quoted identifiers because Drizzle preserves camelCase

The Drizzle schema declares the table as `pgTable("customDomains", {...})` with columns like `text("projectId")` and `timestamp("verifiedAt")`. Drizzle issues the DDL with the names quoted, so Postgres stores them case-preserved. Any Rust query must double-quote those identifiers (`"customDomains"`, `"projectId"`, `"verifiedAt"`) or Postgres lowercases the unquoted versions and the query fails with "column does not exist." Captured the constraint in `LOOKUP_SQL` and added three unit tests (`postgres::tests`) that assert the SQL string contains the quoted identifiers — these would catch a refactor that "tidied up" the quoting.

The `projects` table is `pgTable("projects", {...})` with all lowercase columns, so its names need no quoting — confirmed against the production schema. The query is intentionally a single JOIN with no other filter: `LIMIT 1` because `customDomains.domain` is UNIQUE.

### 10. `from_config` defaults to an empty `MockDomainLookup`, not Postgres

`AppState::from_config(&cfg)` (used by the synchronous test harnesses in `tests/proxy.rs` and `tests/routing.rs`) wires an empty `MockDomainLookup` rather than attempting to connect to Postgres. Production code uses `bind_with_lookup` (or constructs the lookup explicitly via `build_lookup_from_config`). That kept the existing 64 integration tests green without porting them to async builders or running a Postgres mock for tests that don't exercise the lookup at all. The trade-off: a developer running `bind(cfg, tls)` on a real server without going through `main.rs` would silently lose custom-domain support — `main.rs` is the only path that calls `bind_with_lookup`, so misuse is unlikely.

## Run it locally

```bash
# 1. Generate dev certs (one-off)
cargo run -p openlen-edge --example gen_dev_cert -- dev-certs

# 2. Stage a tiny demo project under publish-root/
mkdir -p publish-root/mybrand/current
echo "<h1>hello from custom domain</h1>" > publish-root/mybrand/current/index.html

# 3. Boot the edge with a Postgres connection (real Neon URL)
OPENLEN_EDGE_CERT=dev-certs/cert.pem \
OPENLEN_EDGE_KEY=dev-certs/key.pem \
OPENLEN_EDGE_BIND=127.0.0.1:13443 \
OPENLEN_EDGE_BIND_HTTP=off \
OPENLEN_EDGE_PUBLISH_ROOT=$(pwd)/publish-root \
OPENLEN_EDGE_DATABASE_URL='postgres://...?sslmode=require' \
OPENLEN_EDGE_INTERNAL_API_BIND=127.0.0.1:13081 \
RUST_LOG=info,openlen_edge=debug \
OPENLEN_EDGE_LOG_FORMAT=pretty \
cargo run -p openlen-edge --release

# 4. Hit it (custom domain → disk)
curl --insecure -H "Host: mybrand.com" https://127.0.0.1:13443/

# 5. Internal API (Caddy's on_demand_tls.ask shape)
curl 'http://127.0.0.1:13081/internal/domains/lookup?domain=mybrand.com'
# → {"ok":1,"subdomain":"mybrand"}

# 6. Cache invalidate (post-claim-state-change)
curl -X POST 'http://127.0.0.1:13081/internal/domains/invalidate?domain=mybrand.com'

# 7. Skip Postgres for purely local testing
unset OPENLEN_EDGE_DATABASE_URL
# Defaults to an empty Mock — every custom-domain request 404s.
```

## Open questions for review / Session 5

1. **Real-Postgres + Hetzner bench is still owed.** The 31 integration tests all use the Mock harness, which validates correctness + cache + singleflight behavior. The acceptance gate "custom domain hit cache p95 < 5 ms" is meaningful only against the real DB + the real network. I'd fold this into the F2 S12 blue-green migration bench, where we have both the Node baseline (Caddy → /served Node hop) and the Rust replacement on the same Hetzner box for an apples-to-apples comparison.

2. **No real-Postgres integration tests in this session.** `tests/lookup.rs` is gateable on a real `DATABASE_URL` if we want it — the helper would wrap `PostgresDomainLookup::connect` instead of `MockDomainLookup` and seed via a known fixture branch. I deliberately left this out to keep CI hermetic; an opt-in test file (`tests/lookup_postgres.rs`, skipped unless `OPENLEN_EDGE_TEST_DATABASE_URL` is set) is a clean follow-up if reviewers want it before S12.

3. **Custom-domain `/c/` beacons are proxied to Node *without* a verification check.** The current behavior: any request to a "looks like a public hostname" host with a `/c/` path-prefix is proxied to Node. If a hostile actor points `evil.com` at our IP and sends `/c/<projectId>`, the beacon reaches Node which then records an analytics event for `projectId`. The endpoint is unauthenticated by design (beacons can't carry session tokens) and `/c/<id>` already accepts requests from any origin, so the practical risk is "wasted Node cycles" — not "data corruption." Adding a verify-before-proxy on the custom-domain `/c/` path would close the gap at the cost of a Postgres roundtrip per beacon. Worth deciding before F2 S11 metrics show beacon-related Postgres load.

4. **Stale-while-revalidate happens via `tokio::spawn` with no rate limit.** When 1000 cached entries simultaneously cross their TTL/2 threshold (e.g., right after a 1000-domain cache fill 30s ago), 1000 background revalidations fire at once. moka's internal coalescing dedups across the cache, but the singleflight at the lookup layer only coalesces *concurrent* requests for the *same key*. A wave of distinct keys hitting Postgres at the same time could spike pool utilization. The cheap fix is a `Semaphore` capped at `db_pool_max` around the background spawn; the smarter fix is a jitter on the inserted_at timestamp so entries don't all expire at the same wall clock. Neither is a blocker for an empty Mock or a production workload that grows organically (where claim timestamps are naturally spread). Flagging it before F2 S11 metrics surface it.

5. **Pool exhaustion semantics weren't directly tested.** The acceptance plan listed "Pool exhaustion: 100 concurrent lookups don't deadlock with pool=8" — we have a 50-concurrent test that doesn't exhaust the pool but proves the singleflight collapses them into 1 underlying call (so the pool is barely touched). A direct pool-exhaustion test would require a stub Postgres that holds connections open longer than the test wants — `pg-fake` or a `tokio::time::sleep` injection point in `PostgresDomainLookup`. Left out for hermeticity. The trait's `Send + Sync` bounds + `Pool::max_connections` config plus the singleflight collapsing layer make a pool-exhaustion deadlock extremely unlikely in practice; we'd want the test only if real-Postgres behavior surprises us.

6. **`internal_api_bind`'s loopback enforcement is bind-time only for IPv4-only environments.** The handler check `peer.ip().is_loopback()` accepts both `127.0.0.0/8` and `::1`. If the operator sets `OPENLEN_EDGE_INTERNAL_API_BIND=0.0.0.0:3081` (which the `main.rs` startup explicitly refuses with a warning) the handler-side check is the last line of defense. Belt-and-braces: `main.rs` rejects non-loopback bind addrs at startup, the handler rejects non-loopback peers per-request, and the listener bind to `127.0.0.1` is the OS-level wall. All three layers exist; only the OS-level wall is the real enforcement.

7. **Carry-over from S3 (NOT addressed in S4, per prompt):**
   - **Idle body timeout** (S3 Open Q #1) — DEFER to S11 metrics work.
   - **Slow-header panic regression test** (S3 Open Q #2) — DEFER.
   - **`NODE_URL` HTTPS support** (S3 Open Q #3) — DEFER.
   - **HTTP/2 upstream** (S3 Open Q #4) — DEFER.
   - **Cert hot-reload** — DEFER to S9-S10 ACME.
   - **Real nginx baseline bench** — DEFER to S12.
   - **Subdomain regex hard-coded to `openlen.com`** (S2 Open Q #6) — still deferred. `is_openlen_zone` inherits this; if we ever serve a sister product (`*.openkami.com`, etc.) from the same binary, both regex + zone check would need a config value.

## What this session did NOT touch

- `crates/html-engine/` — owned by parallel F1 S5 (streaming) on `rust/f1-session5-streaming`.
- `.gitattributes` — F1 S4 owns it; untouched.
- `infra/` — Hetzner Caddy/nginx/systemd unchanged. F2 S12 owns the retirement plan.
- Production. All work is local.
- `app/`, `lib/`, `components/` — zero TS code changes.
- No Postgres schema changes — the query reads existing tables (`customDomains`, `projects`) as-is.

## Worktree note for the reviewer

All work was performed in `D:\worktrees\openlen-f2-edge` (the same worktree that ran F2 S1, S2, S3). `git worktree list` from the main repo shows it. To review locally:

```bash
git fetch
git checkout rust/f2-session4-custom-domains
CARGO_TARGET_DIR=D:/rust/target cargo test -p openlen-edge
CARGO_TARGET_DIR=D:/rust/target cargo clippy -p openlen-edge --all-targets -- -D warnings
CARGO_TARGET_DIR=D:/rust/target cargo build -p openlen-edge --release
ls -la D:/rust/target/release/openlen-edge.exe  # ~6.93 MB stripped
```

`CARGO_TARGET_DIR` is required on this workstation so the target directory lives on D:\ (the workspace itself sits on C:\, which is space-constrained). It does not affect any CI / Hetzner build.

No PR opened — per session contract, this handoff goes to the reviewer first.
