# Deploy + live-smoke runbook

Single Hetzner box (Caddy → Next standalone via `openlen-app.service`). There is
**no separate staging environment** — `npm run deploy:prod` ships to the live
`openlen.com`; the `-staging` dir it uses is just an atomic-swap buffer on the
same box. Recommended posture: **ship the free beta first**, turn on payments
(Polar) only after Phase 2 below passes.

---

## 0 · Pre-flight — env vars on the box (`/etc/openlen/openlen.env`)

Edit, then `systemctl restart openlen-app`. Full reference: `infra/app/env.example`.

**Required for the free beta (Phase 1):**
- `DATABASE_URL` — Postgres on the box itself
  (`postgresql://openlen_app@127.0.0.1:5432/openlen`). Neon was retired
  2026-07-19; a `*.neon.tech` URL still switches drivers, so never paste one
  back in expecting the pool.
- `NEXTAUTH_SECRET` — `openssl rand -base64 32`
- `NEXTAUTH_URL=https://openlen.com`
- **`FIREWORKS_API_KEY`** — THE AI credential, and the only one generation
  needs. Both writing roles are Fireworks: DeepSeek writes the HTML, Qwen
  takes the turns that carry an attached image. Without it Create, Chat and
  the Agent refuse BEFORE opening the stream, naming the variable
  (`lib/ai/turn-credentials.ts`).
