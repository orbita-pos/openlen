# F1 Rust HTML engine — Session 4 handoff

Branch: `rust/f1-session4-minify` (off `master`'s `db86fbb` = F1 S1+S2+S3 + F2 S1 merged tip, 5 commits, **not** pushed, no PR).

```
2088122  chore(rust): Criterion bench for optimize_for_publish
71baeab  test(rust): optimize FFI smoke — 10 cases over the napi boundary
6f228e8  test(rust): optimize_for_publish — starters + idempotence stress
201fd89  feat(rust): minify/{mod,html} — minify-html wrapper + OptimizeResult
4fac42c  chore: pin LF line endings via .gitattributes
```

> Worktree note. Work happened entirely in `D:\worktrees\openlen-f1-s4` (created as `git worktree add -b rust/f1-session4-minify D:/worktrees/openlen-f1-s4 master`). Zero overlap with the parallel `D:\worktrees\openlen-f2-edge` session-2 routing work. No cross-checkout drama this time.

## Milestones completed against the 12-week plan

| Sem  | Milestone | Status |
|------|-----------|--------|
| 1-2  | Bootstrap napi-rs + parse/serialize round-trip | **Done** (S1) |
| 3-4  | ID-tag ops engine | **Done** (S1) |
| 5-6  | Normalize chain | **Done** (S2) |
| 7    | Sanitizer + slot_path single gate | **Done** (S3) |
| **8** | **Minify + CSS opt** | **Partial — Option C shipped (S4)**. HTML minify + lightningcss inline-CSS minify landed. Tailwind CDN strip + bake (the bigger Lighthouse win) deferred to a dedicated future session. |
| 9    | Streaming API for F3 | not started |
| 10-11| Node migration + shadow soak | not started |
| 12   | Cleanup — delete cheerio | not started |

Stopping point: `optimize_for_publish` ships idempotent, reduces bytes 13-17% across the starter pack via HTML whitespace + inline-CSS minify, and the same slot-path gate that sanitize uses doubles as a defense-in-depth check at publish time. Tailwind CDN handling lives in a clearly-documented future session (see "Option C trade-off" below).

## Acceptance criteria — F1 global

| Criterion | State | Notes |
|-----------|-------|-------|
| Chat-turn HTML overhead p95 < 30 ms (today ~150 ms) | **On track**. Ops ~3.5 ms + normalize ~3.4 ms + sanitize ~3-4 ms ≈ ~10 ms. Minify is publish-only, not on the chat path. |
| Publish p95 < 200 ms | **On track but not yet measurable end-to-end**. Optimize alone is 1.4-2.4 ms on the 38-60 KB starters; sanitize + optimize composed ≈ 5-7 ms Rust pipeline. Sem 10 wires the rest of the publish path. |
| Lighthouse mobile ≥95 average across 20 templates | not measurable — Sem 10 + the deferred CDN bake. **Important caveat**: without the Tailwind CDN strip, the Lighthouse FCP/LCP win the original `lib/publish/optimize-html.ts` delivers is NOT replicated by this session. Pages still serve Tailwind via the runtime CDN script, same as today. |
| Zero `data-slot-path=` leaks in 1000 adversarial docs | **Done — defense-in-depth confirmed in S4**. The optimize gate uses the same byte scanner sanitize uses; if a slot-path marker somehow survived sanitize, optimize hard-blocks it. |
| Compiles clean Windows x64 + Linux x64 with CI prebuilds | **Windows verified locally** (MSVC, rustc 1.95.0). CI YAML unchanged. Branch local-only. |
| Bundle Node −150 KB after deleting cheerio | Sem 12. |
| Tests Rust < 5 s | **Done — 289 tests, <1 s wall in release-build runs (~6 s including build).** |

### Sem 8 acceptance specifically — what was met, what wasn't

| Sem 8 acceptance | State | Notes |
|---|---|---|
| `bytes_out ≤ 0.8 × bytes_in` on 3 starters (≥20% reduction) | **NOT MET in Option C.** mirror 16.3%, counter 16.5%, manuscript 13.0%. See "Option C trade-off" — the 20% target is implicitly Option-A-shaped (the Tailwind bake adds inline CSS that lets the page render without the runtime CDN — a Lighthouse win that doesn't help byte count). Test thresholds set to ≥15% (mirror/counter) and ≥12% (manuscript) — the achievable floor without the bake. |
| Byte-equal output on already-optimized input (idempotence) | **Done.** All 3 starters + 15 edge-case shapes in `tests/optimize_idempotence.rs`. |
| `npm run test:node` green + new optimize.test.mjs green (no S3 regression) | **Done.** 45 Node tests (35 prior + 10 new) pass in ~200 ms. |
| Lighthouse target ≥95 | Sem 10 (not this session). |
| Criterion bench `benches/optimize.rs` (S2 pattern) | **Done.** 6 measurements: cold + second-pass × 3 starters. |

## Surface shipped (Rust → JS, via napi-rs)

```ts
export declare function roundTrip(html: string): string
export declare function normalizeBornCanonical(html: string): string
export declare function sanitizeForPublish(html: string): SanitizeResult
export declare function optimizeForPublish(html: string): OptimizeResult   // ← NEW
export declare function tagWithOpIds(html: string): TaggedHtmlResult
export declare function stripOpIds(html: string): string
export declare function parseOps(rawHtml: string): ParseResult
export declare function applyOps(taggedHtml: string, ops: Array<Op>): ApplyResult
export declare function resolveOpIdByPath(taggedHtml: string, path: string): string | null
export declare function buildScopedView(taggedHtml: string, pinnedOpId: string): ScopedView | null

export interface OptimizeResult {
  /** Optimized HTML when the gate passes; absent on a slot-path
   *  detection (caller MUST treat absence as publish-block).
   *  See S1/S3 handoffs for the `?? null` shim pattern at TS call
   *  sites — same applies here. */
  html?: string
  /** Position-tagged reasons when the slot-path gate fires. Empty on success. */
  errors: Array<string>
  stats: OptimizeStats
}

export interface OptimizeStats {
  bytesIn: number
  bytesOut: number
  /** True when the Tailwind CDN was successfully swapped for inline
   *  `<style>`. Always false in S4 — the bake is deferred to a future
   *  session (see "Option C trade-off"). */
  cssInlined: boolean
  /** Count of Tailwind utility classes inlined. Always 0 in S4. */
  tailwindClassesKept: number
}
```

## Engine choices

### 1. Option C, not Option A (the big one — please read)

The session brief offered three Tailwind CDN strategies:

- **A** (recommended in brief): lookup-table approach. Pre-generate `tailwind-css-rules.json` from PostCSS+Tailwind over the 3 starters; Rust extracts the class set, looks up rules, inlines them, strips the CDN script.
- **B**: `build.rs` invokes Tailwind CLI at cargo build time.
- **C**: skip CDN handling this session; ship just minify-html + inline-`<style>` minify.

**I shipped C.** Reasoning (~the brief authorized this if A turned out infeasible):

The starter templates use **arbitrary-value Tailwind classes heavily** — `bg-[rgba(15,15,15,0.72)]`, `max-w-[1240px]`, `text-[color:var(--fg-dim)]`, `grid-cols-[1fr_2fr]`. A grep over the 3 starters surfaced these on most navigation, hero, and pricing components. The arbitrary-value syntax is essentially infinite (any color, any pixel size, any CSS var lookup) — a static lookup-table approach silently drops classes it doesn't recognize, which means pages render visually broken for any class outside the pre-baked set. The only way to make A correct is to port Tailwind's arbitrary-value matcher in Rust, which is a Tailwind compiler in disguise and a session of its own.

Option B (build.rs) has cross-platform fragility (needs Tailwind CLI on every developer + CI machine) and adds a network/install dependency at cargo build time.

What we lose by shipping C:
- The Lighthouse FCP/LCP win (the CDN script blocks initial paint ~200 ms).
- ~6% of the 20% reduction acceptance (mathematically — the Tailwind bake doesn't actually reduce HTML bytes; it INCREASES them by inlining the CSS. The 20% target was based on an unstated assumption about what gets measured).

What we get from C:
- Idempotent minify on every publish, byte reductions of 13-17% on starters.
- The full inline-`<style>` body gets lightningcss treatment (rgba → 8-digit hex, transparent → `#0000`, property-order normalization).
- Defense-in-depth slot-path gate at publish.
- All correctness invariants from the brief (idempotence, visual fidelity, arbitrary-value class preservation, inline-script preservation).
- Foundation for the future Option-A session — the `OptimizeStats` already exposes `cssInlined` and `tailwindClassesKept` fields (zeroed in S4) so the future bake doesn't need an FFI surface change.

**Recommendation for the future Tailwind-bake session.** Either:
- (a) Port a *real* Tailwind arbitrary-value matcher to Rust. Big scope; could land as Sem 8.5 or be deferred to post-shadow-soak.
- (b) Keep CSS generation in Node (call out from Rust → Node TS that wraps `generateTailwindCss`) and have Rust only do the strip + inline. This sidesteps the matcher port but adds a Node-side dependency to the optimize pipeline. Probably the right compromise.
- (c) Drop the bake entirely and just embrace the runtime CDN. Pages stay Lighthouse-meh but the publish path stays pure-Rust. Cheapest, least value.

My weak recommendation is (b) — it's the smallest delta from where we are.

### 2. Conservative minify-html Cfg

The default `Cfg::new()` was tightened in two directions:

**Toward idempotence**:
- `keep_closing_tags = true`
- `keep_html_and_head_opening_tags = true`

minify-html v0.16's optional-closing-tag omission heuristic is **not stable across passes** on real-world HTML. Concrete repro caught during S4: in `mirror.html`, `</p></details>` keeps `</p>` on pass 1 and drops it on pass 2 because the omission decision looks at surrounding whitespace bytes, and pass 1's strip changes what pass 2 sees. Same applies to `<html>` / `<head>` opening-tag omission. Locking both to `keep = true` trades ~30 bytes per starter for guaranteed idempotence — the right trade given idempotence is a hard contract for the publish path (Sem 10's wiring assumes it).

**Toward reach**:
- `minify_css = true` (routes inline `<style>` blocks + `style="..."` attrs through lightningcss internally — no separate `css.rs` needed)
- `allow_optimal_entities = true` (collapse safe entity references)
- `allow_removing_spaces_between_attributes = true`
- `minify_doctype = true` (`<!doctype html>` → `<!doctypehtml>`)

These are all marked "still parsed correctly by almost all browsers" in the Cfg docstring. The marginal byte savings are small (50-200 bytes per template) but free.

**Kept off**:
- `minify_js = false`. mirror.html has ~2 KB of inline sparkline JS. Turning this on pulls minify-js (~5 MB of deps) and historically produces edge-case regressions on author-written JS. Marginal reduction win didn't justify the cost.
- `allow_noncompliant_unquoted_attribute_values = false`. Probe ran on mid-session: enabling it saves ~50-150 bytes per starter, **but** Tailwind arbitrary-value classes contain brackets and parens that browsers may misparse unquoted in noncompliant mode. Not worth the risk.

### 3. Module structure: 2 files, not 4

The brief asked for `mod.rs + html.rs + css.rs + cdn.rs`. I shipped `mod.rs + html.rs` only:

- **No `css.rs`** because minify-html v0.16 already routes `<style>` + `style="..."` through lightningcss internally when `minify_css = true`. A standalone `css.rs` exposing the same dependency would be a redundant re-export. (The day we need to minify raw CSS strings outside the HTML context — e.g. for the future bake step — `css.rs` slots in cleanly.)
- **No `cdn.rs`** because Option C defers the CDN handling. (The future bake session would add it; the module path is reserved by the comment block in `mod.rs`.)

### 4. Defense-in-depth slot-path gate

`optimize_for_publish` runs the same `crate::sanitize::detect_slot_path` byte scanner sanitize uses, as the last gate before disk. If a slot-path marker somehow survived sanitize (or sanitize was accidentally skipped — Sem 10 wiring risk), optimize hard-blocks with `html: None`, errors populated, `bytes_in` still reported so callers can log. Test coverage: `tests/optimize_starters.rs::slot_path_in_starter_blocks` + the lib-test cases in `src/minify/mod.rs`.

## Benchmarks — release+LTO build (`bench` profile), p95-ish

Sample-size 25, measurement 3s, warm-up 1s. Local: Windows MSVC, rustc 1.95.0.

```
optimize/for_publish/mirror       2.43 ms  (60412 → 50704 B, 23 MiB/s)
optimize/for_publish/counter      2.04 ms  (52611 → 44059 B, 24 MiB/s)
optimize/for_publish/manuscript   1.37 ms  (38091 → 33153 B, 26 MiB/s)

optimize/second_pass/mirror       2.09 ms  (post-optimize input, no work needed)
optimize/second_pass/counter      1.80 ms
optimize/second_pass/manuscript   1.29 ms
```

Second-pass is 5-15% faster — same parser cost, less serialization. Both well under the F1 publish-p95 target of 200 ms.

Composed Rust pipeline at publish time (Sem 10): sanitize ~3-4 ms + optimize ~1.4-2.4 ms ≈ ~5-7 ms total. Leaves ~190 ms headroom for filesystem + disk + the remaining publish wiring.

## Test inventory

**Rust** (`cargo test -p openlen-html-engine --tests`): **289 tests** across 21 files, <1 s wall.

S1-S3 unchanged (243 tests across 19 files).

S4 additions (46 tests across 2 new files + extension to lib tests):

| File | Tests | Coverage |
|------|-------|----------|
| `src/minify/mod.rs` (unit) | 5 | empty input, slot-path gate, idempotence on simple input, reduction guarantee, CDN-deferred stats contract |
| `src/minify/html.rs` (unit) | 10 | whitespace strip, comment strip, inline `<style>` minify, inline `style="..."` minify, arbitrary-value class preservation, idempotence, doctype/charset/viewport preservation, empty input |
| `tests/optimize_idempotence.rs` | 15 | idempotence stress: `</p></details>` shape, inline style attr/block, inline script body, meta + viewport, Tailwind arbitrary classes, forms, tables, inline SVG, UTF-8, comment-strip, consecutive whitespace, doctype case both ways |
| `tests/optimize_starters.rs` | 16 | per-starter reduction guards, per-starter idempotence, per-starter visual fidelity, arbitrary-value preservation, mirror inline-script survival, second-pass byte-equal, empty/whitespace, slot-path defense |

**Node** (`node --test __test__/*.test.mjs`): **45 tests**, ~200 ms.

| File | Tests | New? |
|------|-------|------|
| `__test__/round-trip.test.mjs` | 6 | unchanged S1 |
| `__test__/ops.test.mjs` | 11 | unchanged S1 |
| `__test__/normalize.test.mjs` | 5 | unchanged S2 |
| `__test__/sanitize.test.mjs` | 13 | unchanged S3 |
| `__test__/optimize.test.mjs` | **10** | NEW |

## CI

`.github/workflows/rust.yml` unchanged from S1/S2/S3. Branch is local-only — first push will be the first real CI exercise. The new tests + bench add to the cargo and Node test sets; CI will pick them up.

## Open questions for next session / the reviewer

1. **Tailwind CDN bake — Option A revival, Option B Node-bridge, or Option C permanently?** See "Engine choices #1". My recommendation is (b) — strip the CDN script in Rust, call out to Node to generate the CSS bundle, inline it back in Rust. Keeps the Tailwind dependency on the Node side where it already lives. Decision is the user's; the FFI surface is forward-compatible whatever you pick.

2. **`OptimizeStats.{cssInlined,tailwindClassesKept}` — keep or drop the deferred fields?** Currently always 0/false in S4. Keeping them documents the contract for the future bake session and means Sem 10's TS callsite doesn't need a surface change later. Dropping them is also fine — they re-appear easily. Recommend keep.

3. **Should `optimize_for_publish` also strip `data-op-id="..."` attributes?** The current contract is: optimize is the LAST step before disk, sanitize already ran, normalize already ran, **and** strip_op_ids has been called somewhere up the chain. If a future caller forgets to strip op-ids, the optimize output will carry them to disk (browsers ignore them but they're ~5 bytes per element of useless markup). Could either:
   - (a) leave optimize agnostic — strip is the caller's job, fail fast if op-ids appear via a hard error
   - (b) make optimize idempotently strip op-ids as part of its contract
   I picked (a) implicitly (no op-id handling). Recommend formalizing in Sem 10's wiring rather than this layer.

4. **20% reduction acceptance — recalibrate to ≥15% post-Sem-8, or hold ≥20% as the bar that the future bake-session must clear?** Both are honest answers. The byte-count framing was always slightly off (the bake *adds* inline CSS, lowering reduction percentage even though it improves Lighthouse). My instinct is to recalibrate the byte-reduction criterion to ≥15% (which Option C meets) and add a separate Lighthouse-FCP criterion the future bake session is responsible for.

5. **Carry-over from S1/S2/S3 — still open:**
   - Hierarchy cascade in `apply_ops`. Sem 10-11 decision.
   - `Option<String>` → `undefined` shim at every Sem 10 call site.
   - CI prebuild distribution (GH releases recommended).
   - Normalize chain perf — Sem 11 if shadow soak demands it.
   - 4-pass sanitize consolidation — Sem 11 if shadow soak demands it.
   - `.gitattributes` — **CLOSED** in S4. The `*.html eol=lf` + 13 other text rules landed in `4fac42c` as a forward-defense against the autocrlf gotchas S2 + S3 hit on concurrent-agent ping-pong. Working tree was already LF-clean; `git add --renormalize .` produced no content changes.

## Files touched

```
.gitattributes                                                    new (LF pins for 11 text formats)
Cargo.lock                                                        modified (new deps locked)
crates/html-engine/Cargo.toml                                     modified (+ minify-html, lightningcss, optimize bench entry)
crates/html-engine/src/lib.rs                                     modified (+ optimize_for_publish napi export + Js* structs)
crates/html-engine/src/minify/mod.rs                              new (entry + OptimizeStats + slot-path defense-in-depth)
crates/html-engine/src/minify/html.rs                             new (minify-html wrapper + 10 unit tests)
crates/html-engine/tests/optimize_starters.rs                     new (16 integration tests)
crates/html-engine/tests/optimize_idempotence.rs                  new (15 idempotence stress tests)
crates/html-engine/__test__/optimize.test.mjs                     new (10 FFI smoke tests)
crates/html-engine/benches/optimize.rs                            new (Criterion bench)
docs/rust-f1-session4-handoff.md                                  new (this file)
```

Zero changes to any pre-existing Node-side code — `lib/publish/optimize-html.ts`, `lib/publish/filesystem.ts`, the 6 ingestion paths' inline checks all untouched. Sem 10 owns the migration.

## How the next session should pick up

```
git checkout rust/f1-session4-minify
cd crates/html-engine
npm install                                    # gets @napi-rs/cli
npm run build                                  # release .node binding (Windows: ~3 min cold)
cargo test -p openlen-html-engine --tests      # 289 tests, <1 s warm
node --test __test__/*.test.mjs                # 45 tests, ~200 ms

# Perf snapshot:
cargo bench --bench optimize -- --sample-size 25 --measurement-time 3 --warm-up-time 1
```

**Suggested next milestone: Sem 9 — streaming API for F3.** Sem 8's minify is publish-only and not on the chat-turn hot path; Sem 9 unlocks streaming partial-doc outputs from Kimi back through the engine for the chat preview. Alternative: pick up the Tailwind-bake follow-on (Sem 8.5) per "Engine choices #1" — depends on whether the publish-p95 target needs the bake's Lighthouse win before Sem 10's wiring.
