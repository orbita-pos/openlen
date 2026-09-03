# OpenLen — repo-level instructions for Claude Code

OpenLen is a landing-page builder. Users describe a page (or pick a template, or paste their own HTML), edit, and publish to `<sub>.<publish host>` — the host is `PUBLISH_BASE_HOST`, and **production has been `openlen.app` since 2026-08-23** (`*.openlen.com` and `*.openlen.app` serve the same folders; `.app` is a separate browser origin, which is the point). Never hardcode either — `lib/publish/base-host.ts` is the single source. The repo runs as a Next.js app self-hosted on Hetzner — **never Vercel**. Brand was renamed from "Inari Pages" on 2026-05-16; `Inari Watch` is a separate sister product (monitoring, not pages), don't conflate.

## High-level structure

| Path | What lives here |
|---|---|
| `app/[locale]/` | **Every user-facing route** — next-intl, 10 locales (`en es pt fr de it ja ko zh nl`), `localePrefix: "always"`, so there is no unprefixed `/new`. `app/api/`, `app/c/` (analytics beacon), `app/p/` (preview link) and `app/served/` (custom domains) sit OUTSIDE the locale segment. |
| `app/[locale]/new/` | The workspace — the only one (`/new-v2` redirects here in `middleware.ts`). The React dir stays `components/workspace-v2/` and the scoped CSS class stays `.workspace-v2`; only the URL is `/new`. `page.tsx` is ~3.5k lines and holds the URL state machine. |
| `app/[locale]/projects/` | Project list view. Inside the workspace the same list is `/new?view=projects`. |
| `app/api/projects/[id]/publish/` | POST/DELETE — claim subdomain + `publishToDir`. It writes a whole **release tree**, not one file: `index.html`, `<locale>/index.html` per translated variant, `<slug>/index.html` per site page, `protected/<sha>/<slug>/index.html` for gated pages, plus sitemap/robots — then swaps it in atomically. |
| `app/api/projects/from-template/` | POST — clone a curated template's HTML into a new user project. |
| `app/api/projects/from-html/` | POST — accept raw HTML (typically from claude.ai), create project. |
| `app/api/generate/` | POST — free-form AI generation → a complete HTML document, saved as a new project. The writer is whatever `lib/generation/model-policy.ts` maps its operation to — **read the table, never a model name written here**. And it is **not one call** — write → retry/repair-pass → vision critic (the `visualCritic` role; informs only unless `OPENLEN_VISION_CRITIC_REGEN=1`) → **one call and one credit per declared subpage**. |
| `app/api/templates/ai-design/` | POST — conversational page editing; Mode A ops / Mode B full rewrite. It writes through the `page_edit` operation (or `page_write_with_reference` when the turn carries an image) — see `model-policy.ts`. ⚠️ **No longer what the Chat tab calls by default** — see `/api/agent` below; this is the opt-out path. |
| `app/api/agent/` | POST — **the Agent (Len), and what the Chat tab actually talks to.** A tool-calling loop (`lib/agent/loop.ts`) that edits the page, reads and writes the business profile, searches photos, and VERIFIES its own work by rendering the page and looking at the screenshot. Kill switch: `OPENLEN_AGENT=0` refuses, and the client falls back to `ai-design` for the rest of the session. |
| `components/workspace-v2/` | The workspace UI — `top-bar.tsx`, `left-sidebar.tsx`, `preview-area.tsx`, `start-landing.tsx` (the entry screen), `rail-model.ts` (the unified navigation rail), `status-bar.tsx`, and `panels/` — one panel per surface. |
| `lib/templates/` | Template store — `store.ts` (server: list/get/upsert against DB + R2), `families.ts` (client-safe family types/metadata), `admin-schemas.ts` (Zod). Templates are DB-backed; add via `npm run templates:add`. |
| `lib/design-guidance.ts` | `DESIGN_GUIDANCE` (~51 KB) and the `PUBLISH_CONTRACT` slice cut from it. ⚠️ **What `generate` actually sends is the MINIMUM contract** (`lib/publish-contract-min.ts`, ~7 KB): `OPENLEN_MIN_CONTRACT` is opt-OUT, only the literal `"0"` restores the full one. Reading `DESIGN_GUIDANCE` and assuming that is the prompt is wrong by ~85%. |
| `lib/publish/filesystem.ts` | `publishToDir` — builds the release tree under `/var/www/openlen/<sub>/` and swaps it in atomically. `PUBLISH_ROOT` overrides the root (tests point it at a tmp dir). |
| `infra/` | Hetzner stack — **Caddy** is the web tier (`infra/caddy/Caddyfile`): apex reverse-proxies to Next on :3000, `*.openlen.com` + `*.openlen.app` serve `/var/www/openlen/<sub>/` off disk. `infra/nginx/` is the PRE-cutover legacy, kept for reference — do not edit it expecting an effect. Also systemd units + timers (`infra/app/`), DB box (`infra/db/`), DNS, runbooks. |
| `crates/` | The Rust layer, real and load-bearing: `html-engine` (the ops/sanitize/normalize engine behind `lib/html-engine.ts`), `ai-gateway`, `images`, `rate-limit`, `edge`. They compile to `.node` bindings — the deploy's atomic swap wipes them, which is why `deploy.ps1` rebuilds them on the box. |
| `lib/agent/` | **Len, the agent** — `loop.ts` + `brain.ts` (the `agent` role — the only role with turn-to-turn continuity) + `catalog.ts` (the tool declarations) + `verify.ts` (the eyes: renders the page and looks at it, on the `visualCritic` role). ⚠️ The eyes are TWO checks, not one: a vision call on the screenshot, plus a DETERMINISTIC pass in `lib/ai/visual-quality-renderer.ts` (JS in Chromium, no model, no credit) that measures contrast, mobile overflow and JS errors. ⚠️ Since 2026-09-02 the contrast is **read off the pixel** — the text is blanked, one PNG is captured, and `lib/ai/png-crudo.ts` → `lib/ai/contraste.ts` do the decoding and the judging in Node — it is no longer deduced from CSS. The two CSS walks survive INSIDE that same pass as a per-candidate FALLBACK. Proposing "fix the CSS walk" for a wrongly-measured background is looking at the wrong place. Reached through `POST /api/agent`. |
| `templates/starter/` | In-repo starter pack — 3 template HTMLs + `manifest.ts`, seeded into DB/storage by `npm run templates:seed`. The full gallery is DB-backed (see Template gallery section). |
| `docs/claude-design-prompts.md` | Design-brief prompts for claude.ai — each produces 5–6 template HTMLs. **40 prompts** as of 2026-08-27 (`grep -c '^## Prompt'`), not the 32 this line used to claim. |

