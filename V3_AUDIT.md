# V3 Pivot — File-by-file Audit

What survives, what changes, what dies in the catalog → curated-presets pivot. Use this to recover from "am I losing work?" anxiety.

Last reconciled with: master @ 1090a0d (after Session 12 + persistence + planning docs).

## ✅ KEEP — untouched in V3 (~70% of repo)

Most of OpenLen survives the pivot. The V3 work is concentrated in the generation pipeline + workspace UI; everything else is shell that already works.

### Auth + DB layer
- `lib/db/schema.ts` — projects table, users, sessions all unchanged. The `data` jsonb column on projects continues to hold the LandingPage artifact (just with a different internal shape, see V3 contract).
- `lib/db/index.ts` — Drizzle setup unchanged.
- `app/api/auth/[...nextauth]/route.ts` + everything under `app/(auth)/*` — NextAuth flow untouched. Login, register, forgot, reset all keep working.
- `app/api/auth/*` (register, forgot, reset) — untouched.
- `app/(auth)/login/login-form.tsx`, `register-form.tsx`, etc. — untouched.

### Session 11 (publish) — fully preserved
- `app/api/projects/[id]/publish/route.ts` — V3's HTML output is the same shape (`page.html` in `data`), so publish reads/writes the same way.
- `app/api/subdomains/check/route.ts` — untouched.
- `lib/subdomain/*` — validation/limits/reserved untouched.
- `lib/publish/filesystem.ts` — KEEP the defensive `data-slot-path` assertion (Session 12 backstop). V3 will also need it because `<EditableText>` still produces those spans in editor mode.

### Session 12 (inline edit) — preserved with light refactor
- `lib/blocks/_editable.tsx` — `EditableText` component + `EditorContext` move from `lib/blocks/` to `components/primitives/` but the implementation is unchanged. Just relocated.
- `public/iframe-editor.js` — vanilla JS for the iframe is unchanged. It reads `data-slot-path`; V3 emits the same attribute on primitives instead of blocks.
- `app/new/page.tsx` — `handleInlineEdit` + 500ms debounce + persistence integration stays. The slot-path parser becomes "primitive-path parser" but same logic.

### Infra
- `infra/nginx/openlen.conf` — wildcard server + apex reverse proxy untouched.
- `infra/app/openlen-app.service` — systemd unit untouched (PUBLISH_ROOT etc.).
- `infra/SETUP.md` — only addition: a Section 12 noting `OPENLEN_PIPELINE_V3=true` env var to switch pipelines.
- All deploy/build infra untouched.

### Misc
- `app/projects/projects-view.tsx` — project list page; the kebab menu + status pills stay. Only change: thumbnail rendering reads V3 presets instead of V1 HTML (which still works through the same renderToStaticMarkup path).
- `app/api/projects/route.ts` + `app/api/projects/[id]/*` — CRUD unchanged.
- `app/api/projects/[id]/duplicate/route.ts` — duplicates a project; works the same on V3 data shape.
- `lib/projects.ts` — `publishProject`, `unpublishProject`, `updateProjectSlots`, `listProjects` — all keep working. Signatures preserved.
- `lib/zod-to-form.ts` — still useful for the Content tab sidebar (slot editor forms) since primitives have typed slots.
- `lib/orchestrator/types.ts` — extend with `DesignSystem` type but `LandingPage` shape stays compatible.
- Quality gates (a11y, conversion, mobile, SEO, security, performance) — run on the OUTPUT HTML; they don't care whether it came from catalog or V3 writer.

### Tests
- Vitest config + existing tests on services keep running. Block-component tests (15 of them) get deleted along with the blocks.

---

## 🔄 REFACTOR — same surface, new internals (~15% of repo)

