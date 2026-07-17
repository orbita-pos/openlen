# OpenLen infrastructure — master setup runbook

This is the canonical runbook for bringing up `*.openlen.com` wildcard
subdomain hosting on a fresh Hetzner box. Following the steps in order,
end-to-end, takes 30–60 minutes (most of which is waiting for DNS).

Companion docs:

- [`dns/MIGRATION.md`](./dns/MIGRATION.md) — Hostinger → Cloudflare nameserver swap
- [`dns/CLOUDFLARE_TOKEN.md`](./dns/CLOUDFLARE_TOKEN.md) — API token for DNS-01 ACME
- [`scripts/setup-hetzner.sh`](./scripts/setup-hetzner.sh) — idempotent box bootstrap
- [`nginx/openlen.conf`](./nginx/openlen.conf) — apex/www proxy + wildcard subdomain config
- [`scripts/deploy-key-setup.md`](./scripts/deploy-key-setup.md) — SSH key for SCP deploys
- [`scripts/smoke-test.md`](./scripts/smoke-test.md) — 5 tests proving it works
- [`app/setup-node.sh`](./app/setup-node.sh) — Node 22 + Chromium runtime install
- [`app/install-app.sh`](./app/install-app.sh) — Next.js scaffolding (dirs, env, systemd unit)
- [`app/openlen-app.service`](./app/openlen-app.service) — systemd unit for the Node process
- [`scripts/deploy.sh`](./scripts/deploy.sh) — local build + rsync + service restart
- [`DR_RUNBOOK.md`](./DR_RUNBOOK.md) — **disaster recovery** — rebuild a dead box from R2 backups

---

## Architecture

```
openlen.com (apex)         ─┐
www.openlen.com            ─┤→  Hetzner CX22, nginx → Node 22 (openlen-app.service)
                            │     └── Next.js standalone server on 127.0.0.1:3000
                            │     └── /uploads/  served from /var/openlen/uploads/
                            │     └── /_next/static/ served from /opt/openlen-app/.next/static/
                            │
*.openlen.com (wildcard)   ─┘   Hetzner CX22, nginx serving static HTML
                                  └── /var/www/openlen/<sub>/index.html
                                  └── wildcard TLS via Let's Encrypt DNS-01
```

Everything runs on a single Hetzner box. The Next.js app handles apex/www;
wildcard subdomains serve cheap static HTML straight from disk. Cloudflare
handles DNS for the whole zone (proxy OFF — we use it for DNS hosting and
DNS-01 challenge support only).

**Why self-host instead of Vercel?** Three reasons:

1. **Brand consistency.** Open-source product → self-hosted infrastructure.
2. **Predictable cost.** €4.49/mo flat for the CX22 vs Vercel's
   function-invocation billing that scales with traffic.
3. **Single mental model.** One box, one playbook, no vendor lock-in. The
   Next.js standalone build deploys anywhere that runs Node.

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

## Step 6 — Smoke-test wildcard

Follow [`scripts/smoke-test.md`](./scripts/smoke-test.md). All 5 tests
must pass.

**Checkpoint:** `https://test.openlen.com` returns the deployed HTML with a
valid wildcard TLS cert; `https://nothing-here.openlen.com` returns the
friendly OpenLen 404.

At this point the wildcard subdomain side is fully working. Apex/www
still return 444 (catch-all) until Section 10.5 runs.

---

## Section 10.5 — Deploy the Next.js app to apex + www

The wildcard subdomain side is independent of the app. Skip this section
if you only want subdomain hosting; complete it to serve marketing +
workspace at `openlen.com` from the same box.

### Step 1 — Install Node 22 + Chromium

```bash
scp -i ~/.ssh/openlen-admin infra/app/setup-node.sh root@<HETZNER_IP>:/root/
ssh -i ~/.ssh/openlen-admin root@<HETZNER_IP> "bash /root/setup-node.sh"
```

