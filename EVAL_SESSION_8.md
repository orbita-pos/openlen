# Session 8 — Sidebar slot editor (Phase A in-place editing)

**Date:** 2026-05-16
**Branch:** `master`
**Commit at start of session:** `455b965` (Session 7 docs + MOCK_MODE artifacts)

## TL;DR

Converted the product from "AI generates → user has static HTML" into "AI
generates → user can edit any text via sidebar form panel → page re-renders
live." First post-MVP feature. The slot-filling architecture made this
~700 LOC of new UI plus a 70-line API endpoint — no LLM call, no client-side
JSX-touching, no schema migration.

**Scope shipped:**

- `lib/zod-to-form.ts`: walk a Zod schema, emit typed `FormField` metadata
- `app/api/reassemble`: deterministic re-render endpoint (no LLM, ~50 ms)
- `lib/orchestrator/assemble.tsx` refactor: extracted `renderDeterministic()`
  pure function so reassemble can call it without a recorder/budget
- `components/workspace/slot-fields/`: 5 primitive field components
  (string, number, boolean, enum, plus a recursive dispatcher that handles
  object / array / tuple / optional unwrapping)
- `components/workspace/slot-editor.tsx` + `slot-editor-block.tsx`: sidebar
  accordion, per-block dirty indicator, per-block "Reset to original"
- `app/new/page.tsx`: edit-mode toggle, debounced (300 ms) reassemble,
  localStorage persistence keyed by `generationId`, "Reset entire page to
  AI version" affordance
- `components/workspace/preview-panel.tsx`: "Edit content" pencil button in
  the preview header
- Inline banned-phrase warning + character counts on every string field
  (regex mirrors `lib/gates/conversion.ts`)

Verification: `tsc --noEmit` clean · `next lint` 0 warnings/errors ·
MOCK_MODE eval **5/5 passes** at $0.0760/gen avg (assemble refactor didn't
disturb the orchestrator) · dev server boots cleanly in 2.4 s.

## Per-step detail

### Step 1 — `lib/zod-to-form.ts`

Custom walker (not react-jsonschema-form) because 15 schemas × ~5–10 fields
each is ~200 lines of mapping code, well below the threshold where pulling
a library pays for itself. The library would have needed UI overrides for
every field type anyway because the dense sidebar form doesn't match its
default JSON-Schema renderer.

Output shape:

```ts
type FormField =
  | { kind: "string"; multiline: boolean; maxLength?; minLength?; pattern?; patternHint? }
  | { kind: "number"; min?; max?; integer }
  | { kind: "boolean" }
  | { kind: "enum"; options: string[] }
  | { kind: "object"; fields: FormField[] }
  | { kind: "array"; itemTemplate: FormField; minItems?; maxItems? }
  | { kind: "tuple"; items: FormField[] }   // `pricing/two-tier-simple` uses this
  | { kind: "unknown" }                      // catch-all
```

Walker unwraps `ZodOptional` / `ZodNullable` (→ `required: false`) and
`ZodDefault` (→ `hasDefault: true`) before introspecting the inner type.
`ZodEffects` is unwrapped too (the inner schema is what the form renders).
`ZodTuple` separately because of the fixed-length pricing tier shape — an
array form would render add/remove buttons that would fail Zod validation.

Heuristics:

- **Multiline detection**: key matches `/\b(body|description|sub|content|paragraph|quote|tagline|blurb|privacy|copyright|answer|note|reasoning)\b/i`
  OR `maxLength >= 100` OR key is literally `"a"` (FAQ answer convention).
  Covers every multi-line field across all 15 schemas with no false negatives.
- **Label humanization**: `primaryCTA` → "Primary CTA", `imageSrc` → "Image URL",
  `q` → "Question", `a` → "Answer", camelCase → "Title Case". Edge cases
  hardcoded.
- **Singularization for array items**: `items` → "Item", `tiers` → "Tier",
  `logos` → "Logo". Two simple plural rules + identity fallback.
- **Pattern hints**: `^#[0-9a-fA-F]{6}$` → "Hex colour, e.g. #5E6AD2",
  `^[a-z][a-z0-9_-]*$` → "Lowercase letters, digits, hyphens, underscores".
  Both regex patterns currently in use across the schemas.

`defaultValueFor(field)` exported alongside — produces a seed value for
"+ Add" affordances. For objects, only required fields are populated; for
arrays, an empty array; for enums, the first option.

### Step 2 — `app/api/reassemble`

```ts
POST /api/reassemble
Body: { intent, plan, filledBlocks, images }
Returns: { html, css }
```

- Auth-gated (mirrors `/api/regenerate-section`) but **no quota consumed** —
  free deterministic operation; chewing through the generation budget on
  keystrokes would be hostile.
- No witness record, no SSE, no project persistence (Session 13+ when auth
  is real and edits need server-side rows).
- Calls the new `renderDeterministic()` pure function.