### Workspace UI
- `components/workspace/header.tsx` — add Content/Design segmented toggle. Keep everything else (Publish dropdown, save status, edit toggle, avatar).
- `components/workspace/preview-panel.tsx` — extend with viewport switcher (Desktop/Tablet/Mobile), zoom controls, top toolbar. iframe rendering logic unchanged.
- `components/workspace/slot-editor.tsx` + `components/workspace/slot-editor-block.tsx` + `components/workspace/slot-fields/*` — same components, but they render primitive slots instead of block slots. The form-field generation via `zodToFormMetadata` continues to work since primitives have Zod schemas too.
- `app/new/page.tsx` — workspace shell. Add state for active mode (Content | Design), active presets (bg, palette, typography, density, radius, decoration), wire to `DesignPanel`. ~+200 LOC.

### Generation pipeline (gutted, rebuilt)
- `app/api/generate/route.ts` — SSE endpoint stays. Internals swap from `classify → plan → fill → assemble` to `plan → write → autofix → render`.
- `app/api/reassemble/route.ts` — keep. V3 renders the same way (primitives → renderToStaticMarkup → HTML).
- `app/api/regenerate-section/route.ts` — keep but logic changes: instead of regenerating a single block's slot JSON, it regenerates a single primitive's TSX subtree from the writer.
- `lib/orchestrator/assemble.ts` — keep `renderDeterministic` (it just renders React → HTML). Input shape changes from `filledBlocks[]` to `primitives[]` but the render mechanism is identical.

### Image handling
- `app/api/upload/route.ts` — file upload endpoint kept (user-uploaded images still supported).
- `lib/storage/*` — `r2.ts` / `local.ts` kept. AI image gen (FLUX) is removed from the pipeline but the storage layer that serves user uploads is unchanged.

---

## ❌ DELETE — gone in V3 (~15% of repo)

### The 15 block catalog
All files under `lib/blocks/<category>/<variant>.tsx` go away:
- `lib/blocks/hero/centered-cta.tsx`
- `lib/blocks/hero/split-image.tsx`
- `lib/blocks/hero/animated-gradient.tsx`
- `lib/blocks/hero/logo-strip.tsx`
- `lib/blocks/features/icon-grid-3col.tsx`
- `lib/blocks/features/bento-asymmetric.tsx`
- `lib/blocks/features/alternating-rows.tsx`
- `lib/blocks/pricing/three-tier-highlight.tsx`
- `lib/blocks/pricing/two-tier-simple.tsx`
- `lib/blocks/testimonials/quote-grid-3col.tsx`
- `lib/blocks/faq/accordion.tsx`
- `lib/blocks/cta/gradient-cta.tsx`
- `lib/blocks/cta/card-cta-form.tsx`
- `lib/blocks/footer/four-col-links.tsx`
- `lib/blocks/footer/minimal-row.tsx`
- `lib/blocks/_registry.ts`
- `lib/blocks/_icons.tsx`
- `lib/blocks/types.ts`
- `lib/blocks/README.md` (or rewrite as `components/primitives/README.md`)

**Their design intelligence is replaced by:** 5 hand-tuned layout primitives + the 8 backgrounds + 20 palettes + 6 typography systems + variant logic in the writer prompt.

### FLUX image generation
- Calls to FLUX inside `lib/storage/*` or wherever the orchestrator generates hero/decorative images — gone.
- The FLUX-specific routing entries in any model bucket config — gone.

### Orchestrator stages no longer needed
- `lib/orchestrator/classify.ts` — V3 doesn't classify intent as a separate step; the planner reads the brief directly.
- `lib/orchestrator/fill.ts` — the writer fills everything in one call; no per-block fill step.
- The "compose" intermediate step (if any) — gone.

### Eval corpus (partial)
- `evals/*` — keep the brief inputs (5-25 briefs) but throw out the V1-shaped expected outputs. V3 eval runs the new pipeline + Opus 4.7 judge.

---

## ➕ ADD — net-new for V3 (~15% of repo)

