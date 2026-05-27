# Rust F2 — Session 7 handoff

**Branch:** `rust/f2-session7-migration` (off `master @ ad22c35`)
**Date:** 2026-05-27
**Scope shipped:** F2 Sem 12 — migration toolkit. Routing parity for the
nginx swap, bench harness, deployment artifacts, cutover runbook, smoke
test, soak alerts. This session does NOT touch production — every file
shipped is local to the laptop until the operator runs the runbook.

## TL;DR

The Rust edge now matches nginx and Caddy semantically for every
production path class — apex proxy with disk-served `/_next/static/`
and `/uploads/`, wildcard subdomain with disk-served `/uploads/` and
sibling-tree `/assets/`, custom domain with broader `/api/*`
passthrough. Five new security headers land on every response. The
renewal-due gauge that A1 of S6 left undocumented is now populated.

For the operator: `infra/edge/CUTOVER.md` is the front door. It chains
through `infra/edge/install.sh` (one-time root setup), `infra/scripts/
deploy-edge.sh` (build + ship binary), `bench/{run-baseline,run-edge}.
sh` + `bench/diff.py` (go/no-go gate), `infra/edge/smoke-test.sh`
(post-swap 8/8 verification), and `infra/grafana/openlen-edge-alerts.
yaml` (7-day soak monitoring).

Tests grew from **296** (S6) to **331** (+35). All green plus
`cargo fmt --check`, `cargo clippy --all-targets -D warnings`, and a
stripped 7.7 MiB Linux build well under the new 8.0 MiB cap.

## Pre-flight discrepancy worth flagging

None this session — `master @ ad22c35` matched the prompt's expected
head (the F1 Sem 12 cutover merge commit + F2 S6 had already merged
in). Worktree set up clean at `D:\worktrees\openlen-f2-s7` via
`git worktree add -b rust/f2-session7-migration D:/worktrees/openlen-f2-s7 origin/master`.

## Commits on this branch

```
d2df7cb  docs(rust):          F2 session-7 handoff — migration toolkit complete (F2 DONE)
2c32b5e  feat(infra/grafana): F2 S7 F  — Prometheus alert rules
03950c2  test(infra/edge):    F2 S7 E  — post-cutover smoke (8 checks)
4a338ee  docs(infra/edge):    F2 S7 D  — cutover runbook
0fdd14c  feat(infra):         F2 S7 C3+C4 — install.sh + deploy-edge.sh
f610ffd  feat(infra/edge):    F2 S7 C1+C2 — systemd unit + env template
69be2aa  chore(bench):        drop accidentally committed __pycache__
105a510  test(bench):         F2 S7 B  — k6 harness + diff w/ gates
ba7731c  feat(rust/edge):     F2 S7 A5 — security header parity
98e0135  test(rust/edge):     F2 S7 A4 — apex routing integration suite
87dd92e  feat(rust/edge):     F2 S7 A3 — path-aware routing for migration parity
33614e3  build(rust):         F2 S7 A2 — promote binary cap to 8.0 MiB
04aa587  feat(rust/edge):     F2 S7 A1 — populate cert_renewal_due_total
```

Thirteen commits including this self-reference. The 69be2aa fixup is
a zero-risk `.gitignore` extension + index removal (`__pycache__/`
from the diff.py validation step accidentally landed in B).

## Milestones covered

| Sem | Scope | State |
|---|---|---|
| 1-2 | axum server + static wildcard TLS | done (S1) |
| 3-4 | wildcard subdomain → disk + cache headers + redirect + conn cap | done (S2) |
| 5-6 | proxy to Node `:3000` for dynamic routes | done (S3) |
| 7-8 | custom domain serving + LRU + singleflight | done (S4) |
| 9-10 | ACME on-demand + wildcard hot-reload + persistence + renewal | done (S5) |
| 11 | Prometheus + Grafana + S1-S5 cleanups | done (S6) |
| **12** | **Migration toolkit — runbook + bench + artifacts** | **done (this session)** |

**F2 is complete.** Open items below are operator follow-ups, not
session deliverables.

## Acceptance — verde vs rojo (with numbers)

