# F1 Rust shadow-soak runbook

End-to-end procedure for exercising the four `shadowCompare`-routed call sites (sanitize / html-ops / normalize / optimize-html) outside production traffic and deciding whether the Rust arms are safe to flip to default in F1 S9.

## Topology

Migrated call sites — each routes through `lib/shadow-soak.ts`. Default mode is `shadow-prefer-ts` (TS arm is the return value; Rust runs in shadow, divergences land via `setShadowLogger`).

| Shadow site name (env-var slug)            | Module                                          | Equality                          |
|--------------------------------------------|-------------------------------------------------|-----------------------------------|
| `sanitize-filled-html`                     | `lib/style-match/autofill/sanitize.ts`          | deep-equal (adapter re-bundles)   |
| `tag-with-op-ids`                          | `lib/html-ops.ts`                               | deep-equal                        |
| `strip-op-ids`                             | `lib/html-ops.ts`                               | deep-equal (string)               |
| `parse-ops`                                | `lib/html-ops.ts`                               | custom (ops struct; errors len)   |
| `apply-ops`                                | `lib/html-ops.ts`                               | custom (html eq; errors len)      |
| `resolve-op-id-by-path`                    | `lib/html-ops.ts`                               | deep-equal                        |
| `build-scoped-view`                        | `lib/html-ops.ts`                               | deep-equal                        |
| `normalize-born-canonical`                 | `lib/normalize.ts`                              | deep-equal                        |
| `optimize-html-for-production` *(async)*   | `lib/publish/optimize-html.ts`                  | deep-equal (orthogonal arms)      |

Cutover gate: divergence log shows ≥100 records with **zero `errorShapeMismatch=true`** entries that aren't traceable to a known adversarial-by-design input.

## Prerequisites

1. Rust binding built (`crates/html-engine/index.js` + `.node`):
   ```bash
   cd crates/html-engine
   CARGO_TARGET_DIR=D:/rust/target npm install --no-audit --no-fund
   CARGO_TARGET_DIR=D:/rust/target npm run build
   cd ..
   ```
2. Root deps installed:
   ```bash
   PUPPETEER_SKIP_DOWNLOAD=1 npm install --no-audit --no-fund
   ```
3. Type-check verde:
   ```bash
   npx tsc --noEmit
   ```
4. (Optional) `DATABASE_URL` in `.env.local` to pull real `projectVersions` rows. Without it, the synthetic load skips the DB sample silently and only uses starters + adversarials.

## Running the synthetic load

The load exercises every shadow site with hand-crafted inputs. **Zero AI calls.** Inputs:

- 3 starter templates — `templates/starter/{mirror,manuscript,counter}.html` (canonical production-shape).
- N real `projectVersions.html` rows (when `DATABASE_URL` is set).
- 13 adversarial inputs — slot-path variants (literal / mixed-case / entity-encoded / whitespace-around-equals), XSS payloads (`<script>`, `<iframe>`, `on*=`, `javascript:` / `vbscript:` / `data:text/html` URLs), `<meta http-equiv="refresh">`, empty doc, ~100 KB synthetic doc, Tailwind arbitrary values, malformed unclosed tags.

```bash
# Minimum — starters + adversarials only; optimize-html dev-gated off.
npx tsx scripts/soak/run.ts > /dev/null

# Full — exercises optimize-html (postcss + tailwindcss), pulls 20 DB rows.
SOAK_LOG=soak-log.jsonl \
SOAK_DB_SAMPLE=20 \
NODE_ENV=production \
npx tsx --env-file=.env.local scripts/soak/run.ts > /dev/null
```

> `NODE_ENV=production` is required to invoke the optimize-html shadow wrapper — its dev-mode skip returns the input unchanged otherwise and that site contributes 0 records.

> Default `OPENLEN_SHADOW_MODE=shadow-prefer-ts` is in effect — TS wins on the return path; Rust runs in shadow. No production traffic side effects.

The run script logs a startup banner with the resolved env var state, processes inputs one at a time with a live progress line, then prints the final record count + the path of the JSONL log.

## Summarizing the log

```bash
npx tsx scripts/soak/tail.ts soak-log.jsonl
```

Output sections:
1. **Header** — total record count + actionable count.
2. **By call site** — per-site totals + actionable counts (sorted).
3. **optimize-html byte delta** — `rustBytes − tsBytes` histogram (count / min / p50 / p95 / max). This is the dataset Sem 8.5 (Rust Tailwind bake) needs to scope its work.
4. **Verdict + exit code**:
   - `0` (`✅ SAFE TO FLIP`) — `actionable=0` AND `total ≥ 100`.
   - `1` (`⚠️  NEED MORE SAMPLES`) — `actionable=0` but `total < 100` → re-run with more inputs (`SOAK_DB_SAMPLE=50`, run again, etc.).
   - `1` (`❌ NOT READY`) — `actionable ≥ 1` → review the "First 5 actionable records" block printed below the verdict.

## Merging with production traffic

For the real soak window (≥7 days per S8 handoff), production records append to the same JSONL via the `setShadowLogger` hook. Server-startup wiring example:

```typescript
// instrumentation.ts or any server-only init module
import { createWriteStream } from "node:fs";
import { setShadowLogger } from "@/lib/shadow-soak";

if (process.env.SHADOW_LOG_PATH) {
  const stream = createWriteStream(process.env.SHADOW_LOG_PATH, { flags: "a" });
  setShadowLogger({
    onDivergence(record) {
      stream.write(JSON.stringify(record) + "\n");
    },
  });
}
```

