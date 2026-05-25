# Caddy cutover — nginx → Caddy

Step-by-step procedure to replace nginx with Caddy as the production
web tier on the Hetzner box. After cutover, Caddy serves:

- `openlen.com` + `www.openlen.com` — reverse proxy to Next.js
- `*.openlen.com` — static files per subdomain (no Node hop, same as before)
- `*.<your-custom-domain>` — on-demand TLS, served via the Next `/served/` route

There is a brief downtime window (~5 seconds) during the systemd swap. Do
this at a low-traffic moment.

---

## Pre-flight on your laptop

```bash
# Make sure the new code compiles + the migration script is in.
npx tsc --noEmit
git status   # commit the infra/caddy/ + lib/custom-domains.ts + serve route
git push
```

## On the Hetzner box

### 1. Pull the new code

```bash
cd /opt/openlen-app   # or wherever the repo lives
git pull
```

### 2. Run the DB migration

```bash
npm run domains:bootstrap
```

Creates the `customDomains` table + indexes. Idempotent — safe to re-run.

### 3. Install Caddy

```bash
sudo bash infra/caddy/install.sh
```

This installs Caddy from the official Cloudsmith repo, symlinks
`/etc/caddy/Caddyfile` to `infra/caddy/Caddyfile` in the repo, sets up
the certbot deploy hook to reload Caddy on renewal, and grants the
`caddy` user read access to the existing wildcard cert.

**Does NOT start Caddy** — that's the next step. You can still re-run
this script later to re-sync the symlink + permissions.

### 4. Smoke-test the Caddyfile

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
```

Should print `Valid configuration`. If it errors, fix the Caddyfile +
re-run.

### 5. The swap (~5 seconds of downtime)

```bash
sudo systemctl stop nginx
sudo systemctl disable nginx
sudo systemctl enable --now caddy
```

If anything goes sideways:

```bash
sudo systemctl stop caddy
sudo systemctl start nginx     # back on the old stack
```

### 6. Verify

```bash
# Apex still works
curl -sI https://openlen.com | head -5

# A subdomain still works
curl -sI https://manuscript.openlen.com | head -5    # or any sub you have

# Caddy is healthy
sudo systemctl status caddy --no-pager
sudo journalctl -u caddy -n 100 --no-pager
```

The apex response should have a `Server: Caddy` header (vs the old
`Server: nginx`). Subdomain HTML should still come back as 200, with
the same `Cache-Control` headers as before.

### 7. Test custom domains end-to-end

Once a verified custom domain is added via the workspace UI:

```bash
# DNS resolution sanity check
dig +short <your-custom-domain>     # should return 178.156.175.171

# TLS handshake + Caddy on-demand cert issuance
curl -vI https://<your-custom-domain> 2>&1 | tail -30

# Confirm the page is served from the right project
curl -s https://<your-custom-domain> | head -20
```

The first hit to a fresh custom domain takes a few seconds (Caddy is
issuing the cert in-line). Subsequent hits are near-instant. The cert
lives at `/var/lib/caddy/.local/share/caddy/certificates/...` and Caddy
auto-renews at ~30 days before expiry.

---

## Removing nginx (optional, after a week of clean Caddy logs)

Once you're confident the cutover stuck:

```bash
sudo apt-get remove --purge nginx-full nginx-common
sudo rm -rf /etc/nginx
```

Keep `/var/log/nginx/` around if you want the historical access logs.

## Rolling back (within the first hours, if Caddy misbehaves)

```bash
sudo systemctl stop caddy
sudo systemctl disable caddy
sudo systemctl enable --now nginx
```

`infra/nginx/openlen.conf` is unchanged in the repo, so nginx wakes up
on the same config it had before the swap.
