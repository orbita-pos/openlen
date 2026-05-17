# Session 12 prompt — OpenLen WYSIWYG inline editing

Paste this into a fresh Claude Code session at `C:\Users\jesus\desktop\inari-pages\`. Self-contained — no prior chat context needed.

---

You are implementing **Session 12 of OpenLen** — the final session of the 12-session build arc. The product is an open-source (AGPL v3) AI landing-page generator. The repo is at `C:\Users\jesus\desktop\inari-pages\`, public mirror at `https://github.com/orbita-pos/openlen`, live at `https://openlen.com`. First user-published page lives at `https://inari.openlen.com`.

## Goal

Close the "Lovable-quality" wedge by adding **in-iframe WYSIWYG text editing**. Today, users edit slot content via a sidebar (`components/workspace/slot-editor.tsx`) — type in a form, the iframe re-renders. After Session 12: users click any text directly in the preview iframe, type the new value inline, hit Enter, see the update instantly. Sidebar stays as a fallback / for structural slots (images, enums, ordering).

This is the visible polish that competitors (Lovable, v0, Framer, Bolt) have and OpenLen doesn't yet. It's the difference between "feels like a form" and "feels like magic."

## Context (locked — do not redesign)

**Stack on disk:**

- Next.js 15.5 App Router + TypeScript. Standalone build deployed to Hetzner CPX21 via tar+scp.
- Neon Postgres + Drizzle ORM (`drizzle-kit push --force`, no migration folder).
- NextAuth (email + Google) — handled.
- Tailwind + shadcn/ui — handled.
- Together AI smart-routing for generation (see `lib/orchestrator/`).

**The generation pipeline (read these before designing):**

- `app/api/generate/route.ts` — SSE endpoint that runs the slot-filling pipeline (classify → plan → fill + images → assemble → 6 gates → optional refine). Returns a `LandingPage` artifact with both the slot JSON (`page.blocks[i].slots`) and the rendered HTML (`page.html`).
- `lib/orchestrator/assemble.ts` — `renderDeterministic(page)`: pure function, takes the page, renders all blocks via `react-dom/server` (escape-hatched in `_render-element.ts` for RSC graph reasons), returns a full HTML document string. **This is the single source of HTML truth.** It's called both at generation time AND by `/api/reassemble` after every slot edit.
- `app/api/reassemble/route.ts` — re-renders a project after slot edits. Tiny. Fast (no LLM calls — pure render).
- `lib/blocks/_registry.ts` — maps block IDs to React components + Zod schemas.
- `lib/blocks/<category>/<variant>.tsx` — 15 block components. Each declares a Zod schema for its slots, takes typed props, renders JSX.
- `lib/blocks/_icons.tsx` — **inline SVG components, NOT lucide-react** (lucide had a "use client" SSR boundary issue, fixed in commit `2c258ca`). If you need a new icon, add inline SVG here, do NOT import from `lucide-react` inside any `lib/blocks/` file.

**Workspace UI:**

- `app/new/page.tsx` — the workspace (auth-gated). Reads `projectId` from query, loads the project, holds slot state.
- `components/workspace/preview-panel.tsx` — the iframe. Currently shows `page.html` via `srcDoc=`.
- `components/workspace/slot-editor.tsx` — sidebar with one expandable section per block; uses `lib/zod-to-form.ts` to derive form fields from the block's Zod schema. Calls `/api/reassemble` after each save.
- `components/workspace/slot-editor-block.tsx`, `components/workspace/slot-fields/*` — per-field UI primitives.
- `components/workspace/header.tsx` — workspace header with "Deploy" dropdown (Session 11 added "Publish to openlen.com" here).
- `components/workspace/publish-modal.tsx` — Session 11 publish flow (claim subdomain).

**Publishing (Session 11, do not regress):**

- `POST /api/projects/[id]/publish` writes `page.html` to `/var/www/openlen/<subdomain>/index.html`.
- nginx wildcard server serves `*.openlen.com` from that root.
- **The published HTML MUST stay static and clean** — no editor JS, no `data-slot-path` attributes leaking out. The editor surface lives in the workspace iframe only.

**The 11 architecture principles** (from `README.md`):
- Slot JSON is the source of truth. HTML is derived.
- Render is deterministic — given the same slots, you always get the same HTML.
- Witness records every AI call for explainability.

**Developer context:**
- Jesus Bernal (@JesusBrDev), solo founder, Mexico.
- Style: simple, no over-engineering, no abstractions for hypothetical futures.
- Avoid: mocks in tests, `unsafe-eval`, in-memory rate limiters.

## Locked design decisions