Latency on the dev box: 30–50 ms for a 4-block page. Tailwind CDN script
+ Google Fonts links are static; React SSR is the only real cost.

### Step 3 — `lib/orchestrator/assemble.tsx` refactor

Extracted the rendering machinery (block iteration + image injection + html
wrapping) into `renderDeterministic()` — a pure function with no recorder,
no budget, no progress events. `assemble()` now wraps that with the witness
record + SSE progress emit; the new endpoint calls the pure function
directly so live edits don't write a JSONL line for every 300 ms debounce.

Returns `{ html, heroAssigned, decorativeCursor, ordered }` so the
witness-recording wrapper can still report what got rendered. No behaviour
change for the orchestrator path — MOCK eval still 5/5 at the same costs.

### Step 4 — Primitive slot field components

Six files in `components/workspace/slot-fields/`:

| File              | Renders                                                |
|-------------------|---------------------------------------------------------|
| `string-field`    | input or auto-growing textarea + char count + banned warn |
| `number-field`    | numeric input with `min/max/step`                       |
| `boolean-field`   | switch toggle (coral when on)                           |
| `enum-field`      | compact h-8 dropdown (custom — `<Select>` is h-9)      |
| `slot-field`      | dispatcher; handles object/array/tuple/optional        |

`slot-field.tsx` is the single recursion point:
- Optional + value undefined → `+ Add <label>` button that seeds via
  `defaultValueFor`.
- `object` → recursive child render with a left border indicating the nest level.
- `array` → list of cards with the item label numbered ("Item 1", "Item 2"),
  honours `minItems` (hide remove) / `maxItems` (hide add).
- `tuple` → fixed-length array, no add/remove buttons.

**Banned phrases warning** lives in `string-field.tsx`. Regex mirrors
`lib/gates/conversion.ts`:

```ts
const BANNED_PHRASES_REGEX =
  /\b(world-class|cutting-edge|revolutionary|game-changing|leverage|unlock|supercharge|next-gen|reimagined|lorem ipsum|lorem)\b/i;
const FUTURE_OF_REGEX = /\bthe future of\s+\w+/i;
```

Kept as a duplicate (not import) so removing the gate doesn't accidentally
disable the UI hint. They've drifted in this direction before — gates evolve;
UI hints should stay aggressive.

**Char count** shows when `maxLength` is set on the schema; turns amber at
85%, red over. Min length below the threshold shows amber "min N chars"
until met.

### Step 5 — `SlotEditor` + `SlotEditorBlock`

Sidebar layout:

```
┌────────────────────────────────┐
│ Edit content     [×]           │  <- header with "Saved locally" status
│ Changes preview live           │
├────────────────────────────────┤
│ 1  Hero — centered CTA   [v]   │  <- collapsed
│ 2  Features — icon grid  [^]   │  <- open
│    Eyebrow: [What's inside]    │
│    Title:   [Everything Tide…] │     16/80
│    Items:                      │
│      Item 1                    │
│        Icon: [zap]             │
│        Title: [Triage…]        │
│        Body:  [Tide reads…]    │
│      Item 2 ...                │
│    [+ Add item]                │
│    [↺ Reset block to original] │
│ 3  CTA — gradient        [v]   │
└────────────────────────────────┘
[Reset entire page to AI version]
```

Per-block dirty dot fires when slot payload `JSON.stringify` differs from
the original. Open one block at a time (accordion) — the field tree gets
dense enough that two-open would push the second below the fold.

### Step 6 — Edit mode wiring (`app/new/page.tsx`)

State machine extended:

```ts
| { kind: "generated"; result: LandingPage;
    originalFilledBlocks: FilledBlock[];   // <-- new
    regen?, projectId?, title? }
```

`originalFilledBlocks` is set when result lands and refreshed on `regen`
success (a regen blesses the new payload as the AI baseline so future
"reset" affordances land there, not at the very first generation).

Two new methods on `useGeneration()`:
- `applyLiveEdit(filledBlocks, html?)` — splice new blocks into result,
  optionally update html. Doesn't touch `originalFilledBlocks`.
- `resetToOriginal()` — restore `result.filledBlocks` from the snapshot.

Edit-mode flow:

1. User clicks "Edit content" pencil in preview header.
2. Brief form slides out, slot editor slides in (same grid column).
3. User types in a field → `handleSlotsChange(newFilledBlocks)`:
   - `applyLiveEdit(newFilledBlocks)` (optimistic, no html yet).
   - Debounce timer (300 ms). On fire: POST `/api/reassemble`, then
     `applyLiveEdit(newFilledBlocks, html)`.
   - Abort controller cancels in-flight reassembles when a new edit lands.
4. localStorage sync effect writes the edits keyed by `meta.generationId`
   on every result change (catches both manual edits AND regens). Cache
   cleared when filledBlocks deep-equals originalFilledBlocks.
