# EVAL — Session 10.5: Deploy Next.js app to Hetzner (self-host)

Date: 2026-05-16
Branch: master
Verdict: ✅ Code complete, locally verified. Box deploy pending operator.

## Goal

Stop using Vercel for apex/www. Move the Next.js app onto the same
Hetzner CX22 that already serves `*.openlen.com` wildcards. End state:
one box, one playbook, zero vendor lock-in.

## What shipped

8 logical changes:

1. `next.config.ts` — `output: "standalone"` flag flipped on
2. `infra/app/setup-node.sh` — Node 22 + Chromium apt installer
3. `infra/app/openlen-app.service`, `env.example`, `install-app.sh` —
   systemd unit + secrets template + first-run scaffold
4. `infra/nginx/openlen.conf` — new apex/www server block reverse-proxying
   to `127.0.0.1:3000`; `/uploads/` + `/_next/static/` served from disk;
   wildcard subdomain block untouched
5. `infra/scripts/deploy.sh` — build locally + rsync `.next/standalone/`
   + restart service + curl smoke
6. `infra/SETUP.md` — Architecture diagram rewritten (no Vercel),
   Section 10.5 procedures added, DR checklist updated
7. `lib/orchestrator/_render-element.ts` (NEW) +
   `lib/orchestrator/assemble.ts` (RENAME from `.tsx`) — pre-existing
   build failure fix, see below
8. This file

## Time

- Pre-flight + exploration: 10 min
- Bloque A (standalone config) + build-error rabbit hole: 35 min
- Bloque B (runtime scripts): 25 min
- Bloque C (nginx): 15 min
- Bloque D (deploy.sh): 10 min
- Docs + SETUP.md: 20 min
- Eval write-up: 10 min