- **`OPENAI_API_KEY`** — instruction-based image editing only (gpt-image-2:
  the Replace modal + the Agent's `editar_imagen`). Without it that feature
  returns 503 `ai_unavailable`; everything else keeps working. Prepaid — an
  empty balance looks exactly like a missing key.
- `RESEND_API_KEY` + `EMAIL_FROM` — email. ⚠️ The `EMAIL_FROM` domain
  (`openlen.com`) **must be verified in Resend** or sends throw and the lead is
  saved but no email arrives (silent — by design the visitor still sees success).

**Phase 2 (enable later):**
- `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_ID/SECRET` — OAuth login
- `POLAR_SERVER=sandbox` + `POLAR_ACCESS_TOKEN` + `POLAR_PRODUCT_PRO_ID` +
  `POLAR_WEBHOOK_SECRET` — billing. Keep `sandbox` until Phase 2 passes; flip to
  `production` only to take real money. Webhook URL in Polar:
  `${NEXTAUTH_URL}/api/billing/webhook` (format: Raw).
- `GITHUB_DEPLOY_*`, `VERCEL_*` — Deploy-dropdown export targets
- `R2_*` (assets), `CLOUDFLARE_ZONE_ID/API_TOKEN` (publish cache purge)
- **`BROADCAST_POSTAL_ADDRESS`** — CAN-SPAM postal address stamped into every
  Broadcast email. The Send route returns 503 until this is set (required only
  to use the Broadcast module).
- **`OPENLEN_INTERNAL_SECRET`** — machine-to-machine secret for the datos-vivos
  hourly refresh (`POST /api/internal/live-republish`, localhost-only). Generate
  with `openssl rand -base64 32`. The route is **fail-closed**: unset ⇒ every
  call 401s and the hourly Sheet refresh never runs (pages freeze at
  last-publish values). After setting it, install + enable the timer (bundled by
  `install-app.sh`): `systemctl enable --now openlen-live-republish.timer`.
  Without both, `conectar_datos_vivos` still bakes current Sheet values at
  publish, but the "se actualiza sola cada hora" promise is dark.

The billing schema migration is already applied to Neon and `deploy.ps1` re-runs
`billing:migrate` (idempotent) as a gate before the swap — no manual step.

> **Backend-module migrations are NOT automated.** Unlike `billing:migrate`, the
> modules ship their own CLIs — `members:migrate`, `comments:migrate`,
> `broadcast:migrate`, `bookings:migrate`, `analytics:migrate` — that `deploy.ps1`
> does **not** run. Apply them manually against the prod `DATABASE_URL` (same
> model as `billing:migrate`: run locally, idempotent DDL) BEFORE deploying the
> code that uses the new columns — otherwise the first write throws
> `column/relation does not exist` (500). Comments + Broadcast also require
> **Members** migrated first.
>
> ⚠️ **`analytics:migrate` is a HARD pre-deploy gate** (Conversion Brain / funnel
> cid). It adds `pageEvents.cid` + `pageEvents.source` + `bookings.cid`. Because
> the booking insert (`claimBookingSlot`) now writes `bookings.cid`, deploying
> the new code BEFORE this migration would make **every booking POST 500** (and
> silently drop analytics beacons). Run `npm run analytics:migrate` against prod
> first; it's idempotent (`ADD COLUMN IF NOT EXISTS`).

---

## 1 · Deploy

From your machine (has the SSH key + egress; the `openlen` alias is in `~/.ssh/config`):

```bash
npm run deploy:prod
```

Does: local `next build` → tar → scp to the box → `billing:migrate` →
rebuild the Rust `.node` crates on the box → atomic swap → restart
`openlen-app`. Slowest part is the crate rebuild (~5–15 min on the CX22).
To skip the rebuild when crates are unchanged: `$env:OPENLEN_SKIP_CRATES_REBUILD=1`.

**Rollback** (if a deploy goes bad):
```bash
ssh openlen "systemctl stop openlen-app; rm -rf /opt/openlen-app; mv /opt/openlen-app.old /opt/openlen-app; systemctl start openlen-app"
```

Tail logs while smoking:
```bash
ssh openlen "journalctl -u openlen-app -f"
```

---

## 2 · Automated smoke (no browser — runs in seconds)

```bash
bash infra/scripts/smoke-live.sh https://openlen.com
```

Checks routing, auth gates, the billing webhook signature/method, security
headers, robots/sitemap. Green here ⇒ the wiring + config gates are sound. It
does NOT (and can't) confirm the things that need a real session / external
service / browser — those are the manual checklist below.

---

## 3 · Manual smoke checklist (browser)

### Phase 1 — core free beta (do these before opening the beta)
- [ ] **AI generate** — `/new?mode=ai` → brief ≥10 chars → submit → page streams
      in, redirects to `?project=<id>`, credits debited. *(Confirms `FIREWORKS_API_KEY`.)*
- [ ] **Edit** — open the project → Content/Chat tabs work; rename persists after reload.
- [ ] **Publish → subdomain** — Deploy → claim a subdomain → visit
      `https://<sub>.openlen.com` → serves the page over valid TLS (200).
- [ ] **OAuth login** — sign in with Google AND GitHub → lands in app, locale kept.
- [ ] **Email** — fastest check: inspector → form section → **"Test email"** button
      (gives direct success/error in the UI). It should arrive. Also try
      forgot-password. *(Confirms `RESEND_API_KEY` + verified Resend domain.)*

### Phase 2 — payments + export (before charging / before promoting deploy targets)
- [ ] **Polar checkout (sandbox)** — Upgrade → complete sandbox payment → webhook
      flips plan to `pro` + grants 150 credits → lands on `/projects?upgraded=1`.
- [ ] **Cancel** — from the portal, cancel → confirm whether Polar emits
      `canceled` immediately or keeps `active` until period end (the code keeps
      Pro on `active`/`trialing`/`past_due`, downgrades on terminal states).
- [ ] **Refund/dispute** — issue one in sandbox → confirm the exact event name
      Polar sends (the webhook logs unhandled types via `console.warn`) so the
      `order.refunded`/`order.disputed` handling can be confirmed.
- [ ] **Deploy export** — connect Vercel + GitHub → deploy a project → live URL works.
- [ ] **Unsplash** — Replace asset → search → results + select.

---

## 4 · Known silent-failure gotchas
- **Email "no error" ≠ "email arrived."** The form path saves the lead then
  fire-and-forgets the email; a missing key or unverified Resend domain fails
  silently (logged to journal). Verify actual delivery, not just absence of error.
- **AI key names.** `FIREWORKS_API_KEY` for everything that writes, and
  `OPENAI_API_KEY` for image editing alone. `GEMINI_API_KEY`, `TOGETHER_API_KEY`
  and `MOCK_MODE` read as live config in old notes and are not: nothing has
  read them since 2026-08-28, and they were removed from the box on 2026-08-29.
- **A missing image key is invisible until someone edits an image.** The 503
  surfaces in the Replace modal as the raw string `ai_unavailable`, so it reads
  as a random editor bug rather than missing config.
- **Polar stays in sandbox** until you set `POLAR_SERVER=production`.
