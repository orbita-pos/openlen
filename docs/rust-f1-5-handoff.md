# F1.5 — cheerio cleanup (handoff)

Branch: `rust/f1-5-cheerio-cleanup` off `master`'s `719111b` (the F3 S2 napi+TS-wrapper merge tip at the time the worktree was created).

```
{{SELF_SHA}}  docs(rust): F1.5 Phase F — final handoff + bundle stats
29e237e        chore(deps): F1.5 E — remove cheerio
8b1b14b        feat(rust): F1.5 D4 — cutover lib/branding/inject-logo.ts to Rust
50f0870        feat(rust): F1.5 D3 — cutover lib/branding/extract-logo.ts to Rust
ef4ac7b        feat(rust): F1.5 D2 — cutover lib/publish/credits.ts to Rust
90827e0        feat(rust): F1.5 D1 — cutover lib/publish/forms.ts to Rust
e1fdb5d        feat(rust): F1.5 C — TS shim wrappers for the four publish-time helpers
c65dbef        feat(rust): F1.5 B4 — wire_published_forms (Phase B complete)
cf067f4        feat(rust): F1.5 B3 — consolidate_unsplash_credits
c4dd758        feat(rust): F1.5 B2 — inject_logo + shared publish helpers
f3c857b        feat(rust): F1.5 B1 — extract_logo (publish module skeleton)
9bb67e7        docs(rust): F1.5 Phase A — survey + API decision for cheerio cleanup
```

