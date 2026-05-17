# OpenLen — repo-level instructions for Claude Code

OpenLen is a landing-page builder. Users describe a page (or pick a template, or paste their own HTML), edit, and publish to `<sub>.openlen.com`. The repo runs as a Next.js app self-hosted on Hetzner — **never Vercel**. Brand was renamed from "Inari Pages" on 2026-05-16; `Inari Watch` is a separate sister product (monitoring, not pages), don't conflate.

## High-level structure

| Path | What lives here |
|---|---|
| `app/` | Next.js App Router pages + API routes |
| `app/new/` | V1 workspace — AI brief → orchestrator → page. Still ships, but V2 is the new entry. |
| `app/new-v2/` | V2 workspace — 3 entry paths (AI / Template / Paste) + editing + Deploy dropdown. Primary entry point. |
| `app/projects/` | Project list view. "New" buttons route to `/new-v2`. |
| `app/api/projects/[id]/publish/` | POST/DELETE — claim subdomain + write `project.data.html` to disk via `publishToDir`. |
| `app/api/projects/from-template/` | POST — clone a curated template's HTML into a new user project. |
| `app/api/projects/from-html/` | POST — accept raw HTML (typically from claude.ai), create project. |
| `app/api/generate/` | Orchestrator pipeline (classify → plan → fill → assemble → gates → refine). |
| `components/workspace-v2/` | V2 workspace UI — TopBar, LeftSidebar (7-tab panel), PreviewArea, panels for each mode. |
| `components/templates/_registry.ts` | The 15 (eventually 30) curated templates registry. Adding a new template = one entry here + one `.html` file. |
| `lib/blocks/` | 15 vendored MIT-licensed block components (hero / features / pricing / etc.) the orchestrator composes pages from. |
| `lib/orchestrator/` | The AI pipeline + `assemble.ts` which renders blocks → static HTML via `_render-element.ts`. |
| `lib/publish/filesystem.ts` | `publishToDir` — atomic write to `/var/www/openlen/<sub>/index.html`. |
| `infra/` | Hetzner deploy stack — nginx wildcard config, systemd unit, deploy.sh, bootstrap. |
| `public/templates/curated/` | The 15 curated landing HTMLs served directly to the workspace's template gallery. |
| `docs/claude-design-prompts.md` | 6 prompts for claude.ai Opus 4.7 that generate 5 templates each. |

## Architecture invariants — do not break

1. **Templates are HTML files, not React components**. The 15 in `public/templates/curated/` are pure HTML (Tailwind CDN + Google Fonts inline). Do NOT port them to TSX — we tried, the user rejected it. Adding more = drop `.html` + register entry.
2. **Templates never claim subdomains**. Only user projects do, at publish time. `mirror.html` is inspiration; `<myco>.openlen.com` is what a user gets after cloning Mirror + clicking Deploy.
3. **Published output is static HTML**. `project.data.html` → `/var/www/openlen/<sub>/index.html` → nginx serves direct from disk. No React runtime, no Node hop on the user's published page. Tailwind via CDN is OK.
4. **`<EditableText>` lives in `lib/blocks/_editable.tsx`** — uses lazy `getEditorContext()` to dodge Next 15's RSC `createContext` ban at module-load time. Do not call `React.createContext` at module top level in any file imported into the RSC graph.
5. **`react-dom/server` lives only in `lib/orchestrator/_render-element.ts`** — it uses `createRequire` to hide the import from webpack's RSC graph check. Anything else that needs `renderToStaticMarkup` should go through this helper.
6. **`publishToDir` rejects HTML containing `data-slot-path=`** — that marker means editor-mode HTML and must never reach disk. The orchestrator passes `editorMode: false` to `renderDeterministic` for the canonical `page.html`.

## Workspace V2 mental model

`/new-v2` has an `EntryMode` state machine derived from URL params:

- `?` (no params) → `choosing` → EmptyState with 3 cards (AI / Template / Paste)
- `?mode=ai` → `ai` → redirects to `/new` (V1 brief flow) for now
- `?mode=template` → `template` → templates gallery in sidebar + preview-first commit flow in main area
- `?mode=paste` → `paste` → PastePanel in sidebar (textarea + title)
- `?project=<id>` → `editing` → workspace with TopBar Deploy, sidebar tabs, full preview

The sidebar locks tabs per entry mode. In `editing`, "flat" projects (template-clone or paste, `data.filledBlocks.length === 0`) lock Content + Design because those panels only apply to AI-generated slot-based pages. Inline-edit toggle in TopBar hides on flat projects for the same reason.

## Commands

```bash
npm run dev               # local dev — Next.js + DB connection from .env.local
npm run build             # standalone build (next.config has output: "standalone")
npx tsc --noEmit          # type check — run before committing
bash infra/scripts/deploy.sh  # build locally + rsync to Hetzner + systemctl restart
```

## Code style preferences

- **No excess comments**. The user dislikes verbose code that explains the obvious. Only comment WHY when non-obvious.
- **No over-engineering**. Ship simple first. Add abstractions when there's a second caller, not before.
- **Don't pivot architecture mid-session**. User dislikes "andar dando vueltas". Commit to one approach, ship, iterate.
- **Don't add features without confirming**. The phrase "deja de inventar" has come up. Match what was asked; if scope grows, ask first.
- **Always run `tsc --noEmit` before saying "done"**. The user takes "compila limpio" as a real signal.

## Template gallery scaling roadmap

Current state: 15-30 templates live as a static `TEMPLATES` array in `components/templates/_registry.ts` + matching `.html` files in `public/templates/curated/`. `TemplatePreviewFrame` lazy-mounts each card's iframe via IntersectionObserver, so the in-memory list scales further than the visible viewport. Don't add infinite scroll or DB-backed templates "just in case" — both are real features tied to specific triggers below.

**Trigger 1 — Scanning feels slow** (~30+ templates, when scrolling the sidebar to find the right one becomes annoying):
- Add a search bar at the top of `TemplatesPanel` — client-side filter over `TEMPLATES` by name/pitch/tags. ~1 hour. No backend changes.

**Trigger 2 — Open user contributions** (when community-submitted templates become a planned feature):
- New table `community_templates` in Postgres: `id`, `ownerUserId`, `title`, `family`, `html`, `status` (`draft` | `pending_review` | `approved` | `rejected`), `createdAt`, `approvedAt`. Drizzle schema goes in `lib/db/schema.ts`.
- New endpoint `GET /api/templates?cursor=<id>&limit=N&family=<f>&q=<search>` — cursor-based pagination, only returns `status = approved`.
- New endpoint `POST /api/templates/submit` for users to submit their own; `POST /api/templates/<id>/approve` for moderation.
- `TemplatesPanel` switches from reading the static array to fetching this endpoint + infinite scroll (IntersectionObserver on the bottom sentinel triggers next page) or virtualization with `react-window` if the catalog hits 1000+.
- The 15-30 curated templates in `_registry.ts` stay as the "official" set, possibly seeded into the DB on bootstrap. Or kept as a separate static collection alongside the community one — user picks.

**Out of scope for both triggers**: AI moderation of submitted HTMLs, fraud detection, abuse reports, take-down flow. Those land if/when the gallery is publicly open.

## Other context worth knowing

- Hetzner box IP: `178.156.175.171`. Deploy via `infra/scripts/deploy.sh`.
- DNS via Cloudflare; certs via Let's Encrypt DNS-01 ACME (`infra/dns/`).
- Database: Neon Postgres. Drizzle ORM (`lib/db/schema.ts`).
- Auth: Auth.js v5 with email/password + OAuth providers. After login → `/new-v2`.
- Tailwind CSS v4 + custom design tokens in `app/new-v2/tokens.css` (scoped to `.workspace-v2`).
- `InariWatch` (memory: `openlen-vs-inariwatch-boundaries`) is a sister product — error monitoring. Different repo concerns; the `inari-` strings that remain in code are intentional (analytics, not branding).
