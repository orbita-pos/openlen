# OpenLen theme engine — born-canonical normalization

Every page that enters OpenLen — AI-generated (`/api/generate`), cloned from a
template (`from-template`), pasted (`from-html`), or rewritten by Chat
(`/api/templates/ai-design`) — runs through **`normalizeBornCanonical`**
(`lib/normalize.ts`). It hoists each design axis onto a deterministic
CSS-token contract. The inspector's **Theme** section drives those tokens:
instant, deterministic, no AI call — and it never breaks the page.

## The chain

`normalizeBornCanonical` runs the axis passes in order:

```
radius → spacing → type → font → accent → color → light/dark
```

Each pass is **idempotent** (a `data-ol-*` marker makes a second run a no-op)
and **structurally non-destructive** (a no-op where the axis doesn't apply).
Token defaults equal the page's own values → zero visual change at birth; a
control surfaces only where the pass identified a real contract.

## Axes

| Axis | File | Token(s) | Mechanism | Control |
|---|---|---|---|---|
| Radius | `normalize-radius.ts` | `--ol-r-scale` | Tailwind `borderRadius` config override + literal `border-radius:` rewrite | `RoundnessControl` |
| Spacing | `normalize-space.ts` | `--ol-space-scale` | Tailwind `padding`/`margin`/`gap` config overrides (not `spacing` globally — that would scale widths) | `DensityControl` |
| Type | `normalize-type.ts` | `--ol-text-scale` | Tailwind `fontSize` config override + literal `font-size:` rewrite | `TypeScaleControl` |
| Font | `normalize-font.ts` | `--ol-font-display` | Hoists the display font; preloads the 5 picker fonts | `FontControl` |
| Accent | `normalize-accent.ts` | `--ol-accent`, `--ol-accent-r` | Identifies the accent (`:root` token / `tailwind.config` / chroma); rewrites its hardcoded uses to `var()` | color swatch |
| Color | `normalize-color.ts` | `--ol-bg`, `--ol-surface`, `--ol-fg`, `--ol-border` | Hoists the semantic palette from `:root` tokens or the `body` rule | color swatches |
| Light/dark | `normalize-modes.ts` | `data-ol-mode` attr | Lifts the model-designed `:root.dark` palette onto `:root[data-ol-mode="dark"]` | `ModeToggle` |

## How a control reaches the page

The inspector posts `openlen:apply-prop` (`scope: "theme"`) to the preview
iframe. The iframe's inspect-script (`use-element-inspect.ts`,
`INSPECT_SCRIPT`) sets the token inline on `<html>`, overriding the `:root`
default. Edits persist via `openlen:html-changed` → `PATCH
/api/projects/[id]/html`; the `data-ol-*` blocks survive to the published
page.

## Verification

Three Playwright harnesses in `scripts/verify/` — a permanent regression
gate. Run them before committing any normalizer change:

```
npm run verify          # engine + inspect — the fast gate (~30s)
npm run verify:corpus   # renders all 63 local templates (~5min)
```

- `engine.ts` — every token drives a real Chromium render: radius, accent,
  the 5 colours, font, type scale, density, and the designed dark palette.
  **18/18.**
- `inspect.ts` — the iframe inspect-script `openlen:apply-prop` protocol,
  end to end (page-meta, theme/mode apply, and `theme-bundle` preset apply).
  **9/9.**
- `corpus.ts` — all 63 local templates render light + dark, clean. Gates on
  rendering — a template's own `<script>` error is reported but is not
  treated as an engine regression.

Run artifacts (screenshots) land in `scripts/verify/screenshots/`, gitignored.

## Adding an axis

Mirror `normalize-radius.ts`: a pure `(html) => html` pass that injects a
`<style data-ol-*>` token block (defaults = the page's own values) and, for a
Tailwind-utility axis, a `tailwind.config` override. Add it to the chain in
`lib/normalize.ts`, add a control + the `readPageMeta` / `PageMeta` wiring in
the inspector, and verify with a harness.

## Banned

The document-model IR — round-tripping arbitrary HTML through an owned model.
It does not round-trip losslessly; rejected. The engine builds the contract
deterministically, at ingestion, instead.

## Theme presets

`lib/theme-presets.ts` — curated coherent "looks" (Editorial, Crisp, Soft,
Bold), each a bundle of token values across the axes. The inspector's
**Looks** row applies one in a click: the panel posts `openlen:apply-prop`
with `scope: "theme-bundle"` and a `{token: value}` map; the inspect-script's
`applyThemeBundle` sets them all on `<html>` in a single reclean, so the whole
look lands atomically. The panel becomes *looks*, not just loose knobs.
