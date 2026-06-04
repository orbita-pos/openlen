# OpenLen — repo-level instructions for Claude Code

OpenLen is a landing-page builder. Users describe a page (or pick a template, or paste their own HTML), edit, and publish to `<sub>.openlen.com`. The repo runs as a Next.js app self-hosted on Hetzner — **never Vercel**. Brand was renamed from "Inari Pages" on 2026-05-16; `Inari Watch` is a separate sister product (monitoring, not pages), don't conflate.

## High-level structure

| Path | What lives here |
|---|---|
| `app/` | Next.js App Router pages + API routes |
| `app/new/` | The workspace — 3 entry paths (AI / Template / Paste) + editing + Deploy dropdown. The only workspace route (lives at `/new`; the old `/new-v2` path now redirects here via middleware). The React component dir stays `components/workspace-v2/` and the scoped CSS class stays `.workspace-v2` — only the URL/route is `/new`. |
| `app/projects/` | Project list view. "New" buttons route to `/new`. |
| `app/api/projects/[id]/publish/` | POST/DELETE — claim subdomain + write `project.data.html` to disk via `publishToDir`. |
| `app/api/projects/from-template/` | POST — clone a curated template's HTML into a new user project. |
| `app/api/projects/from-html/` | POST — accept raw HTML (typically from claude.ai), create project. |
| `app/api/generate/` | POST — free-form AI generation: one Gemini streaming call (system prompt from `lib/design-guidance.ts`) → a complete HTML document, saved as a new project. |
| `app/api/templates/ai-design/` | POST — conversational page editing (the Chat tab). Same Gemini engine as `generate`, but editing an existing page; Mode A ops / Mode B full rewrite. |
| `components/workspace-v2/` | V2 workspace UI — TopBar, LeftSidebar (tabbed panel), PreviewArea, panels for each mode. |
| `lib/templates/` | Template store — `store.ts` (server: list/get/upsert against DB + R2), `families.ts` (client-safe family types/metadata), `admin-schemas.ts` (Zod). Templates are DB-backed; add via `npm run templates:add`. |
| `lib/design-guidance.ts` | `DESIGN_GUIDANCE` — the distilled design system fed into both AI surfaces (`generate` + `ai-design`). |
| `lib/publish/filesystem.ts` | `publishToDir` — atomic write to `/var/www/openlen/<sub>/index.html`. |
| `infra/` | Hetzner deploy stack — nginx wildcard config, systemd unit, deploy.sh, bootstrap. |
| `templates/starter/` | In-repo starter pack — 3 template HTMLs + `manifest.ts`, seeded into DB/storage by `npm run templates:seed`. The full gallery is DB-backed (see Template gallery section). |
| `docs/claude-design-prompts.md` | Design-brief prompts for claude.ai Opus 4.7 — each produces 5 template HTMLs (32 prompts as of 2026-05-21). |

## Architecture invariants — do not break

1. **Templates are HTML files, not React components**. Each template is pure HTML (Tailwind CDN + Google Fonts inline) — its body lives in object storage, its metadata in Postgres. Do NOT port them to TSX — we tried, the user rejected it. Add a new one with `npm run templates:add` (see the Template gallery section); never by dropping files in the repo or editing a registry.
2. **Templates never claim subdomains**. Only user projects do, at publish time. `mirror.html` is inspiration; `<myco>.openlen.com` is what a user gets after cloning Mirror + clicking Deploy.
3. **Published output is static HTML**. `project.data.html` → `/var/www/openlen/<sub>/index.html` → nginx serves direct from disk. No React runtime, no Node hop on the user's published page. Tailwind via CDN is OK.
4. **`publishToDir` rejects HTML containing `data-slot-path=`** — a reserved editor-mode marker. The `from-html`, `from-template`, and `ai-design` paths reject it too (defense in depth) — it must never reach disk or the DB.

## Workspace V2 mental model

`/new` has an `EntryMode` state machine derived from URL params:

- `?` (no params) → `choosing` → EmptyState with 3 cards (AI / Template / Paste)
- `?mode=ai` → `ai` → renders the AI brief panel; on submit, `useGeneration` opens an SSE stream to `/api/generate` (one free-form Gemini call) and shows a live preview of the streaming HTML, then redirects to `?project=<id>` once the project is saved
- `?mode=template` → `template` → templates gallery in sidebar + preview-first commit flow in main area
- `?mode=paste` → `paste` → PastePanel in sidebar (textarea + title)
- `?project=<id>` → `editing` → workspace with TopBar Deploy, sidebar tabs, full preview