## Architecture invariants — do not break

1. **Templates are HTML files, not React components**. Each template is pure HTML (Tailwind CDN + Google Fonts inline) — its body lives in object storage, its metadata in Postgres. Do NOT port them to TSX — we tried, the user rejected it. Add a new one with `npm run templates:add` (see the Template gallery section); never by dropping files in the repo or editing a registry.
2. **Templates never claim subdomains**. Only user projects do, at publish time. `mirror.html` is inspiration; `<myco>.<publish host>` is what a user gets after cloning Mirror + clicking Deploy.
3. **The published DOCUMENT is static HTML**. `project.data.html` → `/var/www/openlen/<sub>/…` → **Caddy** serves it straight off disk. No React runtime and no Node in the render path; Tailwind via CDN is OK. ⚠️ **"No Node hop" is no longer absolute**: the published page calls back for the backend features — `/c/*` (analytics beacon), `/api/f/*` (form submissions), `/api/chat/*` — which Caddy reverse-proxies to Next from inside the same wildcard block. The page RENDERS without Node; it INTERACTS with it.
4. **`publishToDir` rejects HTML containing `data-slot-path=`** — a reserved editor-mode marker. The `from-html`, `from-template`, and `ai-design` paths reject it too (defense in depth) — it must never reach disk or the DB. The OTHER editor marker, `data-op-id`, is **stripped, not rejected** (`stripOpIds`): a slot-path means the document came from a pipeline that no longer exists, while an op-id is an inert attribute on an otherwise correct page — rejecting it would punish the user for an upstream bug of ours.

## Workspace V2 mental model

`/new` derives its state from URL params. `EntryMode` is
`"ai" | "template" | "paste" | "editing"` — **there is no `choosing` state and no
3-card chooser screen**; that was replaced by the start landing.

- **no params** → `ai` → lands straight in the brief (`start-landing.tsx`). Template and Paste are reached from the sidebar tabs, not from a chooser.
- `?mode=template` / `?mode=paste` → that guided flow.
- `?project=<id>` → `editing` → the full workspace.
- `?view=` picks what the CENTER renders, with a project open or without: `projects` · `explore` · `templates` · `business` · `messages` · `modulos` · `marketing` · `resultados` (`analytics` is its old alias). Absent = the page canvas.
- `?page=<slug>` picks WHICH site page the canvas shows (multi-page).

On submit `useGeneration` opens an SSE stream to `/api/generate`, shows the HTML as it streams, and redirects to `?project=<id>` once saved.

The sidebar locks tabs per entry mode — in an entry flow only the relevant tab is interactive; in `editing` every tab opens. A project is flat HTML: `data.html` is the Home, plus `data.pages` (slug → `SitePage`) when the site has more pages. There is no slot-based project type — generation is free-form. The Content tab activates in-iframe editing (inline-edit + section reorder + asset replace); the Chat tab redesigns the page end-to-end.

## Commands

```bash
npm run dev               # local dev — next dev --turbopack, DB from .env.local
npm run build             # standalone build (next.config has output: "standalone")
npm run typecheck         # tsc --noEmit — run before committing
npm test                  # vitest run
npm run test:node         # the suites that need the native Rust binding (node:test, NOT vitest)
npm run deploy:prod       # infra/scripts/deploy.ps1
```