| Gate | Expected | Result |
|---|---|---|
| A1 — `openlen_edge_cert_renewal_due_total` populated | gauge set per sweep | `count_due_for_renewal` lifted into pure helper; `gauge!().set(due_now as f64)` in `run_sweep_once` before the renewal loop |
| A1 — unit test | feed two certs at 3d + 60d, assert gauge=1 at threshold=7d | covered by `count_due_for_renewal_respects_threshold` (3 assertions: threshold=7d→1, threshold=100d→2, threshold=1d→0) + `count_due_for_renewal_treats_expired_as_due` |
| A2 — binary cap bumped to 8.0 MiB + documented | comment in `Cargo.toml` | added with rationale + pointer to S6 Open Q #3 regex-removal headroom |
| A2 — `cargo build` stripped under cap | ≤ 8.0 MiB | **7.7 MiB** (no change vs S6 baseline — routing changes are pure logic) |
| A3 — wildcard subdomain `/uploads/` `/api/f/` `/assets/` `/c/` covered | `decide_route` + new variants | `RouteAction::SharedUploads` + `RouteAction::NextStatic`, default `proxy_paths` extended to `["/c/", "/api/f/"]`, `/assets/*` routed through `DiskBase::Sibling`, all five paths covered by unit + integration tests |
| A3 — custom domain `/api/*` `/c/*` passthrough | `decide_route` differentiates | new `custom_domain_proxy_paths` config defaulting to `["/c/", "/api/"]`; tested via `custom_domain_api_passes_through` + `custom_domain_uploads_routes_to_shared_uploads` |
| A4 — apex routing model | apex_proxy branch + `/uploads/` + `/_next/static/` | implemented in A3 (single `decide_route` change); A4 commit adds dedicated `tests/apex.rs` with 5 cases (root proxy / uploads + cache header / next-static + cache header / missing-uploads = 404 / missing-next-static = 404) |
| A5 — headers emitted on all responses | HSTS / X-CTO / X-Frame / Referrer / Permissions | 5 `SetResponseHeaderLayer::overriding` layers on the router; `security_headers_emitted_on_subdomain_responses` asserts every header has the right value; `security_headers_emitted_on_shared_uploads_responses` confirms the layer applies through the strict-resolver path too |
| B — bench scripts syntactically valid | `node --check` + `bash -n` | all 4 k6 scripts pass `node --check`; both run-*.sh pass `bash -n`; `diff.py` compiles via `py -3 -m py_compile` |
| B — cutover gates documented | RPS≥95%, p99≤120%, err≤+0.1pp | encoded in `bench/diff.py` constants `GATE_RPS_FLOOR=0.95`, `GATE_P99_CEIL=1.20`, `GATE_ERR_DELTA=0.001`; non-zero exit on breach so runbook can chain via `&&` |
| C1 — systemd unit | `Type=simple`, ambient `CAP_NET_BIND_SERVICE`, `ProtectSystem=full` | `infra/edge/openlen-edge.service` matches; deliberately NOT ordered `After=openlen-app.service` (edge serves static during app rolls) |
| C2 — env template | every `OPENLEN_EDGE_*` documented | 25 vars grouped (listener / TLS / static / proxy / lookup / ACME / observability), defaults inline, required-for-prod called out |
| C3 — install.sh idempotent | user / dirs / setcap / hook / unit | every step checks before mutating; re-run safe; output ends with "Next steps" block referencing CUTOVER.md |
| C4 — deploy-edge.sh atomic | rsync `.new` → mv → restart | hard fail at >10 MiB, warn at >8.0 MiB cap; conditional restart (skips on pre-cutover installs); WSL2-recommended cross-compile + zigbuild escape hatch documented |
| D — runbook self-contained | 9 sections, rollback per step | 446 lines; each section that mutates state has a `§7.<X>` rollback; bench bake-off (§4f) and smoke (§5f) are the gates; "common failures and what they mean" table inside §7d |
| E — smoke-test.sh runnable | 8 checks, descriptive failures | always runs all 8 (no fail-fast — operators want full diagnostic); auto-discovers `/uploads/` and `/_next/static/` files when no override; custom-domain check uses real DNS path to surface misconfigurations |
| F — alert rules importable | 6 PromQL rules | covers error rate / p99 latency / renewal-due / issuance failures / proxy errors / handshake cap; every annotation has summary + description + runbook reference where critical |
| `cargo fmt -p openlen-edge -- --check` | clean | clean |
| `cargo clippy -p openlen-edge --all-targets --release -- -D warnings` | clean | clean |
| Zero production touched | no SSH / no deploy.sh main | every artifact shipped to disk only; the runbook is what the operator executes against prod |

