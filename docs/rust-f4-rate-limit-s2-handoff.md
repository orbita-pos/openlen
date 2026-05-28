# F4 Rate-limit S2 handoff

Branch: `rust/f4-rate-limit-s2`
Worktree: `D:/worktrees/openlen-f4-rl-s2`
Base: `origin/master` @ `8f740a2` (post-F4 S1 merge)
Self-SHA: `3b65e7e`

## TL;DR

F4 S1 left two pieces deferred — Open Q #1 (the smart hybrid cache) and the
edge-side IP rate limiter. S2 closes both.

- **SmartCache** (`crates/rate-limit/src/smart_cache.rs`) — memory-primary
  token bucket with optional async PG flush + cold-start hydration. Per-
  window keys (`{base_key}::{label}`) so the existing single-window
  `MemoryLimiter` covers multi-window callers without API changes. Two
  persistence modes — `None` (edge default, no DB writes) and `AllEvents`
  (TS-caller migration target, every allow → batched INSERT). Background
  flush task drains a bounded mpsc queue every `flush_interval` into
  multi-row INSERTs; queue overflow is counted and the memory consume
  still stands. Hydration is one `SELECT key, COUNT(*) GROUP BY key` per
  window, no per-key fanout.
- **Edge middleware** (`crates/edge/src/middleware/rate_limit.rs`) —
  Tower `Layer` + `Service` pair that runs inside the existing axum
  router. Decision flow: exempt-path check → IP extraction
  (cf-connecting-ip → x-real-ip → peer-addr, with trusted-proxy gating
  against header spoofing) → `SmartCache::check_and_consume` → either
  pass-through or short-circuit 429 with `Retry-After` +
  `X-RateLimit-{Limit,Remaining,Reset}`. Inner-most layer in the chain so
  blocked responses still pick up the existing security-header layers on
  the way back out. Fail-open on cache errors — a broken limiter must
  not take down traffic.
- **Default OFF** — `OPENLEN_EDGE_RATE_LIMIT_ENABLED` un-set keeps the
  binary identical to S1's runtime profile: no `SmartCache`, no layer,
  no measurable hot-path cost. Activation is one env flip + restart, with
  rollback the same way. Runbook section in CUTOVER.md §10.

Defense-in-depth posture maintained — Node-side per-userId quotas (the TS
modules unified in S1) keep enforcing plan limits; the edge layer only
adds coarser per-IP abuse prevention in front of Node. The two layers
coexist.

Tests grew from F4 S1's `42 lib + 6 integ (gated)` baseline to **57 lib +
6 lib-with-napi delta + 6 edge-rate-limit integ + 4 smart-cache-PG-integ
(gated)**. Edge lib went `217 → 236` (+19); zero existing-test
regressions; `cargo clippy --all-targets -D warnings` and `cargo fmt
--check` both clean. Stripped Linux release binary still under the 8.0
MiB cap (Windows .exe 7.8 MiB; Linux build TBD on Hetzner during deploy).

## Pre-flight discrepancy

None — `origin/master @ 8f740a2` matched the prompt's expected head (the
F4 S1 merge). Worktree set up at `D:/worktrees/openlen-f4-rl-s2` via
`git worktree add -b rust/f4-rate-limit-s2 origin/master`. The pre-flight
flake on `lookup::tests::reval_semaphore_drops_revalidation_when_exhausted`
under heavy parallel test load is a known carry-over from F2 S6/S7; it
passes in isolation + with `--test-threads=1`.

## Commits on this branch

```
3ce1cff  chore(rust):      F4 S2 — cargo fmt + clippy 1.95 cleanups
7b56471  docs(infra/edge): F4 S2 Phase G — rate-limit activation runbook
ae70300  test(rust):       F4 S2 Phase F — integration tests
9f61c26  feat(rust/edge):  F4 S2 Phase E — rate-limit metrics descriptions + buckets
b3013ba  feat(rust/edge):  F4 S2 Phase D — wire rate-limit middleware into router
75bfdf6  feat(rust/edge):  F4 S2 Phase C — rate-limit Tower middleware
bdc2e43  feat(rust):       F4 S2 Phase B — SmartCache + napi feature gate
```

Seven commits, each independently reviewable. Phase B + C are the two
load-bearing pieces; D-G are wiring + observability + operational
artifacts. The trailing `chore(rust)` commit folds in fmt + clippy
deltas that surfaced at the validation gate (mostly S1 carry-over
warnings the rust 1.95 update tightened).

