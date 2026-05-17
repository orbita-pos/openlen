# EVAL_SESSION_10 — Hetzner deploy infra (DNS + nginx + TLS for `*.openlen.com`)

**Date:** 2026-05-16
**Branch:** master
**Scope:** Brand swap (Inari Pages → OpenLen) + infrastructure runbooks +
scripts for wildcard subdomain hosting on Hetzner.

This session is the **operator-prep half** of "one-click deploy to subdomain."
It produces the runbooks + scripts the operator runs against real DNS / a
real box. Session 11 is the **product half** — DB schema, "Choose your
subdomain" UX, and the Deploy button wiring.

No live execution was attempted in this session — the operator runs the
scripts after providing the Hetzner public IP and Cloudflare API token. The
deliverables here are tested by reading, not by SSH-ing in. Smoke-test
verification happens when the operator runs the steps end-to-end.

---

## What shipped

### Bloque A — Brand swap (committed: `1a2a2b6`)

34 files changed, +57/-57 lines. Replaced "Inari Pages" → "OpenLen" in:

- Top-level docs: `README.md`, `LICENSE_HEADER.txt`, `docs/SHOW_HN_DRAFT.md`
- Config: `package.json` (`name: "openlen"`), `.env.local.example`
  (incl. `INARI_PAGES_DOMAIN` → `OPENLEN_DOMAIN`, `R2_BUCKET` default,
  `R2_PUBLIC_URL` default, `EMAIL_FROM` default)
- App shells: `app/layout.tsx` (metadata title), `app/(auth)/*` (4 page
  titles), `app/projects/page.tsx`, `app/preview-blocks/page.tsx`