| # | Decision | Detail |
|---|---|---|
| 1 | **Toggle, not replace** | Add a "Edit mode" toggle to the workspace header (next to / inside the Deploy dropdown). Off by default; sidebar editor unchanged. When ON, the iframe becomes interactive AND the sidebar dims (still usable for structural slots). |
| 2 | **What's editable inline** | Text slots only — headings, eyebrows, body copy, button labels, list items, FAQ Q/A, pricing tier names, testimonial text, feature titles & descriptions. **NOT editable inline:** images, icons (enum), aesthetic direction, color tokens, link `href` values, block ordering, add/remove block. Those stay in sidebar. |
| 3 | **Tagging strategy** | During `renderDeterministic()`, when called with `editorMode: true`, wrap each text-bearing slot in a span: `<span data-slot-path="blocks.2.slots.heading.text">My heading</span>`. The path encodes block index + dot-separated slot path. **For arrays** (e.g. `features[3].title`), use bracketed indices: `blocks.1.slots.features[3].title`. When `editorMode: false` (default — used for publish), render without the wrapper spans — clean output. |
| 4 | **Editor injection** | The iframe receives `srcDoc=` with `page.html` + an injected `<script type="module">` (only when edit mode is on). The script: registers hover/focus styles, makes spans contentEditable on click, sends edits to parent via `postMessage`. ~200 LOC, plain TS bundled separately (a server-side route returns the script as a string, see implementation plan). |
| 5 | **postMessage protocol** | `{ type: "openlen-edit", path: string, value: string }` from iframe → parent. Parent validates path matches a known slot, updates in-memory slot JSON, debounces 500ms, calls `/api/reassemble` to get fresh HTML, refreshes iframe `srcDoc`. **Optimistic UI**: the iframe DOM updates the span text on Enter/blur before the reassemble round-trip — the user sees their change immediately, then reassemble validates + replaces. |
| 6 | **Plain text only** | `contenteditable="plaintext-only"` on every editable span. No bold/italic/links inline — those would require markdown round-trips and are out of scope. Drop pasted HTML; only the textContent survives. |
| 7 | **ESC cancels, Enter saves** | Enter (for single-line) or Cmd/Ctrl+Enter (for multi-line, e.g. body paragraphs) commits. ESC reverts the span to its pre-edit value and blurs. Click-outside also commits (Lovable behavior). |
| 8 | **Validation** | After edit, before reassemble, validate the new value against the block's Zod schema for that specific slot path. On schema fail, revert + toast "doesn't fit this slot — try shorter / no special chars". Don't crash. |
| 9 | **Visual affordance** | When edit mode is on: spans have an invisible outline that becomes a 1px dashed border on hover (color: brand coral `#FF5A36` at 30% opacity). Active edit gets a solid 1px border + tiny "↵ to save · ESC to cancel" hint at the bottom-right of the span. |
| 10 | **Save state** | The workspace already has slot state in memory. Inline edits feed into the SAME state, same debounced reassemble. If user also edits in the sidebar simultaneously, last-write-wins — both surfaces mutate the same source. |
| 11 | **Published HTML stays clean** | `lib/publish/filesystem.ts` writes `page.html` produced by `renderDeterministic(page, { editorMode: false })`. The Session 11 publish flow currently uses `page.html` from the stored project — that field is already produced with editorMode false, so as long as you don't accidentally store the editor-mode HTML into `page.html`, you're safe. Keep editor-mode HTML in a separate field or compute it on demand for the iframe. |
| 12 | **No persistence of edit mode preference** | If user reloads, edit mode is OFF. Don't write to localStorage. Simpler, no migration risk later. |
| 13 | **Touch / mobile** | Test in Chrome mobile emulator. Long-press should trigger edit (since hover doesn't exist on touch). If long-press is hard, fall back to: tap to enter edit, tap again to commit. Document whichever you ship. |
| 14 | **Out of scope** | Image swap inline. Layout drag-and-drop. Block reorder. Adding new blocks. Color picker. Font picker. Anything that touches structural slots. All of those stay in the sidebar (or future sessions). |

## Research first (before implementing)

Read these and any others you discover. Aim for ~250 words of findings:

1. `lib/orchestrator/types.ts` — what's the `LandingPage` shape exactly? Where is the slot JSON stored vs the HTML?
2. `lib/orchestrator/assemble.ts` — how does `renderDeterministic()` walk the blocks? Is there a single place to thread `editorMode` through, or do I need to plumb it into each block?
3. `lib/blocks/<any one>/<variant>.tsx` — pick a representative block (e.g. `hero/centered-cta.tsx` or `features/icon-grid-3col.tsx`). How does it consume slots? Does it spread them into props, or destructure each one? **This tells you whether the editor-mode wrapper goes at the block level (per-slot) or one level up (a generic `<EditableText slot="..." />` helper inside each block).**
4. `app/api/reassemble/route.ts` — how does it accept the project state? Does it take slot JSON and re-render, or does it take the full LandingPage?
5. `components/workspace/preview-panel.tsx` — how is `srcDoc` populated? Is there an existing path to pass non-HTML content to the iframe?
6. `lib/publish/filesystem.ts` — confirm the publish path uses `page.html` (the stored field) and not a re-rendered version.
7. Any iframe sandbox attributes currently set? `sandbox="allow-scripts allow-same-origin"`? `postMessage` works regardless but worth confirming.

## Then propose architecture

Cover these explicitly with your decisions (some are already locked above — just confirm or push back if you find a reason):

1. **Where editorMode threads through.** Add a parameter to `renderDeterministic(page, opts?)`? A separate `renderEditable(page)`? Justify.

2. **The `EditableText` helper.** Propose its API. Likely something like:
   ```tsx
   <EditableText slot="heading.text" editorMode={editorMode}>
     {slots.heading.text}
   </EditableText>
   ```
   That renders a plain string when off, a wrapped span when on. The path prop is per-slot — you have to update every block to use it. **Estimate the diff: how many blocks × how many text slots per block ≈ N call sites.** Honest number — 15 blocks × ~5 text slots avg = ~75 call sites of mechanical edits.

3. **The iframe editor script.** Where does it live? Options:
   - (a) `public/iframe-editor.js` — static asset, fetched by `<script src=>`.
   - (b) `app/api/iframe-editor/route.ts` — returned as `text/javascript`; lets you template (e.g., inline config).
   - (c) Inlined as a string in `preview-panel.tsx` and injected into `srcDoc`.
   Pick one. (a) is simplest if no templating needed; (c) keeps everything in one place.

4. **Path → slot lookup.** Given `blocks.2.slots.features[3].title`, how do you walk the slot JSON to validate + mutate? Use `lodash.get`/`set`? Hand-roll a parser? Hand-roll is fine — paths are well-formed by construction (you emit them).

5. **Reassemble flow.** On edit commit:
   - Optimistic: update span textContent immediately (in the iframe).
   - Debounce 500ms.
   - PATCH the project (or call /api/reassemble) → get new HTML.
   - Refresh iframe `srcDoc`.
   - During the round-trip, show a small "saving" pulse somewhere (top-right corner of preview? toast?).

6. **Validation order.** When edit commits:
   1. Walk slot JSON, find the slot at `path`.
   2. Replace value, run the block's Zod schema on the whole slots object.
   3. If schema passes → state update + reassemble.
   4. If schema fails → revert span text, toast error.

7. **Failure modes to flag for the user:**
   - "Inline editing breaks for any new block that doesn't wrap its text in `<EditableText>`. Document this in `lib/blocks/README.md` or a new doc, and add an ESLint rule if cheap."
   - "Mobile long-press conflict with native iOS callout — may need `-webkit-touch-callout: none` on editable spans."
   - "Pasted long text into a small slot — Zod schema rejects → user thinks app is broken. Surface clear error with character count."

## Implementation plan

Rough complexity bands: **S** ≤ 50 LOC, **M** 50–200, **L** 200–500.

### Phase A — Plumbing the editor mode through render

1. **`lib/orchestrator/types.ts`** (S, edit) — add `RenderOptions { editorMode?: boolean }` type.
2. **`lib/orchestrator/assemble.ts`** (M, edit) — `renderDeterministic` accepts `opts?: RenderOptions`. Threads `editorMode` into a React context (e.g., `EditorContext` provider) wrapping the rendered tree, so every block can access it without prop drilling.
3. **`lib/blocks/_editable.tsx`** (M, new) — `EditableText` component. Reads `EditorContext`. When off, renders children as plain string (no wrapper). When on, renders `<span data-slot-path="..." contenteditable="plaintext-only" suppressHydrationWarning>{children}</span>`. The `suppressHydrationWarning` matters because contenteditable HTML can drift from React's expectation; we're outputting to a static iframe so it's fine, but suppress the warning.

### Phase B — Wrap every text slot in every block

4. **`lib/blocks/<all 15>/<variant>.tsx`** (M each, L total) — Mechanical edit. Each text-bearing slot gets wrapped in `<EditableText slot="...">`. Be precise with slot paths; they're the API now. Example diff:
   ```tsx
   - <h1 className={...}>{slots.heading.text}</h1>
   + <h1 className={...}><EditableText slot="heading.text">{slots.heading.text}</EditableText></h1>
   ```
   For arrays (features, FAQ items, pricing tiers): index in the loop:
   ```tsx
   {slots.features.map((feat, i) => (
     <div key={i}>
       <EditableText slot={`features[${i}].title`}>{feat.title}</EditableText>
       <EditableText slot={`features[${i}].body`}>{feat.body}</EditableText>
     </div>
   ))}
   ```

### Phase C — The iframe editor

5. **`public/iframe-editor.js`** (M, new) — Plain JS module, no bundler involved, loaded by the iframe. Lifecycle:
   - On DOMContentLoaded: find all `[data-slot-path]` spans. Attach hover/click handlers.
   - On click: enter edit mode (`contenteditable="plaintext-only"`, focus, select all).
   - On Enter / blur: commit. Send `postMessage({ type: "openlen-edit", path, value }, "*")` to parent.
   - On ESC: revert + blur.
   - Style injection: a small `<style>` tag with hover outline + edit hint pseudo-element.
   Keep it < 200 LOC. No deps. No bundling.

6. **`components/workspace/preview-panel.tsx`** (M, edit) — Take a new prop `editorMode: boolean`. When true:
   - Modify the iframe srcDoc to append `<script src="/iframe-editor.js" defer></script>` before `</body>`.
   - Set `sandbox="allow-scripts allow-same-origin"` on the iframe.
   - Add a `message` event listener on the parent window. Validate origin (will be `null` since srcDoc), validate message shape, call a new prop `onSlotEdit({ path, value })`.

### Phase D — Workspace state + reassemble

7. **`app/new/page.tsx`** (M, edit) — Add `editorMode` boolean state. Pass to `preview-panel`. Add `onSlotEdit` handler:
   ```ts
   const handleSlotEdit = ({ path, value }) => {
     const next = produce(slots, draft => {
       set(draft, path, value);     // lodash.set or hand-rolled
     });
     // Optional Zod validation here — revert if invalid.
     setSlots(next);
     debouncedReassemble(next);
   };
   ```
   Debounce 500ms. Reuses the existing `/api/reassemble` plumbing.

8. **`components/workspace/header.tsx`** (S, edit) — Add an "Edit mode" toggle (a small pill button: "Edit text inline" / "Editing"). Wire to `editorMode` state in parent.

### Phase E — Safety + polish

9. **`lib/publish/filesystem.ts`** (S, verify only) — Confirm the publish path uses the editor-mode-OFF HTML. Add a runtime assertion: refuse to write any HTML containing `data-slot-path=` to disk. Defense in depth — a leaked editor-mode publish would be a tiny disaster (broken styling + visible cruft to visitors).

10. **`lib/blocks/README.md`** (S, new — or extend an existing doc) — Document the `EditableText` contract for future block authors: "every text-bearing slot must be wrapped; arrays use bracketed indices; non-text slots stay raw."

11. **`tsconfig.json`** (S, verify) — no changes expected, just confirm the new `_editable.tsx` compiles.

### Phase F — Smoke test (do this yourself; user will browser-verify)

12. **Bring up dev server** (`npm run dev`). Generate a sample landing (use MOCK_MODE=1 to skip Together cost). Toggle edit mode on. Click a heading, type new text, hit Enter. Verify:
    - Iframe updates immediately.
    - Sidebar form reflects the new value.
    - Network panel shows ONE reassemble call after 500ms debounce, not one per keystroke.
    - Publish the page, view the published HTML at `https://<sub>.openlen.com`, confirm zero `data-slot-path` attributes in source.

## Critical implementation rules

1. **Read every file you're about to edit first.** Match existing style — comment density, naming, import order.
2. **No new deps if avoidable.** lodash for `get`/`set` is OK if it's already in package.json; otherwise hand-roll a 20-LOC walker. Don't pull in `immer` if there's already a pattern for state updates in the workspace.
3. **`EditableText` is server-renderable.** Don't add `"use client"` to it. It must run inside `renderToStaticMarkup`.
4. **NO lucide-react imports inside `lib/blocks/*`.** Use `lib/blocks/_icons.tsx` (inline SVGs). This was a Session 11 lesson — see commit `2c258ca` for why.
5. **The published HTML must stay clean.** If your tests confirm `data-slot-path` appears in published files, the test must fail.
6. **TypeScript safety.** `EditableText` props are typed; `slot` is just `string` (paths are too dynamic to make literal-union — and that's fine for v1).
7. **Don't run deploy scripts.** The user does deploys via existing infra after you finish.
8. **Don't commit.** The user reviews + commits.
9. **`drizzle-kit push` not needed** — Session 12 has no schema changes.

## Output format when done (under 400 words)

- Files created / edited (paths, one per line)
- Anywhere you deviated from the spec and why
- Pre-existing issues you noticed (do NOT fix unless blocking)
- Exact local smoke test the user should run before deploying:
  - `npm run dev` → URL → click action → expected result
- Anything you punted (e.g., "mobile long-press: handled the basic case, iOS-specific quirks may need polish")

Aim for tight, focused implementation. ~500-700 LOC total. Don't gold-plate. This is the last session — ship it tight.

---

End of prompt. Paste from "You are implementing **Session 12 of OpenLen**" through "ship it tight." into a fresh Claude Code session in `C:\Users\jesus\desktop\inari-pages\`.
