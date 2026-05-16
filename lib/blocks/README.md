# `lib/blocks/` — the curated block library

Inari's orchestrator does **not** ask an LLM to write JSX. It asks the LLM to:

1. **Pick block IDs** (in the `plan.structure` step) from this registry.
2. **Fill slot JSON** (in the `section.fill` step), validated by each block's
   Zod schema.
3. **Render deterministically** (in `compose.assemble`) using the React
   components in this folder.

This is the architectural reason Inari does not suffer the "bug loops" Lovable
users complain about: the model never produces a `.tsx` file that could be
broken. Pages are composed from pre-vetted blocks + structured slot data.

---

## Block file contract

Every file under `lib/blocks/<category>/<variant>.tsx` exports two values:

```tsx
export const meta: BlockMeta<typeof slotsSchema> = { ... };
export const Component: BlockComponent<typeof slotsSchema> = ({ slots, tokens }) => ( ... );
```

Where:

- `meta` provides the block ID, display name, description, aesthetic
  directions it fits, the Zod slots schema, and realistic `exampleSlots`.
- `Component` is a **pure** React renderer — no `useEffect`, no fetches, no
  state mutations. Slots come in, JSX comes out.

### Rules for components

1. **Tokens-only for colour, type, radius, shadow.** Never hardcode a hex —
   read from `tokens.X`. The five Inari palettes feed `tokens` at render time.
2. **Slots are required.** If `slots.headline` is missing, the schema fails
   in `section.fill` long before the component runs — don't paper over
   missing data with hardcoded defaults inside the JSX.
3. **Mobile-first responsive.** Every block must look correct at 360px.
4. **Semantic HTML.** `<section aria-labelledby>`, real headings (no `<div>`
   styled like an `<h1>`), explicit `alt` on every `<img>`.
5. **No side effects.** Pure renderer. The orchestrator owns image fetches,
   analytics, and form submission wiring at the compose layer.

### Vendoring

All 15 blocks in this directory are adapted from MIT-licensed sources:

- [Tailark](https://github.com/tailark/blocks) — most heroes, features,
  pricing, testimonials, CTAs, and 4-col footer.
- [shadcn/ui](https://github.com/shadcn-ui/ui) — accordion primitive,
  two-tier pricing reference.
- [Magic UI](https://github.com/magicuidesign/magicui) — aurora gradient
  text, marquee, bento grid patterns.
- [HyperUI](https://github.com/markmead/hyperui) — minimal footer.

Every vendored file carries a header pointing to its source and to
`/LICENSES/<source>.MIT.txt`.

---

## Adding a new block

1. Decide the category folder (or add a new one).
2. Find an MIT-licensed source — **never copy from Tailwind Plus, Aceternity
   Pro, Preline (Fair Use), Flowbite Pro, or any commercial license.**
3. Create `lib/blocks/<category>/<variant>.tsx`:
   - Add the source header comment.
   - Define `slotsSchema` (Zod).
   - Define `meta` with realistic `exampleSlots` — use product names from
     the few-shots corpus (Tide, Folio, Pulse, etc.), never Lorem ipsum.
   - Define `Component` consuming `slots` and `tokens` only.
4. Register the block in `_registry.ts` (the cross-check there is what
   gives you compile-time typed `BlockId`).
5. Run `npx tsc --noEmit` and (optional) `npm run preview-blocks` to visually
   verify across all five palettes.

If the source repo's license is anything other than MIT/BSD/Apache 2.0, **do
not vendor it**. Pick a different source.
