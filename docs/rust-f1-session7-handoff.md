# F1 Rust HTML engine — Session 7 handoff

Branch: `rust/f1-session7-migrate-ops-normalize` (off `master`'s `a3efd15` = F1 S6 merge tip, **not** pushed, no PR).

```
7c274c7  docs(rust): F1 session-7 handoff — Sem 10 Phase 2 shipped
55ccaa1  feat(rust): F1 S7 — detectSlotPath helper + consolidate 9 inline gate sites
f892416  feat(rust): F1 S7 — migrate lib/normalize.ts via shadow-soak
b05d1e2  feat(rust): F1 S7 — migrate lib/html-ops.ts (6 exports) via shadow-soak
```

> Worktree note. Work happened entirely in `D:\worktrees\openlen-f1-s7` (created as `git worktree add -b rust/f1-session7-migrate-ops-normalize D:/worktrees/openlen-f1-s7 a3efd15`). Zero overlap with the parallel `D:\worktrees\openlen-f2-edge` (F2 S5 ACME) session — F1 S7 only touches Node-side files (`lib/*` + a handful of `app/api/*/route.ts` to switch the slot-path gate over to the new helper). The Rust crate at `crates/html-engine/src/**` was not modified — every migration target was already shipped by S1–S5.

## Milestones completed against the 12-week plan

| Sem  | Milestone | Status |
|------|-----------|--------|
| 1-2  | Bootstrap napi-rs + parse/serialize round-trip | **Done** (S1) |
| 3-4  | ID-tag ops engine | **Done** (S1) |
| 5-6  | Normalize chain (7 idempotent passes) | **Done** (S2) |
| 7    | Sanitizer + slot_path single gate | **Done** (S3) |
| 8    | Minify + CSS opt | **Partial — Option C (S4)** |
| 9    | Streaming API for F3 AI Gateway | **Done** (S5) |
| 10   | Node migration foundation | **Done** (S6 Phase 1) |
| **11** | **Shadow soak — call-site rollout** | **Done — Phase 2 (3 migrations + the inline gate consolidation)** |
| 12   | Cleanup — delete cheerio | not started |

Stopping point: the three pre-cutover Phase 2 deliverables ship — `lib/html-ops.ts` + `lib/normalize.ts` both routed through `shadowCompare`, AND the nine inline `data-slot-path=` `String.includes` call sites consolidated under one Rust-backed `detectSlotPath` helper. Every public surface is unchanged in behaviour at the default `shadow-prefer-ts` mode; the Rust engine runs in shadow on every call and divergences land as `[shadow-soak] divergence` JSON warnings. F1 S8 picks up `lib/publish/optimize-html.ts` (the last cheerio-dependent module) and after one soak window, the cutover flip to `rust` + cheerio deletion in Sem 12.

## Acceptance criteria — F1 global

| Criterion | State | Notes |
|-----------|-------|-------|
| Chat-turn HTML overhead p95 < 30 ms (today ~150 ms) | Still on track. Real measurement deferred to post-cutover (Sem 11). |
| Publish p95 < 200 ms | Same — post-cutover. |
| Lighthouse mobile ≥95 across 20 templates | Same — needs Sem 8 + measurement. |
| Zero `data-slot-path=` leaks in 1000 adversarial docs | **HARDENED THIS SESSION.** The seven publish/ingestion paths plus the admin templates schema all delegate to `detectSlotPath(html)` (a thin wrapper over `sanitize_for_publish`'s slot-path gate). Mixed-case / entity-encoded / whitespace-around-equals variants — undetected by the inline `String.includes` — are now caught. The `data-op-id` injection path (`lib/html-ops.ts`'s `tagWithOpIds`) and the chat flow's gate (`ai-design/route.ts` Mode A + Mode B) all run through the helper. |
| Compiles clean Windows x64 + Linux x64 with CI prebuilds | Unchanged from S6 (workflow exists, not yet exercised). |
| Bundle Node −150 KB after deleting cheerio | Sem 12 / F1 S9. **Note:** the migrations this session leave cheerio in place — both `lib/html-ops.ts` and `lib/normalize.ts` still import it as the TS arm of `shadowCompare`. Deletion waits on F1 S9's cutover. |
| Tests Rust < 5 s | Unchanged from S6 (366 tests across the crate). |

### Sem 10 Phase 2 acceptance specifically

| Sem 10 Phase 2 acceptance | State |
|---|---|
| `lib/html-ops.ts` — all 6 public exports route via `shadowCompare` | **Done.** `tagWithOpIds`, `stripOpIds`, `parseOps`, `applyOps`, `resolveOpIdByPath`, `buildScopedView`. Each renamed-Ts impl preserved, each Rust adapter calls into `lib/html-engine.ts`. `applyOps` carries a custom `equalityFn` for the S1 cascade carry-over (see "Decisions"); `parseOps` carries a custom `equalityFn` that ignores error-string drift but compares the parsed ops structurally. |
| `lib/normalize.ts` — `normalizeBornCanonical` routes via `shadowCompare` | **Done.** Default `shadow-prefer-ts`, default deep-equal (byte-equal on the 3 starter templates per S2 acceptance). |
| Tests with default mode pass | **Verified.** 110 TS tests across the modified suites; 0 failures. |
| Tests with `OPENLEN_SHADOW_<NAME>=ts` pass | **Verified.** Cutover dry-run via the legacy path matches default. |
| Tests with `OPENLEN_SHADOW_<NAME>=rust` pass | **Verified.** All 6 html-ops exports + `normalizeBornCanonical` work end-to-end via the Rust binding on full-doc inputs. Fragment-input divergence on `tagWithOpIds` is *documented* with a dedicated test (cheerio wraps fragments → tags `<body>` too; lol-html keeps them unwrapped). |
| ≥30 net new TS tests covering the parity matrix | **64 new tests.** Per-suite breakdown below. |
| `npx tsc --noEmit` verde | **Verified.** Exit code 0 on the whole project (per the worktree's clean `npm install`). |
| `applyOps` `equalityFn` covers the S1 hierarchy-cascade carry-over | **Done.** Compares visible HTML byte-equal + error-count parity; ignores `appliedCount` divergence. Shadow records still log the gap via `tsBytes`/`rustBytes` so we can quantify it on production data. |
| Migration 3 (bonus): inline slot-path checks consolidated | **Done — all 9 sites + 1 helper file.** `detectSlotPath(html)` lives in `lib/html-engine.ts`. Call sites: `lib/publish/filesystem.ts`, `lib/templates/admin-schemas.ts`, `app/api/projects/from-html/route.ts`, `app/api/projects/from-template/route.ts`, `app/api/projects/[id]/html/route.ts`, `app/api/templates/ai-design/route.ts` (×2), `app/api/templates/autofill/route.ts`, `app/api/generate/route.ts`. Adversarial test set covers mixed-case, entity-encoded `&#x3d;`, whitespace-around-equals, substring-without-equals (negative). |
| `docs/rust-f1-session7-handoff.md` shipped | **Done** (this file). |

## Surface migrated (TS public exports → shadowCompare-routed)

| Public export | Module | Default mode | Equality strategy | Env-var slug |
|---|---|---|---|---|
| `tagWithOpIds` | `lib/html-ops.ts` | `shadow-prefer-ts` | deep-equal (default) | `OPENLEN_SHADOW_TAG_WITH_OP_IDS` |
| `stripOpIds` | `lib/html-ops.ts` | `shadow-prefer-ts` | deep-equal (string equality) | `OPENLEN_SHADOW_STRIP_OP_IDS` |
| `parseOps` | `lib/html-ops.ts` | `shadow-prefer-ts` | **custom** — ops structurally; errors by count only | `OPENLEN_SHADOW_PARSE_OPS` |
| `applyOps` | `lib/html-ops.ts` | `shadow-prefer-ts` | **custom** — `html` byte-equal; errors by count; `appliedCount` ignored (S1 cascade carry-over) | `OPENLEN_SHADOW_APPLY_OPS` |
| `resolveOpIdByPath` | `lib/html-ops.ts` | `shadow-prefer-ts` | deep-equal (string \| null) | `OPENLEN_SHADOW_RESOLVE_OP_ID_BY_PATH` |
| `buildScopedView` | `lib/html-ops.ts` | `shadow-prefer-ts` | deep-equal | `OPENLEN_SHADOW_BUILD_SCOPED_VIEW` |
| `normalizeBornCanonical` | `lib/normalize.ts` | `shadow-prefer-ts` | deep-equal (byte-equal string) | `OPENLEN_SHADOW_NORMALIZE_BORN_CANONICAL` |

### `detectSlotPath` consolidation (Migration 3)

```ts
// lib/html-engine.ts
export function detectSlotPath(html: string): boolean {
  const r = sanitizeForPublish(html);
  return r.html === null;
}
```

Used to replace nine call sites of `html.includes("data-slot-path=")`. Direct cutover (no shadow-soak wrapper) because the Rust gate is *strictly more restrictive* than the inline TS check — see S3 handoff for the false-positive-risk-zero claim. The S5 streaming gate's cross-chunk scanner also feeds this code path, so the helper inherits its mid-stream coverage when the caller hands it a fully buffered string.

## Decisions made this session

1. **`applyOps` custom `equalityFn` — accept the S1 hierarchy-cascade gap.**
   The S1 handoff §2 documents that when an op deletes an ancestor of a later op's target, the Rust engine's `apply_ops` reports a different `appliedCount` than the TS chain (the lol-html streaming handler still fires inside the to-be-removed range). The *visible HTML is correct* (the contract callers depend on — the chat flow renders it to the iframe; publish flow writes it to disk). Per the S6 playbook's flip-mode procedure, we accept the gap via:

   ```ts
   function applyOpsEquality(ts, rust) {
     if (ts.html !== rust.html) return false;          // contract
     if (ts.errors.length !== rust.errors.length) return false;  // shape
     // appliedCount intentionally not compared
     return true;
   }
   ```

   Shadow records still surface `tsBytes`/`rustBytes` so we can quantify how many real Kimi op-batches trip the cascade. If the ratio is <5% (S1's working threshold), the full Rust fix (~1 day on kuchikiki) stays deferred. If it's higher, F1 S8 picks it up.

2. **`parseOps` custom `equalityFn` — ignore error-string drift.**
   The TS impl hand-writes error strings (`"Op \"x\" requires <new>...</new>..."`); the Rust impl emits its own phrasings. The *parsed ops* match (same `type` / `target` / `newHtml`), but the human-readable `errors[]` strings differ word-by-word. We compare ops structurally and only check `errors.length` — anything finer floods the shadow log with cosmetic noise.

3. **Documented `tagWithOpIds` fragment divergence as a test, not a bug.**
   Both impls auto-wrap their input differently: cheerio wraps a fragment (`<div><p>hi</p></div>`) with `<html><head></head><body>…</body></html>` and tags the `<body>` too (TS: 3 tags); lol-html keeps the fragment unwrapped and tags only the original elements (Rust: 2 tags). Production paths always pass full HTML docs, so the divergence is operationally moot — but tests pass full docs throughout *and* one explicit test asserts the fragment divergence so it's visible to future readers (`lib/html-ops.test.ts` → "fragment input diverges between TS and Rust (documented gap)").

4. **Self-closing + open-close edits in the same `<edits>…</edits>` envelope are a known parser quirk in BOTH impls.**
   The TS open-close regex `/<edit\b([^>]*)>([\s\S]*?)<\/edit>/gi` matches across an intervening self-closing `<edit … />`, so e.g. `<edits><edit op="delete" target="x" /><edit op="replace" target="y">…</edit></edits>` parses as two delete ops on target `x` instead of one delete + one replace. The Rust port has the same shape and the same quirk — they're *byte-parity-bug-equivalent*. The migrated `parseOps` test set uses open-close everywhere to avoid the quirk; documenting it here so a future S8/S9 cleanup can fix both impls together.

5. **`detectSlotPath` is a *direct cutover*, not shadow-soaked.**
   The playbook (S6) suggested shadow-soaking the inline checks for one soak window before flipping. We skipped the soak step for these because the Rust gate is *strictly stronger* than `String.includes` (S3 verified zero false-positive risk on clean docs). Soaking would only log the cases the TS chain missed — which is the entire point of the migration. Direct flip + adversarial tests is the right shape.

6. **Helper lives in `lib/html-engine.ts`, not a new `lib/slot-path-gate.ts`.**
   Keeps the napi surface and its derived helpers in one file. The cost is one extra `sanitize_for_publish` call on the publish-path-already-runs-it sites (e.g. `publishToDir`); the wins are stronger gate coverage everywhere else and zero new files to grep across.

7. **The migrated `lib/html-ops.ts` keeps cheerio imported.**
   Per the playbook, `shadowCompare` runs *both* impls in shadow mode; the TS arm requires cheerio. Deletion happens at F1 S9 once the cutover has soaked. We're not eagerly tree-shaking now — that would defeat the purpose of having a TS fallback.

## Test inventory

**Rust** (`cargo test -p openlen-html-engine --tests --no-fail-fast` in the worktree): unchanged from S6 — 366 tests, 0 source changes. The manuscript reduction threshold mirror-fix from `a0a84ab` is on this branch via the merge base.

**Node FFI smoke** (`npm run test:node` in `crates/html-engine`): unchanged from S6 — 61 tests. Same FFI surface; no shape edits required.

**TS suites** (`npx tsx --test <file>` from the worktree root):

| File | Tests (S7) | Δ vs S6 | Coverage |
|------|-----------:|--------:|----------|
| `lib/html-engine.test.ts` | 27 | **+8** | Adds 8 `detectSlotPath` cases — clean/empty/literal/mixed-case/entity-encoded/whitespace-around-equals/substring-without-equals (negative)/buried-in-doc. |
| `lib/shadow-soak.test.ts` | 20 | 0 | Unchanged. |
| `lib/style-match/autofill/sanitize.test.ts` | 15 | 0 | Unchanged. |
| `lib/html-ops.test.ts` | **39** | **+39 (new file)** | 7 tagger / 4 stripper / 8 parseOps / 9 applyOps / 4 resolveOpIdByPath / 4 buildScopedView / 3 forced-mode parity tests. Cascade carry-over covered explicitly. Fragment divergence covered explicitly. |
| `lib/normalize.test.ts` | **17** | **+17 (new file)** | 5 default-mode + idempotence on 3 starters + 3 ts-forced + 3 rust-forced byte-equal + 1 rust-idempotence + 1 rust-empty + 2 adversarial small-doc + 2 mode-resolution end-to-end. |
| **Total TS** | **118** | **+64** | |

Sums: pre-S7 = 54; post-S7 = 118. Net new TS test count for the session: **+64**, far above the ≥30 acceptance bar.

### How to run (in the worktree)

```bash
# Rebuild the binding (one-time per crate src change — N/A this session):
cd crates/html-engine
CARGO_TARGET_DIR=D:/rust/target npm install --no-audit --no-fund
CARGO_TARGET_DIR=D:/rust/target npm run build         # ~3 min cold, ~30 s warm
cargo test -p openlen-html-engine --tests --no-fail-fast   # 366 pass
npm run test:node                                     # 61 FFI smoke tests

# Link workspace symlink (one-time per root deps change — N/A this session):
cd ..
PUPPETEER_SKIP_DOWNLOAD=1 npm install --no-audit --no-fund

# Run S7 TS suites:
npx tsx --test lib/html-engine.test.ts                  # 27 pass
npx tsx --test lib/shadow-soak.test.ts                  # 20 pass
npx tsx --test lib/style-match/autofill/sanitize.test.ts  # 15 pass
npx tsx --test lib/html-ops.test.ts                     # 39 pass
npx tsx --test lib/normalize.test.ts                    # 17 pass

# Type check (whole project):
npx tsc --noEmit   # exit 0

# Lint Rust (no source changes this session, but the gate still runs):
CARGO_TARGET_DIR=D:/rust/target cargo clippy -p openlen-html-engine --all-targets -- -D warnings
CARGO_TARGET_DIR=D:/rust/target cargo fmt --check
```

## Files touched

```
lib/html-engine.ts                              modified (+ detectSlotPath helper)
lib/html-engine.test.ts                         modified (+ 8 detectSlotPath tests)
lib/html-ops.ts                                 modified (6 exports routed via shadowCompare; cheerio impl preserved as *Ts; Rust adapter *Rust)
lib/html-ops.test.ts                            new (39 parity / forced-mode tests)
lib/normalize.ts                                modified (routed via shadowCompare; chain preserved as normalizeBornCanonicalTs)
lib/normalize.test.ts                           new (17 tests covering 3 starters + ts/rust forced + adversarial)
lib/publish/filesystem.ts                       modified (detectSlotPath replaces inline includes)
lib/templates/admin-schemas.ts                  modified (htmlContainsEditorMarker now wraps detectSlotPath)
app/api/projects/from-html/route.ts             modified (detectSlotPath)
app/api/projects/from-template/route.ts         modified (detectSlotPath)
app/api/projects/[id]/html/route.ts             modified (detectSlotPath)
app/api/generate/route.ts                       modified (detectSlotPath)
app/api/templates/ai-design/route.ts            modified (detectSlotPath × 2 — Mode A + Mode B gates)
app/api/templates/autofill/route.ts             modified (detectSlotPath)
docs/rust-f1-session7-handoff.md                new (this file)
```

Zero modifications to `crates/html-engine/src/**`. Zero new dependencies. cheerio still in `package.json` (kept alive by the TS arms of `shadowCompare` until cutover in F1 S9 / Sem 12).

## Open questions for the next session / the reviewer

1. **Soak window length.** S6 suggested 7 days for the first migration. With three migrations + the gate consolidation landing in one session, the per-call-site soak windows can run in parallel — but the cutover flip should still wait until shadow logs come back clean. Defer the calendar to whoever owns the deploy schedule.

2. **`applyOps` cascade rate.** The custom `equalityFn` masks `appliedCount` divergences, but `tsBytes`/`rustBytes` are still in the shadow records. Once production data shows the actual rate, the decision is binary: (a) <5% of batches trip cascade → leave as-is, flip to `rust`, document the gap permanently; (b) ≥5% → switch Rust's `apply_ops` over to kuchikiki (~1 day per S1 estimate). Track this in F1 S8.

3. **Normalize perf flip.** S2 showed V8 irregexp wins on regex-vs-regex (TS 1.2 ms p95 mirror vs Rust 3.4 ms). Shadow records will quantify this on real-world docs. If Rust loses consistently, leave `normalizeBornCanonical` on `OPENLEN_SHADOW_NORMALIZE_BORN_CANONICAL=ts` after the broader cutover — the migration win is correctness + bundle-shrink, not speed.

4. **`lib/publish/optimize-html.ts` migration.** The last cheerio-consuming module. Wraps existing minify; the Rust counterpart (`optimize_for_publish`) is already in S4. Adapter notes from the playbook §F1 S8: throws on `errors.length > 0` to keep the contract single-result; stats can be dropped or surfaced verbatim. ~1 day if you've done one of these.

5. **Cheerio deletion (Sem 12 / F1 S9).** Cannot start until all three migrated call sites + S8's `optimize-html` migration have all flipped to `rust` mode in production. Once the four are flipped, the entire `import * as cheerio from "cheerio"` set can be deleted from the repo; `package.json` loses the dep; Node bundle drops ~150 KB.

6. **Self-closing + open-close edit parser quirk.** Both TS and Rust `parseOps` regexes match across an intervening self-closing `<edit … />` and mis-classify the open-close form. Symmetrical bug = symmetrical fix; not user-visible until Kimi starts emitting mixed envelopes (so far it only emits one form per envelope). Park as a known issue.

7. **Shadow-soak log volume in prod.** Default `shadow-prefer-ts` runs both impls on every call. For the chat-turn path (~5-10 RPS), that's ~10-20 extra Rust calls per second per shadow site. With S7 landing ~14 new shadow sites (6 html-ops + 1 normalize + 7 detectSlotPath — though detectSlotPath isn't a `shadowCompare`-wrapped call), the per-RPS Rust call count is up by an order of magnitude. Recommend a dev-mode-only logger override that buffers + decimates before flushing to `console.warn` if prod logs get noisy. The hook (`setShadowLogger`) already exists; no engine work needed.

8. **CI prebuild still untested.** Same as S6 — the `html-engine-v*` tag workflow exists but hasn't fired. F1 S8/S9 should push a test tag once the cutover is imminent.

## How the next session should pick up

```bash
# Branch is local-only. From master tip a3efd15:
git checkout rust/f1-session7-migrate-ops-normalize

# Rebuild the binding once per crate src change (N/A from S7):
cd crates/html-engine
CARGO_TARGET_DIR=D:/rust/target npm install --no-audit --no-fund
CARGO_TARGET_DIR=D:/rust/target npm run build

# Link workspace symlink (once per root deps change):
cd ..
PUPPETEER_SKIP_DOWNLOAD=1 npm install --no-audit --no-fund

# Validate state:
npx tsc --noEmit                                                # exit 0
CARGO_TARGET_DIR=D:/rust/target cargo test -p openlen-html-engine --tests   # 366 pass
crates/html-engine/$ npm run test:node                          # 61 FFI smoke
npx tsx --test lib/html-engine.test.ts lib/shadow-soak.test.ts lib/style-match/autofill/sanitize.test.ts lib/html-ops.test.ts lib/normalize.test.ts   # 118 pass
```

Suggested next milestone: **F1 S8 — Migrate `lib/publish/optimize-html.ts` (last cheerio dep) + decide on `applyOps` cascade fix.** With S7's foundation in place, the optimize-html migration is the same 4-step recipe (rename TS impl, add Rust adapter, route via `shadowCompare`, write the parity matrix). The cascade decision needs production shadow data first — if F1 S7 is deployed and shadow logs are quiet for a week, the cascade fix is unblocked.

No PR. The user owns the merge.
