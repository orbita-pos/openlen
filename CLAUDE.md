# OpenLen — repo-level instructions for Claude Code

OpenLen is a landing-page builder. Users describe a page (or pick a template, or paste their own HTML), edit, and publish to `<sub>.openlen.com`. The repo runs as a Next.js app self-hosted on Hetzner — **never Vercel**. Brand was renamed from "Inari Pages" on 2026-05-16; `Inari Watch` is a separate sister product (monitoring, not pages), don't conflate.

## High-level structure

| Path | What lives here |
|---|---|
| `app/` | Next.js App Router pages + API routes |
| `app/new-v2/` | The workspace — 3 entry paths (AI / Template / Paste) + editing + Deploy dropdown. The only workspace route; legacy `/new` was retired and redirects here via middleware. |
| `app/projects/` | Project list view. "New" buttons route to `/new-v2`. |
| `app/api/projects/[id]/publish/` | POST/DELETE — claim subdomain + write `project.data.html` to disk via `publishToDir`. |
| `app/api/projects/from-template/` | POST — clone a curated template's HTML into a new user project. |
| `app/api/projects/from-html/` | POST — accept raw HTML (typically from claude.ai), create project. |
| `app/api/generate/` | POST — free-form AI generation: one Kimi K2.6 streaming call (system prompt from `lib/design-guidance.ts`) → a complete HTML document, saved as a new project. |
| `app/api/templates/ai-design/` | POST — conversational page editing (the Chat tab). Same Kimi K2.6 engine as `generate`, but editing an existing page; Mode A ops / Mode B full rewrite. |
| `components/workspace-v2/` | V2 workspace UI — TopBar, LeftSidebar (tabbed panel), PreviewArea, panels for each mode. |
| `components/templates/_registry.ts` | The 15 (eventually 30) curated templates registry. Adding a new template = one entry here + one `.html` file. |
| `lib/design-guidance.ts` | `DESIGN_GUIDANCE` — the distilled design system fed into both AI surfaces (`generate` + `ai-design`). |
| `lib/publish/filesystem.ts` | `publishToDir` — atomic write to `/var/www/openlen/<sub>/index.html`. |
| `infra/` | Hetzner deploy stack — nginx wildcard config, systemd unit, deploy.sh, bootstrap. |
| `public/templates/curated/` | The 15 curated landing HTMLs served directly to the workspace's template gallery. |
| `docs/claude-design-prompts.md` | 6 prompts for claude.ai Opus 4.7 that generate 5 templates each. |

## Architecture invariants — do not break

1. **Templates are HTML files, not React components**. The 15 in `public/templates/curated/` are pure HTML (Tailwind CDN + Google Fonts inline). Do NOT port them to TSX — we tried, the user rejected it. Adding more = drop `.html` + register entry.
2. **Templates never claim subdomains**. Only user projects do, at publish time. `mirror.html` is inspiration; `<myco>.openlen.com` is what a user gets after cloning Mirror + clicking Deploy.
3. **Published output is static HTML**. `project.data.html` → `/var/www/openlen/<sub>/index.html` → nginx serves direct from disk. No React runtime, no Node hop on the user's published page. Tailwind via CDN is OK.
4. **`publishToDir` rejects HTML containing `data-slot-path=`** — a reserved editor-mode marker. The `from-html`, `from-template`, and `ai-design` paths reject it too (defense in depth) — it must never reach disk or the DB.

## Workspace V2 mental model

`/new-v2` has an `EntryMode` state machine derived from URL params:

- `?` (no params) → `choosing` → EmptyState with 3 cards (AI / Template / Paste)
- `?mode=ai` → `ai` → renders the AI brief panel; on submit, `useGeneration` opens an SSE stream to `/api/generate` (one free-form Kimi K2.6 call) and shows a live preview of the streaming HTML, then redirects to `?project=<id>` once the project is saved
- `?mode=template` → `template` → templates gallery in sidebar + preview-first commit flow in main area
- `?mode=paste` → `paste` → PastePanel in sidebar (textarea + title)
- `?project=<id>` → `editing` → workspace with TopBar Deploy, sidebar tabs, full preview

The sidebar locks tabs per entry mode — in an entry flow only the relevant tab is interactive; in `editing` every tab opens. Every project is a single flat HTML document: `data` is just `{ html }` (there is no slot-based project type — generation is free-form). The Content tab activates in-iframe editing (inline-edit + section reorder + asset replace); the Chat tab redesigns the page end-to-end via Kimi K2.6.

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

**Curated stays in repo. Community is additive — never a replacement.**

