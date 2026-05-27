# F1 soak-tooling — handoff (decisions + departures from spec)

Branch: `chore/soak-tooling` (off `master`'s `33abe4c`, no PR). Worktree: `D:/worktrees/openlen-soak`.

This session sets up the synthetic load + summarizer + runbook for the F1 cutover soak window. **Zero production code modified** — only `scripts/soak/*` + `docs/rust-f1-soak-runbook.md` + this doc. Zero changes to `lib/`, `app/`, `crates/`.

## What shipped

```
scripts/soak/inputs.ts                          new (3 loaders: starter + db + 13 adversarials)
scripts/soak/ops-generator.ts                   new (8 ops batches + 9 parseOps envelopes)
scripts/soak/run.ts                             new (main driver + JSONL logger + per-call try/catch)
scripts/soak/tail.ts                            new (summarizer + verdict + optimize-html byte-delta histogram)
docs/rust-f1-soak-runbook.md                    new (end-to-end procedure + interpretation guide)
docs/rust-f1-soak-decisions.md                  new (this file)
```

No edits to `lib/`, `app/`, `crates/`. No new dependencies. No deploy. No PR.

## Departures from the session brief

### 1. `parseOps` envelopes pulled OUT of the per-input loop

The brief sketches `parseOps(envelope)` inside the per-input loop. `parseOps` is *input-independent* — it operates only on the envelope string. Running it per input means `N × M` calls that all produce the same divergence record per envelope. That's pointless duplication and fluffs the divergence count without adding information.

I run the envelope sweep ONCE at the top of `main()` (after `setShadowLogger`, before the per-input loop). Per-envelope divergences are still logged; the total count reflects the envelope set's intrinsic divergence shape, not `N × envelopes`.

If the tail's sample-size bar (`total ≥ 100`) is hard to clear in dev-config because of this, the right fix is more adversarial inputs (driving sanitize/html-ops/normalize records), not running parseOps N times. The runbook calls this out under "Sample-size expectations".

### 2. `optimize-html-for-production` requires `NODE_ENV=production`

`optimizeHtmlForProduction` has a dev-mode skip at the top of the function that returns the input unchanged when `process.env.NODE_ENV !== "production"`. The shadow wrapper sits BELOW the skip, so non-prod runs never invoke `asyncShadowCompare` for that site.

This was intentional in F1 S8 (avoids Next.js webpack mangling tailwindcss's preflight.css path on Windows). The synthetic-load workaround is to set `NODE_ENV=production` for the run; the runbook documents this, and `scripts/soak/run.ts` emits a startup warning when it sees `NODE_ENV` not set to `production`.

### 3. Adversarial slot-path inputs deliberately trigger actionable records

The brief asks for slot-path variants in the adversarial set. Those inputs WILL trigger `errorShapeMismatch=true` in `sanitize-filled-html` (Rust adapter throws; TS doesn't) and in `optimize-html-for-production` (same shape). The synthetic load alone will therefore produce `❌ NOT READY` from `tail.ts`.

This is correct. The synthetic load is testing that the gates fire as designed. The verdict tool is for PROD soak data, where any unexpected actionable record is a real signal. The runbook's "Interpreting actionable records" section spells out the expected-from-synthetic vs. unexpected split, and provides a `jq` filter for excluding slot-path-by-design records from prod log analysis.

### 4. DB sample uses `projectVersions.html`, not `projects.data->>'html'`

`projectVersions` rows are versioned snapshots — every chat-applied edit + every publish creates one. That's a richer and more representative input set than the live `projects.data.html` (which is only the current tip). Drizzle query: `db.select({ id, html }).from(projectVersions).limit(N)`.

When `DATABASE_URL` is unset, the loader returns `[]` with a warning log — no throw, no broken run. The Drizzle client in `lib/db/index.ts` always instantiates (fallback to an invalid conn string), so static imports are safe.

### 5. Synthetic load assumes `process.cwd()` is the worktree root

Scripts compute `templates/starter/` and the default JSONL path relative to `process.cwd()`. This matches every other script in `scripts/` (no `import.meta.dirname` fiddling needed) and aligns with how the runbook documents invocation: `npx tsx scripts/soak/run.ts` from the worktree root.

If a future invocation needs to run from a different cwd, override `SOAK_LOG` to an absolute path; starter loading would silently return `[]` (the runbook check warns at startup).

## Sample-size expectations

**`NODE_ENV=unset`, `DATABASE_URL=unset` (minimum config):**
- 3 starters + 13 adversarials = 16 inputs.
- Per-input calls: 1 sanitize + 1 normalize + 1 tag + 1 strip + 8 applyOps + 5 resolvePaths + 1 buildScopedView = 18 calls.
- Plus 9 parseOps envelopes (once total).
- Theoretical max calls: ~290.
- Expected divergence count: ~60-150 (varies; serializer-drift on cheerio vs lol-html dominates, byte-equal cases produce 0 records).

**`NODE_ENV=production`, `DATABASE_URL=set`, `SOAK_DB_SAMPLE=20` (full config):**
- 3 starters + 20 DB rows + 13 adversarials = 36 inputs.
- Per-input: 19 calls (adds 1 optimize-html).
- Theoretical max: ~690.
- Expected divergence count: ~300-500 (optimize-html logs 1 record per non-skipped input — TS bakes, Rust minifies).

So `total ≥ 100` lands comfortably with the full config; the dev config may need `SOAK_DB_SAMPLE=50+` if `DATABASE_URL` is available, or more adversarial inputs otherwise.

## Decisions I weighed but didn't take

**Filtering slot-path adversarials out of the verdict count** — Considered adding a `--ignore-by-design` flag to `tail.ts` that subtracts slot-path-tagged adversarial records from the actionable count automatically. Rejected: the verdict tool needs to behave the same on synthetic and prod input; baking in "what's expected from synthetic" couples the two. The runbook documents the `jq` filter instead, leaving the verdict deterministic and trustworthy on prod data.

**Wiring the synthetic load through the Next.js server runtime** — Considered launching `next start` in a sidecar so optimize-html runs in its actual Next.js webpack context. Rejected: the F1 S8 adapter already documented that the dev skip is Next-webpack-specific, not optimize-html-specific. Running via `tsx` with `NODE_ENV=production` exercises the same code path the prod server hits, modulo Next-internal asset resolution (which only matters for the TS bake, not the Rust minify). Adding a Next harness for parity wasn't worth the complexity.

**Replacing JSONL with sqlite for log storage** — Considered. Rejected: JSONL is human-readable, append-only, mergeable with `cat`, queryable with `jq`. sqlite buys indexed query speed for >>100k records — out of scope for the F1 soak budget (~10k records over a week of prod traffic estimated).

## Open questions for the F1 S9 prep session

1. **Soak window length.** S8 handoff suggests 7 days as a first pass. If prod shadow-log volume is much lower than expected (the 10-20 RPS estimate may be high for the chat-turn path), 14 days may be needed for `total ≥ 100` to clear. Check the volume after day 1 and re-scope.

2. **`apply-ops` cascade rate.** The custom `equalityFn` masks `appliedCount` divergences; `tsBytes`/`rustBytes` are still logged. The S9 cutover decision: <5% of batches trip cascade → leave as-is, flip to `rust`, document the gap permanently; ≥5% → port `apply_ops` to kuchikiki (~1 day per S1 estimate). The tail.ts site breakdown surfaces the apply-ops total; cross-reference with prod chat-turn op-batch volume to compute the ratio.

3. **optimize-html byte-delta sign.** The histogram tells Sem 8.5 whether the Rust Tailwind bake is critical (consistently positive delta = TS adds bytes Rust loses → Rust must port a real matcher) or nice-to-have (consistently negative = Rust minify wins despite no bake → Node-bridge bake is fine for interim). The synthetic load's adversarial set includes Tailwind-arbitrary inputs to seed this signal; prod data refines it.

## How the next session picks up

```bash
git checkout chore/soak-tooling

# Build binding (one-time per crate src change — N/A from this session):
cd crates/html-engine
CARGO_TARGET_DIR=D:/rust/target npm install --no-audit --no-fund
CARGO_TARGET_DIR=D:/rust/target npm run build
cd ..

# Install root deps:
PUPPETEER_SKIP_DOWNLOAD=1 npm install --no-audit --no-fund

# Validate state:
npx tsc --noEmit

# Synthetic load:
NODE_ENV=production npx tsx --env-file=.env.local scripts/soak/run.ts > /dev/null

# Summarize:
npx tsx scripts/soak/tail.ts soak-log.jsonl
```

For the prod soak: wire `setShadowLogger` from `instrumentation.ts` to `SHADOW_LOG_PATH`, deploy, capture ≥7 days of traffic, merge with `synthetic-soak.jsonl` and re-summarize. When the verdict is `✅ SAFE TO FLIP` (synthetic adversarial slot-path records excluded), F1 S9 proceeds.

No PR. The user owns the merge.