Chromium is required at runtime by the puppeteer gates (a11y + mobile).
The systemd unit points `PUPPETEER_EXECUTABLE_PATH` at the apt-installed
binary so puppeteer doesn't try to download its own Chromium.

### Step 2 — Scaffold dirs, env file, systemd unit

```bash
scp -i ~/.ssh/openlen-admin -r infra/app root@<HETZNER_IP>:/root/openlen-app-scripts
ssh -i ~/.ssh/openlen-admin root@<HETZNER_IP> "bash /root/openlen-app-scripts/install-app.sh"
```

This creates `/opt/openlen-app` (release dir), `/var/openlen/{uploads,witness}`
(persistent data), `/etc/openlen/openlen.env` (secrets template), and
installs `openlen-app.service`. The service is enabled but **not started**
— it needs env values first.

### Step 3 — Paste secrets into the env file

Edit interactively over SSH so the secrets never land in shell history
or chat:

```bash
ssh -i ~/.ssh/openlen-admin root@<HETZNER_IP>
nano /etc/openlen/openlen.env
# Fill in GEMINI_API_KEY, DATABASE_URL, NEXTAUTH_SECRET, NEXTAUTH_URL
# (see infra/app/env.example for the full list)
```

### Step 4 — Reload nginx with apex + www server block

Push the updated config (which now includes the apex + www reverse-proxy
block alongside the existing wildcard block):

```bash
scp -i ~/.ssh/openlen-admin -r infra/nginx root@<HETZNER_IP>:/root/openlen-nginx
ssh -i ~/.ssh/openlen-admin root@<HETZNER_IP> "bash /root/openlen-nginx/install-config.sh"
```

`install-config.sh` runs `nginx -t` before reloading; the reload fails
loudly if anything is wrong.

### Step 5 — First deploy

From your local checkout:

```bash
bash infra/scripts/deploy.sh
```

This builds the Next.js standalone bundle locally, rsyncs `.next/standalone/`
to `/opt/openlen-app/`, and `systemctl restart openlen-app`. The script
ends with a curl smoke check against `https://openlen.com`.

### Step 6 — Confirm

```bash
curl -I --resolve openlen.com:443:<HETZNER_IP> https://openlen.com         # 200
curl -I --resolve openlen.com:443:<HETZNER_IP> https://openlen.com/new     # 200
curl -I --resolve test.openlen.com:443:<HETZNER_IP> https://test.openlen.com  # 200 (wildcard untouched)
ssh -i ~/.ssh/openlen-admin root@<HETZNER_IP> "systemctl status openlen-app --no-pager | head -10"
```

**Checkpoint:** apex returns the marketing landing, `/new` returns the
workspace, the wildcard subdomain still serves, and the service is
`active (running)`.

---

## Section 11 — per-user subdomain publish flow

Session 11 lets signed-in users claim `<sub>.openlen.com` from the workspace
and writes one directory per subdomain into the same `/var/www/openlen/`
root the wildcard nginx block already serves from.

The Next.js app is the one writing those directories now (previously empty —
Session 10 only proved the static-hosting path). One-time box prep, then
deploy as usual.

### Step 1 — Open up `/var/www/openlen/` to the deploy user

The app process runs as `User=openlen-deploy` / `Group=www-data`. The
wildcard root needs to be group-writable by `www-data`, with the setgid
bit set so subdirectories inherit the group ownership:

```bash
ssh -i ~/.ssh/openlen-admin root@<HETZNER_IP>
chown -R openlen-deploy:www-data /var/www/openlen
chmod 2775 /var/www/openlen
# Sanity: openlen-deploy can now touch a file in there.
sudo -u openlen-deploy install -m 644 /dev/null /var/www/openlen/.write-test
ls -l /var/www/openlen/.write-test    # owner=openlen-deploy group=www-data
rm /var/www/openlen/.write-test
exit
```

`_default/` and any test subdirs from Session 10 keep working — the chown
preserves the existing tree, only the permissions and group change.

