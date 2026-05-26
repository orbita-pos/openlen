# F1 Rust HTML engine — Session 1 handoff

Branch: `rust/f1-html-engine` (off `master`, 2 commits, **not** pushed, no PR).

```
2bfd39e  feat(rust): ID-tag ops engine — tagger, parser, applier, resolver, scoped view
bd6e009  feat(rust): bootstrap napi-rs html-engine crate with round-trip parser
```

## Milestones completed against the 12-week plan

| Sem  | Milestone | Status |
|------|-----------|--------|
| 1-2  | Bootstrap napi-rs + parse/serialize round-trip | **Done** |
| 3-4  | ID-tag ops (tagger + apply + stripper + resolver + scoped view) | **Done** |
| 5-6  | Normalize chain (7 idempotent passes) | not started |
| 7    | Sanitizer + slot_path single gate | not started |
| 8    | Minify + CSS opt | not started |
| 9    | Streaming API for F3 | not started |
| 10-11| Node migration + shadow soak | not started |
| 12   | Cleanup — delete cheerio | not started |

Stopping point chosen deliberately: Sem 5-6 is 7 separate regex-heavy passes, better as its own milestone than partly done.

## Acceptance criteria — F1 global

| Criterion | State | Notes |
|-----------|-------|-------|
| Chat-turn HTML overhead p95 < 30 ms (today ~150 ms) | **On track** — ops pipeline alone is ~3.4 ms p95 now; normalize chain (Sem 5-6) still in TS so total chat-turn cost isn't measurable end-to-end yet | see bench section |
| Publish p95 < 200 ms (today ~800 ms) | not measurable yet — need Sem 8 (minify) + Sem 10 wiring | |
| Lighthouse mobile ≥95 average across 20 templates | not measurable yet — needs Sem 8 + a measurement harness | |
| Zero `data-slot-path=` leaks in 1000 adversarial docs | not measurable yet — Sem 7 owns the consolidated gate | |
| Compiles clean Windows x64 + Linux x64 with CI prebuilds | **Windows x64 verified locally (MSVC, rustc 1.95.0)**. CI YAML committed but not yet exercised (no push to remote) | `.github/workflows/rust.yml` runs fmt + clippy + cargo test + napi build + node smoke tests on `windows-latest` + `ubuntu-latest` |
| Bundle Node −150 KB after deleting cheerio | not yet — cheerio still in `package.json`, scheduled for Sem 12 | |
| Tests Rust < 5 s | **Done** — `cargo test -p openlen-html-engine --all-targets` finishes in <1 s | 53 Rust tests across 8 files |

## Surface shipped (Rust → JS, via napi-rs)

```ts
export declare function roundTrip(html: string): string
export declare function tagWithOpIds(html: string): JsTaggedHtmlResult
export declare function stripOpIds(html: string): string
export declare function parseOps(rawHtml: string): JsParseResult
export declare function applyOps(taggedHtml: string, ops: Array<JsOp>): JsApplyResult
export declare function resolveOpIdByPath(taggedHtml: string, path: string): string | null
export declare function buildScopedView(taggedHtml: string, pinnedOpId: string): JsScopedView | null
```

All seven surface APIs in `lib/html-ops.ts` have a Rust counterpart with matching semantics.

## Engine choices (deviations from the plan worth flagging)

1. **lol-html for streaming, kuchikiki for DOM walks.** The original plan named `lol-html` as the parser. I'm using it for tagger / stripper / apply (its attribute-selector support `[data-op-id="x"]` covers the cases, and streaming wins). For `resolveOpIdByPath` (needs `:nth-child` etc.) and `buildScopedView` (needs ancestor walks + `outerHTML`), I added `kuchikiki = "0.8"` which gives full CSS3 selectors and a mutable DOM on top of html5ever. Net binary growth on the napi side is fine — we're going to **delete** cheerio (~150 KB on the Node side) in Sem 12, so the trade is strongly net-negative.

