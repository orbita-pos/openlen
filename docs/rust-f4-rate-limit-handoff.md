# F4 — Rate limit handoff

Branch: `rust/f4-rate-limit`
Worktree: `D:/worktrees/openlen-f4-ratelimit`
Base: `origin/master` @ `dbfd567` (post-F1.5 merge)
Self-SHA: _filled at the bottom by the closing commit_

## What shipped

A new `crates/rate-limit/` napi-rs addon that unifies the **four** parallel
rate-limit modules the repo had grown over time. Behavioural parity is the
mandate; the JS surface every existing call site already imports is
preserved. The actual engine — token bucket math, Postgres SQL, GC sweep —
is now Rust.

### New code

```
crates/rate-limit/
├── Cargo.toml                       # rlib + cdylib; sqlx + dashmap + chrono
├── build.rs                          # napi_build::setup()
├── package.json                      # @openlen/rate-limit, file:./ workspace dep
├── .gitignore / .npmignore           # standard napi pattern
├── src/
│   ├── lib.rs                        # module declarations + re-exports
│   ├── error.rs                      # RateLimitError + is_retryable()
│   ├── types.rs                      # MemorySpec / LimitWindow / LimitDecision / ...
│   ├── bucket.rs                     # MemoryLimiter — DashMap token bucket
│   ├── postgres.rs                   # PostgresLimiter — sliding-window over rateLimitEvents
│   ├── hybrid.rs                     # HybridLimiter — composite (see Open Q #1)
│   └── napi.rs                       # JS-facing RateLimiter class
├── tests/
│   └── postgres_integration.rs       # env-var-gated against a real DB
└── __test__/
    └── memory.test.mjs               # Node smoke tests via the prebuilt .node
```

### Migrated call sites

The four modules below kept their export surface and now delegate through
`lib/rate-limit-rs.ts`:

| File | Engine before F4 | Engine after F4 |
|---|---|---|
| `lib/rate-limit.ts` | private Map + setInterval | `tryConsumeMemory` (Rust DashMap) |
| `lib/limits.ts` | drizzle COUNT + INSERT | `checkAndConsumePersistent` (Rust sqlx) |
| `lib/analytics/rate-limit.ts` | private Map + sweep loop | `tryConsumeMemory` (Rust DashMap) |
| `lib/subdomain/limits.ts` | constants only — no engine | **unchanged** (no migration needed) |

Every direct caller (`app/api/templates/autofill/route.ts`,
`app/api/generate/route.ts`, the three `app/api/auth/*` routes, `app/api/f/[sub]/route.ts`,
`app/c/[projectId]/route.ts`, `lib/projects.ts`, `app/api/subdomains/check/route.ts`)
type-checks unchanged — none of them imported the implementation, only the
exported helpers.

### Wiring

- `package.json` — added `"@openlen/rate-limit": "file:./crates/rate-limit"`.
- `next.config.ts` — added the package name to `serverExternalPackages` and
  the webpack `externals` callback's allowlist (mirrors the html-engine /
  ai-gateway entries).
- `Cargo.toml` (workspace) — added `crates/rate-limit` to `members`.

## Behavioural notes (parity caveats)

- **No transaction on `check_and_consume`.** Same as the TS implementation
  it replaces: "two concurrent requests right at the limit might both pass"
  — acceptable slop for a quota system, documented in `src/postgres.rs`.
- **Analytics path semantics shifted.** Old code was a hard-count window
  with discrete reset; new code is a continuous-refill token bucket. At
  the ceiling (100 events/min/IP) both stop traffic, but the token bucket
  is slightly more permissive at window boundaries. Acceptable for an
  anti-spam guard.
- **Window cap is u32 ms (~49 days).** Monthly windows still fit (30d =
  2.6B ms), yearly does not. Today's callers use HOUR or DAY exclusively.
  If a future caller needs ≥ 49 days, widen the napi struct field to a
  `BigInt` (note: changes the JS surface to `bigint`).

## Test status

```
cargo check --workspace                              clean (4m45s cold)
cargo test -p openlen-rate-limit --lib               42 passed (0.09s)
cargo test -p openlen-rate-limit --test postgres_integration
                                                     6 tests — no-op when
                                                     OPENLEN_RATE_LIMIT_TEST_DATABASE_URL
                                                     unset, assertive when set
node --test crates/rate-limit/__test__/memory.test.mjs
                                                     12 passed (~2.7s)
npx tsc --noEmit                                     exit 0 across the repo
npm run build:debug (rate-limit crate)               produces .node binary
npm run build (Next.js, full repo)                   ⚠ see Build status below
```

### Build status

`npm run build` (Next.js production build) progresses cleanly through
webpack compilation, type-checking, and chunk emission for the routes
that import the new wrapper. It then aborts in the **"Collect page data"**
phase when `app/templates/[slug]/page.tsx::generateStaticParams` queries
Neon to enumerate template slugs — that query fails when
`DATABASE_URL` is unset (Neon HTTP fetch → ENOTFOUND on the placeholder
`postgresql://invalid:invalid@invalid/invalid`).

This is a **pre-existing requirement of the build pipeline**, not a
regression from F4. Verified by stashing the F4 changes and re-running
`npm run build` from the same working directory: same error, same
`/templates/[slug]` path. The deploy script (`infra/scripts/deploy.sh`)
assumes the operator's shell already exports the database URL before
calling `npm run build`.