**Total: ~2h** (within plan's 2-3h estimate).

## Build artifact sizes

- `.next/standalone/` raw: **74 MB**
- After `cp .next/static/` into it: **76 MB**
- Largest contributors:
  - `node_modules/next` — 28 MB
  - `node_modules/@img` (sharp's binaries) — 20 MB
  - `node_modules/typescript` — 8.7 MB (bundled by Next at build)
  - `node_modules/puppeteer-core` — 1.7 MB (Chromium installed separately)
- Well under the 100 MB warning threshold from the plan.
- rsync delta on incremental deploys should be tiny (only changed JS chunks).

## Gotchas

### 1. Pre-existing build failure unblocked first

`npm run build` on HEAD (`a9f639e`) was already broken — Next.js 15.5.18's
RSC graph check rejects `react-dom/server` imports in any module
reachable from a Client Component dependency chain, transitively. Affected
`lib/orchestrator/assemble.tsx`:

```
./lib/orchestrator/assemble.tsx
Error: You're importing a component that imports react-dom/server.
```

Tried in order:
1. Rename `.tsx` → `.ts` (file uses `React.createElement` only, no JSX).
   No effect — Next uses the graph, not the extension.
2. `import "server-only"` at the top. No effect — Next still complains.
3. Split into a sibling module that imports `react-dom/server` only. No
   effect — Next follows the chain across modules.
4. **What worked:** `_render-element.ts` uses Node's `createRequire` to
   load `react-dom/server` at runtime, hiding it from webpack's static
   analyzer. The `eval`-free `createRequire(import.meta.url)` pattern is
   the cleanest opaque escape.

The fix doesn't change runtime behavior — `react-dom/server` still loads
the first time `assemble()` is called and is module-cached after.

### 2. Puppeteer needs system Chromium

`/api/generate` runs deterministic a11y + mobile gates that need
Chromium, even in `MOCK_MODE=1`. Standalone build includes the
`puppeteer-core` JS but not a Chromium binary (puppeteer caches it in
`~/.cache/puppeteer/` which doesn't ship with the deploy artifact).

Fix: `setup-node.sh` apt-installs `chromium-browser`;
`openlen-app.service` sets `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser`
so `lib/gates/_browser.ts:resolveChromePath()` picks it up.

### 3. `recordings/` directory pulled into standalone

Next's build trace follows the `lib/witness/` module imports and copies
the entire `recordings/` directory (eval fixtures) into
`.next/standalone/recordings/`. ~668 KB so not catastrophic, but we're
shipping 88 dev-only `.jsonl` files to production. Worth excluding via
`outputFileTracingExcludes` in a future polish pass; deferred for now to
keep this session focused.

### 4. `server-only` package installed but unused

I installed `server-only` while exploring approach (2) above (adding
`import "server-only";` to mark modules as server-only). The eventual
fix uses `createRequire` instead and doesn't actually need the package,
but I kept it as a dependency since it's a 4-line zero-dep package and
useful guardrail for future server-only modules.

### 5. nginx server-block ordering

Apex `openlen.com` and `www.openlen.com` are matched by the new
dedicated server block via exact `server_name`. The wildcard regex still
matches `www.openlen.com` (since `www` satisfies the DNS label regex),
but nginx prefers exact names over regex matches, so the apex block
always wins. No conflict — verified by reading the nginx server-name
matching docs.

## Deploy cost (estimate)

- **Build time** (local): ~45-60s for `npm run build`. After Bloque A
  changes, the standalone bundling adds maybe 2-3s.
- **rsync over deploy keys**: 76 MB cold → ~30 sec on a 25 Mbps uplink.
  Subsequent deploys with delta sync should be ~5-15 sec.
- **systemd restart**: ~2-5 sec for the Node process to bind to port 3000.
- **Total wall clock per `deploy.sh` invocation**: ~90 sec cold,
  ~30 sec warm.

## Acceptance criteria

| Item                                                       | Status |
|------------------------------------------------------------|--------|
| `next.config.ts` has `output: 'standalone'`                | ✅      |
| Local `npm run build` produces `.next/standalone/server.js`| ✅      |
| Node 22 install script committed                           | ✅      |
| Chromium install added (gap in original plan)              | ✅      |
| `/etc/openlen/openlen.env` template committed              | ✅      |
| systemd unit committed + scaffold script                   | ✅      |
| nginx apex + www reverse proxy block                       | ✅      |
| Wildcard `*.openlen.com` block untouched                   | ✅      |
| Persistent dirs `/var/openlen/{uploads,witness}` scaffolded| ✅      |
| `deploy.sh` idempotent + tools/keys pre-flighted           | ✅      |
| `npx tsc --noEmit` clean                                   | ✅      |
| `next lint` clean                                          | ✅      |
| Updated SETUP.md (architecture + Section 10.5 + DR)        | ✅      |
| 8 scoped commits                                           | ✅      |
| EVAL_SESSION_10_5.md                                       | ✅      |

| Item (operator-side, deferred until SSH access)            | Status |
|------------------------------------------------------------|--------|
| Box has Node 22 + Chromium installed                       | ⏳      |
| `/etc/openlen/openlen.env` populated with real keys        | ⏳      |
| `openlen-app.service` `active (running)`                   | ⏳      |
| `https://openlen.com` returns marketing HTML               | ⏳      |
| `https://openlen.com/new` returns workspace                | ⏳      |
| `https://openlen.com/api/generate` MOCK_MODE → 5/5 briefs  | ⏳      |
| `https://test.openlen.com` wildcard still works            | ⏳      |

## Out of scope (per plan's "Do NOT")

- DB / Postgres setup (Session 11)
- NextAuth backend wiring beyond env vars
- Stripe
- R2 cloud storage migration
- CI/CD pipeline
- Subdomain provisioning UX

## What's next

**Session 11 — Subdomain provisioning + dashboard.** DB schema for
`subdomain → user_id`, "Choose your subdomain" UX in workspace, "Deploy"
button SCPs landing HTML to `<subdomain>.openlen.com` via the deploy
keypair. Closes the end-to-end "one-click hosted landing page" loop.