2. **`apply_ops` cascade detection.** The TS reference detects "ancestor of this op was deleted by an earlier op" via cheerio's live-DOM `$el.length === 0`. lol-html is streaming, so it doesn't natively see ancestor relationships across handlers. **Same-target cascade** (op N+1 hits the same id that op N replaced/deleted) **is** detected by per-target kill-flag tracking in `ops/apply.rs::apply_ops`. **Hierarchy cascade** (op N deletes parent, op N+1 targets a child) currently under-reports — the child op's handler still fires inside the to-be-removed range, applied_count over-counts. Visible HTML is correct (parent + child mutations all collapse). **This is a known shadow-soak risk for Sem 10-11**: applied_count divergence on real Kimi op batches that include parent-delete + child-op combos. If it trips the soak gate, the fix is to swap `apply_ops` over to kuchikiki (same DOM-walk pattern resolver/scoped_view use); estimate ~1 day.

3. **`Option<String>` → `undefined`, not `null`.** napi-derive's struct serialization omits None fields entirely (so `JsApplyResult.html` is `undefined` when there's no result, not `null`). TS callers in `lib/html-ops.ts` check `=== null`. **Sem 10 migration shim**: `r.html ?? null` at every call site. Already documented in the Sem 3-4 commit body and the Node smoke tests pattern around it.

4. **`base36` exact JS-parity** — added a 9-case unit test (`ops::id::tests::matches_js_to_string_36`) covering 0, 9, 10, 35, 36, 1295, 1296. Sem 11 shadow soak should diff cleanly on op-id assignment.

## Benchmarks — release build, mirror.html (59 457 B), 50 iters, p95

```
=== tagWithOpIds ===
rust  (lol-html)        p95=1.21 ms
node  (cheerio)         p95=9.69 ms     8.0× faster

=== stripOpIds ===
rust  (regex)           p95=0.55 ms
node  (regex)           p95=0.39 ms     comparable (v8's regex engine is excellent on
                                        small ASCII patterns over UTF-8 strings)

=== parseOps (20-op envelope) ===
rust  (regex)           p95=0.10 ms     no cheerio baseline (TS path is also regex)

=== applyOps (10 replaces on tagged mirror) ===
rust  (lol-html)        p95=1.91 ms     no cheerio baseline written

Full ops pipeline (tag + parse + apply + strip), single Kimi turn equivalent:
~3.4 ms p95   vs   target ≤30 ms   vs   baseline ~150 ms
```

These numbers are from `crates/html-engine/__test__/perf-vs-cheerio.mjs` — an ad-hoc Node-side comparison, NOT a formal Criterion benchmark. The plan calls for Criterion benches in Sem 5; deferring them is intentional (will land alongside normalize-chain measurements so we measure all of F1 in one harness).

## CI

`.github/workflows/rust.yml` — matrix on `ubuntu-latest` + `windows-latest`, Rust stable, Node 24:

1. cargo fmt --check
2. cargo clippy --all-targets -D warnings
3. cargo test --all-targets
4. npm install (crate dir)
5. napi build
6. node --test (Node-side smoke tests over FFI)

**Not yet exercised** — branch is local-only. First push will be the first real CI run. Cache key on Cargo.lock; first run will be slow (deps cold).

## Test inventory

**Rust** (`cargo test -p openlen-html-engine --all-targets`): 53 tests across 8 files, <1 s.

- `tests/round_trip.rs` — 7 (lol-html identity on 3 starter templates + idempotence + text-content preservation)
- `tests/ops_tagger.rs` — 6 (empty, count, skip-tags, preserve-existing-id, base36 past 9)
- `tests/ops_stripper.rs` — 5 (incl. tag+strip round-trip)
- `tests/ops_parse.rs` — 10 (self-closing, open-close, natural-form, error paths)
- `tests/ops_apply.rs` — 11 (each op type, validation, cascade)
- `tests/ops_resolver.rs` — 7 (incl. `:nth-child` specifically — the reason kuchikiki is in)
- `tests/ops_scoped_view.rs` — 6 (container walk-up, outline, SCOPED marker, hint truncation)
- `src/ops/id.rs` unit test — 1 (base36 parity)

**Node** (`node --test __test__/*.test.mjs`): 17 tests over the FFI boundary, ~100 ms.

- `__test__/round-trip.test.mjs` — 6
- `__test__/ops.test.mjs` — 11

## Open questions for next session / the reviewer

