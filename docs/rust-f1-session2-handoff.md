# F1 Rust HTML engine — Session 2 handoff

Branch: `rust/f1-session2-normalize` (off `master`'s session-1 merge `5f109b9`, 10 commits, **not** pushed, no PR).

```
4d76e5e  chore(rust): add Criterion normalize bench + TS comparison harness
dcf9a35  feat(rust): normalize/modes + normalize_born_canonical chain entry
b798ba7  feat(rust): normalize/color — port of lib/normalize-color.ts
c5fb3fd  feat(rust): normalize/accent — port of lib/normalize-accent.ts
3e4997a  feat(rust): normalize/font — port of lib/normalize-font.ts
b876893  feat(rust): normalize/type_pass — port of lib/normalize-type.ts
577cc92  feat(rust): normalize/space — port of lib/normalize-space.ts
14cb5f5  feat(rust): normalize/radius — port of lib/normalize-radius.ts
d9bc543  chore(rust): add Criterion ops bench as Sem 5 comparable
e47ff1a  refactor(rust): drop Js* prefix on napi-exposed struct names
```

## Milestones completed against the 12-week plan

| Sem  | Milestone | Status |
|------|-----------|--------|
| 1-2  | Bootstrap napi-rs + parse/serialize round-trip | **Done** (S1) |
| 3-4  | ID-tag ops engine | **Done** (S1) |
| 5-6  | Normalize chain (7 idempotent passes) | **Done** (S2) — byte-equal to TS on 3 starter templates, end-to-end + per pass |
| 7    | Sanitizer + slot_path single gate | not started |
| 8    | Minify + CSS opt | not started |
| 9    | Streaming API for F3 | not started |
| 10-11| Node migration + shadow soak | not started |
| 12   | Cleanup — delete cheerio | not started |

Stopping point: the chain ships byte-equal and idempotent. Perf is honest (see below) but did not hit the optimistic ≥20× target — the user reviewed and chose to ship now and move on to Sem 7+ next session rather than re-architect.

## Acceptance criteria — F1 global

| Criterion | State | Notes |
|-----------|-------|-------|
| Chat-turn HTML overhead p95 < 30 ms (today ~150 ms) | **On track**. Ops pipeline ~3.5 ms p95 + normalize chain ~3.4 ms p95 ≈ 7 ms total — well under target | see bench section |
| Publish p95 < 200 ms | not measurable yet — Sem 8 (minify) + Sem 10 wiring | |
| Lighthouse mobile ≥95 average across 20 templates | not measurable — Sem 8 + harness | |
| Zero `data-slot-path=` leaks in 1000 adversarial docs | Sem 7 owns the consolidated gate | |
| Compiles clean Windows x64 + Linux x64 with CI prebuilds | **Windows verified locally (MSVC, rustc 1.95.0)**. CI YAML committed; branch still local-only | `.github/workflows/rust.yml` unchanged from S1 |
| Bundle Node −150 KB after deleting cheerio | Sem 12 | |
| Tests Rust < 5 s | **Done** — `cargo test -p openlen-html-engine --all-targets` finishes <1 s | 133 Rust tests across 16 files |

## Surface shipped (Rust → JS, via napi-rs)

```ts
export declare function roundTrip(html: string): string
export declare function normalizeBornCanonical(html: string): string   // ← NEW
export declare function tagWithOpIds(html: string): TaggedHtmlResult
export declare function stripOpIds(html: string): string
export declare function parseOps(rawHtml: string): ParseResult
export declare function applyOps(taggedHtml: string, ops: Array<Op>): ApplyResult
export declare function resolveOpIdByPath(taggedHtml: string, path: string): string | null
export declare function buildScopedView(taggedHtml: string, pinnedOpId: string): ScopedView | null
```

Struct names dropped the `Js*` prefix — `TaggedHtmlResult`, `Op`, `ParseResult`, `ApplyError`, `ApplyResult`, `ScopedView`. Rust internals keep the `Js*` prefix on the napi-object structs to avoid colliding with the internal `apply::Op` / `apply::ApplyResult` types; the rename is done via `#[napi(object, js_name = "…")]` so only the JS side sees the clean names.

## Engine choices (deviations from the plan worth flagging)

1. **Normalize chain stayed regex-based**, NOT moved onto a real CSS parser. The plan flagged accent.ts as "a regex frágil sobre Tailwind config; oportunidad de parser real con kuchikiki o lol-html." After the byte-equal pass landed, the regex port works on all 3 starter templates. Moving to a real DOM walk now would risk byte-equal regressions without obviously winning perf (see "Open questions"). Recommend revisiting at Sem 11 if shadow soak flags adversarial templates the regex misses.

2. **`(?<!-)` negative lookbehind reimplemented manually.** The TS `normalize-color.ts` uses `(?<!-)color\s*:` to skip `border-color:`. The `regex` crate doesn't support lookbehind. The Rust port iterates `color\s*:\s*[^;}]+` matches and checks the byte before each for `-` — same result, kept the test gate green.

3. **`#hex(?![0-9a-f])` negative lookahead also done manually**, in `normalize-accent.rs`. Same reason — regex crate lacks lookahead. Iterate all `#hex` matches; check the byte after; replace only if next byte isn't a hex digit. Preserves the TS guard against `#rrggbb` inside `#rrggbbaa`.

4. **Module is `type_pass` (not `type`).** `type` is a Rust keyword and can't be a module name. The napi entry point doesn't expose any name that hits this.

5. **Per-call regex compilation in `normalize_accent`.** The hex / rgb / rgb-triplet regexes depend on the resolved accent's RGB and can't be precomputed globally. Each `normalize_accent` call recompiles them. Cost is sub-microsecond per regex; not a hotspot but worth noting.

## Benchmarks — release+LTO build (`bench` profile), p95

### Normalize chain (NEW)

```
                            Rust          TS (V8 irregexp)    speedup
normalize/chain/mirror      3.4 ms        1.2 ms              0.6x  ← Rust slower
normalize/chain/counter     2.7 ms        1.0 ms              0.4x
normalize/chain/manuscript  2.2 ms        1.0 ms              0.5x

per-pass on mirror.html:
  radius / space / type     <0.1 ms each
  font                      ~21 µs
  accent                    ~2.2 ms    ← dominates the chain
  color                     ~38 µs
  modes                     ~12 µs
```

The ≥20× target was not met. Reasoning: V8's irregexp JIT is fiercely optimized for the exact regex shape this pipeline uses, and the per-pass model rescans the document 5-6 times. The Sem 5-6 commit body has the long version. Crucially, **the chat-turn p95 target (<30 ms) is still well clear**: ops ~3.5 ms + normalize ~3.4 ms ≈ 7 ms total Rust pipeline vs the ~150 ms baseline. The big chat-turn win still comes from ops, as session 1 predicted. The normalize port is correctness-equivalent and unblocks Sem 10's Node migration; perf can be revisited at Sem 11 with shadow-soak data on real Kimi turns.

### Ops pipeline (re-measured at the same Criterion settings as normalize)

```
ops/mirror/tag                    1.1 ms
ops/mirror/strip                  271 µs
ops/mirror/parse_envelope_20      90 µs
ops/mirror/apply_10               2.1 ms
ops/mirror/tag_parse_apply_strip  3.5 ms
```

Matches session 1's perf-vs-cheerio numbers (3.4 ms p95 there → 3.5 ms here) — now in a maintained Criterion harness instead of an ad-hoc script.

## CI

`.github/workflows/rust.yml` unchanged from S1 — matrix on `ubuntu-latest` + `windows-latest`, Rust stable + Node 24, runs fmt + clippy + `cargo test --all-targets` + napi build + Node smoke tests. **Still not exercised** — branch local-only.

The new tests + benches add to the cargo test set; CI will pick them up on first push.

## Test inventory

**Rust** (`cargo test -p openlen-html-engine --all-targets`): **133 tests** across 16 files, <1 s.

Session 1 (unchanged, 53 tests across 8 files):
- `tests/round_trip.rs` — 7
- `tests/ops_tagger.rs` — 6
- `tests/ops_stripper.rs` — 5
- `tests/ops_parse.rs` — 10
- `tests/ops_apply.rs` — 11
- `tests/ops_resolver.rs` — 7
- `tests/ops_scoped_view.rs` — 6
- `src/ops/id.rs` unit test — 1

Session 2 (new, 80 tests across 8 files):
- `tests/normalize_radius.rs` — 11 (byte-equal × 3 starters + idempotence × 3 + 5 unit cases)
- `tests/normalize_space.rs` — 9
- `tests/normalize_type.rs` — 10
- `tests/normalize_font.rs` — 10
- `tests/normalize_accent.rs` — 13 (the heavy hitter: covers named-vs-chroma, 8-digit-hex guard, rgb/rgba with and without alpha)
- `tests/normalize_color.rs` — 11 (incl. the `(?<!-)color:` border-color skip)
- `tests/normalize_modes.rs` — 9
- `tests/normalize_chain.rs` — 7 (end-to-end byte-equal vs `lib/normalize.ts`)

**Node** (`node --test __test__/*.test.mjs`): **22 tests** over the FFI boundary, ~150 ms.
- `__test__/round-trip.test.mjs` — 6 (unchanged from S1)
- `__test__/ops.test.mjs` — 11 (unchanged from S1)
- `__test__/normalize.test.mjs` — 5 (NEW: byte-equal × 3 starters + empty + idempotence)

**Fixture generator** — `__test__/gen-fixtures.ts` (run via `npx tsx`) is the single source of truth tying the Rust port to `lib/normalize-*.ts`. Whenever the TS reference changes before Sem 12 deletes it, regenerate fixtures and verify cargo tests stay green. Fixtures themselves are checked into `tests/fixtures/<pass>/{mirror,counter,manuscript}.html` so cargo test is hermetic.

## Open questions for next session / the reviewer

1. **Normalize chain perf — accept or revisit?** Decided this session: ship the byte-equal port now; perf is a Sem 11 question. If shadow-soak data shows real chat turns where normalize dominates, options are: (a) consolidate the 5-6 sequential accent passes into a single-scan walker (probably 2-4× win); (b) replace accent's regex chain with a real CSS parser (e.g. via lol-html attribute handlers); (c) cache normalized templates if the same template is normalized repeatedly. The current perf gap is real but the overall chat-turn target is met regardless. Recommend NOT optimizing until shadow soak provides evidence.

2. **Negative lookaround workarounds.** Two manual reimplementations (the `(?<!-)` color check and the `#hex(?![0-9a-f])` guard). Both pass the byte-equal gate on all starters. If we ever migrate to `fancy-regex`, these can collapse back to the original regexes — but the perf cost of fancy-regex's NFA engine likely isn't worth it.

3. **autocrlf + the fixture files.** Repo has `core.autocrlf=true` and no `.gitattributes`; the fixture HTML files and the starter HTML files get the same LF↔CRLF conversion on Windows checkout, so byte-equal holds cross-platform by symmetry. A `.gitattributes` pinning `*.html` to `eol=lf` (or marking the fixtures `binary`) would make this robust against accidental autocrlf changes. Low priority — flagging for visibility.

4. **Carry-over from Session 1 — still open:**
   - Hierarchy cascade in `apply_ops` (parent delete + child op): under-reports `applied_count`. Decide before Sem 10-11 whether to swap to kuchikiki or live with the divergence.
   - `Option<String>` → `undefined` on the napi boundary. The S1 plan was to use `r.html ?? null` at every Sem 10 call site. Still recommended.
   - CI prebuild distribution. Sem 10 needs the `.node` binaries somewhere. Recommend GH releases.

## Files touched

```
crates/html-engine/Cargo.toml                          modified (criterion dev-dep + 2 [[bench]] entries)
crates/html-engine/src/lib.rs                          modified (js_name on 5 structs; normalize_born_canonical napi export)
crates/html-engine/src/normalize/mod.rs                new (chain entry point + 7 pub uses)
crates/html-engine/src/normalize/radius.rs             new
crates/html-engine/src/normalize/space.rs              new
crates/html-engine/src/normalize/type_pass.rs          new
crates/html-engine/src/normalize/font.rs               new
crates/html-engine/src/normalize/accent.rs             new
crates/html-engine/src/normalize/color.rs              new
crates/html-engine/src/normalize/modes.rs              new
crates/html-engine/benches/ops.rs                      new
crates/html-engine/benches/normalize.rs                new
crates/html-engine/tests/normalize_radius.rs           new
crates/html-engine/tests/normalize_space.rs            new
crates/html-engine/tests/normalize_type.rs             new
crates/html-engine/tests/normalize_font.rs             new
crates/html-engine/tests/normalize_accent.rs           new
crates/html-engine/tests/normalize_color.rs            new
crates/html-engine/tests/normalize_modes.rs            new
crates/html-engine/tests/normalize_chain.rs            new
crates/html-engine/tests/fixtures/radius/{3 starters}  new
crates/html-engine/tests/fixtures/space/{3 starters}   new
crates/html-engine/tests/fixtures/type/{3 starters}    new
crates/html-engine/tests/fixtures/font/{3 starters}    new
crates/html-engine/tests/fixtures/accent/{3 starters}  new
crates/html-engine/tests/fixtures/color/{3 starters}   new
crates/html-engine/tests/fixtures/modes/{3 starters}   new
crates/html-engine/tests/fixtures/chain/{3 starters}   new
crates/html-engine/__test__/gen-fixtures.ts            new
crates/html-engine/__test__/normalize.test.mjs         new
crates/html-engine/__test__/perf-normalize-vs-ts.mjs   new
docs/rust-f1-session2-handoff.md                       new (this file)
```

Zero changes to any pre-existing Node-side code — `lib/normalize*.ts`, `lib/html-ops.ts`, `lib/publish/*` all untouched. cheerio still in `package.json`. Sem 10 owns the migration.

## How the next session should pick up

```
git checkout rust/f1-session2-normalize
cd crates/html-engine
npm install                  # gets @napi-rs/cli + tsx (peer)
npm run build                # release .node binding
cargo test -p openlen-html-engine         # 133 tests, <1s
node --test __test__/*.test.mjs           # 22 tests, ~150ms

# Re-generate fixtures only if you change a lib/normalize-*.ts file:
npx tsx __test__/gen-fixtures.ts

# Perf snapshot:
cargo bench --bench ops -- --sample-size 25 --measurement-time 3 --warm-up-time 1
cargo bench --bench normalize -- --sample-size 25 --measurement-time 3 --warm-up-time 1
node --import tsx __test__/perf-normalize-vs-ts.mjs
```

Suggested next milestone: **Sem 7, the slot_path / sanitizer gate.** `publishToDir` and the ingestion paths each independently reject `data-slot-path=`; consolidating them into a single Rust gate is the F1 plan's safety-critical step. Aim for: `pub fn sanitize_for_publish(html: &str) -> Result<String, SanitizeError>` exposed via napi, with the same byte-equal-on-clean-input + idempotent contract the normalize chain has. Adversarial test corpus: 1000 docs with `data-slot-path` injected in attributes, content, comments, CDATA, encoded entities.