The ~50 curated templates (Mirror, Anchor, Foundry, Counter, … and whatever else lands by PR) live as `.html` files in `public/templates/curated/` + entries in `components/templates/_registry.ts`. They ship with `git clone`, they survive deploys without a DB seed, and they're the "out of the box" gallery a self-hoster sees on first boot. Do NOT propose moving curated templates to the database — the user has explicitly chosen the in-repo path to keep the OSS self-host story simple and to keep template design under PR review. Curated grows via PR ("a contributor writes a beautiful Vercel-style page, owner reviews, merges"). Community contributions, if/when that feature ships, layer ON TOP of curated via the DB schema below.

Current state: 15-30 templates live as a static `TEMPLATES` array in `components/templates/_registry.ts` + matching `.html` files in `public/templates/curated/`. `TemplatePreviewFrame` lazy-mounts each card's iframe via IntersectionObserver, so the in-memory list scales further than the visible viewport. Don't add infinite scroll or DB-backed templates "just in case" — both are real features tied to specific triggers below.

**Trigger 1 — Scanning feels slow** (~30+ templates, when scrolling the sidebar to find the right one becomes annoying):
- Add a search bar at the top of `TemplatesPanel` — client-side filter over `TEMPLATES` by name/pitch/tags. ~1 hour. No backend changes.

**Trigger 2 — Open user contributions** (when community-submitted templates become a planned feature):
- New table `community_templates` in Postgres: `id`, `ownerUserId`, `title`, `family`, `html`, `status` (`draft` | `pending_review` | `approved` | `rejected`), `createdAt`, `approvedAt`. Drizzle schema goes in `lib/db/schema.ts`.
- New endpoint `GET /api/templates?cursor=<id>&limit=N&family=<f>&q=<search>` — cursor-based pagination, only returns `status = approved`.
- New endpoint `POST /api/templates/submit` for users to submit their own; `POST /api/templates/<id>/approve` for moderation.
- `TemplatesPanel` reads via a `useTemplates({ source: "all" })` hook that internally concatenates `[...CURATED, ...await fetchCommunity({ cursor })]`. Infinite scroll lives on the community half only — curated is always fully loaded (it's a small in-memory array). Cards don't care which source they came from.
- The curated set in `_registry.ts` stays the canonical "official" gallery, **not migrated to DB**. Each self-host instance decides whether to enable the community endpoint at all — a minimalist self-host can ship with curated only and never touch the community table.
- Optional `tier: "free" | "pro"` field on `TemplateEntry` to gate certain curated designs behind a paywall (still in-repo, just rendered as locked in the UI for non-pro users). Premium curated stays in repo for the OSS+freemium model.

**What stays in DB regardless** (orthogonal to where templates live):
- `template_clone_events` for analytics (which templates get cloned, when, by whom). Logged in `from-template` route handler — no need to move the templates themselves to DB to get usage data.

**Out of scope for both triggers**: AI moderation of submitted HTMLs, fraud detection, abuse reports, take-down flow. Those land if/when the gallery is publicly open.

**Design surface philosophy.** Customization of a project's design happens exclusively in the **Chat tab** (`components/workspace-v2/panels/chat-panel.tsx`). It routes to the `AIDesignChat` sub-component which talks to `/api/templates/ai-design` (Kimi K2.6 streaming SSE). No swatches, no font dropdowns, no vibes, no variations, no manual controls of any kind. Kimi receives the full current HTML + the user's request and streams back a complete new page (reasoning text + new HTML). The AI has full creative freedom — token tweaks, section rewrites, full restructuring are all in scope per request. The Content tab is a separate surface — direct in-iframe text editing, section reorder, and asset replace — not design controls.

Architecturally: don't add manual controls back. Don't introduce "quick presets" or vibe cards. Don't add a parallel design-controls panel. The user explicitly rejected those after we shipped a token-diff prototype — that approach treated AI as a glorified color picker and was the wrong tier of ambition for the 2026 positioning. Chat is the surface. If users want shortcuts, the chat has quick-prompt chips that fill the input.

## Other context worth knowing

- Hetzner box IP: `178.156.175.171`. Deploy via `infra/scripts/deploy.sh`.
- DNS via Cloudflare; certs via Let's Encrypt DNS-01 ACME (`infra/dns/`).
- Database: Neon Postgres. Drizzle ORM (`lib/db/schema.ts`).
- Auth: Auth.js v5 with email/password + OAuth providers. After login → `/new-v2`.
- Tailwind CSS v4 + custom design tokens in `app/new-v2/tokens.css` (scoped to `.workspace-v2`).
- `InariWatch` (memory: `openlen-vs-inariwatch-boundaries`) is a sister product — error monitoring. Different repo concerns; the `inari-` strings that remain in code are intentional (analytics, not branding).
