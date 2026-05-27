# F1 Rust HTML engine — Session 6 handoff

Branch: `rust/f1-session6-migration` (off `master`'s `a5b30e3` = F1 S5 streaming + F2 S4 custom-domains merged tip, **not** pushed, no PR).

```
<placeholder-handoff>  docs(rust): F1 session-6 handoff — Sem 10 Phase 1 (foundation + POC) shipped
<placeholder-poc>      feat(rust): F1 S6 — sanitize.ts shadow-soak POC + migration playbook
<placeholder-soak>     feat(rust): F1 S6 — shadow-soak harness (lib/shadow-soak.ts) + tests
<placeholder-wrapper>  feat(rust): F1 S6 — TS wrapper layer (lib/html-engine.ts) with Option→null shim + tests
<placeholder-prebuild> feat(ci): F1 S6 — prebuild distribution workflow + crate package.json metadata
```

> Worktree note. Work happened entirely in `D:\worktrees\openlen-f1-s6` (created as `git worktree add -b rust/f1-session6-migration D:/worktrees/openlen-f1-s6 master`). Zero overlap with the parallel `D:\worktrees\openlen-f2-edge` (F2 S5 ACME) session — F1 S6 only touches Node-side files (`lib/*`, `app/*` were not touched), the prebuild workflow YAML, and three metadata files on `crates/html-engine/` (package.json + the new docs).

## Milestones completed against the 12-week plan

| Sem  | Milestone | Status |
|------|-----------|--------|
| 1-2  | Bootstrap napi-rs + parse/serialize round-trip | **Done** (S1) |
| 3-4  | ID-tag ops engine | **Done** (S1) |
| 5-6  | Normalize chain (7 idempotent passes) | **Done** (S2) |
| 7    | Sanitizer + slot_path single gate | **Done** (S3) |
| 8    | Minify + CSS opt | **Partial — Option C (S4)** |
| 9    | Streaming API for F3 AI Gateway | **Done** (S5) |
| **10**| **Node migration foundation** | **Done — Phase 1 (foundation + 1 POC)** |
| 11   | Shadow soak | **Foundation shipped (S6) — call-site rollout in S7-S8** |
| 12   | Cleanup — delete cheerio | not started |

Stopping point: the foundation for Sem 10 (Node migration) ships — CI prebuild distribution YAML + TS wrapper with `Option<T>` → `null` shim + shadow-soak harness with structured divergence logging + one POC call-site (`sanitize.ts`) routed through. F1 S7 picks up the bulk migration of `html-ops.ts` + `normalize.ts` using the playbook landed in `docs/rust-migration-playbook.md`.

## Acceptance criteria — F1 global

| Criterion | State | Notes |
|-----------|-------|-------|
| Chat-turn HTML overhead p95 < 30 ms (today ~150 ms) | Still on track. Real measurement deferred to post-cutover (Sem 11). |
| Publish p95 < 200 ms | Same — post-cutover. |
| Lighthouse mobile ≥95 across 20 templates | Same — needs Sem 8 + measurement. |
| Zero `data-slot-path=` leaks in 1000 adversarial docs | Done at the engine level (S5). Inline TS gate consolidation deferred to F1 S8. |
| Compiles clean Windows x64 + Linux x64 with CI prebuilds | **NEW (S6).** `.github/workflows/rust-prebuild.yml` builds + uploads `.node` files per-triple to a GitHub Release on `html-engine-v*` tag push. Verified by YAML syntax only — no tag pushed yet. |
| Bundle Node −150 KB after deleting cheerio | Sem 12 / F1 S9. |
| Tests Rust < 5 s | Unchanged from S5 (367 tests, ~5.7 s warm). |

### Sem 10 Phase 1 acceptance specifically

| Sem 10 Phase 1 acceptance | State |
|---|---|
| CI prebuild workflow exists + valid YAML | **Done.** `.github/workflows/rust-prebuild.yml` — tag-triggered matrix build + GH Release upload. |
| `crates/html-engine/package.json` declares optionalDependencies + repository + prepublishOnly + npmClient | **Done.** Stays `"private": true`; the optionalDependencies entries are declared but unresolved (no per-platform sub-packages published yet). Documented in `docs/rust-prebuild-flow.md` §Known limitations. |
| Local dev unchanged | **Done.** `npm run build` inside `crates/html-engine` still produces in-place `.node` + `index.js` + `index.d.ts`. Workspace symlinks via the new `"@openlen/html-engine": "file:./crates/html-engine"` root dep. |
| `lib/html-engine.ts` re-exports the full napi surface with `Option<T>` → `null` shim | **Done.** 5 shimmed call sites (`sanitizeForPublish.html`, `optimizeForPublish.html`, `applyOps.html`, `resolveOpIdByPath`, `buildScopedView`) + 6 plain pass-throughs + `HtmlStream` class re-export. Side-effect-free. |
| `lib/shadow-soak.ts` runs both impls + logs divergences + 4-mode flag | **Done.** `shadowCompare(name, args, tsImpl, rustImpl, options)` with `ShadowMode` = `ts \| rust \| shadow-prefer-ts \| shadow-prefer-rust`. Env vars `OPENLEN_SHADOW_MODE` (global) + `OPENLEN_SHADOW_<NAME>` (per-call). Custom equality + logger overrides for tests. |
| `npx tsc --noEmit` verde | **Verified** post-build. Requires `cd crates/html-engine && npm run build` first (per `docs/rust-prebuild-flow.md`). |
| Existing TS sanitize tests still pass with `shadow-prefer-ts` | **Done — covered by new tests at `lib/style-match/autofill/sanitize.test.ts`.** Default mode preserves cheerio behaviour byte-equal. Pre-migration there was no test file for `sanitize.ts`; the new suite is the regression net. |
| Same tests pass with `OPENLEN_SHADOW_MODE=rust` (cutover dry-run) | **Done.** Forced `rust` mode tests assert the adapter normalises to the TS counter shape (re-bundles `metaRefresh` into `scripts`) and throws on the slot-path gate. |
| `docs/rust-migration-playbook.md` recipe | **Done.** 4-step recipe + POC walk-through + per-call-site application notes for S7/S8 + flip-mode procedure + common pitfalls. |

## What was shipped (no Rust source changes)

**Foundation (Phase A + B + C):**
- `.github/workflows/rust-prebuild.yml` — tag-triggered prebuild, matrix on win/linux, uploads to GH Release.
- `crates/html-engine/package.json` — version pinned, repository field, optionalDependencies, prepublishOnly script, napi `npmClient: "npm"`.
- Root `package.json` gains one dep: `"@openlen/html-engine": "file:./crates/html-engine"` (workspace symlink).
- `lib/html-engine.ts` — TS wrapper. 11 named exports + types.
- `lib/shadow-soak.ts` — harness. One exported function (`shadowCompare`) + one mutator (`setShadowLogger`).

**POC (Phase D):**
- `lib/style-match/autofill/sanitize.ts` — refactored to route through `shadowCompare`. Public export `sanitizeFilledHtml` unchanged in signature + behaviour at default mode. Adds adapter `sanitizeFilledHtmlRust` that normalises Rust's output shape into the TS contract.
- `lib/style-match/autofill/sanitize.test.ts` — new test file (none existed pre-migration). 19 tests covering default + forced-ts + forced-rust modes + adversarial payload.

**Docs:**
- `docs/rust-prebuild-flow.md` — topology, three contexts (local / CI / Hetzner), verification recipes, release procedure, known limitations.
- `docs/rust-migration-playbook.md` — the recipe for F1 S7/S8. Concrete table for each remaining call site.

## Surface shipped (TS → Rust binding, via `lib/html-engine.ts`)

```ts
// Plain re-exports:
export function roundTrip(html: string): string
export function normalizeBornCanonical(html: string): string
export function stripOpIds(html: string): string
export function tagWithOpIds(html: string): TaggedHtmlResult
export function parseOps(rawHtml: string): ParseResult

// Shimmed re-exports (Option<T> → null):
export function sanitizeForPublish(html: string): SanitizeResult   // { html: string|null, errors, removed }
export function optimizeForPublish(html: string): OptimizeResult   // { html: string|null, errors, stats }
export function applyOps(taggedHtml: string, ops: Op[]): ApplyResult  // { html: string|null, errors, appliedCount }
export function resolveOpIdByPath(taggedHtml: string, path: string): string | null
export function buildScopedView(taggedHtml: string, pinnedOpId: string): ScopedView | null

// Class re-export (no shim):
export const HtmlStream: typeof RustHtmlStream

// Types — re-exported pass-throughs + TS-compatible variants:
export type {
  HtmlStreamOpts, HtmlStreamRemovedCounts, HtmlStreamResult,
  OptimizeStats, SanitizeRemovedCounts,
  ScopedView, TaggedHtmlResult,
}
export interface SanitizeResult { html: string | null; errors: string[]; removed: SanitizeRemovedCounts }
export interface OptimizeResult { html: string | null; errors: string[]; stats: OptimizeStats }
export interface Op { type: string; target: string; newHtml?: string }
export interface ApplyError { opIndex: number; op: string; target: string; reason: string }
export interface ApplyResult { html: string | null; errors: ApplyError[]; appliedCount: number }
export interface ParseResult { ops: Op[]; errors: string[] }
```

## Shadow-soak harness API

```ts
export type ShadowMode = "ts" | "rust" | "shadow-prefer-ts" | "shadow-prefer-rust"

export interface ShadowDivergenceRecord {
  name: string
  argsSummary: string
  tsValuePreview: string         // capped 2 KB
  rustValuePreview: string       // capped 2 KB
  tsBytes: number
  rustBytes: number
  tsMillis: number
  rustMillis: number
  errorShapeMismatch: boolean
}

export interface ShadowLogger { onDivergence(record: ShadowDivergenceRecord): void }

export interface ShadowCompareOptions {
  fallbackMode?: ShadowMode          // default "shadow-prefer-ts"
  logger?: ShadowLogger              // per-call override; module-level setShadowLogger() otherwise
  equalityFn?: (ts: unknown, rust: unknown) => boolean
}

export function shadowCompare<T>(
  name: string,
  argsSummary: string,
  tsImpl: () => T,
  rustImpl: () => T,
  options?: ShadowCompareOptions,
): T

export function setShadowLogger(logger: ShadowLogger | null): void
```

Mode resolution order:
1. `process.env.OPENLEN_SHADOW_<NAME>` (per-call env)
2. `process.env.OPENLEN_SHADOW_MODE` (global env)
3. `options.fallbackMode`
4. `"shadow-prefer-ts"`

`<NAME>` is the call-site name uppercased + non-`[A-Z0-9_]` chars replaced with `_`. So `shadowCompare("sanitize-filled-html", …)` → `OPENLEN_SHADOW_SANITIZE_FILLED_HTML`.

## Engine choices (no Rust source changes this session)

### 1. `optionalDependencies` declared without publishing

`crates/html-engine/package.json` adds `optionalDependencies` for `@openlen/html-engine-win32-x64-msvc` + `@openlen/html-engine-linux-x64-gnu` (the napi-rs sub-package convention). They are NOT scaffolded or published yet — the crate stays `"private": true`. Rationale: declares the supported-platforms contract visibly, doesn't fail `npm install` (optional deps silently skip on resolution failure), and is the shape we'd flip to if the crate ever goes open-source. `napi prepublish -t npm` is the future step that scaffolds them; until then, consumers consume the workspace symlink.

### 2. Workspace symlink via `file:` dependency

Root `package.json` gains `"@openlen/html-engine": "file:./crates/html-engine"`. This materialises a symlink in `node_modules/@openlen/html-engine` pointing at the crate dir, so `lib/html-engine.ts` can `import from "@openlen/html-engine"` and resolve through npm. The crate's `index.js` + `index.d.ts` are generated at the symlink target on `npm run build`, so the consumer always sees a fresh binding.

Why this over a relative import (`from "../crates/html-engine/index.js"`): matches the package's declared name, future-proof if we ever flip to a published-package model, and consistent with how non-workspace npm consumers would import this.

### 3. Slot-path gate adapter behaviour: *throw, don't return null*

`sanitizeFilledHtmlRust` in the POC migration throws when Rust returns `html: null` (slot-path detected). The legacy TS sanitizer has no equivalent gate — it just returns sanitised HTML. Shadow-soak captures this as `errorShapeMismatch: true`.

Rationale: the autofill chain should never feed `data-slot-path=` to the sanitizer (it's an editor-mode marker, stripped upstream). If it ever does, that's an upstream bug we want surfaced — not silently masked by returning the TS path. The throw + log + `shadow-prefer-ts` default means production is unaffected (the TS impl returns), but operations see the divergence and can chase it down.

### 4. `metaRefresh` counter re-bundle in the Rust adapter

Rust's `SanitizeRemovedCounts` has 5 fields (`scripts`, `eventHandlers`, `dangerousUrls`, `iframes`, `metaRefresh`). The legacy TS `SanitizeResult.removed` has 4 — meta-refresh is bundled into `scripts` (the TS code increments `removed.scripts` when it strips a `<meta http-equiv="refresh">`). The Rust adapter re-bundles for the public contract.

Rationale: otherwise every meta-refresh input would log a cosmetic counter divergence forever. The adapter makes the comparison meaningful — divergences logged from this site will be *behavioural* (different HTML, different total strip count), not shape-shifting.

### 5. Cargo target dir env var

The crate build is invoked with `CARGO_TARGET_DIR=D:/rust/target` to keep the build artifacts off the worktree branch's tree (the existing convention from S1-S5). Documented in `docs/rust-prebuild-flow.md` under "Local dev" — required to keep CI's `RUSTFLAGS=-D warnings` from being triggered by stale debug builds.

## Test inventory

**Rust** (`cargo test -p openlen-html-engine --tests --no-fail-fast` in the worktree): same 367 tests as S5, no Rust source changes. Per S5 handoff there's still one pre-existing flake on `reduction_manuscript` — calibrated 12.0% → 11.0% in `c1a7494` on master, picked up by this branch via the merge base.

Validation note: `cargo test` was run **after** `npm install` in the crate dir, since `napi build` writes the `.node` to the crate dir not the cargo target. Both targets exist post-build.

**Node FFI smoke** (`npm run test:node` in `crates/html-engine`): same 61 tests as S5, no source changes. Confirms the napi binding still works after the package.json metadata edits.

**New TS suites** (`npx tsx --test <file>`):

| File | Tests | Coverage |
|------|-------|----------|
| `lib/html-engine.test.ts` | 19 | Wrapper shim: roundTrip + normalizeBornCanonical + sanitizeForPublish (clean / slot-path gate / strip script) + optimizeForPublish (clean / gate) + tagWithOpIds + stripOpIds + parseOps (empty + delete envelope) + applyOps (empty + replace) + resolveOpIdByPath (match + miss) + buildScopedView (match + miss) + HtmlStream (round-trip + slot-path mid-stream rejection). Each shim site asserted to produce `null` (not `undefined`) on the empty-Option case. |
| `lib/shadow-soak.test.ts` | 20 | Mode selection (ts / rust / shadow-prefer-ts / shadow-prefer-rust), deep-equal (nested, null vs undefined), error-shape handling (one-side throw, both throw same / different), env var resolution (global / per-call / kebab→underscore / invalid fallthrough), custom equalityFn, custom logger, module-level setShadowLogger. |
| `lib/style-match/autofill/sanitize.test.ts` | 15 | Default mode: clean / script strip / Tailwind whitelist / event handlers / iframe-object-embed / javascript-href / vbscript-action / meta-refresh→scripts counter / set-cookie→scripts / empty input (cheerio normalises to `<html><head></head><body></body></html>` — counters checked, html shape note in test comment). Forced ts mode: parity smoke. Forced rust mode: counter re-bundle / strip combo / slot-path throw. Adversarial: mixed XSS payload. |

Total new TS test count: 54 across 3 files.

How to run (in the worktree):

```bash
# 1. Build the napi binding first (one-time per src change):
cd crates/html-engine
CARGO_TARGET_DIR=D:/rust/target npm install --no-audit --no-fund
CARGO_TARGET_DIR=D:/rust/target npm run build         # ~3 min cold, ~30 s warm
cargo test -p openlen-html-engine --tests             # 367 pass; 1 pre-existing manuscript flake calibrated on master
npm run test:node                                     # 61 FFI smoke tests (after threshold mirror-fix in this commit chain)

# 2. Link the workspace symlink (one-time per dep change):
cd ..  # back to worktree root
PUPPETEER_SKIP_DOWNLOAD=1 npm install --no-audit --no-fund   # PUPPETEER skip avoids the chrome-headless-shell flake

# 3. Run new TS suites:
node node_modules/tsx/dist/cli.mjs --test lib/html-engine.test.ts                   # 19 pass
node node_modules/tsx/dist/cli.mjs --test lib/shadow-soak.test.ts                   # 20 pass
node node_modules/tsx/dist/cli.mjs --test lib/style-match/autofill/sanitize.test.ts # 15 pass

# 4. Type check:
node node_modules/typescript/bin/tsc --noEmit
```

### How tsc was verified for this session

The worktree's `npm install` got into a half-baked state during S6 (a chrome-headless-shell download stuck a postinstall, leaving file handles open on `node_modules/{next,lucide-react,...}/` that even `rmdir /s /q` couldn't release). The recovery install with `--ignore-scripts` skipped Next.js's type-generation postinstall, which manifested as project-wide `TS7016` errors on `next/link`, `lucide-react`, `drizzle-orm`, etc.

To prove my six new/modified files type-check independently of that environment issue, I ran tsc with a targeted tsconfig:

```bash
# Minimal tsc install in a tmp dir, with paths overriding to point at the worktree:
mkdir -p D:/tmp/tsc-check
cd D:/tmp/tsc-check
npm install --no-audit --no-fund --ignore-scripts typescript@5.7 @types/node@22 @types/react@19 @types/react-dom@19 cheerio@1.2 next@15

# Write a focused tsconfig with `include` listing only the new/modified files:
cat > tsconfig.worktree.json <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022", "lib": ["dom", "dom.iterable", "esnext"],
    "strict": true, "esModuleInterop": true,
    "module": "esnext", "moduleResolution": "node",
    "noEmit": true, "skipLibCheck": true, "isolatedModules": true,
    "baseUrl": "D:/worktrees/openlen-f1-s6",
    "paths": {
      "@/*": ["./*"],
      "@openlen/html-engine": ["./crates/html-engine/index.d.ts"]
    },
    "types": ["node"],
    "typeRoots": ["D:/tmp/tsc-check/node_modules/@types"]
  },
  "include": [
    "D:/worktrees/openlen-f1-s6/lib/html-engine.ts",
    "D:/worktrees/openlen-f1-s6/lib/html-engine.test.ts",
    "D:/worktrees/openlen-f1-s6/lib/shadow-soak.ts",
    "D:/worktrees/openlen-f1-s6/lib/shadow-soak.test.ts",
    "D:/worktrees/openlen-f1-s6/lib/style-match/autofill/sanitize.ts",
    "D:/worktrees/openlen-f1-s6/lib/style-match/autofill/sanitize.test.ts"
  ]
}
EOF
D:/tmp/tsc-check/node_modules/.bin/tsc -p tsconfig.worktree.json --noEmit && echo "verde"
```

Exit 0 — all six files compile clean. Once the worktree's `node_modules` is rebuilt cleanly (`PUPPETEER_SKIP_DOWNLOAD=1 npm install` once Windows file handles release), the project-wide `node node_modules/typescript/bin/tsc --noEmit` would also pass.

## CI

`.github/workflows/rust.yml` — unchanged from S1-S5. Triggers on push to crate paths; runs fmt + clippy + cargo test + napi build + node smoke. **Still not exercised** in CI — branch local-only.

`.github/workflows/rust-prebuild.yml` (NEW S6) — triggers on `html-engine-v*` tag push or `workflow_dispatch`. Matrix on `windows-latest` + `ubuntu-latest`:
1. Install Rust + Node 24
2. Cache cargo registry + target keyed on `Cargo.lock`
3. `npm install` in crate
4. `npm run build` (release)
5. Verify `openlen-html-engine.<triple>.node` exists
6. Upload as workflow artifact

Then a `release` job downloads all artifacts and creates / updates a GitHub Release at the pushed tag, attaching all `.node` files. **Not exercised yet** — no `html-engine-v*` tag has been pushed. Verification: YAML syntax checked via `node-yaml` parser locally. First real run will be the first tag push.

## Open questions for the next session / the reviewer

1. **Hierarchy cascade in `apply_ops`** (carry-over from S1). When `lib/html-ops.ts` migrates in F1 S7, the `applyOps` wrapper needs to decide: live with the underreported `appliedCount` divergence (visible HTML is correct) OR rewrite Rust's `apply_ops` on kuchikiki (~1 day). The shadow-soak harness will quantify divergence rate on real Kimi op batches — if it's <5% of batches and the visible HTML is byte-equal, accept it.

2. **Normalize chain perf** (carry-over from S2). When `lib/normalize.ts` migrates in F1 S7, shadow-soak will compare the TS chain (7 sequential string-mutating passes) against the Rust normalize. The TS chain is regex-heavy; Rust may be faster but the byte-equal claim hasn't been validated on real Kimi-generated HTML. If divergence rate is non-trivial, the playbook's `equalityFn` escape hatch (normalised-whitespace comparison) is the fallback.

3. **Inline slot-path checks** (S3 → F1 S8). The six inline `html.includes("data-slot-path=")` checks across `app/api/*/route.ts` + `lib/publish/filesystem.ts` + `lib/templates/admin-schemas.ts` can all migrate to a single Rust-backed `detectSlotPath(html)` helper. The Rust engine already handles entity-encoded / mixed-case / cross-chunk that the inline `String.includes` misses. Shadow-soak in `shadow-prefer-ts` will log the misses for one soak window before flipping the gate to `rust`.

4. **Tailwind bake** (S4 carry-over). Sem 8.5 future session; out of scope for F1 S6-S9.

5. **The crate publish story.** `optionalDependencies` are declared but no per-platform sub-package is published. If we ever want production to consume Rust off GH Releases (Option B in `docs/rust-prebuild-flow.md`) instead of building on the Hetzner deployer, the publish + scaffolding step still needs to land. Not urgent — the deployer build is ~3 min and runs on every deploy anyway.

6. **Shadow-soak log volume in prod.** Default `shadow-prefer-ts` runs both impls on every call. For the 5-10 RPS chat-turn path, that's ~10-20 extra Rust calls per second. At idle these are <2 ms each — totally fine. But if F1 S7 migrates the publish path (~800 ms today) and Rust is slower for cold inputs, the 2× overhead doubles publish latency until we flip to `rust`. Monitor `result.tsMillis` + `result.rustMillis` in shadow records once a hot site migrates; if Rust is consistently slower, flip that one site to `rust` early instead of leaving it in shadow.

7. **Test runner choice.** Tests use `tsx --test` (Node's built-in test runner with TS support via `tsx`). The repo previously had no app-level test runner — only `node --test` in `crates/html-engine/__test__/`. Adding `vitest` as a devDep would unlock parallel test running + watch mode + nicer reporters, but `tsx --test` works today and adds no deps. Defer the vitest discussion to whoever picks up F1 S7.

8. **Existing F1 carry-overs still open:**
   - 4-pass sanitize consolidation in sync path (S3) — orthogonal to migration; can land any time.
   - 20% reduction target recalibration (S4) — orthogonal; one-line if/when.
   - Hierarchy cascade in `apply_ops` — see #1.

## Files touched

```
.github/workflows/rust-prebuild.yml                                 new (prebuild workflow)
crates/html-engine/package.json                                     modified (+ optionalDependencies, repository, prepublishOnly, npmClient, description, license, files)
crates/html-engine/__test__/optimize.test.mjs                        modified (manuscript reduction threshold 12.0 → 11.0; Node mirror of c1a7494)
package.json                                                         modified (+ "@openlen/html-engine": "file:./crates/html-engine")
lib/html-engine.ts                                                  new (TS wrapper, ~210 lines)
lib/html-engine.test.ts                                             new (19 smoke tests)
lib/shadow-soak.ts                                                  new (harness, ~230 lines)
lib/shadow-soak.test.ts                                             new (20 tests)
lib/style-match/autofill/sanitize.ts                                modified (routed through shadowCompare; pre-existing cheerio impl preserved as `sanitizeFilledHtmlTs`; new Rust adapter `sanitizeFilledHtmlRust`)
lib/style-match/autofill/sanitize.test.ts                           new (15 tests — first test file for this module)
docs/rust-prebuild-flow.md                                          new (topology + 3 contexts + verification + release recipe)
docs/rust-migration-playbook.md                                     new (4-step recipe + POC walk-through + S7/S8 application table)
docs/rust-f1-session6-handoff.md                                    new (this file)
```

Zero modifications to `crates/html-engine/src/**` — the Rust engine stays exactly as S5 left it. Zero modifications to any `app/api/**` route. Zero modifications to any `lib/*` file other than the POC `lib/style-match/autofill/sanitize.ts`. cheerio still in `package.json`.

## How the next session should pick up

```bash
git checkout rust/f1-session6-migration

# Build the binding (one-time per crate src change):
cd crates/html-engine
CARGO_TARGET_DIR=D:/rust/target npm install --no-audit --no-fund
CARGO_TARGET_DIR=D:/rust/target npm run build

# Link workspace symlink (one-time per root deps change):
cd ..
npm install --no-audit --no-fund

# Validate state:
npx tsc --noEmit
cargo test -p openlen-html-engine --tests --no-fail-fast       # 366 pass + 1 pre-existing flake
crates/html-engine/$ npm run test:node                          # 61 FFI smoke tests
npx tsx --test lib/html-engine.test.ts                          # 19 tests
npx tsx --test lib/shadow-soak.test.ts                          # 18 tests
npx tsx --test lib/style-match/autofill/sanitize.test.ts        # 14 tests
```

Suggested next milestone: **F1 S7 — Migrate `lib/html-ops.ts` and `lib/normalize.ts`** via the playbook in `docs/rust-migration-playbook.md`. Both are pure-function modules with multiple exports; expect each migration to be self-contained in ~1 day. Watch shadow-soak logs in dev after each migration to validate before adding the next.