⚠️ **`infra/scripts/deploy.sh` does not exist** and there is no rsync anywhere.
The real deploy is PowerShell: build → migrate → compose standalone → tar → scp →
extract to a staging dir → systemd stop → atomic mv → start → smoke. The swap
wipes `node_modules/@openlen/*`, so it rebuilds the Rust crates on the box.

**`npm test` is not the whole suite**: vitest's `include` is a WHITELIST, and the
suites exercising the native binding run under `npm run test:node`.

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

**Design briefs** for new templates live in `docs/claude-design-prompts.md` — prompts run in claude.ai, each producing 5–6 landing-page HTMLs that are then registered via `templates:add`. Related brief files sit beside it (`claude-section-prompts.md`, `claude-layout-variant-prompts.md`, per-family design briefs and image prompts).

Community pages **are built**, just not the way this file predicted: there is no `community_templates` table. **Explore** (`/explore`, `app/api/explore/`, `lib/community/`) lists ordinary `projects` rows with `visibility = "public"` and `status = "published"`, joined to the author's `users.handle` — a published page becomes public, it does not become a template. Public profiles live at `/[handle]`, and remixing is counted on `projects.remixCount`.

**Design surface philosophy.** The three original surfaces are the **Chat tab** (open-ended AI editing), the **Content tab** (in-iframe text editing + section reorder + asset replace), and the **inspector** (`panels/properties-panel.tsx` — per-element properties + global radius/font/accent). ⚠️ **"Three places" undersells it now**: `components/workspace-v2/panels/` also holds modules, collections, site-pages, images, versions, submissions and insights panels, each a real surface.

**The Chat tab talks to `/api/agent`, not `ai-design`** — the agent graduated and is the default; `ai-design` is the opt-out. Reading the older comment at the top of `chat-panel.tsx` and believing it is a known trap.

**Who runs what — `lib/generation/model-policy.ts` IS the answer, and it is a table.** Four roles (`reasoner`, `designer`, `visualCritic`, `agent`); every surface names an OPERATION and the table picks the role, the model and the reasoning effort. 🔴 **Never restate a model name in this file** — that is exactly how the previous version of this line went stale and then misled a session into "reasoning" from it instead of from the code. Read the table.

**Gemini is OUT — of all four roles, since 2026-08-28.** Everything runs on Fireworks. The three provider switches (`OPENLEN_GENERATE_PROVIDER`, `OPENLEN_CHAT_PROVIDER`, `OPENLEN_AGENT_PROVIDER`) were deleted with it, as were `OPENLEN_AGENT_EYES=gemini` and `OPENLEN_CREATE_EYES=gemini` — not kept switched off, deleted, because a lever pointing at nothing reads as an alternative that exists. The Rust `ai-gateway` crate has no Gemini transport at all. ⚠️ **Four surfaces outside the policy table still hardcode `gemini-*` default model strings** — `lib/imagery/photograph.ts`, `lib/publish/localize.ts`, `lib/style-match/autofill/fill-from-page.ts`, `app/api/assistant/[sub]/route.ts`. They are leftovers of the cleanup (each rolls its own default instead of asking the table), NOT evidence that Gemini is still wired.

**The Canva-mode pivot was rolled back on 2026-05-24** — see [[canva-mode-decision]] memory for the full reasoning. Short version: the document-model engine (`lib/doc/*`) and the structured Canva inspector worked in principle but the conversion of polished HTML templates lost too much visual fidelity (animations, custom CSS, brand SVGs all stripped). User prefers the HTML visual quality. Everything related (`lib/doc/`, `components/workspace-v2/model/`, scripts/templates-convert-*, ai-edit endpoint, document-mode flag) was removed. The born-canonical normalizer (`lib/normalize.ts`, `normalizeBornCanonical`) is the ingestion path — `from-html` + `from-template` + `generate` all produce plain HTML projects, and `lib/projects.ts` runs it on the way in. Downstream of it, `lib/page-engine/` is the shared pipeline (prepare → apply edits → persist) used by create, edit and the Agent alike. **Do not propose Canva-mode revival without explicit user request.**

## Other context worth knowing

- Hetzner box IP: `178.156.175.171`. Deploy with `npm run deploy:prod` (`infra/scripts/deploy.ps1`) — **there is no `deploy.sh`**.
- DNS via Cloudflare; certs via Let's Encrypt DNS-01 ACME (`infra/dns/`).
- Database: **self-hosted Postgres on the Hetzner box** (migrated off Neon). `lib/db/index.ts` picks the driver from `DATABASE_URL`: `*.neon.tech` → the Neon HTTP driver, anything else → `pg` with a real pool. Drizzle ORM (`lib/db/schema.ts`).
- Auth: Auth.js v5 with email/password + OAuth providers; the sign-in page is `/login`. After login → `/new` (locale-prefixed like everything else).
- Tailwind CSS v4 + custom design tokens in `app/[locale]/new/tokens.css` (scoped to `.workspace-v2`).
- `InariWatch` (memory: `openlen-vs-inariwatch-boundaries`) is a sister product — error monitoring. Different repo concerns; the `inari-` strings that remain in code are intentional (analytics, not branding).
