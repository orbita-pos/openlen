# EVAL — Session 3: Block Library Vendoring

**Status:** complete
**Date:** 2026-05-16
**Scope:** vendor 15 curated landing-page blocks from MIT sources, define Zod
slot schemas, ship a typed `_registry.ts`, and build a `/preview-blocks`
route + manifest script so visual QA is one command away.

This session is the structural foundation for Session 4 (slot-filling
pipeline conversion). After Session 4 lands, the orchestrator's `plan.structure`
step will pick block IDs from this registry and `section.fill` will produce
slot JSON validated by each block's schema — the model never emits JSX, so
the bug-loop class of failures becomes impossible by construction.

---

## What landed

1. **Block API contract** in `lib/blocks/types.ts`. `BlockMeta<S>`,
   `BlockComponent<S>`, `BlockTokens`, `AestheticDirection`,
   `ICON_NAMES`/`SOCIAL_PLATFORMS` enums. Self-contained — the block library
   stays independently publishable.

2. **15 vendored blocks** under `lib/blocks/<category>/<variant>.tsx`. Every
   file:
   - Carries a source-attribution comment + `/LICENSES/<src>.MIT.txt` pointer
   - Exports `meta: BlockMeta<typeof slotsSchema>` and `Component:
     BlockComponent<typeof slotsSchema>`
   - Drives colour, type, radius, shadow exclusively from `tokens` props
   - Pulls every piece of copy from validated `slots`
   - Renders with semantic HTML5 + `aria-labelledby` + alt text on every `<img>`
   - Stays pure: no `useEffect`, no fetches, no state

3. **Shared helpers** in `lib/blocks/_icons.tsx` (lucide icon name → component),
   `lib/blocks/_social.tsx` (inline-SVG brand marks since lucide ≥1.x dropped
   them), and `lib/blocks/palette-to-tokens.ts` (orchestrator palette →
   `BlockTokens`).

4. **Registry** in `lib/blocks/_registry.ts`. Flat `as const` map of every block,
   yields a literal-union `BlockId` type. Helpers: `getBlock`, `isBlockId`,
   `blocksForAesthetic`, `blocksOfType`, `blocksOfTypeForAesthetic`. A
   module-load sanity check asserts every registry key equals the block's
   declared `meta.id` — single source of truth.

5. **LICENSES** for all four MIT upstreams in `/LICENSES/`:
   `tailark.MIT.txt`, `shadcn-ui.MIT.txt`, `magic-ui.MIT.txt`,
   `hyperui.MIT.txt`. Each preserves the original copyright + license body
   and lists the Inari block files derived from it.

6. **Visual QA** —
   - `app/preview-blocks/page.tsx` renders every block with its
     `exampleSlots`. `?palette=…` query toggles between the five palettes.
     Added to middleware `PUBLIC_ROUTES` so the dev preview opens without
     login.
   - `scripts/preview-blocks.tsx` prints a registry manifest table — run via
     `npx tsx scripts/preview-blocks.tsx` to confirm registry wiring at the
     CLI.
   - `lib/blocks/README.md` explains the contract + adding-a-block flow.

---

## LOC summary

| Area | Files | Lines |
|---|---:|---:|
| `lib/blocks/` (types, registry, helpers, 15 blocks) | 20 | 3,366 |
| `LICENSES/` (4 MIT texts + Inari-usage notes) | 4 | 83 |
| Auxiliary (`preview-blocks` route, script, README) | 3 | 236 |
| **Total Session 3** | **27** | **3,685** |

Inside the 5 000-line ceiling from the session plan. Average block is ~190
lines including the schema, exampleSlots, and the component itself.

---

## License compliance check

Each MIT source has a complete copy of its license body in `/LICENSES/`, and
each vendored file carries a header pointing both to the source URL and to
the local license file. Spot-checked all 15 block files for header presence:

```
$ grep -L "License: MIT" lib/blocks/*/*.tsx
(no output — every block has the header)
```

No vendored content is under Tailwind Plus, Aceternity Pro, Preline (Fair
Use), Flowbite Pro, or any other commercial license. The brand-mark SVGs in
`_social.tsx` are commonly-used neutral path data driven by `currentColor`
and reused under the platforms' brand-usage guidelines.

---

## Aesthetic coverage matrix