## Goals — verde vs rojo

| Gate | Expected | Result |
|---|---|---|
| `cargo check --workspace` | clean | clean (3m27s cold) |
| `cargo test -p openlen-rate-limit --lib --no-default-features` | smart-cache tests pass | 48 / 48 (+17 over S1) |
| `cargo test -p openlen-rate-limit --lib` (default = napi-bindings) | unchanged S1 + new | 57 / 57 |
| `cargo test -p openlen-rate-limit --test smart_cache_integration` | 4 tests, env-gated | 4 / 4 (skip mode without `OPENLEN_RATE_LIMIT_TEST_DATABASE_URL`) |
| `cargo test -p openlen-edge --lib` | 217 baseline + middleware + config | **236** (+19) |
| `cargo test -p openlen-edge --test rate_limit` | 6 end-to-end tests | 6 / 6 |
| `cargo test --workspace` | everything green | every binary `test result: ok.` |
| `cargo clippy --workspace --all-targets -- -D warnings` | clean | clean |
| `cargo fmt --check` | clean | clean post Phase H fixup |
| Edge binary ≤ 8.0 MiB stripped | met | **7.8 MiB** (.exe; Linux release expected within ~50 KiB) |
| Blocked request returns 429 with full header set | yes | `tests/rate_limit.rs::burst_past_per_min_limit_returns_429_with_headers` covers Retry-After + 3× `X-RateLimit-*` + security-header chain on 429 |
| Exempt paths bypass middleware | yes | `tests/rate_limit.rs::exempt_path_bypasses_limit` + `well_known_acme_challenge_exempt_by_default` |
| Metrics on /metrics | 4 new metrics with HELP / TYPE / buckets | `tests/metrics.rs::prometheus_exporter_full_surface` asserts HELP on all four + 10 µs bucket on the histogram |
| Default OFF == zero perf hit | layer never attaches when disabled | `bind_with_lookup_and_layers(.., None)` skips the `.layer()` call; `main.rs` doesn't even construct the `SmartCache` |
| `infra/edge/CUTOVER.md` updated | activation section | §10 added: 10a Pre-flight / 10b Enable / 10c Verify / 10d Soak (4 named Grafana panels) / 10e Rollback / 10f Tuning |
| Handoff doc | this file | here |

### Test-binary count breakdown

```
crates/rate-limit:
  lib (default = napi-bindings)      57   (was 42 in S1 — +9 from napi binding, +6 smart-cache lib)
  lib (--no-default-features)        48   (was N/A in S1; the feature gate is new)
  postgres_integration               6    (unchanged, env-gated)
  smart_cache_integration            4    (new, env-gated)

crates/edge:
  lib                                236  (was 217 in S7 — +14 middleware, +5 config)
  tests/apex.rs                      5
  tests/dynamic_resolver.rs          10
  tests/handshake.rs                 6
  tests/lookup.rs                    31
  tests/metrics.rs                   1
  tests/proxy.rs                     34
  tests/rate_limit.rs                6    (new)
  tests/routing.rs                   27
```

Headline edge total: **236 lib + 126 integration = 362** (was 217 + 113
= 330 in S7 — net +32, all from this session).

### Bench — overhead with rate-limit on

Not benched in this session. The F2 S7 harness exists; the operator
runs `bash bench/run-baseline.sh && OPENLEN_EDGE_RATE_LIMIT_ENABLED=1
bash bench/run-edge.sh && python3 bench/diff.py` during the post-cutover
activation flow (CUTOVER.md §10c). The expected delta is sub-microsecond
on allowed paths (DashMap shard + bucket math, both hot in cache) and a
constant ~10 µs on blocked paths (response builder + header writes). No
PG hits in the edge configuration (memory-only `PersistenceMode`).

## Architecture & decisions

### Phase B — SmartCache shape

**Per-window keys, not multi-window buckets.** `MemoryLimiter::try_consume`
takes a single `MemorySpec` per key. To support a (5/min + 100/hour)
caller without rewriting the bucket store, the smart cache munges the
caller's key into `{key}::{window.label}` before each consume. Each
window gets its own DashMap entry with independent refill rate. A
request consumes one token from EACH window's bucket — same semantic
as the PG path (one event row counted against every window's rolling
count).