1. **Stripper perf parity.** Rust regex strip is **slightly slower** than the Node-side regex (0.55 ms vs 0.39 ms p95 on 60 KB tagged docs) because of the FFI string copy each direction. Options: (a) accept it — strip cost is <1 ms and dwarfed by the rest; (b) keep stripper Node-side and only call into Rust for tag/parse/apply; (c) ship a `tagApplyStrip` combined entry point so the FFI round trip is amortized. Recommend (a) for simplicity, (c) for the publish path where strip is colocated.

2. **Hierarchy cascade for `apply_ops`.** Above. Decide before Sem 10-11 whether to live with the divergence or rewrite on kuchikiki.

3. **napi-rs Option → undefined.** Document as a known shim (`r.html ?? null`) at every Sem 10 call site, OR add a `Either<String, Null>`-style wrapper at the Rust boundary. Recommend the shim — small + explicit + matches existing TS contract on read.

4. **Should the `Js*` prefix on the napi-exposed structs be dropped?** Right now JS-side imports `JsApplyResult`, `JsScopedView`, etc. The TS contract names are `OpApplyResult`, `ScopedView`. Renaming Rust structs to `ApplyResultJs` / etc. has the same fix; or rely on TS-side `import { JsApplyResult as ApplyResult }`. Recommend the rename next session before Sem 10 migration starts.

5. **CI prebuild distribution.** The workflow builds + tests but does NOT yet publish prebuild binaries (`.node` files per triple) anywhere. Sem 10's Node-side `require()` will need them. Either: (a) publish to GH releases on tag, (b) commit them into the repo, (c) build on the deployer at deploy time. Recommend (a) — clean, standard napi-rs pattern.

## Files touched

```
.github/workflows/rust.yml                      new
Cargo.toml                                      new (workspace root)
Cargo.lock                                      new
crates/html-engine/Cargo.toml                   new
crates/html-engine/build.rs                     new
crates/html-engine/package.json                 new
crates/html-engine/package-lock.json            new
crates/html-engine/.gitignore                   new
crates/html-engine/src/lib.rs                   new (napi exports)
crates/html-engine/src/error.rs                 new
crates/html-engine/src/parser.rs                new (lol-html round-trip)
crates/html-engine/src/ops/mod.rs               new
crates/html-engine/src/ops/id.rs                new
crates/html-engine/src/ops/tagger.rs            new
crates/html-engine/src/ops/stripper.rs          new
crates/html-engine/src/ops/parse.rs             new
crates/html-engine/src/ops/apply.rs             new
crates/html-engine/src/ops/resolver.rs          new
crates/html-engine/src/ops/scoped_view.rs       new
crates/html-engine/tests/round_trip.rs          new
crates/html-engine/tests/ops_tagger.rs          new
crates/html-engine/tests/ops_stripper.rs        new
crates/html-engine/tests/ops_parse.rs           new
crates/html-engine/tests/ops_apply.rs           new
crates/html-engine/tests/ops_resolver.rs        new
crates/html-engine/tests/ops_scoped_view.rs     new
crates/html-engine/__test__/round-trip.test.mjs new
crates/html-engine/__test__/ops.test.mjs        new
crates/html-engine/__test__/perf-vs-cheerio.mjs new
```

Zero changes to any pre-existing Node-side code — `lib/html-ops.ts`, `lib/normalize*.ts`, `lib/publish/*` all untouched. The cheerio dep is still in `package.json`. Sem 10-11 owns the migration.

## How the next session should pick up

```
git checkout rust/f1-html-engine
cd crates/html-engine
npm install                  # gets @napi-rs/cli
npm run build                # release .node binding
cargo test -p openlen-html-engine
node --test __test__/round-trip.test.mjs __test__/ops.test.mjs
```

Suggested next milestone: **Sem 5-6, the normalize chain.** Start with `normalize-radius.ts` (simplest — string-injection + 1 regex pass over `<style>` blocks); idempotence is checked by a marker `data-ol-radius`. Each pass needs (a) byte-equal output vs the TS reference on `templates/starter/*` and (b) a property test that running it twice == once. Plan was to keep them all in `crates/html-engine/src/normalize/{radius,space,type,font,accent,color,modes}.rs` with `pub fn normalize_born_canonical(html: &str) -> String` as the entry point.