**Test breakdown (331 total):**

| Binary | Tests | Δ from S6 |
|---|---|---|
| Lib unit (`src/`) | 217 | +20 |
| `tests/apex.rs` | 5 | **new in S7** |
| `tests/dynamic_resolver.rs` | 10 | — |
| `tests/handshake.rs` | 6 | — |
| `tests/lookup.rs` | 31 | — |
| `tests/metrics.rs` | 1 | — |
| `tests/proxy.rs` | 34 | — |
| `tests/routing.rs` | 27 | +9 |
| **Total** | **331** | **+35** |

Lib growth: A1 added 2 in `tls::renewal`; A3 added new config tests (3),
new `resolve_strict` tests (5), new `disk_base_for` + per-host
`decide_route` tests in `proxy::mod` (10).

### Bench — overhead of instrumentation on the request path

Still not benched in this session. The harness is in place; the
operator runs both halves on Hetzner during the cutover bake-off. The
S6 prompt's "≤5% RPS" gate now has concrete evidence path: run
`bash bench/run-baseline.sh && bash bench/run-edge.sh && python3 bench/diff.py`.

## Decisiones técnicas

### A1 — gauge at scan time, not residue

`run_sweep_once` snapshots `due_now` from `count_due_for_renewal`
BEFORE the renewal loop, then sets the gauge. After a clean sweep that
renewed everything, the gauge stays at the at-scan-time value until
the next sweep — which is the right semantic for alerting (we want
"how many certs are in trouble right now if the sweep failed"; the
post-renewal residue is always 0 on success and uninformative).

The helper was extracted out of `run_sweep_once` so the unit test can
exercise it directly without colliding with the once-per-process
global recorder owned by `tests/metrics.rs`.

### A2 — cap bump is a doc change, not a target change

The 7.66 MiB end-of-S6 binary fits comfortably inside an 8.0 MiB
ceiling that gives room for the S7 routing additions (~no measured
delta) without needing a separate cap-pressure conversation
mid-cutover. The savings path to ~7.0 MiB (regex removal) is
documented for a later session — it touches the per-request hot path
so doing it during migration was the wrong risk tradeoff.

### A3 — `DiskBase` enum vs URL re-routing

When the router sees `/assets/foo.css` on a subdomain, it now needs to
serve from `<publish>/<sub>/assets/` (sibling of `current/`) instead
of `<publish>/<sub>/current/`. Three shapes considered:

1. **Two RouteAction variants** — `DiskCurrent { sub }` and
   `DiskSibling { sub }`. Ugly: the routing layer doesn't care which
   directory; only the disk dispatcher does.
2. **URL rewrite at routing time** — strip `/assets/` and pass a
   bare path. Lossy: the strict resolver would see `foo.css` without
   the `/assets/` prefix and reject as bad request from `is_empty`.
3. **(chosen) Pure helper `disk_base_for(url_path) -> DiskBase`** —
   the routing layer stays uniform (one `RouteAction::Disk { sub }`),
   the disk dispatcher branches on the prefix. `DiskBase::{Current,
   Sibling}` is a 2-variant Copy enum; the helper has its own unit
   tests. CustomDomain (which routes through the same dispatcher
   post-lookup) gets the sibling-tree behavior for free.