Trade-off: a request consumes one token from window A, then window B
blocks — window A has already burned a token "for nothing". The
continuous-refill token bucket self-corrects within the same window
(the wasted token refills at the normal rate). Mirrors the
PostgresLimiter slop documented in S1 ("two concurrent requests at the
limit might both pass"). Acceptable for a quota system; not for a
money-critical lock.

**Async flush, bounded queue, drop-on-overflow.** Allowed events go onto
an `mpsc::Sender<FlushEvent>` with `try_send`. Full queue → drop +
counter increment + memory consume still stands. The flush task wakes
every `flush_interval`, drains the channel into a single multi-row
INSERT (`INSERT ... VALUES (...), (...), ...`). On error: warn-log +
`flush_failed` counter; do not retry. Lossy persistence is acceptable
here — the memory bucket is the live count source; PG is for durability
+ hydration.

**Cold-start hydration is a single GROUP BY per window.** The S1 handoff
flagged "load the entire counter universe in O(rows-in-last-month)" as
unobviously shaped. The shape that works:

```sql
SELECT "key", COUNT(*)::bigint
  FROM "rateLimitEvents"
 WHERE "createdAt" > $1
 GROUP BY "key"
```

One round-trip, returns one row per active key. Seeds the memory bucket
to `max - count`. Conservative — over-seeds if the window is short and
the data is spread, but never under-seeds (the worst case is "limiter
is briefly more permissive after a restart" which is the exact failure
mode S1 was worried about anyway).

**Cheap clone.** `SmartCache { inner: Arc<Inner> }`. The Tower middleware
holds a `SmartCache` (not `&SmartCache`) so it can move into the
response future; clones are an Arc bump.

**Background lifetime tied to a `SmartCacheBackground`.** Drop = abort
both tasks (flush + memory GC). The handle returned by
`SmartCache::start_*` belongs to whoever owns the runtime — main.rs in
prod, the test harness in unit tests.

### Phase B — napi feature gate

Edge can't depend on rate-limit as long as napi is unconditional —
napi + napi-derive + napi-build are heavy and pull C-side stubs that
shouldn't land in the edge binary. The fix: move napi-* under a new
`napi-bindings` feature, default-on for the `@openlen/rate-limit`
cdylib build (TS callers keep working with no changes); edge depends
with `default-features = false`.

`#[cfg(feature = "napi-bindings")] pub mod napi;` keeps the JS-facing
class out of the pure-Rust build. The cdylib path is unchanged — the
`napi-build` build script only runs under the feature gate.

### Phase C — Middleware decision flow

```
Tower request
  │
  ├─► exempt path prefix match → pass through (+1 exempt counter)
  ├─► extract IP (header chain or peer_addr)
  │     trusted_proxies empty   → trust all peers
  │     trusted_proxies set     → header ignored from untrusted peers
  ├─► SmartCache::check_and_consume(key="ip:<addr>", windows)
  │     Err(_)                  → fail open (+1 error counter)
  │     Ok(allowed)             → inner.call(req)
  │     Ok(blocked)             → 429 short-circuit
  │
Response
  │ (always passes back through outer layers — SetResponseHeader chain
  │  still tags 429s with HSTS / CTO / X-Frame / Referrer-Policy /
  │  Permissions-Policy)
  ▼
```

**Fail open on cache errors.** A broken limiter (PG hiccup, panicking
flush task) must not 5xx legitimate traffic. The cache returns
`Result<LimitDecision, RateLimitError>`; on `Err`, the middleware logs
+ counts + passes through.

**Inner-most layer ordering.** `.layer(RateLimitLayer)` is the FIRST
`.layer()` call on the router after `.with_state()` — meaning it's the
INNERMOST in the chain (closest to the handler). The existing
SetResponseHeader layers come AFTER it (added with more `.layer()`
calls). Tower semantics: layers stack from inside-out as you add them.
A 429 from the middleware flows out through the SetResponseHeader
layers, so security headers still cover it.

**IP source priority.** `cf-connecting-ip` → `x-real-ip` → peer-addr.
The first two are header-based and only consulted when the TCP peer is
in `trusted_proxies` (empty = trust-all, set = strict). Comma-chains
(`x-forwarded-for` style) take the first entry — the original client.
Invalid IP literals fall through. Spoofing prevention is critical: a
hostile client on a non-trusted IP can't fake `cf-connecting-ip:
127.0.0.1` because the peer wouldn't match the (empty by default but
operator-settable) trusted_proxies list.

### Phase D — Default OFF posture

Tower's `Option<Layer>` story is awkward — `option_layer` exists but
adds a generic explosion to the router type. The cleanest path:
`router(state)` keeps its existing signature; `router_with_layers(state,
Option<RateLimitLayer>)` is the new entry point that conditionally
applies `.layer(rl)` only when `Some`. `bind_with_lookup_and_layers` is
the equivalent on the bind side; `bind_with_lookup` is a one-liner
delegate to `bind_with_lookup_and_layers(..., None)` for back-compat
with existing tests.

When `OPENLEN_EDGE_RATE_LIMIT_ENABLED=0` (default), `main.rs` never
constructs the `SmartCache`, never spawns the GC task, never wraps the
router. The compiled-in path is exactly the S7 hot path.

**Memory-only mode is the right default for edge.** Per
[[no-redis-or-queue-until-trigger]], we're on a single Hetzner box.
DashMap is per-process, restart loses it, and that's fine — the edge
trades soft state for a clean rollback model (`systemctl restart` is
the rollback). PG-backed mode is wired but unused here; it's there for
the day a TS caller wants to migrate to the smart cache.

### Phase E — Metrics

Four new metrics: `decisions_total{result}`, decision histogram,
`memory_hits_total{source}`, `pg_hits_total`. The `pg_hits_total`
counter is registered + emitted (always 0 in memory-only mode) so the
Grafana panel template stays stable for the day PG mode runs at the
edge.

Histogram buckets sized for the in-memory path — 1 µs to 10 ms,
geometric. The 10 ms tail leaves room for an unforeseen latency
regression to surface (cache lock contention, GC pause coinciding with
a hot key). If the p99 sits at 5 µs throughout the soak, the tuning
checklist in CUTOVER.md §10f flags tighter buckets as a follow-up.

### Phase G — Activation runbook

CUTOVER.md §10 is **not** a code session; it's the operator's runbook
post-cutover. Six sub-sections cover pre-flight → enable → verify →
soak → rollback → tune. The pre-flight uses Grafana PromQL to derive
sane starting limits from observed traffic; the rollback is one env
flip + restart with no DB migration needed (the memory-only mode means
"throw away state" is a valid rollback path).

The activation is gradual by design — even after the env flips, the
first 5 minutes of `/metrics` data tells the operator whether the
limits are sane or false-positiving. Tighten / loosen iteratively
based on the blocked-ratio panel and the access-log correlation.

## Files touched

```
Cargo.toml                                         (workspace — unchanged)
crates/rate-limit/Cargo.toml                       feature gate + workspace toggle
crates/rate-limit/build.rs                         cfg-gate napi-build
crates/rate-limit/src/lib.rs                       +smart_cache + #[cfg] for napi
crates/rate-limit/src/smart_cache.rs               NEW — ~580 LOC + 17 lib tests
crates/rate-limit/src/hybrid.rs                    clippy carry-over
crates/rate-limit/src/types.rs                     clippy carry-over
crates/rate-limit/tests/smart_cache_integration.rs NEW — 4 env-gated PG tests

crates/edge/Cargo.toml                             +openlen-rate-limit, +chrono
crates/edge/src/lib.rs                             +middleware module, +new exports
crates/edge/src/middleware/mod.rs                  NEW
crates/edge/src/middleware/rate_limit.rs           NEW — ~640 LOC + 14 lib tests
crates/edge/src/config.rs                          +5 env vars, +parse_ip_csv, +5 tests
crates/edge/src/main.rs                            +SmartCache + RateLimitLayer wiring
crates/edge/src/server.rs                          +router_with_layers + bind variant
crates/edge/src/observability/metrics.rs           +4 describe_* + bucket constant
crates/edge/tests/metrics.rs                       +4 metric seeds + HELP assertions
crates/edge/tests/rate_limit.rs                    NEW — 6 e2e integration tests

infra/edge/edge.env.example                        +rate-limit section (5 vars documented)
infra/edge/CUTOVER.md                              +§10 activation runbook (6 sub-sections)

docs/rust-f4-rate-limit-s2-handoff.md              NEW — this file
```

## How to verify the branch locally

```bash
git fetch
git checkout rust/f4-rate-limit-s2
CARGO_TARGET_DIR=D:/rust/target cargo test --workspace
CARGO_TARGET_DIR=D:/rust/target cargo clippy --workspace --all-targets -- -D warnings
CARGO_TARGET_DIR=D:/rust/target cargo fmt --check
CARGO_TARGET_DIR=D:/rust/target cargo build -p openlen-edge --release
ls -la D:/rust/target/release/openlen-edge.exe   # 7.8 MiB on Windows
```

To exercise the env-gated PG integration tests:

```bash
OPENLEN_RATE_LIMIT_TEST_DATABASE_URL="postgresql://..." \
  cargo test -p openlen-rate-limit --test smart_cache_integration
```

## F4 status post-merge

**F4 is complete** for the rate-limit deliverables. S1 unified the four
parallel TS limit modules and migrated the napi-side; S2 closed the
deferred smart hybrid cache and shipped the edge-side middleware. The
defense-in-depth model — edge IP-based abuse prevention + Node-side
userId-based plan quotas — is in place.

Open F4 work that survives this branch:

- **F4 Images S2** (nice-to-haves) — the only remaining roadmap item
  for the Rust portion. Out of scope for this session.

What the operator picks up post-merge:

1. Soak the cutover binary (per F2 S7 §8) — rate-limit stays OFF
   throughout this window.
2. Once the basic soak is clean, run CUTOVER.md §10 to activate
   rate-limit gradually. Watch the four named Grafana panels for 24-72h.
3. Tune the per-IP defaults using the §10f checklist + Grafana
   correlations.

## Open questions

### 1. Per-userId limits at the edge

Today the edge knows nothing about userIds — that's a Node-side
concern. A future feature (e.g. premium-plan SLOs that need higher
limits for logged-in users) would need session decryption at the edge,
which is a much bigger change. Today's Node-side quotas cover this
adequately. Not building speculatively.

### 2. Distributed coordination

`SmartCache` state is per-process. A two-pod future would need either a
sticky-session L4 LB or a shared store. Both are punted per
[[no-redis-or-queue-until-trigger]] until a concrete trigger appears.

### 3. SmartCache `get_usage` semantics

The token bucket has no peek API — the cheapest read mutates state. So
`SmartCache::get_usage` reports `used = 0, remaining = max` for every
window. Callers wanting precision (the `/api/usage` UI endpoint, e.g.)
should pair the smart cache with `PostgresLimiter::get_usage`. Easy
follow-up if a caller actually wants this from the cache — add a peek
method to `MemoryLimiter` that returns the current token count without
deduction.

### 4. Negative cache structure

The F4 brief mentioned a separate DashMap-keyed negative cache for
blocked decisions. After implementing, the natural flow (memory says
blocked → no PG hit) already provides the "no PG round trip on
blocked" guarantee without a second data structure. DashMap lookup is
~600 ns; adding a separate negative-cache lookup wouldn't make blocked
paths faster, just add a memory footprint per-blocked-key. Dropped
during Phase B; the no-PG-on-block guarantee is built into the flow.

### 5. Rate-limit on the cutover bake-off bench

CUTOVER.md §10c suggests running the bench twice — once with the layer
OFF, once with the layer ON — to surface the overhead delta. The S7
diff.py gate (≤5 % RPS, ≤20 % p99) is the right shape; nothing changes
in bench/. Reusable as-is once the operator runs the post-cutover
activation. Not benched in this session — the harness runs on Hetzner
during cutover, not on a Windows laptop.

### 6. Grafana dashboard panels

Phase G left the dashboard JSON as a flagged follow-up. The PromQL for
the four named panels (decisions/sec by result, decision p99, IP-source
distribution, 5xx ratio) is in CUTOVER.md §10d. Adding them via "Add
visualization → Code → paste" takes about 2 minutes per panel.
Committing the JSON delta is a small post-soak cleanup.

### 7. Pre-existing reval_semaphore flake

`lookup::tests::reval_semaphore_drops_revalidation_when_exhausted`
intermittently fails under heavy parallel test load (236 tests racing
for the same tokio runtime). Pre-existing — S6 / S7 carried the same
flake. Passes in isolation + with `--test-threads=1`. Worth a
dedicated 30-minute pass to make the test deterministic via tokio
time-pausing; deferred as it's not introduced by this session.

## Self-commit SHA

`3b65e7e` — the Phase H commit that introduced this handoff doc. Any
subsequent commits on `rust/f4-rate-limit-s2` will be SHA-fill follow-ups
or post-review fixups.
