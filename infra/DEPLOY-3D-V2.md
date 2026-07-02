# Deploy checklist — 3D v2 + curated models + motion

> **v2.1 addendum (2026-07-01).** The premium-polish branch adds: GLB optimization at
> ingest (meshopt+WebP), auto-thumbnails, brand-accent lights, context-loss recovery,
> per-model curated presentation, 3 new decoratives + crystal/gyre regens (catalog = 10),
> and a shader-lite runtime (shader-only pages ship ~8KB instead of three.js; kill-switch
> `OPENLEN_3D_LITE=0` on the box reverts to the full bundle). Deploy notes:
> - Re-run `npm run models:seed` after deploying v2.1 — it re-uploads all GLBs
>   **optimized** (-58% to -75%), generates **thumbnails**, applies curated sceneSpecs,
>   and adds the 3 new models. Idempotent; old storage objects stay (published pages
>   keep working).
> - No new env vars required. No new migration (same `models` table).

Everything is merged into `master` and builds clean. This is what's left to make it
live. Steps marked **(you)** need Cloudflare/env access; the rest are automated or a
single command.

## A. Cloudflare / R2 — CORS on the images bucket  **(you)** — Option B (default)
The model GLBs default to the **existing `openlen-images` bucket** (`images.openlen.com`)
under a `models/` key prefix — **no new bucket or DNS needed** (R2 account + this bucket +
DNS already exist and serve images/motion). The ONLY thing to add:
- **CORS on the `openlen-images` bucket** — allow `GET` from `https://openlen.com` +
  `https://*.openlen.com`. `GLTFLoader` fetches the GLB with `fetch()` (needs CORS), unlike
  `<img>`/`<video>` which do NOT use CORS — so adding this rule does **not** affect the
  existing images or the motion videos. Without it, live model scenes show only the poster
  (gesture-load fails silently); shader + geometry scenes are unaffected.
- The poster bake runs on the box with `--disable-web-security` (wired in
  `capture-screenshot.ts`), so it does not need a `null`-origin CORS entry.

Alternative (dedicated bucket): create `openlen-models` + `models.openlen.com` DNS + set the
env in B. Not required.

## B. Env — Hetzner box  **(you)**
`R2_ACCOUNT_ID` / `R2_ACCESS_KEY` / `R2_SECRET_KEY` are account-level and already set.
**Nothing to add for Option B** — the code defaults to `openlen-images` /
`https://images.openlen.com` (both the storage adapter AND the SSRF guard). Only set these if
you chose the dedicated-bucket alternative:
```
R2_MODELS_BUCKET=openlen-models
R2_MODELS_PUBLIC_URL=https://models.openlen.com
```
`R2_MODELS_PUBLIC_URL` MUST equal the SSRF-guard origin — keep them identical.

## C. Deploy
```
bash infra/scripts/deploy.sh      # or: npm run deploy:prod (deploy.ps1)
```
- `deploy.ps1` now runs `billing:migrate` **and** `models:migrate` (both scoped + idempotent, `CREATE TABLE/INDEX IF NOT EXISTS`) before the swap. No manual migration needed.
- Motion assets are already on R2 + the manifest is committed → the "By OpenLen Motion" picker works after deploy.
- Reminder (known gotcha): the systemd unit is not auto-applied by deploy — apply unit changes manually if any.

## D. Post-deploy — seed the model catalog  **(one time, after A + C)**
```
npm run models:seed
```
Uploads the 7 starter GLBs (2 Khronos objects + 5 procedural decorative) to R2 and inserts
their rows. Re-runnable (content-hash upsert). The "Modelos" picker is empty until this runs.

## E. Optional — Gemini live AI generation  **(you, later)**
3D scene generation works today on the free **mock** provider (nearest golden). For real
AI generation from a text brief:
1. Recharge the Gemini prepaid key (ai.studio).
2. Set `OPENLEN_3D_PROVIDER=gemini` on the box.
3. Run the deferred live check (`npm run 3d:generate-smoke` or generate from the panel).
Pro-gated + 3 credits/scene when live.

## What's already done (no action)
- 5 original registers + workspace 3D panel + hero-backdrop + Born-100 (100/100/100/100).
- 7 shader registers (gradient/fluid/aurora/plasma/ember/dots/silk).
- Curated-model family: runtime GLB loader, catalog (table + R2 + store + CLI + APIs), panel picker, 7 starter models.
- All reviewed (publish-safety SAFE-TO-MERGE-AND-DEPLOY; adversarial integration SHIP after fixes).