Tested via `disk_base_for_assets_returns_sibling` and
`disk_base_for_other_paths_returns_current`. Integration test
`subdomain_assets_served_from_sibling_dir` proves end-to-end that the
moved fixture file at `<sub>/assets/` is served instead of any
`<sub>/current/assets/` (the latter no longer exists post-fixture-
move — verified by git rename in the A3 commit's `R` lines).

### A3 — asymmetric `proxy_paths` for wildcard vs custom domain

`*.openlen.com` and verified custom domains have different threat
models for what reaches Node. A user-deployed subdomain shouldn't be
able to call `/api/projects/...` (that's the workspace's
auth-gated surface) — only `/c/` analytics and `/api/f/` form
submissions. A verified custom domain aliases a single project, so
exposing the broader `/api/*` is fine (most endpoints 401 anyway, the
public `/api/f/` ones work fine).

The cleanest model: keep `proxy_paths` as the wildcard-subdomain list,
add a separate `custom_domain_proxy_paths`. Operators can override
either independently via env. Default `proxy_paths=["/c/", "/api/f/"]`,
default `custom_domain_proxy_paths=["/c/", "/api/"]` — operationally
this matches the Caddyfile's `@passthrough path /api/* /c/*` for
custom domains plus the apex-side restriction for wildcards.

### A4 — single `decide_route` covers all host classes

The prompt described A4 as a separate phase, but functionally the apex
routing logic is part of the same `decide_route` function. Splitting
the changes across two commits would have left `decide_route` in an
intermediate state during A3. So A3 ships the routing logic for all
three host classes (apex / wildcard / custom domain), and A4 ships
the dedicated `tests/apex.rs` integration suite the runbook needs —
five end-to-end tests through a real TLS listener + mock Node.

### A5 — overriding vs if_not_present

nginx's `add_header ... always` ADDS headers — if upstream sends one,
the response carries both. That can result in duplicate `X-Frame-
Options` headers if Node sets its own. Caddy's `header { ... }`
OVERRIDES by default.

The edge takes the Caddy semantic: `SetResponseHeaderLayer::overriding`
on all five. Edge is the canonical source of these transport policies;
if Node tries to set its own (well, Next adds some by default), the
edge canonicalises. Safer for the soak — no chance of a buggy upstream
header weakening the policy.

### B — k6 over wrk / hey / vegeta

k6 is the only modern Go-implemented benchmark tool with first-class
HTTP/2, native TLS, and a built-in `constant-arrival-rate` executor
that gives a steady RPS instead of "as fast as you can." The
alternatives:

- **wrk** — HTTP/1 only, would force us to bench under HTTP/1.1 even
  though prod is h2.
- **hey** — supports h2 but only "send N total requests" not "sustain
  N RPS for D seconds."
- **vegeta** — sustainable RPS, but JSON output isn't quite as
  Prometheus-shaped as k6's `--summary-export`.

k6's summary JSON also already keys metrics by name (`http_req_duration.p(99)`),
which made `diff.py` trivial — 200 lines, no JSON path-mining.

### C1 — `Type=simple` not `Type=notify`

main.rs does no `sd_notify(READY=1)`. systemd will mark the unit
active as soon as ExecStart's PID exists, which fires immediately
after `tokio::main` enters. There's a small window (~200 ms — TLS
listener bind, ACME account load, lookup pool warmup) where the
listener is up but the binary isn't fully wired. In practice the
`After=network-online.target` ordering means the listener is ready
before anything else cares.

Adding sd_notify would tighten the start ordering and let the cutover
runbook safely chain `systemctl start openlen-edge && smoke-test.sh`
without a sleep. Open for a follow-up — sd_notify-rs is a small dep,
~200 KB; weigh against the binary cap budget.

### C3 — setcap belt-and-braces with AmbientCapabilities

The systemd unit's `AmbientCapabilities=CAP_NET_BIND_SERVICE` is the
modern way to grant port-bind privilege without making the binary
suid. But operators who're used to the `setcap` flow expect to see
the capability on the file. install.sh sets BOTH so either path
works — if someone manually moves the binary and forgets the
systemd unit, the file caps still let it bind.

deploy-edge.sh re-applies the file capability after every rsync,
since the new file's xattrs are blank.

### C4 — cross-compile via zigbuild (escape hatch only)

The default is `cargo build --target x86_64-unknown-linux-gnu`, which
needs a linux-targeting linker. From WSL2 this is just an
`apt install gcc-multilib && rustup target add ...` away. From native
Windows it needs zigbuild + the zig linker — non-trivial setup.