The sidebar locks tabs per entry mode — in an entry flow only the relevant tab is interactive; in `editing` every tab opens. Every project is a single flat HTML document: `data` is just `{ html }` (there is no slot-based project type — generation is free-form). The Content tab activates in-iframe editing (inline-edit + section reorder + asset replace); the Chat tab redesigns the page end-to-end via Gemini.

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

## Template gallery — DB-backed (since 2026-05-18)

Curated templates are **not individual files in the repo**, and there is **no `components/templates/_registry.ts`** (that file was deleted). The gallery is database-backed:

- **Metadata** in Postgres — the `templates` table (`id` = slug = PK; name/family/accent/pitch/description/mode/status + storage fields).
- **HTML bodies** in object storage — R2 in prod (public via `templates.openlen.com`), a local FS fallback in dev (`public/template-objects/`, gitignored). Object path: `templates/<id>-<contentHash>.html`.
- **Server store**: `lib/templates/store.ts` — `listTemplates`, `getTemplate`, `upsertTemplate`, `getTemplateHtml`, `archiveTemplate`.
- **Client-safe types**: `lib/templates/families.ts` — `TemplateFamily` union + `TEMPLATE_FAMILY_META` (zero node imports, safe to import from client components).
- **Zod schemas**: `lib/templates/admin-schemas.ts` — shared by the admin API routes and the CLIs.
- **Public API**: `GET /api/templates`, `GET /api/templates/[id]`. The `/new` gallery reads through these (`components/workspace-v2/use-templates.ts`).
- **In-repo starter pack**: `templates/starter/` — 3 HTMLs (mirror, manuscript, counter) + `manifest.ts`, uploaded by `npm run templates:seed` so a fresh clone boots with a non-empty gallery.

**Adding a template** — run the CLI, never touch the repo:

```bash
npm run templates:add -- <file.html> --id=<slug> --name="<Name>" --family=<slug> \
  --accent=#RRGGBB --mode=<dark|light|cream> --pitch="<hook>" --description="<sentence>" --status=published
```

It validates against `admin-schemas.ts` (rejects `data-slot-path=`), uploads the HTML to storage, and upserts the DB row. Do NOT drop `.html` files into `public/templates/curated/` and do NOT create a `_registry.ts` — neither registers anything; the gallery never sees them. Other CLIs: `templates:republish` (re-upload HTML after edits/renames), `templates:count` (verify DB + storage state).

**Adding a new family** — add the slug to BOTH the `FAMILY` z.enum in `lib/templates/admin-schemas.ts` AND the `TemplateFamily` union + `TEMPLATE_FAMILY_META` in `lib/templates/families.ts`. The DB `family` column is plain `text`, so no migration.

**Design briefs** for new templates live in `docs/claude-design-prompts.md` — prompts run in claude.ai (Opus 4.7), each producing 5 landing-page HTMLs that are then registered via `templates:add`.

Community-submitted templates (a moderated `community_templates` table layered on top of curated) remain a possible future feature — not built, don't build it speculatively.

**Design surface philosophy.** Customization happens in three places — the **Chat tab** for open-ended AI restyle, the **Content tab** for direct in-iframe text editing + section reorder + asset replace, and the inspector (`components/workspace-v2/panels/properties-panel.tsx`) for per-element properties + global theme controls (radius/font/accent). The Chat tab talks to `/api/templates/ai-design` (streaming SSE). AI generation runs on Gemini.

**The Canva-mode pivot was rolled back on 2026-05-24** — see [[canva-mode-decision]] memory for the full reasoning. Short version: the document-model engine (`lib/doc/*`) and the structured Canva inspector worked in principle but the conversion of polished HTML templates lost too much visual fidelity (animations, custom CSS, brand SVGs all stripped). User prefers the HTML visual quality. Everything related (`lib/doc/`, `components/workspace-v2/model/`, scripts/templates-convert-*, ai-edit endpoint, document-mode flag) was removed. The born-canonical normalizer (`lib/normalize.ts`) is the only ingestion path now — `from-html` + `from-template` + `generate` all produce plain HTML projects. **Do not propose Canva-mode revival without explicit user request.**

## Other context worth knowing

- Hetzner box IP: `178.156.175.171`. Deploy via `infra/scripts/deploy.sh`.
- DNS via Cloudflare; certs via Let's Encrypt DNS-01 ACME (`infra/dns/`).
- Database: Neon Postgres. Drizzle ORM (`lib/db/schema.ts`).
- Auth: Auth.js v5 with email/password + OAuth providers. After login → `/new`.
- Tailwind CSS v4 + custom design tokens in `app/new/tokens.css` (scoped to `.workspace-v2`).
- `InariWatch` (memory: `openlen-vs-inariwatch-boundaries`) is a sister product — error monitoring. Different repo concerns; the `inari-` strings that remain in code are intentional (analytics, not branding).
