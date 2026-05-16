# OpenLen infrastructure — master setup runbook

This is the canonical runbook for bringing up `*.openlen.com` wildcard
subdomain hosting on a fresh Hetzner box. Following the steps in order,
end-to-end, takes 30–60 minutes (most of which is waiting for DNS).

Companion docs:

- [`dns/MIGRATION.md`](./dns/MIGRATION.md) — Hostinger → Cloudflare nameserver swap
- [`dns/CLOUDFLARE_TOKEN.md`](./dns/CLOUDFLARE_TOKEN.md) — API token for DNS-01 ACME
- [`scripts/setup-hetzner.sh`](./scripts/setup-hetzner.sh) — idempotent box bootstrap
- [`nginx/openlen.conf`](./nginx/openlen.conf) — wildcard subdomain config
- [`scripts/deploy-key-setup.md`](./scripts/deploy-key-setup.md) — SSH key for SCP deploys
- [`scripts/smoke-test.md`](./scripts/smoke-test.md) — 5 tests proving it works

---

## Architecture

```
openlen.com (apex)         ──→  Vercel (Next.js app: marketing + workspace)
www.openlen.com            ──→  Vercel
*.openlen.com (wildcard)   ──→  Hetzner CX22 (nginx serving static HTML)
                                  └── /var/www/openlen/<sub>/index.html
                                  └── wildcard TLS via Let's Encrypt DNS-01
```

The split is intentional. Vercel handles the dynamic Next.js app; Hetzner
serves the cheap static HTML output of the generator. Cloudflare handles
DNS for the whole zone (proxy OFF — we use it for DNS hosting and DNS-01
challenge support only).

**Why not put everything on Vercel?** Vercel's bandwidth and cost-per-page
scale poorly for hosting thousands of generated landings. €4.49/mo for a
Hetzner box gets ~20K landings on its 40GB SSD with negligible per-request
cost.

---

## Prerequisites

- [ ] Domain `openlen.com` registered (currently at Hostinger)
- [ ] Hetzner Cloud account with billing setup
- [ ] Cloudflare account (free plan is fine)
- [ ] Local machine with `ssh`, `scp`, `curl`, `openssl`, `dig` installed
- [ ] You have or can create SSH keys for both:
  - operator (you) — for `root@` access during setup
  - deploy user — for the Next.js app to SCP HTML (created later)

---

## Step 0 — Provision the Hetzner box

1. <https://console.hetzner.cloud/projects> → Create project "openlen"
2. Add Server:
   - **Image:** Ubuntu 24.04
   - **Type:** CX22 (€4.49/mo, 2 vCPU, 4 GB RAM, 40 GB SSD, 20 TB egress)
   - **Location:** closest to your users (FSN1 / NBG1 for EU, ASH for US)
   - **Networking:** default IPv4 + IPv6
   - **SSH key:** upload your operator public key
   - **Name:** `openlen-pages-01`
3. Create. Note the public IPv4 — referred to below as `<HETZNER_IP>`.

Test SSH access:
```bash
ssh root@<HETZNER_IP>
# You should land on a root shell. exit.
```

---

## Step 1 — Migrate DNS to Cloudflare

Follow [`dns/MIGRATION.md`](./dns/MIGRATION.md) end-to-end. Estimated time:
30 min active + 1–4h waiting for propagation.

**Checkpoint:** `dig NS openlen.com +short` returns Cloudflare nameservers.

---

## Step 2 — Create Cloudflare API token

Follow [`dns/CLOUDFLARE_TOKEN.md`](./dns/CLOUDFLARE_TOKEN.md) to generate
the token and stash it at `/etc/letsencrypt/cloudflare.ini` on the
Hetzner box.

**Checkpoint:** `ssh root@<HETZNER_IP> "ls -la /etc/letsencrypt/cloudflare.ini"`
shows `-rw------- 1 root root <size>`.

---

## Step 3 — Run the box setup script

From your local checkout:

```bash
# Push the script.
scp infra/scripts/setup-hetzner.sh root@<HETZNER_IP>:/root/

# Run it.
ssh root@<HETZNER_IP> "bash /root/setup-hetzner.sh"
```

The script is idempotent — if anything fails partway, fix the issue and
re-run. ~3 min to complete, of which 60 sec is the DNS-01 propagation wait
during cert issuance.

**Checkpoint:** the script prints `[8/8] Setup complete.` and TLS cert
exists at `/etc/letsencrypt/live/openlen.com/`.

---

## Step 4 — Install the nginx config

```bash
# Push the nginx folder.
scp -r infra/nginx root@<HETZNER_IP>:/root/openlen-nginx

# Install + reload.
ssh root@<HETZNER_IP> "bash /root/openlen-nginx/install-config.sh"
```