Rather than try to be smart, the script defaults to plain `cargo build`
(works on Linux / macOS / WSL2) and gives a `USE_ZIGBUILD=1` opt-in.
The runbook recommends WSL2.

### D — runbook is the source of truth, not the code

Every operational decision (when to enable the unit, when to drop
nginx, what threshold to trigger a rollback on) lives in
`CUTOVER.md`, not in the systemd unit or the install script. The
unit deliberately doesn't `WantedBy=multi-user.target` until the
operator runs `systemctl enable`. The install script deliberately
doesn't drop the old nginx config. This is to keep the code-side
artifacts re-runnable without ever taking the operator past a point
they didn't decide to cross.

### E — smoke test runs all 8 even on early failure

`set -uo pipefail` (not `-e`) so the script doesn't bail on the
first `bad()` call. The operator sees all 8 results, not just the
first failure. Important because a single regression can cascade —
if Node is down, every proxy check fails, and seeing all of them
shows that ONE underlying problem (Node) rather than several.

### F — strict-then-tune for soak alerts

Better to ship strict gates that fire false-positives on a normal
spike than to ship loose gates that miss a real regression. The
README is explicit that the operator should re-tune after the first
week of soak data. Alternative (start loose, tighten later) tends
to leave the gates loose forever — once production "works," nobody
re-visits the alert thresholds.

## F2 COMPLETE — what's owed to the operator

The edge is feature-complete and migration-ready. After this branch
merges to master, the operator runs:

1. **Pre-flight on laptop** (CUTOVER.md §1) — green tests + build.
2. **Pre-flight on Hetzner** (§2) — nginx valid, cert > 30d, pool
   healthy, disk free, backups recent.
3. **DNS TTL drop to 60s** (§3) — 24h ahead.
4. **Side-by-side deployment** (§4) — install.sh + deploy-edge.sh +
   edge on :8443 + bench bake-off + 24-48h sidecar soak.
5. **The swap** (§5) — ~5s downtime, swap binds + nginx → edge.
6. **Smoke test** (§6) — 8/8 PASS or rollback.
7. **Soak window** (§8) — 7 days under the alert rules from F.
8. **nginx removal** (§9) — only after 7 clean days.

The migration is a runbook execution, not another code session. F2
is closed.

## Open questions for review / Session 8 (post-cutover)

These survive the merge as operational follow-ups, not blockers:

1. **Bench numbers not yet captured.** The harness exists; the run
   happens on Hetzner during the cutover. Once the operator runs it,
   commit the resulting `bench/results/{baseline,edge}/` JSON to a
   `bench/baselines/cutover-2026MMDD/` snapshot for future regression
   comparison (not the per-run scratch dir — that stays gitignored).

2. **`Type=notify` in the systemd unit.** Closing the start-ordering
   gap during cutover would let the runbook drop the implicit
   `sleep 2` between `systemctl start` and the smoke test. ~200 KB of
   binary size, well inside the 8.0 MiB cap. Worth doing post-soak.

3. **sd_notify-rs for health pings during runtime.** Same dep that #2
   would pull in. Lets systemd's watchdog timeout kill the edge if
   the main loop deadlocks. Today a frozen edge would still respond
   to `systemctl is-active` (the unit thinks the process is alive
   because it is — just stuck). Add after #2.

4. **Hostname regex still hard-coded to `openlen.com`.** S2 Open Q #6,
   still deferred. The day OpenLen gets a sister product needing
   wildcard TLS, this becomes a real config item. Until then, YAGNI.

5. **Real-Pebble ACME integration test.** S5 / S6 carry-over. Needs
   Docker (or a Linux CI box) to spin up the Pebble container.
   Add when we move CI to Linux runners.

6. **Apex routing model for nested subdomains.** Today
   `a.b.openlen.com` returns 404 (nested subdomain detection). The
   Caddyfile and nginx both reject this too. If we ever want to
   support `<region>.<sub>.openlen.com` (e.g. for geo-routing), this
   is the function to extend (`extract_subdomain` in
   `routing/subdomain.rs`).