### Primitives layer
- `components/primitives/Hero.tsx`
- `components/primitives/Stack.tsx`
- `components/primitives/Split.tsx`
- `components/primitives/Grid.tsx`
- `components/primitives/CTA.tsx`
- `components/primitives/EditableText.tsx` (relocated from `lib/blocks/_editable.tsx`)
- `components/primitives/_registry.ts` — maps primitive name → component + typed slots
- `components/primitives/README.md` — primitive authoring contract

### Presets layer
- `lib/design/presets/backgrounds.ts` — 8 background presets (mesh-grain, conic-sweep, halftone, etc.)
- `lib/design/presets/palettes.ts` — 20 OKLCH palette presets (computed from brand hues)
- `lib/design/presets/typography.ts` — 6 typography systems (font family + scale + tracking + leading)
- `lib/design/presets/density.ts` — 3 density modes (compact / standard / spacious)
- `lib/design/presets/radius.ts` — 3 radius modes (sharp / soft / pill)
- `lib/design/presets/decoration.ts` — 3 decoration intensities (minimal / balanced / bold)
- `lib/design/tokens.ts` — runtime computation: given (palette + typography + density + radius + decoration), emit CSS custom properties bundle

### V3 pipeline
- `lib/orchestrator/v3/planner.ts` — Kimi K2.6 brief → DesignSystem JSON
- `lib/orchestrator/v3/writer.ts` — Kimi K2.6 DesignSystem + brief + primitives types → TSX
- `lib/orchestrator/v3/autofixer.ts` — streaming Tailwind class lint + contrast check + Unsplash placeholder rewriter
- `lib/orchestrator/v3/types.ts` — DesignSystem type, V3 LandingPage shape
- `lib/orchestrator/v3/render.ts` — TSX → HTML via renderToStaticMarkup with primitives registry

### Providers
- `lib/ai/providers/kimi.ts` — Kimi K2.6 via Together AI (planner + writer both use this)
- `lib/ai/providers/together.ts` — base Together AI client (probably exists; just extend)
- `lib/ai/router.ts` — feature-flag-based switch: V1 (existing Qwen) or V3 (Kimi)

### Image substitutes
- `lib/images/unsplash.ts` — Unsplash API client (free tier, attribution + UTM compliant)
- `lib/images/svg-decoration.tsx` — 5 SVG decoration components (mesh, grain, halftone, conic, blob)

### Workspace UI
- `components/workspace/design-panel.tsx` — the Design tab sidebar (port from claude.ai artifact)
- `components/workspace/pages-sidebar.tsx` — right sidebar with project list
- `components/workspace/status-bar.tsx` — bottom bar with spent/time/gates
- `components/workspace/preview-toolbar.tsx` — viewport switcher + zoom controls

### Eval V2
- `evals/v3/` — 25 brief corpus + Opus 4.7 judge harness + 7-axis rubric

---

## Feature flag

`OPENLEN_PIPELINE_V3` env var (default `false`):
- `false`: current V1 pipeline (catalog + Qwen) runs. Existing users unaffected.
- `true`: V3 pipeline (curated presets + Kimi) runs. New endpoint `/api/generate?v=3` or query param to opt in per-request during testing.

Both pipelines coexist during the rollout window. Cut over when V3 beats V1 on the expanded eval corpus.

---

## Summary numbers

- **Files deleted: ~20** (15 blocks + 3 orchestrator stages + 2 registries)
- **Files added: ~25** (5 primitives + 6 preset registries + 5 v3 pipeline + 2 providers + 2 images + 5 UI)
- **Files refactored: ~10** (workspace UI + generate route + reassemble + types)
- **Files preserved: ~rest of repo** (auth, DB, publish, infra, projects, modals, etc.)

The wedge ("AI-curated design system + user knobs + AGPL OSS + $19/mo") shows up in the new files. The shell of the product (auth, billing tier scaffolding, publish, subdomain flow) all stays.
