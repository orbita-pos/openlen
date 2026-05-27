# Rust migration playbook (F1 S6 → S9)

How to migrate a TS call-site from its legacy cheerio/regex implementation onto the Rust `@openlen/html-engine` binding, with shadow-soak in between as a safety net.

This playbook was written alongside the POC migration of `lib/style-match/autofill/sanitize.ts` in F1 S6. F1 S7/S8 will apply it to the remaining consumers (`lib/html-ops.ts`, `lib/normalize.ts` + chain, `lib/publish/optimize-html.ts`, and the six inline `data-slot-path=` gate checks).

## The four-step recipe

For each call site `X.ts` exporting a public function `doX(input): Y`:

1. **Wrap**, don't replace. Keep the public export name + signature. Rename the existing impl to `doXTs`. Implement a parallel `doXRust` that calls into `@openlen/html-engine` (via `lib/html-engine.ts`) and adapts the result back to the same shape `Y`.
2. **Route through `shadowCompare`**. The public function becomes a one-liner that hands TS + Rust impls to `shadowCompare`, with default `fallbackMode: "shadow-prefer-ts"` so production behaviour is unchanged.
3. **Adapt, don't add**. If the Rust output shape diverges from TS — extra fields, different null sentinels, error vs. silent — the Rust adapter normalises into the TS contract. Drop extra fields, re-bundle equivalent counters, throw on Rust-specific errors that the TS contract didn't surface. The shadow record will log these normalisation points as expected divergences if you keep them visible.
4. **Tests**: cover the public surface in three modes — default (`shadow-prefer-ts`), forced `ts`, forced `rust`. The first two should be byte-equal to the legacy behaviour. The forced `rust` test is the cutover dry-run.

Once shadow logs are clean for N days in production (suggest 7 days for a first migration; tightening as the playbook matures), bump the call site's default to `rust` and add a `dropDeadline` comment for when to delete the TS impl.

## POC walk-through — `lib/style-match/autofill/sanitize.ts`

The legacy TS sanitizer (cheerio-based, 5 passes, returns `SanitizeResult { html, removed: { scripts, eventHandlers, dangerousUrls, iframes } }`) is migrated to optionally route through Rust's `sanitize_for_publish` (the Sem 7 consolidated gate).

### Step 1 — Wrap

```ts
// lib/style-match/autofill/sanitize.ts (after migration)
export interface SanitizeResult {
  html: string;
  removed: {
    scripts: number;
    eventHandlers: number;
    dangerousUrls: number;
    iframes: number;
  };
}

export function sanitizeFilledHtml(html: string): SanitizeResult {
  return shadowCompare(
    "sanitize-filled-html",
    `bytes=${html.length}`,
    () => sanitizeFilledHtmlTs(html),
    () => sanitizeFilledHtmlRust(html),
    { fallbackMode: "shadow-prefer-ts" },
  );
}

function sanitizeFilledHtmlTs(html: string): SanitizeResult { /* legacy cheerio impl */ }
function sanitizeFilledHtmlRust(html: string): SanitizeResult { /* adapter, see Step 3 */ }
```

### Step 2 — Route

Default is `shadow-prefer-ts`. At runtime:

- `OPENLEN_SHADOW_MODE=ts` — only TS runs (rollback escape hatch)
- `OPENLEN_SHADOW_MODE=shadow-prefer-ts` — both run, return TS, log divergences (DEFAULT)
- `OPENLEN_SHADOW_MODE=shadow-prefer-rust` — both run, return Rust, log divergences (aggressive shadow)
- `OPENLEN_SHADOW_MODE=rust` — only Rust runs (cutover)

Per-call-site override: `OPENLEN_SHADOW_SANITIZE_FILLED_HTML=rust` flips this one site without touching the global default. Convention: the name passed to `shadowCompare` (kebab-case) becomes the env var slug (uppercased, `-` → `_`).

### Step 3 — Adapt