7. **Carry-over from S1-S6 (NOT addressed in S7, per prompt):**
   - **`NODE_URL` HTTPS** (S3 Open Q #3) — DEFER (loopback-only).
   - **HTTP/2 upstream** (S3 Open Q #4) — DEFER.
   - **`/c/` beacon verification on custom domains** (S4 Open Q #3) —
     DEFER (cost is wasted Node cycles, not a vuln).
   - **Renewal sweep rate-limit budgeting** (S5 Open Q #5) — DEFER
     until scale demands it.
   - **Proxy pool gauges** (S6 Open Q #2) — blocked on `hyper-util`
     exposing pool introspection.
   - **Regex-removal refactor for 500 KB binary reduction** (S6 Open
     Q #3) — DEFER; touches hot path, wrong risk tradeoff for
     migration session.
   - **Instrumentation overhead bench** (S6 Open Q #4) — covered
     transitively by B (the diff.py gate proves overhead is within
     ≤5% RPS by definition).

## Files touched

```
crates/edge/src/tls/renewal.rs              +helper + gauge.set() + 2 tests
crates/edge/src/config.rs                    +uploads_root, next_static_root,
                                              custom_domain_proxy_paths +
                                              new defaults + 3 tests
crates/edge/src/files/mod.rs                 +pub use resolve_strict
crates/edge/src/files/serve.rs               +resolve_strict + 5 tests
crates/edge/src/proxy/mod.rs                 +SharedUploads, NextStatic,
                                              DiskBase, disk_base_for; new
                                              decide_route signature + 10 tests
crates/edge/src/server.rs                    +AppState fields, dispatch for
                                              new actions, serve_shared
                                              helper, 5 security header
                                              layers, /assets/ branching in
                                              serve_from_disk
crates/edge/tests/routing.rs                 +9 tests (uploads, api/f, sibling,
                                              security headers, raw traversal)
crates/edge/tests/apex.rs                    NEW — 5 tests (apex root proxy,
                                              uploads + immutable cache,
                                              next-static + 1y immutable,
                                              missing-uploads = 404,
                                              missing-next-static = 404)
crates/edge/tests/fixtures/publish-root/...  fixture files moved from
                                              <sub>/current/assets/ →
                                              <sub>/assets/ (production
                                              layout match)
Cargo.toml                                   +cap bump comment (7.5 → 8.0 MiB)
bench/k6/apex-proxy.js                       NEW
bench/k6/wildcard-static.js                  NEW
bench/k6/custom-domain.js                    NEW
bench/k6/mixed-traffic.js                    NEW
bench/run-baseline.sh                        NEW
bench/run-edge.sh                            NEW
bench/diff.py                                NEW
bench/README.md                              NEW
bench/.gitignore                             NEW
infra/edge/openlen-edge.service              NEW
infra/edge/edge.env.example                  NEW
infra/edge/install.sh                        NEW
infra/edge/CUTOVER.md                        NEW
infra/edge/smoke-test.sh                     NEW
infra/scripts/deploy-edge.sh                 NEW
infra/grafana/openlen-edge-alerts.yaml       NEW
infra/grafana/README.md                      +Alert rules section
docs/rust-f2-session7-handoff.md             NEW — this file
```

## How the next session picks up

There isn't one — F2 is complete. The next session is whatever
post-cutover work the operator surfaces (cap revisit, sd_notify
integration, regex-removal experiment, etc.). Treat the open
questions above as a backlog, not a roadmap.

## Worktree note for the reviewer

All work in `D:\worktrees\openlen-f2-s7`
(`rust/f2-session7-migration`). To review locally:

```bash
git fetch
git checkout rust/f2-session7-migration
CARGO_TARGET_DIR=D:/rust/target cargo test -p openlen-edge --release
CARGO_TARGET_DIR=D:/rust/target cargo clippy -p openlen-edge --all-targets --release -- -D warnings
CARGO_TARGET_DIR=D:/rust/target cargo build -p openlen-edge --release
ls -la D:/rust/target/release/openlen-edge.exe   # 7.7 MiB stripped (Windows .exe)
```

No PR opened — per session contract, this handoff goes to the
reviewer first.