- API: `app/api/export/zip/route.ts` (README emitted in ZIP)
- Marketing site: all 8 components/marketing/* (nav, hero, hero-prompt-input,
  demo-strip, features, comparison, final-cta, footer)
- Workspace + auth chrome: `components/workspace/header.tsx`,
  `components/workspace/brief-form.tsx`, `components/app/app-header.tsx`,
  `components/auth/auth-shell.tsx`
- Email templates: `lib/email.ts` (subject, body, HTML, default From)
- AI system prompt identity: `lib/orchestrator/master-prompt.ts` — the
  model now identifies as "OpenLen" in its role description
- Brief-fidelity gate: `lib/gates/brief-fidelity.ts` NAME_STOPLIST entry
- Block library: `lib/blocks/README.md`, `lib/blocks/features/bento-asymmetric.tsx`
  (`$ openlen deploy`), `lib/blocks/pricing/three-tier-highlight.tsx`
  ("OpenLen domain hosting"), `lib/blocks/hero/centered-cta.tsx` (file
  header comment)
- Storage adapter: `lib/storage/index.ts` (R2 bucket + public URL defaults)
- Dev script: `scripts/preview-blocks.tsx` (CLI manifest header)

**Verification:** `npx tsc --noEmit` clean. `npm run lint` 0 warnings/errors.

### Deliberately preserved (out of scope per the rules)

| Item | Why preserved |
|---|---|
| `@inariwatch/capture` / `INARIWATCH_DSN` / `inariwatch.com` comments | Sister product (error monitoring), not the pages brand |
| `instrumentation.ts` | Just imports `@inariwatch/capture/auto` |
| `inari:height`, `__inari-overlay`, `inari:regen` etc in preview-panel.tsx | Internal postMessage protocol + CSS class prefixes — invisible to end users |
| `inari:dark` localStorage key | Internal storage key — renaming breaks existing user sessions |
| `inari-edit/` localStorage prefix in `app/new/page.tsx` | Same — internal storage key |
| `inari-marquee-strip`, `inari-aurora-shift` CSS keyframes | Internal identifiers, not user-visible |
| `picsum.photos/seed/inari-` mock seed prefix in `lib/together/mock.ts` | Internal seed — changing breaks deterministic mock URL stability |
| `"Inari Watch monitoring"` in `lib/blocks/pricing/two-tier-simple.tsx` | Sister product reference, not the pages brand |
| `"Inari Advisors LLC"` in `lib/orchestrator/few-shots/refined-editorial/folio.jsx` | Fictional company name in a few-shot reference (a fake financial-advisor site), not OpenLen brand |
| Folder name `inari-pages/` and repo URL `github.com/jesusbernalrj/inari-pages` | Codebase / repo legacy continuity (per Session 10 prompt explicit rule) |
| `INARI_DESIGN_ENGINE.md` filename + contents | Not in the explicit file list in the Session 10 prompt; operator can rename + content-swap as a follow-up |
| `EVAL_SESSION_*.md` (1–9) | Historical eval docs frozen in time |
| `evals/*/output.html`, `evals/*/output.raw.html` | Eval artifacts |
| The "い" katakana brand mark (in nav, footer, workspace header, auth shell, email, default 404) | **FLAGGED FOR VISUAL REVIEW** — see open questions |

### Bloque B–E — Infrastructure (in working tree, ready to commit)

```
infra/
├── SETUP.md                              # master runbook
├── dns/
│   ├── MIGRATION.md                      # Hostinger → Cloudflare nameserver swap
│   └── CLOUDFLARE_TOKEN.md               # API token for DNS-01 ACME
├── scripts/
│   ├── setup-hetzner.sh                  # idempotent box bootstrap
│   ├── deploy-key-setup.md               # SSH key for SCP deploys
│   └── smoke-test.md                     # 5-test end-to-end verification
└── nginx/
    ├── openlen.conf                      # wildcard subdomain server
    ├── install-config.sh                 # idempotent installer
    └── default-404.html                  # served when subdomain isn't deployed
```

All scripts are idempotent (re-runs are no-ops where the desired state
already holds). All runbooks include rollback / DR notes.

---

## Time spent

| Block | Estimate | Notes |
|---|---|---|
| Brand swap (Bloque A) | ~25 min | 34 surgical edits across components, docs, libs |
| DNS runbooks (Bloque B) | ~20 min | MIGRATION.md + CLOUDFLARE_TOKEN.md |
| Hetzner script (Bloque C-1) | ~15 min | setup-hetzner.sh with idempotency + guardrails |
| Nginx config (Bloque C-2) | ~15 min | wildcard config + 404 + installer |
| Deploy key + smoke runbooks (Bloque D) | ~15 min | deploy-key-setup.md + smoke-test.md |
| Master SETUP.md (Bloque E) | ~15 min | tying it all together |
| Eval doc (this file) | ~10 min |  |
| **Total** | **~2h authoring** | |

Operator-side time (when actually running): 30–60 min for full setup +
1–4h DNS propagation wait between Steps 1 and 2.

---

## Cost breakdown

| Resource | One-time | Monthly | Notes |
|---|---|---|---|
| Hetzner CX22 | €0 | **€4.49 / ~$4.85** | 2 vCPU, 4 GB RAM, 40 GB SSD, 20 TB egress |
| Cloudflare DNS (Free plan) | $0 | $0 | Unlimited DNS queries, no per-record fee |
| Let's Encrypt wildcard cert | $0 | $0 | 90-day cert, certbot.timer auto-renews |
| `openlen.com` domain (Hostinger) | already paid | ~$1/mo amortized | Existing |
| **Total infra** | **$0** | **~$5/month** | |

Capacity at $5/mo: ~20K landings on the 40GB SSD (assuming 2 MB avg with
images); ~60M page views/mo on 20 TB egress before bandwidth becomes a
concern.

---

## Verification (this session)

Reading-time verification (no live execution):

- [x] `npx tsc --noEmit` clean after brand swap
- [x] `npm run lint` 0 warnings/errors after brand swap
- [x] Final grep confirms no stray "Inari Pages" / "Inari Labs" / etc.
      outside the deliberate preserve list
- [x] Idempotency: scripts re-check state before mutating (user create,
      cert issuance, nginx symlink)
- [x] Cross-references: every doc links to its companions; SETUP.md is the
      single entry point

**NOT verified this session** (operator must run end-to-end):

- [ ] DNS propagation actually completes within the documented window
- [ ] `certbot certonly` actually issues a cert with the `cloudflare.ini`
      this runbook produces
- [ ] `nginx -t` passes with the `openlen.conf` regex on the box's nginx
      version (Ubuntu 24.04 ships nginx 1.24+, named captures supported
      since 0.7.40 — should be fine)
- [ ] The 5 smoke tests all pass

Smoke tests are designed to fail loudly on any misconfiguration — running
them is the proof of correctness, not the runbook.

---

## Open questions for Session 11

These are deferred to Session 11 (subdomain provisioning + dashboard
product UX), not blockers for this session:

1. **Subdomain → user mapping schema.** What's the Postgres table layout?
   Suggested: `subdomains(name PRIMARY KEY, user_id REFERENCES users,
   project_id REFERENCES projects, created_at, last_deployed_at)`.
   The PRIMARY KEY enforces global uniqueness automatically.

2. **Quota: free-tier subdomain cap?** Currently zero enforcement.
   Suggestion: 1 free, 25 on Pro. Enforced at provisioning UX, not at
   nginx/DNS level.

3. **Reserved-word list.** Must include `www`, `api`, `mail`, `admin`,
   `deploy`, `app`, `dashboard`, `blog`, `docs`, `help`, `status`,
   `staging`, `_default`. Probably also: profanity filter (LDNOOBW or
   similar). Plus: a way for an admin to manually reserve more later
   (a `subdomains_reserved` table?).

4. **Subdomain validation regex.** Must match nginx's regex:
   `^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$`. Client + server validation
   must agree. Suggestion: extract to a shared `lib/subdomain.ts` and
   import from both `app/api/deploy/route.ts` and the provisioning form.

5. **Custom domain CNAME support.** Out of scope for Session 11. If we
   want it in Session 11.5+, the nginx wildcard regex needs a second
   `server` block matching arbitrary host headers and looking up the
   custom_domain → subdomain mapping at request time (Lua / OpenResty
   or nginx + Postgres via a daemon). Non-trivial — defer until paying
   customer asks.

6. **Brand mark / logo decision.** The "い" katakana square is preserved
   in:
   - `components/marketing/{nav,footer}.tsx`
   - `components/workspace/header.tsx`
   - `components/app/app-header.tsx`
   - `components/auth/auth-shell.tsx`
   - `lib/email.ts` (password-reset email HTML)
   - `infra/nginx/default-404.html` (new)

   Decision needed: does "OpenLen" keep the い mark, or move to a new
   brand mark (e.g. "OL" monogram, paper/origami glyph matching "kami =
   paper" connotation)? Recommend a quick design pass — the mark
   currently signifies the old Inari name (kami → fox/spirit), which is
   a semantic mismatch with OpenLen. The brand mark fix is a 10-line
   diff once decided.

7. **INARI_DESIGN_ENGINE.md.** Top-level strategy doc, NOT touched this
   session (out of scope per the prompt's explicit file list). Has many
   "Inari Pages" / "InariWatch" / "Inari vs Lovable" references. Two
   options: (a) leave it as-is (it's a strategy snapshot from when
   the brand was Inari), (b) clone to `OPENLEN_DESIGN_ENGINE.md` and
   update content + add to README link. Recommend (a) for now; refresh
   only if/when the strategy doc is shown publicly.

8. **EMAIL_FROM domain.** `lib/email.ts` defaults to
   `OpenLen <no-reply@openlen.com>`. The actual sending domain must be
   verified at Resend before this works in production. The .env.local
   override is the escape hatch for dev (`EMAIL_FROM=OpenLen
   <no-reply@yourdomain.com>`).

---

## Caveats

1. **DNS propagation is the slowest step.** Worst case 48h (registrar TTL
   variance + global Hostinger nameserver removal). Plan the cutover
   accordingly — don't promise "live in an hour" to anyone.

2. **No CDN by default.** Cloudflare proxy is OFF for all records. Once
   real traffic appears, flip the wildcard `*` A record to "Proxied"
   (orange cloud) for CDN + DDoS protection. Re-test cert renewal
   immediately after — DNS-01 still works with proxy on, but the first
   time is worth verifying.

3. **Single Hetzner region.** Latency from far-away regions (~150ms). Not
   a problem for landing-page first-load; revisit if we expand globally.

4. **No content moderation at nginx layer.** Anyone with SSH access to
   `openlen-deploy@<box>` can write any HTML to any subdomain. The
   abuse-prevention layer is the Next.js app gating access to that key
   via Session 11's auth. The nginx box is intentionally dumb.

5. **Cert renewal failures are silent by default.** certbot.timer logs
   to syslog but doesn't email on failure unless explicitly configured.
   Recommend adding a monthly cron that runs `certbot renew --dry-run`
   and pipes the exit code to a healthcheck service (healthchecks.io
   or similar). Out of scope this session.

6. **Vercel apex routing assumed.** SETUP.md assumes `openlen.com` apex
   points at Vercel's `76.76.21.21`. If Vercel changes that, the
   migration runbook must be updated. As of 2026-05-16 this is current.

---

## Next session — preview

**Session 11 — Subdomain Provisioning + Dashboard:**

- Postgres `subdomains` table + migration
- `lib/subdomain.ts` — validation regex shared client + server
- `/api/deploy` endpoint — picks/validates subdomain, SCPs HTML to
  Hetzner via `OPENLEN_DEPLOY_KEY` env var
- "Deploy" button in workspace header (replaces the "Coming in Phase 1B"
  alert)
- "Choose your subdomain" modal — availability check, suggestion when
  taken, reserved-word rejection
- `/projects` dashboard column: deployed URL + "Open" button
- Free-tier quota enforcement (1 subdomain free, 25 Pro)
- Smoke test: brief → generate → deploy → curl the live URL

Session 10 was the **operator side** of one-click deploy. Session 11 is
the **product side**. The handoff is the `OPENLEN_DEPLOY_KEY` env var
and the `subdomains` schema.