> Worktree: `D:\worktrees\openlen-f1-5` (created as `git worktree add -b rust/f1-5-cheerio-cleanup D:/worktrees/openlen-f1-5 origin/master`). Zero overlap with the F3 worktrees. Rust target dir defaulted to the worktree-local `target/` (per-bash-tool env-var quirks meant `CARGO_TARGET_DIR=D:/rust/target` wasn't always honored — no functional impact, just slower cold compiles).

> Diff stat (against the 719111b merge-base): **17 files changed, +1,582 / −732**. Note that `origin/master` advanced to `8361cff` during this session (F3 S3 pipeline merge); the F1.5 changes and F3 S3 changes touch disjoint files (lib/publish + lib/branding + crates/html-engine/src/publish vs lib/ai-stream + crates/ai-gateway), so a clean merge is expected.

## Mission

Close the bundle shrink F1 S9 deferred. S9 left `cheerio` in `package.json` for four non-Motor-HTML consumers (forms / credits / branding logos) — substantive DOM-mutation work that would have doubled S9's scope. F1.5 ports those four call sites to Rust, deletes the dep, and finishes the F1 acceptance line.

## Phase A — Survey

Read the four consumers + the F1 S9 handoff + existing kuchikiki usage in the crate. Findings:

### Consumer summary

| File | Public fn | What it did with cheerio |
|---|---|---|
| `lib/publish/forms.ts` | `wirePublishedForms(html, subdomain, formConfigs?)` | For each `<form>` (in document order): set attrs (`action`, `method`, `data-openlen-form`, `data-openlen-success?`, `data-openlen-redirect?`); conditionally append two hidden inputs (`_openlen_form` index + `_openlen_hp` honeypot); once-per-doc append `<script data-openlen-form-script>` to `<body>` if absent. |
| `lib/publish/credits.ts` | `consolidateUnsplashCredits(html)` | Idempotent: strip prior `[data-openlen-credits-aggregate]` + `head meta[name='image-source']`; walk `[data-openlen-credit='unsplash']` and harvest first child `<a>`'s text+href (dedup by URL); walk `<img>` and count those with `images.unsplash.com` src whose immediate next sibling is NOT an unsplash credit span; append one `<meta name="image-source">` per credit + one for the anonymous count; append one sr-only `<aside>` to `<body>` with the credit `<ul>`. |
| `lib/branding/extract-logo.ts` | `extractLogoFromHtml(html)` | Find first `<link rel>` whose rel tokens *contain* "icon" (catches `icon`, `shortcut icon`, `apple-touch-icon`) → href. Fallback: `<meta property="og:image">` content. Returns `{href, isDataUri}` or null. |
| `lib/branding/inject-logo.ts` | `injectLogoIntoHtml({html, logoUrl})` | Synthesize `<head>` if missing. Remove existing `<link rel>` whose rel tokens are *exactly* `icon` or `shortcut` (different semantics from extract — exact token match, NOT "contains"; leaves apple-touch-icon / mask-icon alone). Append `<link rel="icon" href="…">`. If no `<meta property="og:image">` exists AND `logoUrl` is not a `data:` URI, also append `<meta property="og:image" content="…">`. |

### Callers

- `lib/publish/filesystem.ts` (`publishToDir`) calls all four during the publish pipeline. Each call is wrapped in try/catch with a `console.warn` soft-fail — the publish must never block on a parse hiccup. Behavior preserved.
- `lib/branding/resolve-project-logo.ts` calls `extractLogoFromHtml` to persist the auto-detected logo back to the DB after the first publish.
- No TS tests covered these four modules. Migration just needed `tsc --noEmit` green + the publish pipeline unbroken.

### Existing kuchikiki usage in the crate

`crates/html-engine/src/ops/scoped_view.rs` and `crates/html-engine/src/ops/resolver.rs` already use kuchikiki for DOM walks. `apply.rs` uses lol_html. F1.5 publish module joins the kuchikiki set — next-sibling checks + conditional child appends + multi-pass head/body mutation don't fit lol_html's single-pass streaming model cleanly.

## API decision (confirmed with user before coding)

Four `#[napi]` functions in a new `crates/html-engine/src/publish/` module — one per consumer, all kuchikiki-backed. **Specific over generic**: the S9 handoff suggested 3 generic primitives (`set_form_attributes` / `inject_into_head` / `extract_meta_query`); reading the actual consumers showed each does DOM walking with different semantics (next-sibling on `<img>`, first-child `<a>` extraction, rel-token "contains" vs "exactly equals"). Generic primitives would have left the DOM walking in TS, defeating the cheerio-deletion goal.

| # | Rust fn | TS shim | Notes |
|---|---|---|---|
| 1 | `wire_published_forms(html, action, configs) -> String` | `wirePublishedForms(html, subdomain, formConfigs?)` flattens the `Record<string, FormConfig>` into a `Vec<{index, success_message?, redirect_url?}>` and pre-computes `action` from `NEXT_PUBLIC_SITE_URL`. `HONEYPOT` + `FORM_SCRIPT` moved into Rust as `const` strings — no runtime dependencies. |
| 2 | `consolidate_unsplash_credits(html) -> {html, credits, anonymous_unsplash_count}` | 1:1 wrapper. `UnsplashCredit { author, author_url }` returned in document order. |
| 3 | `extract_logo(html) -> Option<{href, is_data_uri}>` | 1:1 wrapper. `isDataUri(href)` + `decodeDataUri(uri)` stay in `lib/branding/extract-logo.ts` (regex + base64 only — no DOM). |
| 4 | `inject_logo(html, logo_url) -> String` | 1:1 wrapper. Soft-fail behaviour (return original HTML on no-op) lives in Rust. |

## Phase B — Rust functions (one commit per function)

### B1 (`f3c857b`) — `extract_logo` + publish module skeleton

`crates/html-engine/src/publish/{mod.rs, logo.rs}` + napi binding for `ExtractedLogo` + `extract_logo`. 14 unit tests covering: empty input, document-order priority across multiple icon links, every rel variant (icon / shortcut icon / apple-touch-icon / mask-icon), case-insensitive token matching, og:image fallback, data: URI detection, href whitespace handling.

### B2 (`c4dd758`) — `inject_logo` + shared helpers

Added `inject_logo` to `logo.rs` plus three shared helpers to `publish/mod.rs` (`parse_fragment_children`, `escape_attr`, `serialize_doc`) that the remaining functions reuse. 15 unit tests covering: strip/append rules, apple-touch-icon and mask-icon preservation, og:image conditional injection (data: URI carve-out), attribute escaping, and stability from N=2 (first call introduces og:image at end-of-head; second call lands the icon link after og:image and is stable from there — that's the contract callers can rely on for repeated publishes).

### B3 (`cf067f4`) — `consolidate_unsplash_credits`

`crates/html-engine/src/publish/credits.rs` + two more shared helpers (`escape_attr_strict`, `escape_html`). Strip-then-rewrite for idempotency; the per-photographer `<meta>` + per-credit `<li>` + sr-only `<aside>` all bake from the harvested set. 15 unit tests covering: empty-input passthrough, harvest + dedup by URL, case-insensitive CDN regex, anonymous count with mixed credited/uncredited images, skip-spans-with-no-anchor / empty-author / empty-URL, idempotency, removal-clears-prior-aggregate.

> Note: one test was adjusted to document an html5ever spec-quirk — `<` in attribute values is left literal per HTML5 (not entity-encoded), which differs from cheerio's stricter serializer but is semantically equivalent. The DOM round-trips either way.

### B4 (`c65dbef`) — `wire_published_forms` (Phase B complete)

`crates/html-engine/src/publish/forms.rs` + napi binding for `WireFormConfig`. `HONEYPOT` + the full inline `FORM_SCRIPT` live as `const` strings in Rust — no env / runtime variation, no need to ferry them across the napi boundary per call. 12 unit tests covering: no-forms early return, attribute set + hidden input append, sequential indices across multiple forms, per-form config baking, empty-string config values skipped, partial / out-of-range configs, no-duplicate hidden inputs on re-run, no-duplicate script on re-run, idempotency after first application.

**Phase B totals: 56 new publish-module unit tests, 28 cargo test binaries green (up from 27 pre-F1.5), zero regressions across the existing crate tests.**

## Phase C (`e1fdb5d`) — TS shim wrappers

Adds 4 thin wrappers + 3 new interfaces + 1 type re-export to `lib/html-engine.ts`. Pattern mirrors F1 S9: `Option<T>` → `null` normalization for the one Option-returning function (`extractLogo`), struct-field re-shape for parity with how `parseOps` / `applyOps` marshal their arrays, plain pass-through for everything else.

```typescript
export function extractLogo(html: string): ExtractedLogo | null
export function injectLogo(html: string, logoUrl: string): string
export function consolidateUnsplashCredits(html: string): ConsolidationResult
export function wirePublishedForms(html: string, action: string, configs: WireFormConfig[]): string
```

The shim stays low-level: it mirrors the Rust signature, NOT the higher-level consumer surface. The consumer wraps it with the OpenLen-specific translation (subdomain → action, Record → Vec).

`npx tsc --noEmit`: exit 0 after also building the F3 `@openlen/ai-gateway` bindings locally so its pre-existing import resolves — unrelated to this session, no source touched.

## Phase D — Consumer cutovers (one commit per file)

| Sub-phase | File | Net Δ | Result |
|-----------|------|-------|--------|
| **D1** (`90827e0`) | `lib/publish/forms.ts` | +18 / −79 | Resolves the per-subdomain submit URL from env, reshapes the project's `Record<index, FormConfig>` into `WireFormConfig[]`, delegates to the binding. `HONEYPOT` + `FORM_SCRIPT` deletion + cheerio import deletion. |
| **D2** (`ef4ac7b`) | `lib/publish/credits.ts` | +11 / −145 | 1:1 delegation. Type contract re-exported from the html-engine shim. |
| **D3** (`50f0870`) | `lib/branding/extract-logo.ts` | +10 / −41 | DOM walk delegated to Rust. `isDataUri` + `decodeDataUri` (regex + base64) stay in TS verbatim. |
| **D4** (`8b1b14b`) | `lib/branding/inject-logo.ts` | +6 / −53 | One-line delegation. The full contract (rel-token semantics, data: URI carve-out for og:image) lives in `crates/html-engine/src/publish/logo.rs`. |

`npx tsc --noEmit` green after D4. The four consumer files are now 11 / 18 / 16 / 14 lines each — thin enough that they're effectively re-export modules with light translation logic.

## Phase E (`29e237e`) — Remove cheerio

`npm uninstall cheerio` drops 25 packages from `package-lock.json` (cheerio + 24 transitive deps including `parse5`, `htmlparser2`, `domhandler`, `css-select`, etc.).

Companion cleanups:

- Scrubbed the lingering `cheerio` word from comments in `lib/publish/filesystem.ts`, `lib/html-engine.ts`, `scripts/soak/inputs.ts`, `crates/html-engine/src/publish/mod.rs`, and `crates/html-engine/src/sanitize/urls.rs` (rephrased as "parse hiccup" / "legacy TS parser" where the historical context still matters).
- Deleted `crates/html-engine/__test__/perf-vs-cheerio.mjs` — the ad-hoc Rust-vs-cheerio benchmark from the F1 S5 era. The script can't import without the dep, and the historical perf numbers it produced are preserved in `docs/rust-f1-session5-handoff.md`.
- `README.md` retains its cheerio mentions (lines 100, 102) — those refer to an evaluator-pipeline diagram that's already stale post-orchestrator-rollback (2026-05-19); rewriting README.md is out of scope here.

### Verification — acceptance criteria

| Criterion | State |
|-----------|-------|
| cheerio NOT in `package.json` / `package-lock.json` | **PASS** — grep "cheerio" in both files: 0 matches |
| grep `cheerio` in `lib/ app/ scripts/ components/ crates/` → 0 matches | **PASS** |
| 4 consumers migrated | **PASS** (D1-D4) |
| `npx tsc --noEmit` green | **PASS** (exit 0) |
| `cargo test -p openlen-html-engine` green with new tests | **PASS** — 28 test binaries (up from 27 pre-F1.5), all green; 56 new publish-module tests on top of the existing 367 |
| `npm run build` green | **PARTIAL** — webpack-compile phase ran clean (validates no broken imports, externalization still works). Build fails later at `generateStaticParams` for `/templates/[slug]` because the worktree has no `.env.local` → no `DATABASE_URL`. Pre-existing env issue, identical to the F1 S9 verification state. The Hetzner deploy script does the full standalone build with production env loaded; first deploy after merging produces the comparable artifact. |
| Bundle stats show reduction | **PASS** — see below |

## Bundle measurement

`npm run build` to webpack-compile success in the worktree (DB-fetch failure later as noted above):

| Artifact | F1 S9 baseline | F1.5 | Δ |
|---|---:|---:|---:|
| `.next/server/` | 8.9 MB / 23 chunks | **6.8 MB / 22 chunks** | **−2.1 MB (−24%), −1 chunk** |
| `.next/static/` | 1.9 MB | 1.9 MB | unchanged |
| References to `@openlen/html-engine` in `.next/server/chunks/*.js` | zero | **zero** | externalization still holds |

The 2.1 MB server-bundle reduction is approximate — the F1 S9 measurement was on a different machine config and predates F3 S2 + S3, both of which added crate dependencies. But the direction is clear and the magnitude lines up with the cheerio + 24 transitive deps that left `node_modules` (and stopped being pulled into the server-side webpack closure for the publish-time paths).

The F1 acceptance line — **"Bundle Node −150 KB after deleting cheerio"** — is met and then some.

## Final state — what remains in master after F1.5

| Component | Status post-F1.5 |
|---|---|
| `crates/html-engine/src/publish/` | New module with 4 kuchikiki-backed functions + napi exports. 56 unit tests inline. |
| `lib/html-engine.ts` | Adds 4 wrappers + 3 interfaces + WireFormConfig re-export. Continues as the single TS-side surface for `@openlen/html-engine`. |
| `lib/publish/{forms, credits}.ts` + `lib/branding/{extract, inject}-logo.ts` | Thin TS shims around the new binding; existing import paths unchanged. |
| `cheerio` in `package.json` / `package-lock.json` | **Gone.** |
| F1 acceptance line "Bundle Node −150 KB" | **Met** (−2.1 MB on the server bundle, ~14× the target). |

## Open items post-F1.5

1. **Operator merge: F1.5 + F3 S3 integration.** This branch was based on `719111b` (the F3 S2 merge tip at session start). During the session `origin/master` advanced to `8361cff` (F3 S3 pipeline merge). The two branches touch disjoint files — F1.5 = `lib/publish/` + `lib/branding/` + `crates/html-engine/src/publish/`; F3 S3 = `lib/ai-stream/` + `crates/ai-gateway/`. A clean merge is expected; the operator's call whether to rebase or merge.
2. **Lighthouse measurement carryover from F1 S9.** Still open — the post-deploy FCP signal is needed to decide whether Tailwind bake removal regressed cold-cache visitors. F1.5 doesn't change the picture here; whatever the Lighthouse verdict, F1.5's bundle shrink is additive to it.
3. **README.md stale evaluator-pipeline diagram.** Lines 100 + 102 still mention cheerio in a description of a judge pipeline that was rolled back with the orchestrator on 2026-05-19. Out of scope here; flagged for a future docs sweep.

## How the next session should pick up

```bash
git checkout master
git pull
# (if F1.5 isn't yet merged + F3 S3 is on master, rebase F1.5 first;
#  if merged, just continue.)

cd crates/html-engine
npm install --no-audit --no-fund
npm run build       # ~50 s warm in release mode
cd ..
PUPPETEER_SKIP_DOWNLOAD=1 npm install --no-audit --no-fund

# Validate state:
npx tsc --noEmit
cargo test -p openlen-html-engine --tests
```

Suggested next milestone candidates (operator's pick):

- **Lighthouse measurement** (carryover from F1 S9 — see Open item 2).
- **F3 S4+** (continue the AI Gateway work).
- **CI prebuild first exercise** (`html-engine-v*` tag push — also a F1 S9 carryover).

No PR. The user owns the merge.

---

**F1.5 is COMPLETE.** Cheerio is gone, the four publish-time consumers run through Rust, the bundle is 2.1 MB lighter.

## Self-SHA

`{{SELF_SHA}}` — replaced after the Phase F handoff commit lands.
