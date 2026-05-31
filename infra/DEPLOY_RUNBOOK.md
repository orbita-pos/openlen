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
- `DATABASE_URL` — Neon (pooled)
- `NEXTAUTH_SECRET` — `openssl rand -base64 32`
- `NEXTAUTH_URL=https://openlen.com`
- **`GEMINI_API_KEY`** — AI generation. ⚠️ `env.example` is stale (says
  `TOGETHER_API_KEY`); the Rust gateway + `lib/ai/*` read **`GEMINI_API_KEY`**.
  Without it, generation fails with "authentication failed — check GEMINI_API_KEY".
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

The billing schema migration is already applied to Neon and `deploy.ps1` re-runs
`billing:migrate` (idempotent) as a gate before the swap — no manual step.

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
      in, redirects to `?project=<id>`, credits debited by 1. *(Confirms `GEMINI_API_KEY`.)*
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
- **Gemini key name.** `GEMINI_API_KEY`, not the legacy `TOGETHER_API_KEY` in `env.example`.
- **Polar stays in sandbox** until you set `POLAR_SERVER=production`.