Then merge:

```bash
cat synthetic-soak.jsonl prod-soak.jsonl > merged.jsonl
npx tsx scripts/soak/tail.ts merged.jsonl
```

The prod log is the load-bearing dataset for the cutover decision; the synthetic load proves the harness + the gate-by-design adversarials before any prod data lands.

## Interpreting actionable records

A record carries `errorShapeMismatch: true` when one arm threw and the other didn't, or both threw with different messages. This is the actionable signal for cutover readiness.

**Expected from synthetic adversarial inputs** (NOT a blocker — the synthetic load deliberately exercises them):

- `sanitize-filled-html` records on slot-path inputs — Rust gate throws (`sanitize gate fired (unexpected for autofill)`); TS has no equivalent gate.
- `optimize-html-for-production` records on slot-path inputs — same shape: Rust throws (`optimize gate fired (slot-path detected)`); TS just runs.

Operators reviewing the synthetic verdict should subtract slot-path-by-design records from the actionable count before judging cutover readiness. The runbook deliberately keeps these inputs in the load to validate that the gates fire — exclude them in prod log analysis with:

```bash
jq -c 'select(.errorShapeMismatch == true and (.argsSummary | test("slot-path") | not))' prod-soak.jsonl
```

**Unexpected (investigate)**:

- Any actionable record from `parse-ops` (errors compared by count only — ops content drift would have to be a real divergence).
- Any actionable record from `apply-ops` whose `argsSummary` doesn't trace back to an invalid-op-id batch.
- Any actionable record from `normalize-born-canonical` (chain is regex-only on both sides; byte-equal on starters per S2/S7).
- Any actionable record from `tag-with-op-ids` / `strip-op-ids` / `resolve-op-id-by-path` / `build-scoped-view` (deep-equal expected to hold on full-document inputs; fragment-input divergence on `tag-with-op-ids` is documented in S7).

When an unexpected record fires:

1. Extract it for inspection:
   ```bash
   jq -c 'select(.errorShapeMismatch == true)' soak-log.jsonl > actionable.jsonl
   ```
2. Re-create the input (starter file name in the slug? `db:projectVersion:<uuid>` row? hand-crafted adversarial slug?) and re-run the single call to confirm.
3. Decide:
   - **Bug in Rust** — patch crate, `npm run build`, re-soak.
   - **Adapter shape gap** — extend the `*Rust` arm in the matching `lib/*` file (e.g. `sanitizeFilledHtmlRust` already re-bundles the `metaRefresh` counter; similar normalization may be needed for new fields).
   - **Bug in TS** — rarely worth fixing pre-cutover; file a ticket so the F1 S9 cleanup picks it up.
   - **Intentional shape diff** — document it in the call-site equalityFn or in the adapter; add a regression test under `lib/*.test.ts`.

## Extending with new adversarial inputs

Edit `scripts/soak/inputs.ts` → `loadAdversarialInputs()`:

```typescript
{ name: "adversarial:<descriptive-slug>", html: "<...>", source: "adversarial" }
```

The `name` is the grouping key in `tail.ts`, so a stable slug lets runs compare across time. Re-run `npx tsx scripts/soak/run.ts` to pick up the new input.

For a new shadow site (future migration adds one), edit `scripts/soak/run.ts` and add the call inside the per-input loop with a `try { … } catch {}`. The harness records via `setShadowLogger` automatically — no other plumbing.

## How to use the verdict

| Output                  | Action                                                                                                       |
|-------------------------|--------------------------------------------------------------------------------------------------------------|
| `✅ SAFE TO FLIP`        | F1 S9 may proceed: flip each call-site default from `shadow-prefer-ts` to `rust`, soak again ~2 days at the new default to confirm stability, then delete `*Ts` arms + cheerio. |
| `⚠️  NEED MORE SAMPLES` | Increase `SOAK_DB_SAMPLE`, run longer in prod, or add adversarial inputs that exercise more shadow sites.    |
| `❌ NOT READY`           | At least one actionable divergence — investigate per "Interpreting actionable records" above before flipping. |

## Quick reference — env vars

| Var                          | Default              | Purpose                                                       |
|------------------------------|----------------------|---------------------------------------------------------------|
| `SOAK_LOG`                   | `soak-log.jsonl`     | JSONL output path (`run.ts` writes; `tail.ts` reads).         |
| `SOAK_DB_SAMPLE`             | `20`                 | Number of `projectVersions` rows to pull (when DB is wired).  |
| `NODE_ENV`                   | `(unset)`            | Set `production` to exercise `optimize-html-for-production`.  |
| `DATABASE_URL`               | `(unset)`            | Neon conn string; unset → DB sample is empty (no throw).      |
| `OPENLEN_SHADOW_MODE`        | `shadow-prefer-ts`   | Global default mode; `tail.ts` assumes default.               |
| `OPENLEN_SHADOW_<NAME>`      | `(unset)`            | Per-call override (e.g. `OPENLEN_SHADOW_APPLY_OPS=rust`).     |
| `SHADOW_LOG_PATH`            | `(unset)`            | Where prod-wired `setShadowLogger` writes (instrumentation).  |

## Related docs

- `docs/rust-f1-session{6,7,8}-handoff.md` — what each migrated call site does, its equalityFn, and its adapter behaviour.
- `docs/rust-migration-playbook.md` — the recipe for adding a new `shadowCompare`-routed site.
- `docs/rust-f1-soak-decisions.md` — F1 soak-tooling session decisions + departures from this runbook's defaults.