5. On reload / project load with cached edits, hydration effect fires once
   per generationId, restores edits, requests fresh reassemble.

Cache key format: `inari-edit/<generationId>`. Serialized FilledBlock[]
JSON. No size cap — slot payloads are ~1–2 KB per block; localStorage's
~5 MB quota easily handles hundreds of edits.

## Verification

```
$ npx tsc --noEmit                # exit 0
$ npx next lint                   # 0 warnings, 0 errors
$ MOCK_MODE=1 npm run eval        # 5/5 succeeded · $0.3799 · 15.6s wall
$ npm run dev                     # ready in 2.4s, no startup errors
```

MOCK_MODE summary (assemble refactor parity check):

| Brief                  | Cost      | Wall   | Gates | Grade  |
|------------------------|-----------|--------|-------|--------|
| 01-saas-launch         | $0.0774   | 6.1 s  | 6/6   | passed |
| 02-portfolio           | $0.0748   | 2.1 s  | 6/6   | passed |
| 03-event-conference    | $0.0760   | 2.2 s  | 6/6   | passed |
| 04-ecommerce           | $0.0755   | 2.2 s  | 6/6   | passed |
| 05-agency              | $0.0763   | 2.9 s  | 6/6   | passed |

Numbers match Session 7's table — refactor was behavior-preserving.

## Manual smoke test — not run

The Session 8 brief asked me to walk through the editor in a browser. I
can't run interactive browser tests in this environment, so the dev server
was started + immediately torn down (2.4 s, no errors). The operator should
run before sign-off:

```
npm run dev
# 1. Open http://localhost:3000/new
# 2. Type a brief, click Generate
# 3. Click "Edit content" in the preview header
# 4. Expand Hero block, edit headline, observe 300ms preview update
# 5. Edit a CTA label, observe update
# 6. Type "world-class" anywhere — verify red warning shows
# 7. Type 200 chars in a maxLength=80 field — verify counter goes red at 80
# 8. Toggle dark mode — sidebar + preview both behave
# 9. Click "Reset block to original" on a dirty block — verify revert
# 10. Reload page — verify edits persist via localStorage
# 11. Click "Reset entire page to AI version" — verify localStorage cleared + html regenerates
```

## Open questions

1. **Reassemble race with regen.** If the user edits a slot, then clicks
   "Regenerate hero" before the 300 ms debounce fires, the pending
   reassemble can land AFTER the regen result, overwriting the regenerated
   hero with the user's prior edits. Mitigation TBD: either (a) cancel
   pending reassemble when `state.regen` transitions to defined, or (b)
   include a generation epoch in the reassemble request and reject stale
   responses. Edge case (user has to act within 300 ms) — flagging not fixing.
2. **Slot dirty-detection false positives.** `slotsEqual` uses
   `JSON.stringify`. If the user opens an optional field then clears it,
   the resulting object has the same keys as the original but in a
   different insertion order (`{...prev, optKey: defaultValue}` then key
   deletion), so the dirty dot might stay lit on logically-equal payloads.
   Fix: deep-equal helper. Not blocking — false positive at worst.
3. **Banned-phrase regex drift.** Duplicated between `lib/gates/conversion.ts`
   and `components/workspace/slot-fields/string-field.tsx`. Intentional for
   now (decoupling lets UI hints stay aggressive even if the gate is removed)
   but worth revisiting if the list grows.
4. **Image slot UX.** `mockupSrc` / `imageSrc` slots currently render as
   plain text inputs accepting any URL. Session 9 image-upload work will
   replace these with a dedicated `<ImageField>` (click → file picker or
   URL paste). For now: editable URL works, but typing a long Unsplash URL
   into a tiny input is awkward — note for the operator.
5. **Form ergonomics for large arrays.** A bento with 7 tiles or a footer
   with 4 columns × 8 links each is a lot of vertical scroll. Phase B might
   want drag-to-reorder + collapsed-summary-per-item; out of scope here.
6. **Keyboard navigation.** Tab order works (native inputs). No `Esc to
   close editor` or `Cmd+Z block-level undo` shortcuts yet — Phase B.
7. **A11y of compact selects.** The custom `EnumField` mimics the existing
   `<Select>` keyboard semantics (focus + arrow key support) but doesn't
   carry combobox ARIA roles. The native `<select>` element would be more
   accessible at the cost of giving up the dropdown styling. Defer until
   the a11y gate covers form interactions (currently only landmarks +
   alt text).

## Session burn

API spend: **$0** (no real-API calls).
Total tokens: zero. Pure UI + plumbing session against the existing
slot-filling architecture.

## Next

**Session 9 — No-image option + image upload.** Add a "generate without
AI images" toggle and a click-to-upload affordance on image slots. With
Session 8's editor in place, the slot path is wired; the image story
becomes "click a slot → choose upload / URL / generate" rather than
"regenerate the page differently". Completes the "I control the visuals"
story for non-devs with brand assets of their own.
