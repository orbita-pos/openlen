# Deploy checklist — 3D v2 + curated models + motion

Everything is merged into `master` and builds clean. This is what's left to make it
live. Steps marked **(you)** need Cloudflare/env access; the rest are automated or a
single command.

## A. Cloudflare / R2 — curated 3D models  **(you)**
The model catalog stores GLBs on R2 and the runtime + poster fetch them cross-origin.
1. **Create R2 bucket** `openlen-models` (same account as `openlen-templates`/`openlen-images`).
2. **Public access + custom domain**: map `models.openlen.com` → the bucket (CNAME + R2 public domain), like `templates.openlen.com`.
3. **CORS on the bucket** — allow `GET` from your published origins:
   - `https://openlen.com`, `https://*.openlen.com` (published pages fetch the GLB live).
   - The poster bake runs on the box with `--disable-web-security` (already wired in `capture-screenshot.ts`), so it does **not** need a `null`-origin CORS entry.
   - Without CORS, live model scenes show only the poster (the gesture-load silently fails); shader + geometry scenes are unaffected.

## B. Env — Hetzner box + `.env.local`  **(you)**
`R2_ACCOUNT_ID` / `R2_ACCESS_KEY` / `R2_SECRET_KEY` are account-level and already set.
Add (only if you don't use the defaults — the defaults already match `openlen-models`/`models.openlen.com`):
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