```ts
function sanitizeFilledHtmlRust(html: string): SanitizeResult {
  const r = rustSanitizeForPublish(html);
  if (r.html === null) {
    // Adapter: Rust's slot-path gate has no TS counterpart. Autofill HTML
    // should never carry data-slot-path=; if it does, that's an upstream
    // bug we want shadow-soak to surface as errorShapeMismatch=true.
    throw new Error(`sanitize gate fired (unexpected for autofill): ${r.errors.join("; ")}`);
  }
  return {
    html: r.html,
    removed: {
      // Rust splits meta-refresh into its own counter; TS bundles it into
      // scripts. Re-bundle here so the TS contract holds.
      scripts: r.removed.scripts + r.removed.metaRefresh,
      eventHandlers: r.removed.eventHandlers,
      dangerousUrls: r.removed.dangerousUrls,
      iframes: r.removed.iframes,
    },
  };
}
```

Two normalisation points:
1. **Slot-path gate** — Rust has it, TS doesn't. The adapter throws; shadow-soak records an `errorShapeMismatch=true` divergence. This is *intentional* visibility: any slot-path input flagged here = upstream bug to fix in the autofill chain.
2. **`metaRefresh` counter** — Rust splits it out; TS bundles it into `scripts`. The adapter re-bundles. Without this, every meta-refresh input would log a counter divergence that's purely cosmetic.

### Step 4 — Test

See `lib/style-match/autofill/sanitize.test.ts`. Coverage:
- Default mode → cheerio behaviour (no behavioural change vs. pre-migration)
- `OPENLEN_SHADOW_SANITIZE_FILLED_HTML=ts` → same as default
- `OPENLEN_SHADOW_SANITIZE_FILLED_HTML=rust` → Rust path via adapter, same outputs (including the bundled `metaRefresh` counter)
- `OPENLEN_SHADOW_SANITIZE_FILLED_HTML=rust` + slot-path input → adapter throws

## Applying the recipe to the remaining call sites

### F1 S7 — `lib/html-ops.ts` (cheerio → Rust ops engine)

Five exported functions, all bridged to Rust:
| TS export | Rust binding | Adapter notes |
|---|---|---|
| `tagWithOpIds(html)` | `tagWithOpIds(html)` | Same shape `{ taggedHtml, taggedCount }`. Direct pass-through. |
| `resolveOpIdByPath(html, path)` | `resolveOpIdByPath(html, path)` | TS returns `string \| null`, Rust returns `Option<string>` (already shimmed by `lib/html-engine.ts`). Direct. |
| `buildScopedView(html, pin)` | `buildScopedView(html, pin)` | Same shape `{ scopedHtml, containerOpId, outline, pinIsContainer }`. Direct. |
| `stripOpIds(html)` | `stripOpIds(html)` | String → string. Direct. |
| `parseOps(rawHtml)` | `parseOps(rawHtml)` | Same shape. Direct. |
| `applyOps(taggedHtml, ops)` | `applyOps(taggedHtml, ops)` | **Adapter needed.** Rust's hierarchy-cascade detection underreports `appliedCount` when a parent-delete + child-replace pair is present (see F1 S1 handoff §2). Defer migration here or note the cascade behaviour as known divergence — the visible HTML matches. |

Recipe: wrap each export with `shadowCompare`. Six independent migrations, one file. Tests can live next to it (`lib/html-ops.test.ts`).

### F1 S7 — `lib/normalize.ts` + chain (7 TS modules → Rust normalize chain)

Single entry point: `normalizeBornCanonical(html: string): string`. Direct mapping to Rust's `normalizeBornCanonical`. Adapter: none — pure string-in/string-out.

Caveat: the TS chain is 7 sequential string-mutating passes. Rust may produce different intermediate states between passes but the same final output. Shadow-soak only sees the final string, so this is byte-equal-able. If byte-equal fails on real inputs, the playbook's escape hatch is to swap `equalityFn` for a normalised-whitespace comparison.

### F1 S8 — `lib/publish/optimize-html.ts` (TS minify → Rust optimize_for_publish)

Wraps existing minify. Rust returns `OptimizeResult { html, errors, stats }`. Adapter throws on `errors.length > 0` to keep the contract single-result. Stats can be dropped or surfaced verbatim depending on caller needs.

### F1 S8 — Six inline `data-slot-path=` gate checks (publish + ingestion)