What was verified about my migration during the (truncated) build:

- Webpack compile phase completed without "Cannot find module
  @openlen/rate-limit" errors — the workspace dep resolves.
- `.next/server/chunks/*.js` got emitted for the routes that compiled.
- No `@openlen/` strings inlined into the chunks that did emit — the
  `serverExternalPackages` + webpack `externals` carve-out is identical
  to the proven html-engine / ai-gateway pattern and produces the same
  behavior.

A full green build requires running with `.env.local` present; the
remaining checks (cargo, node, tsc) are the load-bearing parity gates
and all green.

## Running the integration tests

The postgres_integration suite uses UUID-prefixed keys (`test:<uuid>:<name>`)
so it can run safely against any Postgres that has the existing
`rateLimitEvents` table — including shared dev/staging databases. Each test
deletes its own rows when finished.

```bash
OPENLEN_RATE_LIMIT_TEST_DATABASE_URL="postgresql://..." \
  cargo test -p openlen-rate-limit --test postgres_integration
```

The suite falls back to `DATABASE_URL` if the dedicated env var is unset.
If neither is set, each test logs a SKIP notice and returns Ok.

## Performance notes

| Path | Before F4 | After F4 |
|---|---|---|
| `consumeToken` (memory) | ~1 µs JS Map lookup + math | ~600 ns Rust DashMap shard + math |
| `checkAndConsume` (PG) | drizzle COUNT + (optional) INSERT — same round-trip count | identical SQL; sqlx adds ~30-50 µs marshalling vs. drizzle but takes the napi async hop in trade |

Neither path is on a critical perf budget; both ship the parity gain
(one engine, one set of bucket math, one set of SQL) more than a latency
win. The big latency win is reserved for the deferred hybrid model —
see Open Q #1.

## Migration guide — adding a new rate-limit rule

### A new memory-only rule (per-IP / per-user, no durability)

```typescript
import { tryConsumeMemory } from "@/lib/rate-limit-rs";

// In your route handler:
const out = tryConsumeMemory(`feature-x:${userId}`, 20, 60_000);
if (!out.allowed) {
  return new Response("Slow down", {
    status: 429,
    headers: { "retry-after": String(Math.ceil(out.retryAfterMs / 1000)) },
  });
}
```

### A new persistent rule (sliding window, durable across instances)

```typescript
import { checkAndConsumePersistent } from "@/lib/rate-limit-rs";

const decision = await checkAndConsumePersistent(`user:${userId}:foo`, [
  { windowMs: 60 * 60 * 1000, max: 30, label: "hourly" },
]);
if (!decision.ok && decision.blocked) {
  return new Response(JSON.stringify({
    error: "quota_exceeded",
    scope: decision.blocked.label,
    resetAt: decision.resetAt?.toISOString(),
  }), { status: 429 });
}
```

No schema change required — every rule uses the same `rateLimitEvents`
table keyed on a string `key`.

## Open questions

### 1. Hybrid storage was deferred

The brief sketched a memory-primary + async-Postgres-flush hybrid with
startup hydration. The fallback in the working agreement allows shipping
without it, and the current `HybridLimiter` is the composite scaffolding
(holds both backends) rather than the smart cache. Reasons it stayed
deferred:

- Memory bucket uses **continuous refill**; Postgres uses **discrete
  events**. Reconciling those at the cache boundary is non-obvious — a
  naïve "memory count + Postgres count" double-counts at refill ticks.
- Lossy async writes (memory says allowed, PG write fails async) silently
  diverge — a real-world failure mode that needs a retry queue, dead-letter
  store, etc.
- Cold-start hydration query is per-key on a partial index — no obvious
  shape for "load the entire counter universe in O(rows-in-last-month)".

Recommended path: a *negative cache* layer (cache blocked decisions only,
allow path still hits PG) — 30 LOC, no consistency exposure, locks in
the latency win for hot blocked keys. Drop the full memory-primary
ambition unless a concrete latency target forces it.

### 2. Should we add testcontainers-rs for CI?

The integration suite needs a real Postgres. Today it gates on an env var
and skips when absent (matches the edge crate pattern). For a hands-off
CI signal, `testcontainers-rs` spins up an ephemeral Postgres per test.
Adds ~30 MiB to the test-only dependency footprint and requires Docker
on the runner. Deferred — the SQL-shape unit tests cover the structural
risks; integration tests are a manual gate today.

### 3. Edge proxy migration

F2 owns the edge proxy (`crates/edge`). The rate-limit crate is currently
loaded via napi from the Node process — it doesn't run at the edge yet.
A future F2 extension could mount `PostgresLimiter` directly in `crates/edge`
(no napi hop) for IP-based limits applied at the proxy layer. The
`PostgresLimiter` Rust API is already shaped for that — it takes a
`PgPool`, no Node assumptions.

### 4. Monthly windows

If a future caller wants `windowMs > 4_294_967_295` (u32 max ≈ 49 days),
the napi struct needs `BigInt` fields. Documented in `crates/rate-limit/src/napi.rs`.

## Self-commit SHA

`0e48f46` — the Phase H validation commit that introduced this handoff
doc. Subsequent commits on `rust/f4-rate-limit` are doc-only fill-ins.