**Checkpoint:** `nginx -t` reports `syntax is ok` and `systemctl status
nginx` shows `active (running)`.

---

## Step 5 — Add the deploy user's SSH key

Follow [`scripts/deploy-key-setup.md`](./scripts/deploy-key-setup.md).

**Checkpoint:** `ssh -i ~/.ssh/openlen-deploy openlen-deploy@<HETZNER_IP>
"whoami"` returns `openlen-deploy`.

---

## Step 6 — Smoke-test

Follow [`scripts/smoke-test.md`](./scripts/smoke-test.md). All 5 tests
must pass.

**Checkpoint:** `https://test.openlen.com` returns the deployed HTML with a
valid wildcard TLS cert; `https://nothing-here.openlen.com` returns the
friendly OpenLen 404.

---

## Verify all green

After all steps, this checklist should be entirely ticked:

- [ ] `https://openlen.com` — Vercel Next.js app (apex)
- [ ] `https://www.openlen.com` — same Vercel app
- [ ] `https://test.openlen.com` — 200 OK, "Hello from test"
- [ ] `https://anyrandom.openlen.com` — 404 + default OpenLen page
- [ ] TLS cert valid for `*.openlen.com` and `openlen.com`
- [ ] `certbot renew --dry-run` succeeds
- [ ] `ufw status` shows 22/80/443 allowed, defaults deny incoming
- [ ] `systemctl is-enabled fail2ban` → enabled
- [ ] `systemctl is-enabled certbot.timer` → enabled

---

## Disaster recovery

If the Hetzner box dies (hardware failure, accidental destroy, etc.):

1. Provision a new box (Step 0) — note the new IP
2. Update Cloudflare DNS:
   - Edit the `*` A record → new `<HETZNER_IP>`
   - Apex + www unchanged (still Vercel)
3. Run the box setup script (Step 3) — `cloudflare.ini` re-creation is
   in [`dns/CLOUDFLARE_TOKEN.md`](./dns/CLOUDFLARE_TOKEN.md)
4. Install nginx config (Step 4)
5. Re-add deploy user public key (Step 5) — same key, just a fresh
   `authorized_keys`
6. Re-sync deployed subdomain content. Session 11+ stores
   `<subdomain> → <user_id>` in Postgres, so the Next.js app can
   re-push every active subdomain from the DB. Until then, the box is
   functional but empty until each user clicks "Deploy" again.

DR drill recommendation: spin up a second box once, run through these
steps, confirm < 60 min recovery time. Then destroy the drill box.

---

## Cost

- **Hetzner CX22:** €4.49/mo (~$4.85)
- **Cloudflare DNS:** $0 (Free plan)
- **Let's Encrypt:** $0
- **Domain renewal:** $11–15/year at Hostinger (unchanged from current)

**Steady-state:** ~$5/month for landing-page hosting capacity good for
~20K landings on the 40GB SSD before needing to upgrade.

Bandwidth: Hetzner includes 20 TB/mo on CX22 — that's ~20M page views at
1MB each. Landings are typically 100–300 KB, so realistically ~60–200M
views/mo before bandwidth becomes a concern.

---

## Caveats

1. **No CDN.** All requests hit the Hetzner box directly. Fine for V1
   traffic; if a landing goes viral, the 4-vCPU box might struggle —
   flip Cloudflare proxy ON for that wildcard record to gain CDN +
   DDoS protection. (Test cert renewal works with proxy on first.)

2. **Single-region.** Box is in one Hetzner region. Visitors on the far
   side of the planet see ~150ms latency. Acceptable for landings;
   revisit if we expand to a global audience.

3. **Subdomain regex enforces DNS RFC label rules.** Allowed:
   lowercase a-z, 0-9, hyphens (not leading/trailing), 1–63 chars.
   No underscores, no uppercase, no Unicode. Session 11's provisioning
   UX must validate against this regex client-side.

4. **1 MB upload cap.** Set in `client_max_body_size`. Landings are
   far smaller; raise if Session 11 ever pushes large assets directly.

5. **Reserved subdomains** (api, www, mail, admin, deploy, _default,
   …) are NOT enforced at the nginx layer — provisioning UX in
   Session 11 owns the reserved-word list. If someone manages to deploy
   `mail.openlen.com`, it'll just be a landing; no real harm.

6. **Cert renewal failure is silent** by default — certbot.timer runs
   it but only emails Let's Encrypt's expiry warning at T-30 / -10 /
   -1 days, to the email set in `setup-hetzner.sh`. Set up a
   monitoring poke (e.g. monthly `certbot renew --dry-run` via cron
   with email-on-failure) for true peace of mind.