These aren't function migrations — they're inline `if (html.includes("data-slot-path=")) throw …` statements scattered across six files:

```
app/api/generate/route.ts
app/api/projects/from-template/route.ts
app/api/projects/from-html/route.ts
app/api/templates/ai-design/route.ts
app/api/projects/[id]/html/route.ts
app/api/templates/autofill/route.ts
lib/publish/filesystem.ts
lib/templates/admin-schemas.ts
```

Rust's `sanitize::slot_path::detect_slot_path` (already shipped in S3) handles entity-encoded + mixed-case + cross-chunk variants the inline `String.includes` doesn't. Expose it as a thin `detectSlotPath(html): { detected: boolean, reason?: string }` helper (in `lib/html-engine.ts` or a new `lib/slot-path-gate.ts`) and route each inline check through `shadowCompare`. Default behaviour preserved; Rust catches the adversarial variants that today's `includes` misses, but shadow-prefer-ts means we *log* misses without changing the gate. After a soak window, flip to `rust` to harden the gate everywhere.

## How to flip modes

Once shadow logs come back clean for a soak window:

1. **Per-call-site flip** — change the `fallbackMode` arg in the source from `"shadow-prefer-ts"` to `"rust"`. Done. Add a comment explaining the cutover date.
2. **Global flip** — set `OPENLEN_SHADOW_MODE=rust` in the deploy env. Affects every call site that doesn't have an explicit override.
3. **Drop the TS impl** — once the call site has been in `rust` mode for one full soak window without incident, delete `doXTs` and inline the body of `doXRust`. Update the test to only cover the Rust path. This is the cleanup that lands in F1 S9 / Sem 12 for cheerio removal.

If shadow logs surface unexpected divergences, do *not* flip. Investigate, patch the Rust impl OR the adapter, re-soak. The harness is the bug-detector; trust it.

## Common pitfalls

- **Pitfall: forgetting that Rust binding `Option<T>` is `undefined`, not `null`, in struct fields.** The `lib/html-engine.ts` wrapper already shims to `null` for the documented fields. If a new Rust function returns `Option<T>` in a struct, add it to the shim layer in `lib/html-engine.ts` first.
- **Pitfall: comparing HTML strings byte-equal across serialisers.** cheerio and lol-html disagree on optional whitespace, attribute quoting (single vs. double), self-closing slashes (`<br />` vs. `<br>`). Either accept the noise in the shadow log OR pass an `equalityFn` that normalises both sides.
- **Pitfall: shadow logs piling up forever.** Each call's divergence is one `console.warn`. In a hot path, that's a flood. If a divergence is *known and expected* and the soak window has confirmed it, normalise it in the adapter so it stops logging. The log is a TODO list, not a permanent record.
- **Pitfall: forgetting to test the rust-mode path.** Default mode tests verify nothing about the migration target. Add an explicit `withEnv({ OPENLEN_SHADOW_<NAME>: "rust" }, …)` test for every public function.
- **Pitfall: testing through `shadow-prefer-ts` and assuming Rust ran.** It did — but the return value is TS, so the test exercises the TS path. Use `shadow-prefer-rust` or forced `rust` to actually validate the Rust path's return shape.
- **Pitfall: env-var per-call slug mismatch.** The `name` passed to `shadowCompare` becomes the env-var slug via `name.toUpperCase().replace(/[^A-Z0-9_]/g, "_")`. So `"sanitize-filled-html"` → `OPENLEN_SHADOW_SANITIZE_FILLED_HTML`. Be consistent — kebab-case for `name`, env-var auto-derived.

## Quick reference

```ts
import { shadowCompare } from "@/lib/shadow-soak";
import { sanitizeForPublish } from "@/lib/html-engine";

export function publicAPI(input: string): Y {
  return shadowCompare(
    "public-api",                          // env-var slug + log key
    summarizeArgs(input),                   // small string, capped at 200 chars
    () => legacyImpl(input),                // TS, the safe path
    () => rustAdapter(rustImpl(input)),     // Rust, normalised to TS contract
    { fallbackMode: "shadow-prefer-ts" },   // SAFE DEFAULT for first soak
  );
}
```

Soak → flip → drop.
