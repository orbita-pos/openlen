# F1.5 — cheerio cleanup (handoff)

Branch: `rust/f1-5-cheerio-cleanup` (off `master`'s `719111b` = F3 S2 napi+TS-wrapper merge tip).

> Worktree: `D:\worktrees\openlen-f1-5` (created as `git worktree add -b rust/f1-5-cheerio-cleanup D:/worktrees/openlen-f1-5 origin/master`). Zero overlap with F3 worktrees. Rust target dir: `D:/rust/target` (set per-shell with `$env:CARGO_TARGET_DIR = "D:/rust/target"`).

## Mission

Close the bundle shrink F1 S9 deferred. S9 left `cheerio` in `package.json` for four non-Motor-HTML consumers (forms / credits / branding logos) — substantive DOM-mutation work that would have doubled S9's scope. F1.5 ports those four call sites to Rust, deletes the dep, and finishes the F1 acceptance line.

## Phase A — Survey

Read the four consumers + the F1 S9 handoff + existing kuchikiki usage in the crate. Findings:

### Consumer summary

| File | Public fn | What it does (cheerio dependency) |
|---|---|---|
| `lib/publish/forms.ts` | `wirePublishedForms(html, subdomain, formConfigs?)` | For each `<form>` (in document order): set attrs (`action`, `method`, `data-openlen-form`, `data-openlen-success?`, `data-openlen-redirect?`); conditionally append two hidden inputs (`_openlen_form` index + `_openlen_hp` honeypot); once-per-doc append `<script data-openlen-form-script>` to `<body>` if absent. |
| `lib/publish/credits.ts` | `consolidateUnsplashCredits(html)` | Idempotent: strip prior `[data-openlen-credits-aggregate]` + `head meta[name='image-source']`; walk `[data-openlen-credit='unsplash']` and harvest first child `<a>`'s text+href (dedup by URL); walk `<img>` and count those with `images.unsplash.com` src whose immediate next sibling is NOT an unsplash credit span; append one `<meta name="image-source">` per credit + one for anonymous count; append one sr-only `<aside>` to `<body>` with the credit `<ul>`. |
| `lib/branding/extract-logo.ts` | `extractLogoFromHtml(html)` | Find first `<link rel>` whose rel tokens *contain* "icon" (catches `icon`, `shortcut icon`, `apple-touch-icon`) → href. Fallback: `<meta property="og:image">` content. Returns `{href, isDataUri}` or null. Also exports pure helpers `isDataUri(href)` + `decodeDataUri(uri)` (regex + base64, no cheerio). |
| `lib/branding/inject-logo.ts` | `injectLogoIntoHtml({html, logoUrl})` | Synthesize `<head>` if missing. Remove existing `<link rel>` whose rel tokens are *exactly* `icon` or `shortcut` (note: different semantics from extract — exact token match, NOT "contains"; leaves apple-touch-icon / mask-icon alone). Append `<link rel="icon" href="…">`. If no `<meta property="og:image">` exists AND `logoUrl` is not a `data:` URI, also append `<meta property="og:image" content="…">`. Soft-fails to original HTML on any parse error. |

### Callers

- `lib/publish/filesystem.ts` (`publishToDir`) calls all four during the publish pipeline. Each call is wrapped in try/catch with a `console.warn` soft-fail — the publish must never block on a parse hiccup. Behavior to preserve.
- `lib/branding/resolve-project-logo.ts` calls `extractLogoFromHtml` to persist the auto-detected logo back to the DB after the first publish.
- No TS tests cover these four modules today. Migration just needs `tsc --noEmit` green + the publish pipeline unbroken.

### Existing kuchikiki usage in the crate

`crates/html-engine/src/ops/scoped_view.rs` and `crates/html-engine/src/ops/resolver.rs` already use kuchikiki for DOM walks. `apply.rs` uses lol_html. F1.5 publish module joins the kuchikiki set (next-sibling checks + conditional child appends + multi-pass head/body mutation don't fit lol_html's single-pass streaming model cleanly).

## API decision

Four `#[napi]` functions in a new `crates/html-engine/src/publish/` module — one per consumer, all kuchikiki-backed. Specific over generic: each of the four consumers does DOM walking (next-sibling / first-child / rel-token tokenisation) with different semantics, so the S9 handoff's "3 generic primitives" idea would have left the DOM-walking back in TS, defeating the cheerio-deletion goal.

| # | Rust fn | TS shim | Notes |
|---|---|---|---|
| 1 | `wire_published_forms(html, action, configs) -> String` | `wirePublishedForms(html, subdomain, formConfigs?)` flattens the `Record<string, FormConfig>` into a `Vec<{index, success_message?, redirect_url?}>` and pre-computes `action` from `NEXT_PUBLIC_SITE_URL`. `HONEYPOT` + `FORM_SCRIPT` move into Rust as `const` strings — they have no runtime dependencies. |
| 2 | `consolidate_unsplash_credits(html) -> {html, credits, anonymous_unsplash_count}` | 1:1 wrapper. `UnsplashCredit { author, author_url }` returned in document order. |
| 3 | `extract_logo(html) -> Option<{href, is_data_uri}>` | 1:1 wrapper. `isDataUri(href)` + `decodeDataUri(uri)` stay in `lib/branding/extract-logo.ts` (regex + base64 only — no cheerio). |
| 4 | `inject_logo(html, logo_url) -> String` | 1:1 wrapper. Soft-fail behaviour (return original HTML on no-op) lives in Rust. |

### Rust napi structs

```rust
#[napi(object, js_name = "WireFormConfig")]
pub struct JsWireFormConfig { pub index: u32, pub success_message: Option<String>, pub redirect_url: Option<String> }

#[napi(object, js_name = "UnsplashCredit")]
pub struct JsUnsplashCredit { pub author: String, pub author_url: String }

#[napi(object, js_name = "ConsolidationResult")]
pub struct JsConsolidationResult { pub html: String, pub credits: Vec<JsUnsplashCredit>, pub anonymous_unsplash_count: u32 }

#[napi(object, js_name = "ExtractedLogo")]
pub struct JsExtractedLogo { pub href: String, pub is_data_uri: bool }
```

### Test plan (per Rust function)

Each function gets unit tests in `crates/html-engine/src/publish/<file>.rs` (or sibling `tests/` integration file, matching the existing crate convention). Coverage targets:

- `wire_published_forms`: golden path; idempotent re-wire (already-tagged forms get fresh attrs but no duplicate hidden inputs / script); no-forms doc → no-op; multi-form doc with partial configs (only some indices in the Vec); `_openlen_form` already present.
- `consolidate_unsplash_credits`: golden path with mixed credit-spans + anonymous URLs; idempotent (prior aggregate + meta gets cleaned before the new write); no-credits doc → no-op; `<head>`-less doc; head and body both missing.
- `extract_logo`: each rel variant (`icon`, `shortcut icon`, `apple-touch-icon`); og:image fallback; no match → None; multiple icons → first wins.
- `inject_logo`: existing icon stripped + new appended; existing og:image preserved (no overwrite); `data:` URI logo URL → no og:image injected; missing `<head>` synthesized.

## Phase B — Rust functions

_(TBD — one commit per function)_

## Phase C — TS shim

_(TBD — adds 4 wrappers to `lib/html-engine.ts`)_

## Phase D — Migrate consumers

_(TBD — one commit per consumer)_

## Phase E — Remove cheerio

_(TBD — `npm uninstall cheerio` + lockfile + grep)_

## Phase F — Final handoff

_(TBD — bundle stats, open items, self-SHA)_

## Self-SHA

`{{SELF_SHA}}` — replaced after the F handoff commit lands.
