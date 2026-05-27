# F1 Rust HTML engine — Session 8 handoff

Branch: `rust/f1-session8-optimize-migration` (off `master`'s `e4b4121` = F1 S7 merge tip + F2 S5 ACME merge tip, **not** pushed, no PR).

```
9fc5142  docs(rust): F1 session-8 handoff — Sem 10 Phase 3 shipped
5dd1592  feat(rust): F1 S8 — migrate lib/publish/optimize-html.ts via async shadow-soak
a5304b3  feat(rust): F1 S8 — extend shadow-soak harness with asyncShadowCompare
```

> Worktree note. Work happened entirely in `D:\worktrees\openlen-f1-s8` (created via `git worktree add -b rust/f1-session8-optimize-migration D:/worktrees/openlen-f1-s8 master`). Zero overlap with the parallel `D:\worktrees\openlen-f2-edge` (F2 S6 metrics) session — F1 S8 only touches Node-side files (`lib/shadow-soak.ts` additive change + `lib/publish/optimize-html.ts` rewrite + two new test files). The Rust crate at `crates/html-engine/src/**` was not modified — `optimize_for_publish` is the same artifact S4 shipped.

## Milestones completed against the 12-week plan

| Sem  | Milestone | Status |
|------|-----------|--------|
| 1-2  | Bootstrap napi-rs + parse/serialize round-trip | **Done** (S1) |
| 3-4  | ID-tag ops engine | **Done** (S1) |
| 5-6  | Normalize chain (7 idempotent passes) | **Done** (S2) |
| 7    | Sanitizer + slot_path single gate | **Done** (S3) |
| 8    | Minify + CSS opt | **Partial — Option C (S4)** (Tailwind bake deferred to Sem 8.5) |
| 9    | Streaming API for F3 AI Gateway | **Done** (S5) |
| 10   | Node migration foundation | **Done** (S6 Phase 1) |
| 11   | Shadow soak — call-site rollout | **Done — Phase 3 (last cheerio-dependent module migrated)** |
| 12   | Cleanup — delete cheerio | **Unblocked — pending soak window before F1 S9** |

Stopping point: `lib/publish/optimize-html.ts` — the final cheerio-importing module in the migration target list — now routes through `asyncShadowCompare`. All four migration targets called out by the playbook (`sanitize.ts` POC + `html-ops.ts` + `normalize.ts` + `optimize-html.ts`) are behind shadow-soak at default `shadow-prefer-ts`. Production behaviour is byte-equal to pre-migration; the Rust engine runs in shadow on every call and divergences surface as `[shadow-soak] divergence` JSON warnings carrying byte/timing deltas. After one soak window (suggest 7 days), F1 S9 can flip default modes to `rust` and delete every `import * as cheerio from "cheerio"` line in the repo.

## Acceptance criteria — F1 global

| Criterion | State | Notes |
|-----------|-------|-------|
| Chat-turn HTML overhead p95 < 30 ms (today ~150 ms) | Still on track. Real measurement deferred to post-cutover (F1 S9). |
| Publish p95 < 200 ms | Same — post-cutover. |
| Lighthouse mobile ≥95 across 20 templates | Same — needs Sem 8.5 (Tailwind bake in Rust) + measurement. |
| Zero `data-slot-path=` leaks in 1000 adversarial docs | Hardened in S7. S8 adds defense-in-depth via the optimize-html shadow path — Rust's gate fires `errorShapeMismatch=true` on any slot-path input that survives the upstream `detectSlotPath` check. |
| Compiles clean Windows x64 + Linux x64 with CI prebuilds | Unchanged from S7 (workflow exists, not yet exercised). |
| Bundle Node −150 KB after deleting cheerio | **F1 S9 / Sem 12 — UNBLOCKED.** All cheerio-importing modules now route via shadow-soak. After soak window + cutover flip, deletion is mechanical. |
| Tests Rust < 5 s | Unchanged from S7 (366 tests across the crate, zero Rust source changes). |

### Sem 10 Phase 3 acceptance specifically

| Sem 10 Phase 3 acceptance | State |
|---|---|
| `lib/publish/optimize-html.ts` — public export routes via shadowCompare | **Done.** `optimizeHtmlForProduction` (async) routes via `asyncShadowCompare`. TS impl preserved as `optimizeHtmlForProductionTs` (also exported for direct testing); Rust adapter is `optimizeHtmlForProductionRust`. |
| New `asyncShadowCompare` extension to the harness | **Done.** `lib/shadow-soak.ts` adds an async variant alongside the existing sync `shadowCompare`. Tail logic (compare + log + return-per-mode) is duplicated rather than refactored into a shared helper to keep the sync surface byte-equal — its 20 existing tests still pass without modification. |
| ≥15 new TS tests covering the parity matrix | **18 in `lib/publish/optimize-html.test.ts`** + **9 in `lib/shadow-soak.test.ts`** = **27 net new TS tests**. |
| Tests pass in `ts` / `rust` / `shadow-prefer-ts` / `shadow-prefer-rust` modes | **Verified.** Per-test coverage of all four modes across optimize-html + a smaller matrix for the async harness itself. |
| `npx tsc --noEmit` verde | **Verified** project-wide. |
| `cargo build` + `test` + `clippy -D warnings` + `fmt --check` verde | **Verified.** Zero Rust source changes; the gates still run clean. 367 cargo tests pass across 27 test binaries. |
| `npm run test:node` verde | **Verified.** 61 FFI smoke tests pass (same as S6/S7). |
| Production behaviour unchanged at default mode | **Verified by tests.** Default `shadow-prefer-ts` returns the TS arm verbatim; the Rust arm runs in shadow only. The dev-mode `NODE_ENV !== "production"` skip is preserved exactly so editor preview is unaffected. |
| Decision documented for the Tailwind-bake gap | **Option A.** See "Decisions made this session" below for the trade-off — short version: ship the migration *as-is* with default deep-equal so every prod publish logs byte deltas as data for Sem 8.5 (the Rust Tailwind bake session). Actionable signal is `errorShapeMismatch=true`; expected noise is everything else. |

## Surface migrated (TS public exports → shadowCompare-routed)

Adding to the S7 table:

| Public export | Module | Default mode | Async? | Equality strategy | Env-var slug |
|---|---|---|---|---|---|
| `sanitizeFilledHtml` | `lib/style-match/autofill/sanitize.ts` | `shadow-prefer-ts` | no | adapter normalises `metaRefresh` counter | `OPENLEN_SHADOW_SANITIZE_FILLED_HTML` |
| `tagWithOpIds` | `lib/html-ops.ts` | `shadow-prefer-ts` | no | deep-equal | `OPENLEN_SHADOW_TAG_WITH_OP_IDS` |
| `stripOpIds` | `lib/html-ops.ts` | `shadow-prefer-ts` | no | deep-equal | `OPENLEN_SHADOW_STRIP_OP_IDS` |
| `parseOps` | `lib/html-ops.ts` | `shadow-prefer-ts` | no | **custom** — ops structurally; errors by count | `OPENLEN_SHADOW_PARSE_OPS` |
| `applyOps` | `lib/html-ops.ts` | `shadow-prefer-ts` | no | **custom** — html byte-equal; appliedCount ignored | `OPENLEN_SHADOW_APPLY_OPS` |
| `resolveOpIdByPath` | `lib/html-ops.ts` | `shadow-prefer-ts` | no | deep-equal | `OPENLEN_SHADOW_RESOLVE_OP_ID_BY_PATH` |
| `buildScopedView` | `lib/html-ops.ts` | `shadow-prefer-ts` | no | deep-equal | `OPENLEN_SHADOW_BUILD_SCOPED_VIEW` |
| `normalizeBornCanonical` | `lib/normalize.ts` | `shadow-prefer-ts` | no | deep-equal (byte-equal string) | `OPENLEN_SHADOW_NORMALIZE_BORN_CANONICAL` |
| **`optimizeHtmlForProduction`** | **`lib/publish/optimize-html.ts`** | **`shadow-prefer-ts`** | **YES** | **deep-equal (intentional — log every Tailwind-bake-vs-minify divergence as Sem 8.5 telemetry)** | **`OPENLEN_SHADOW_OPTIMIZE_HTML_FOR_PRODUCTION`** |

Every cheerio-importing module in the production HTML pipeline is now behind shadow-soak. The only remaining cheerio import outside the migrated modules is the soft-fallback `consolidateUnsplashCredits` in `lib/publish/filesystem.ts`, which is unrelated to the Rust engine surface and can stay or migrate independently.

## Decisions made this session

### 1. Option A — migrate as-is, accept the Tailwind-bake gap in shadow logs

The session brief offered three options for the Tailwind bake gap:

- **A** Migrate the public function as-is, with a loose equalityFn that swallows the deterministic bake-vs-minify divergence. Default `shadow-prefer-ts` means production keeps baking. The shadow log captures byte deltas as Sem 8.5 planning data.
- **B** Skip this session entirely; wait for Sem 8.5 (Rust Tailwind bake) before migrating.
- **C** Hybrid: split the public function into `tailwindBake` (kept in TS) + `htmlMinify` (migrated). The TS side stays the bake pipeline; only the post-bake minify routes through shadow-soak.

**I shipped A** (the user's vote in the session brief). Reasoning:

- **Cheerio cleanup unblocks NOW.** The whole point of S7+S8 is to land the call-site cutover so F1 S9 can delete cheerio. Option B leaves the cheerio import in `optimize-html.ts` alive indefinitely, blocking the bundle-shrink milestone. Option C also keeps cheerio alive in the bake half. Option A removes the *call* from the migration target list — once the soak shows the Rust path is stable, S9 can delete the TS arm entirely.
- **No artificial split.** Option C would require inventing a TS minify step where none exists today (the current TS module is bake-only). That's new code to write + new code to test + new code to delete in S9, all for the sake of a tidier shadow signal. Not worth it.
- **The divergence IS the data.** The brief framing of "Rust output is ~150 KB larger than TS output" was slightly inverted — in practice, TS *adds* bytes (the Tailwind bake inlines several KB of CSS) and Rust *removes* bytes (whitespace + inline CSS minify). Either way, the deltas-per-publish dataset is exactly what Sem 8.5 needs to plan its scope. Loose equalityFn would silence that signal. The default deep-equal logs it.
- **The actionable signal is `errorShapeMismatch=true`.** When TS passes through a slot-path-containing HTML (it has no gate) but Rust throws (its gate catches the marker), the shadow record carries `errorShapeMismatch: true`. Operators filter on that flag to find genuine bugs; the bake-gap noise is everything else and ignorable in normal review.

**Specifically not implemented this session:**

- **Tailwind bake in Rust.** This is Sem 8.5, a separate session. The shadow record dataset gives Sem 8.5 the byte-delta evidence it needs to scope (full-matcher port vs. Node-bridge per S4's recommendation).
- **Custom equalityFn that hides the bake-gap.** Considered and rejected. Filtering the production log on `errorShapeMismatch=true` is the lighter solution.

### 2. `asyncShadowCompare` extension to the harness (not a refactor of `shadowCompare`)

The TS impl is async (postcss + tailwindcss). The S6 harness is sync only. Three paths to fix this:

- **(a)** Refactor `shadowCompare`'s tail (compare + log + return-per-mode) into a private helper, then add `asyncShadowCompare` reusing it.
- **(b)** Add `asyncShadowCompare` with the tail duplicated verbatim from the sync `shadowCompare`. Existing sync function untouched.
- **(c)** Make `shadowCompare` polymorphic (detect Promise return, branch internally). Most clever, least surgical.

**Shipped (b).** Reasoning: the sync `shadowCompare` and its 20 existing tests don't move at all — zero refactor risk. The duplication is ~30 lines of straight-line code; refactoring into a shared helper buys minor DRY and costs the migration confidence in S6/S7 surfaces. If a third async migration ever lands, factor then.

### 3. `optimizeHtmlForProductionTs` is exported (not just internal)

The TS arm is exported in addition to being passed to `asyncShadowCompare`. Reason: the test file exercises the arm directly to verify the rename refactor (renamed-Ts impl) didn't drop any behaviour. The export is harmless — no other consumer imports it. F1 S9's cutover will inline the Rust arm and delete the TS arm + this export.

### 4. Dev-mode skip stays at the TOP of the public function

The original TS impl had a `NODE_ENV !== "production"` skip at the top that returned `{ html, baked: false, cssBytes: 0 }` verbatim. I kept the skip at the top of the wrapped function — not inside the TS arm — so neither arm runs in dev. Reasoning:

- The skip exists because Next.js webpack mangles tailwindcss's path resolution on Windows; running the TS arm in dev would crash.
- The Rust arm could in principle run in dev (no webpack, just FFI), but firing it would cause every editor-preview publish call to log a divergence (TS skips, Rust minifies). That's pure noise from dev pollution.
- Dev publish flows aren't exercised on the publish path anyway — the editor preview iframe never calls `optimizeHtmlForProduction`.

If dev telemetry is ever wanted, the gate can move down into the TS arm only. For now, keep the top-of-function gate.

### 5. Rust adapter throws on `html: null` (slot-path gate fired)

Mirrors the sanitize POC's adapter behaviour (S6 §"Engine choices #3"). The TS arm has no slot-path gate, so any input containing `data-slot-path=` passes through TS verbatim (the upstream `detectSlotPath` from S7 is supposed to catch it before optimize runs). When the Rust arm sees one, it throws via `throw new Error("optimize gate fired (slot-path detected): ...")`. The shadow harness records the asymmetry as `errorShapeMismatch: true`.

In production this surfaces any caller forgetting to call `detectSlotPath` upstream — a defense-in-depth net. In tests, `forced rust mode + slot-path` exercises the throw explicitly.

## Test inventory

**Rust** (`cargo test -p openlen-html-engine --tests --no-fail-fast` in the worktree): 367 tests across 27 test binaries, zero Rust source changes from S7. (S6/S7 handoffs report 366; the current worktree counts 367 — likely an off-by-one in the prior accounting since no Rust source has moved between S5–S8.)

**Node FFI smoke** (`npm run test:node` in `crates/html-engine`): 61 tests, unchanged from S6/S7.

**TS suites** (`npx tsx --test <file>` from worktree root):

| File | Tests (S8) | Δ vs S7 | Coverage |
|------|-----------:|--------:|----------|
| `lib/html-engine.test.ts` | 27 | 0 | Unchanged from S7. |
| `lib/shadow-soak.test.ts` | **29** | **+9** | 9 new tests for `asyncShadowCompare`: mode resolution × 4 (ts / rust async / shadow-prefer-ts / shadow-prefer-rust), divergence logging, error-shape × 2 (ts-only throws / rust-only throws), env-var override, custom equalityFn. |
| `lib/style-match/autofill/sanitize.test.ts` | 15 | 0 | Unchanged from S7. |
| `lib/html-ops.test.ts` | 39 | 0 | Unchanged from S7. |
| `lib/normalize.test.ts` | 17 | 0 | Unchanged from S7. |
| `lib/publish/optimize-html.test.ts` | **18** | **+18 (new file)** | 2 dev-mode passthrough + 3 default-mode (empty / no-CDN / slot-path) + 2 forced-ts + 5 forced-rust (no-CDN / slot-path throw / mixed-case slot-path throw / empty / idempotence) + 2 shadow-prefer-rust + 3 direct-arm + 1 state-leak smoke. |
| **Total TS** | **145** | **+27** | |

Sums: pre-S8 = 118 (per S7 handoff); post-S8 = 145. Net new TS tests for the session: **+27**, above the ≥15 acceptance bar.

### How to run (in the worktree)

```bash
# Rebuild the binding (one-time per crate src change — N/A this session):
cd crates/html-engine
CARGO_TARGET_DIR=D:/rust/target npm install --no-audit --no-fund
CARGO_TARGET_DIR=D:/rust/target npm run build       # ~3 min cold, ~30 s warm
CARGO_TARGET_DIR=D:/rust/target cargo test -p openlen-html-engine --tests --no-fail-fast
npm run test:node                                    # 61 FFI smoke tests

# Link workspace symlink (one-time per root deps change — N/A this session):
cd ..
PUPPETEER_SKIP_DOWNLOAD=1 npm install --no-audit --no-fund

# Run S8 TS suites:
npx tsx --test lib/shadow-soak.test.ts                 # 29 pass
npx tsx --test lib/publish/optimize-html.test.ts       # 18 pass
# Regression net (S6 + S7):
npx tsx --test lib/html-engine.test.ts                 # 27 pass
npx tsx --test lib/html-ops.test.ts                    # 39 pass
npx tsx --test lib/normalize.test.ts                   # 17 pass
npx tsx --test lib/style-match/autofill/sanitize.test.ts  # 15 pass

# Type check (whole project):
npx tsc --noEmit                                       # exit 0

# Lint Rust:
CARGO_TARGET_DIR=D:/rust/target cargo clippy -p openlen-html-engine --all-targets -- -D warnings
CARGO_TARGET_DIR=D:/rust/target cargo fmt --check
```

## Files touched

```
lib/shadow-soak.ts                                modified (+ asyncShadowCompare ~50 lines, additive)
lib/shadow-soak.test.ts                           modified (+ 9 asyncShadowCompare tests)
lib/publish/optimize-html.ts                      modified (rename TS impl, add Rust adapter, route via asyncShadowCompare)
lib/publish/optimize-html.test.ts                 new (18 parity / forced-mode / direct-arm tests)
docs/rust-f1-session8-handoff.md                  new (this file)
```

Zero modifications to `crates/html-engine/src/**`. Zero modifications to any `app/api/**` route. Zero modifications to `lib/html-engine.ts` (the wrapper already exposed `optimizeForPublish` since S6). Zero modifications to S7's migrated files (`lib/html-ops.ts`, `lib/normalize.ts`, `lib/style-match/autofill/sanitize.ts`).

cheerio still in `package.json`. Pre-cutover: it backs the TS arms of four `shadowCompare` sites. Post-cutover (F1 S9): all four arms get deleted, the import is removed from each file, the dep is dropped from `package.json`.

## Open questions for the next session / the reviewer

1. **Soak window length.** With four migration call sites live in `shadow-prefer-ts`, F1 S9's cutover decision needs a soak window where the production shadow log shows zero `errorShapeMismatch=true` records. Suggest 7 days as a first pass; could shorten if logs stay quiet faster than that.

2. **Tailwind-bake byte-delta histogram.** Default `shadow-prefer-ts` on the optimize-html site logs a divergence on every prod publish carrying `tsBytes` / `rustBytes`. After one week of prod traffic, plot the histogram of `(rustBytes - tsBytes)` to size Sem 8.5 (Rust Tailwind bake). Two extreme outcomes:
   - Delta is consistently *negative* (Rust smaller despite no bake) → confirms minify dominates on pages with few Tailwind classes; full-matcher port for Sem 8.5 is overkill, the Node-bridge approach (S4 §"Engine choices #1" option b) suffices.
   - Delta is consistently *positive and large* (Rust significantly bigger because TS bake adds CSS the runtime would otherwise fetch) → Sem 8.5 must port a real Tailwind matcher to Rust to match TS's bytes-on-disk; the Node-bridge is the safer interim.

3. **F1 S9 cleanup checklist.** Sequence:
   1. Wait for soak window with zero `errorShapeMismatch=true` records across all four shadow sites.
   2. Flip the default `fallbackMode: "shadow-prefer-ts"` to `"rust"` in each call site (one-line edits across 4 files).
   3. Soak again for a shorter window (~2 days) to confirm production tolerates Rust-as-source-of-truth.
   4. Inline each `*Rust` arm into the public function (delete the `*Ts` arm + `shadowCompare` indirection).
   5. Delete cheerio imports across `lib/html-ops.ts`, `lib/normalize.ts`, `lib/publish/optimize-html.ts`, `lib/style-match/autofill/sanitize.ts`.
   6. `npm uninstall cheerio` — check `package.json` / `package-lock.json`.
   7. Verify bundle shrink with `npm run build` + `du -sh .next/standalone` before/after. Target: −150 KB per F1 acceptance.

4. **`applyOps` cascade rate, carried from S7.** Still gated on production shadow data. F1 S9 owns the decision: accept the underreported `appliedCount` (custom `equalityFn` already masks it) OR port `apply_ops` to kuchikiki (~1 day per S1 estimate). Defer to the F1 S9 prep step.

5. **Self-closing parser quirk in BOTH `parseOps` impls (carried from S7).** Symmetrical bug = symmetrical fix; not user-visible until Kimi starts emitting mixed envelopes. Park as a known issue; F1 S9 can fix while cleaning up the `parseOps` Ts/Rust split.

6. **Async harness — refactor for DRY in a future session.** The tail logic in `asyncShadowCompare` is duplicated from `shadowCompare`. Acceptable for one async site; if a second async migration lands, factor into a shared `evaluateAndReturn<T>(name, args, tsValue, tsError, tsMillis, rustValue, rustError, rustMillis, mode, options): T` private helper that both surfaces call. The current duplication is ~30 lines and isolated.

7. **CI prebuild workflow (carried from S6/S7).** `.github/workflows/rust-prebuild.yml` still hasn't fired — no `html-engine-v*` tag has been pushed. F1 S9 cutover is the natural trigger: once the worktree binary is the source of truth for prod, distributing prebuilds via GH Releases matters more than today (Hetzner deployer rebuilds in ~3 min, fine for now; matters when CI machines stop having Rust toolchain).

8. **F2 S6 metrics is in a parallel worktree.** That session can run independently — it touches only `crates/edge/` + `infra/grafana/`. F1 S8 closes Sem 10 Phase 3; the next F2 session reviews edge cache hit rates from prod and decides whether Sem 12 (cache-warm probe) is worth the complexity.

## How the next session should pick up

```bash
# Branch is local-only. From master tip <e4b4121 = F1 S7 merge>:
git checkout rust/f1-session8-optimize-migration

# Rebuild the binding once per crate src change (N/A from S8):
cd crates/html-engine
CARGO_TARGET_DIR=D:/rust/target npm install --no-audit --no-fund
CARGO_TARGET_DIR=D:/rust/target npm run build

# Link workspace symlink (once per root deps change):
cd ..
PUPPETEER_SKIP_DOWNLOAD=1 npm install --no-audit --no-fund

# Validate state:
npx tsc --noEmit                                              # exit 0
CARGO_TARGET_DIR=D:/rust/target cargo test -p openlen-html-engine --tests   # 367 pass
crates/html-engine/$ npm run test:node                         # 61 FFI smoke
npx tsx --test lib/shadow-soak.test.ts lib/publish/optimize-html.test.ts lib/html-engine.test.ts lib/html-ops.test.ts lib/normalize.test.ts lib/style-match/autofill/sanitize.test.ts   # 145 pass
```

Suggested next milestone: **F1 S9 — Cheerio cleanup + cutover flip.** Wait for soak window on master (7 days suggested for the first batch of `shadow-prefer-ts` migrations). Then sequence per "Open question #3" above. Target: F1 acceptance line "Bundle Node −150 KB after deleting cheerio" lands.

No PR. The user owns the merge.
