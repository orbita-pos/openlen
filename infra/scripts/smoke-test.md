# Smoke test — verify wildcard subdomain serving works end-to-end

Run these from your local machine after:
1. DNS migrated to Cloudflare and propagated (`dig NS openlen.com` shows
   `*.ns.cloudflare.com`).
2. `setup-hetzner.sh` ran successfully, including the certbot step.
3. `install-config.sh` installed the nginx config.
4. `deploy-key-setup.md` step 4 succeeded (test write).

All 5 tests must pass before declaring the infra solid.

---

## Test 1 — Deploy a test landing

```bash
# Push HTML as the deploy user.
ssh -i ~/.ssh/openlen-deploy openlen-deploy@<HETZNER_IP> \
  "mkdir -p /var/www/openlen/test"

echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>test · OpenLen</title></head><body><h1>Hello from test.openlen.com</h1></body></html>' \
  | ssh -i ~/.ssh/openlen-deploy openlen-deploy@<HETZNER_IP> \
      "tee /var/www/openlen/test/index.html > /dev/null"
```

Expected: no errors. The file is now served at `https://test.openlen.com`.

---

## Test 2 — HTTPS GET returns 200 + valid TLS

```bash
curl -I https://test.openlen.com
```

Expected:
```
HTTP/2 200
content-type: text/html
strict-transport-security: max-age=31536000; includeSubDomains
x-content-type-options: nosniff
x-frame-options: SAMEORIGIN
referrer-policy: strict-origin-when-cross-origin
cache-control: no-cache, must-revalidate
...
```

```bash
curl -sS https://test.openlen.com
```

Expected body: the `<h1>Hello from test.openlen.com</h1>` HTML.

If curl complains about TLS: cert isn't valid for `test.openlen.com`. Run
`certbot certificates` on the box and verify the cert covers
`*.openlen.com`.

---

## Test 3 — Undeployed subdomain returns the friendly 404

```bash
curl -I https://nothing-here.openlen.com
```

Expected:
```
HTTP/2 404
content-type: text/html
...
```

```bash
curl -sS https://nothing-here.openlen.com
```

Expected body: the default 404 page (matches `infra/nginx/default-404.html`,
contains the OpenLen brand mark and a link to <https://openlen.com>).

If you get a generic nginx 404 instead of the styled OpenLen 404: the
`default-404.html` wasn't installed at `/var/www/openlen/_default/404.html`,
or perms are wrong. Re-run `install-config.sh`.

---

## Test 4 — Apex still routes to Vercel (not Hetzner)

```bash
curl -sSI https://openlen.com | head -5
```

Expected: response includes `server: Vercel` (or similar Vercel-specific
header), NOT the nginx server header. The apex is intentionally NOT served
by Hetzner — it's the Next.js app on Vercel.

If you get the OpenLen 404 from Hetzner here, DNS for the apex got
misconfigured. Check Cloudflare: `openlen.com` A record should point at
Vercel's anycast (`76.76.21.21`), not Hetzner.

---

## Test 5 — TLS cert covers wildcard

```bash
echo | openssl s_client -connect test.openlen.com:443 -servername test.openlen.com 2>/dev/null \
  | openssl x509 -noout -subject -issuer -ext subjectAltName
```

Expected output includes:
```
subject=CN=openlen.com
issuer=C=US, O=Let's Encrypt, CN=R10 (or similar Let's Encrypt CA)
X509v3 Subject Alternative Name:
    DNS:*.openlen.com, DNS:openlen.com
```

The SAN must list **both** `*.openlen.com` AND `openlen.com`. If only one
is present, the cert was issued for only that name — re-run `certbot
certonly` with both `-d` flags.

```bash
# Expiry check.
echo | openssl s_client -connect test.openlen.com:443 -servername test.openlen.com 2>/dev/null \
  | openssl x509 -noout -dates
```

Expected: `notAfter` ~90 days from today. certbot.timer renews ~30 days
before expiry; you don't need to do anything.

---

## Bonus — multiple subdomains share the cert

```bash
# Deploy two more landings under different subdomain names.
for sub in acme bloom; do
  ssh -i ~/.ssh/openlen-deploy openlen-deploy@<HETZNER_IP> \
    "mkdir -p /var/www/openlen/$sub && \
     echo '<!doctype html><h1>$sub.openlen.com</h1>' > /var/www/openlen/$sub/index.html"
done

curl -sS https://acme.openlen.com
curl -sS https://bloom.openlen.com
```

Both should return their respective `<h1>`. Both served from the same
wildcard cert, no per-subdomain configuration.

---

## Bonus — malformed subdomain gets rejected

```bash
# Underscore is invalid per the regex.
curl -sSI "https://foo_bar.openlen.com" -k
```

DNS won't resolve underscore subdomains at the OS resolver level on most
clients (RFC 952/RFC 1123), so this test mostly proves DNS rejects it
before nginx sees it. The wildcard A record only catches valid label syntax.

---

## Cleanup test subdomain (optional)

```bash
ssh -i ~/.ssh/openlen-deploy openlen-deploy@<HETZNER_IP> \
  "rm -rf /var/www/openlen/test /var/www/openlen/acme /var/www/openlen/bloom"
```

Subdomain directories deleted → curl now returns 404 + the default page.

---

## If anything fails

Tail the nginx logs from another terminal while you re-run a failing
request:

```bash
ssh root@<HETZNER_IP> "tail -F /var/log/nginx/openlen-error.log /var/log/nginx/openlen-access.log"
```

Common gotchas:
- `cert not found` → certbot didn't run; check `cloudflare.ini` exists +
  re-run `setup-hetzner.sh`
- `unknown directive "ssl_session_tickets"` → nginx older than 1.5.9 (won't
  happen on Ubuntu 24.04); remove the line
- 444 response (connection closed) → the request didn't match the wildcard
  regex; likely the host header is wrong (typo subdomain, raw IP, etc.)