### Step 2 — Apply the systemd unit changes

The unit now whitelists `/var/www/openlen` in `ReadWritePaths=` and adds
`Environment=PUBLISH_ROOT=/var/www/openlen` and
`Environment=PUBLISH_BASE_HOST=openlen.com`. Push and reload:

```bash
scp -i ~/.ssh/openlen-admin infra/app/openlen-app.service \
  root@<HETZNER_IP>:/etc/systemd/system/openlen-app.service
ssh -i ~/.ssh/openlen-admin root@<HETZNER_IP> \
  "systemctl daemon-reload && systemctl restart openlen-app"
```

`deploy-phase-2.ps1` rebuilds and ships the app code itself — this step only
covers the unit-file delta.

### Step 3 — Push the updated nginx config

The wildcard server block now serves `/uploads/` from
`/var/openlen/uploads/` (so the published page can reference user-uploaded
images without going cross-origin via the apex). Reload nginx:

```bash
scp -i ~/.ssh/openlen-admin -r infra/nginx root@<HETZNER_IP>:/root/openlen-nginx
ssh -i ~/.ssh/openlen-admin root@<HETZNER_IP> \
  "bash /root/openlen-nginx/install-config.sh"
```

`install-config.sh` runs `nginx -t` before reloading; the reload fails
loudly if anything is wrong.

### Step 4 — Apply the Drizzle schema migration

Three new columns on `projects` (`subdomain` UNIQUE, `publishedAt`,
`publishedHtml`). Run from the local checkout against the same Neon DB the
app uses in production:

```powershell
npx drizzle-kit push --force
```

`--force` is needed because the new `UNIQUE` constraint can't be created
implicitly. Inspect the printed plan first if you're uneasy.

### Step 5 — Smoke test

After `.\deploy-phase-2.ps1` is done:

```bash
# Pick a fresh subdomain via the workspace UI → click "Publish to openlen.com".
# Then check from your laptop:
curl -I https://<sub>.openlen.com
# Expect: HTTP/2 200, Content-Type: text/html, valid wildcard TLS.

# Click Unpublish, then:
curl -I https://<sub>.openlen.com
# Expect: HTTP/2 404, served by the friendly _default block.
```

---

## Verify all green

After all steps, this checklist should be entirely ticked:

- [ ] `https://openlen.com` — Next.js marketing landing
- [ ] `https://www.openlen.com` — same app, same box
- [ ] `https://openlen.com/new` — workspace UI
- [ ] `https://openlen.com/api/generate` accepts POST (returns SSE stream)
- [ ] `https://test.openlen.com` — 200 OK, "Hello from test"
- [ ] `https://anyrandom.openlen.com` — 404 + default OpenLen page
- [ ] TLS cert valid for `*.openlen.com` and `openlen.com`
- [ ] `certbot renew --dry-run` succeeds
- [ ] `ufw status` shows 22/80/443 allowed, defaults deny incoming
- [ ] `systemctl is-enabled fail2ban` → enabled
- [ ] `systemctl is-enabled certbot.timer` → enabled
- [ ] `systemctl is-enabled openlen-app` → enabled, `is-active` → active

---

## Disaster recovery

**The full, current procedure lives in [`DR_RUNBOOK.md`](./DR_RUNBOOK.md)** —
follow that, not a summary here. It rebuilds a dead box from the R2 backups
(`backup-published-to-r2.sh` + `backup-system-to-r2.sh`): bootstrap → restore
secrets + re-issue the cert → Caddy → app → restore content → smoke → and only
then flip DNS. It is ordering-sensitive (cert before Caddy, install-app before
deploy) and DNS is touched **last**, so don't improvise from the old nginx-era
steps that used to live here.

DR drill: spin up a temporary box once, run `DR_RUNBOOK.md` §1–§9 against it
(never §10 — that's the prod DNS flip), confirm < 90 min RTO, destroy the box.

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