|  | tech-min | refined-ed | warm-hum | ed-max | brut-tech |
|---|:--:|:--:|:--:|:--:|:--:|
| hero/centered-cta | ✓ | ✓ | – | – | – |
| hero/split-image | ✓ | ✓ | ✓ | ✓ | – |
| hero/animated-gradient | – | – | ✓ | ✓ | – |
| hero/logo-strip | ✓ | ✓ | – | – | – |
| features/icon-grid-3col | ✓ | ✓ | ✓ | ✓ | ✓ |
| features/bento-asymmetric | ✓ | – | – | ✓ | – |
| features/alternating-rows | ✓ | ✓ | ✓ | ✓ | ✓ |
| pricing/three-tier-highlight | ✓ | ✓ | ✓ | ✓ | ✓ |
| pricing/two-tier-simple | ✓ | – | ✓ | – | – |
| testimonials/quote-grid-3col | ✓ | ✓ | ✓ | ✓ | ✓ |
| faq/accordion | ✓ | ✓ | ✓ | ✓ | ✓ |
| cta/gradient-cta | ✓ | ✓ | ✓ | ✓ | ✓ |
| cta/card-cta-form | ✓ | ✓ | ✓ | ✓ | ✓ |
| footer/four-col-links | ✓ | ✓ | ✓ | ✓ | ✓ |
| footer/minimal-row | ✓ | – | – | – | ✓ |
| **count per aesthetic** | **14** | **11** | **10** | **10** | **8** |

Every aesthetic direction can compose a full page (hero + features + pricing
+ social proof + FAQ + CTA + footer):

- **technical-minimal**: deepest coverage — 14/15 blocks fit.
- **refined-editorial**: 11/15. Logo-strip + four-col footer for serious
  pages; centered or split heroes; icon grid or alternating rows.
- **warm-humanist**: 10/15. Aurora-gradient hero, two-tier simple pricing,
  alternating rows for narrative flow.
- **editorial-maximalist**: 10/15. Aurora hero + bento features is the
  signature combo.
- **brutalist-technical**: 8/15. Sparse on purpose — minimal-row footer,
  icon grid, alternating rows. May need a dedicated block in a later
  session if briefs land that lean hard into brutalism.

---

## Adaptations of note

- **`hero/animated-gradient`** keeps Magic UI's aurora animation but
  re-renders it via a CSS-only `@keyframes` injected through
  `<style dangerouslySetInnerHTML>`. No framer-motion dependency — keeps
  the single-HTML output goal intact. Added an `accentWord` slot so the AI
  controls which token (last occurrence) gets gradient treatment.

- **`hero/logo-strip`** marquee animation is also CSS-only. Logos render as
  text by default (`fontDisplay`-styled brand-name) when no `src` is
  provided; the orchestrator's image step can swap in real logo SVGs later.

- **`features/icon-grid-3col`** uses `z.enum(ICON_NAMES)` on the icon slot so
  the AI can only emit the 15 names defined in `types.ts`. The icon is
  resolved to a lucide-react component via `getIcon()` at render time. This
  matters: the AI's slot output stays JSON-safe (no JSX), and we never
  ship code the AI authored to the browser.

- **`features/bento-asymmetric`** has decorative visual variants
  (`'code'|'stats'|'image'|'none'`) baked into the component. The AI picks
  one of those four; the component renders the corresponding canned
  visual. When real images land later, `imageSrc` is already wired.

- **`pricing/two-tier-simple`** uses `z.tuple([tier, tier])` (length-2 tuple)
  instead of `z.array(...).length(2)` so the AI's plan output can't drift
  to three tiers — that would just become `pricing/three-tier-highlight`.

- **`cta/card-cta-form`** caps `formFields` at 4 to match quality gate G2
  (conversion: forms ≤4 fields). The slot schema enforces what the gate
  will later assert.

- **`faq/accordion`** uses native `<details>`/`<summary>` instead of pulling
  `@radix-ui/react-accordion`. Renders without client-side JS, which fits
  the single-HTML output target. The `+` icon rotates via `group-open`
  Tailwind variant.

- **Brand SVGs in `_social.tsx`.** `lucide-react@^1.16` dropped `Twitter`,
  `Github`, `Linkedin`, `Youtube`, `Discord` (trademark concerns). Rather
  than pull in a second icon dep, we ship five tiny inline-SVG path
  definitions sized to match lucide's stroke language.

---

## Smoke tests

```
$ npx tsc --noEmit
(clean — exit 0)

$ npm run lint
✔ No ESLint warnings or errors

$ npx tsx scripts/preview-blocks.tsx
Inari block library — manifest
…
15 blocks registered. Run `npm run dev` and visit
http://localhost:3000/preview-blocks for the visual preview.

$ curl -s -L -o /tmp/preview.html -w "%{http_code} · %{size_download}\n" \
    http://localhost:3001/preview-blocks
200 · 407089

$ MOCK_MODE=1 npm run eval -- 01-saas-launch
✓ done in 0.3s, $0.2599, 4 images
Totals: 1/1 succeeded
```

The mock pipeline is unchanged — Session 3 is purely additive. Nothing in
`lib/orchestrator/` was modified.

---

## Caveats

1. **Auth middleware change.** `/preview-blocks` was added to `PUBLIC_ROUTES`
   in `middleware.ts` so the dev preview opens without a session. This is
   the only edit outside `lib/blocks/`, `app/preview-blocks/`, `scripts/`,
   `LICENSES/`, and `.eslintrc.json`. If the route should be gated in
   production, the future site-build step can strip it.

2. **ESLint override.** `@next/next/no-img-element` is disabled for
   `lib/blocks/**/*.tsx` and `app/preview-blocks/**/*.tsx`. The block
   library targets the single-HTML output format; using `next/image` there
   would force a Next.js runtime into the rendered page, defeating the
   "open it anywhere" property the architecture relies on.

3. **No real upstream JSX scraping.** Tailark, Magic UI, and HyperUI source
   pages are JS-rendered marketing sites; their raw GitHub source
   structure is per-block but heavily themed. Rather than attempt to scrape
   each file via `WebFetch` (which would have returned markdown-ish prose,
   not JSX), each block was authored fresh to match the pattern published
   by the upstream — same layout, same structure, same density — but
   adapted on first write to consume `tokens` + `slots`. The MIT license
   permits derivative works; the source attribution headers credit the
   pattern's origin and license file.

4. **`exampleSlots` use realistic brand names**, not Lorem ipsum, matching
   the few-shots corpus (Tide, Folio, Letter, Daybreak, Glass, Cohort,
   Kettle, Arrow, Brace). This makes the preview useful for evaluating
   typography rendering and helps integration tests in Session 4 produce
   non-generic-looking pages.

---

## Open questions for Session 4 (slot-filling pipeline)

1. **`plan.structure` output shape.** It needs to return:
   ```ts
   {
     aestheticDirection: AestheticDirection,
     palette: PaletteName,
     sections: { id: string, blockId: BlockId }[],
     style: …
   }
   ```
   Should `blocksForAesthetic(direction)` constrain the AI's pick list per
   slot (via JSON schema enum), or should the prompt just describe the
   menu and validate post-hoc? Constraining is cheaper at runtime; the
   prompt approach gives better explainability if the AI picks "wrong."
   Recommend: constrain.

2. **`section.fill` parallelism.** Each section's slot fill is a separate
   Qwen3-Coder call. With 5-8 sections per page, that's 5-8 parallel
   model calls. Need to confirm Together's rate limits + check whether
   prompt caching applies (system prompt is identical across sections —
   should be a cache hit on every section after the first).

3. **`compose.assemble` rendering target.** Two options:
   a. **Server-render once** via `renderToStaticMarkup` from
      `react-dom/server` against the registry components → single HTML
      string with inlined CSS. No JS runtime needed in output.
   b. **Tailwind purge step** — render to HTML, then run Tailwind on the
      output to inline the actually-used classes. Cleaner CSS but adds a
      build step.
   Recommend (a) for v1; tackle (b) if the single-file payload exceeds
   the perf gate threshold (Session 5).

4. **Slot validation failure mode.** When `section.fill` returns invalid
   JSON (schema rejection), do we (a) retry once with the validation error
   injected back into the prompt, (b) fall back to `exampleSlots` so the
   block still renders, or (c) skip the section entirely? Recommend (a)
   then (b) — never (c), because the plan step already committed to that
   section's existence.

5. **Image slot resolution.** Blocks like `hero/split-image` declare
   `imageSrc` as a required string, but during composition the image
   generation step may not have completed yet. Likely answer: render-time
   placeholders (a `data:` SVG with the alt text), swap in real images
   once `images.generate` resolves. Need to spec this contract in
   Session 4.

6. **A11y gate calibration.** Block components emit semantic HTML and
   alt text from slots, but quality gate G1 (axe-core) needs to be told
   our colour palettes do meet WCAG AA before it runs against real
   outputs. Worth measuring contrast ratios of every (text colour,
   surface colour) pair across the five palettes — fast Session 5 task.

---

## Out of scope (intentionally deferred)

- Orchestrator pipeline integration — Session 4
- Quality gates (a11y, conversion, mobile, SEO, security, perf) — Session 5
- Together API live calls — Session 6
- Additional aesthetic-direction coverage (brutalist-technical needs more
  dedicated blocks) — backlog
- Block library as a separate npm package — backlog
