# Cloudflare API token for Let's Encrypt DNS-01

The Hetzner box uses `certbot-dns-cloudflare` to issue and renew the wildcard
TLS cert for `*.openlen.com`. That plugin needs an API token with permission
to read the zone and edit DNS records on that zone.

This token is **read/write on DNS for openlen.com only.** It does NOT have
account-level permissions, can't change other zones, and can be revoked
at any moment from the Cloudflare dashboard.

---

## Permissions required

Token type: **Custom Token** (NOT Global API Key — that's account-wide and
dangerous to put on a server).

- Permission 1: **Zone → DNS → Edit**
- Permission 2: **Zone → Zone → Read**
- Zone Resources: **Include → Specific zone → `openlen.com`**

Optional:

- Client IP Address Filtering: restrict to the Hetzner box's IPv4. Tighter,
  but means rotating the token if you ever move the box.
- TTL: leave as "no expiry" for production. If you set a TTL, calendar a
  renewal task — the cert renewal silently fails the day after the token
  expires.

---

## Generate the token

1. Sign in at <https://dash.cloudflare.com/>.
2. **My Profile (top-right) → API Tokens → Create Token**.
3. Pick **Custom token** (NOT one of the pre-built templates — they're
   either too broad or missing DNS edit).
4. Set the permissions and zone scope per the table above.
5. **Continue to summary → Create Token**.
6. Cloudflare shows the token **exactly once**. Copy it now. If you lose it,
   you'll need to delete + regenerate.

Test the token from your laptop before pushing it to the box:

```bash
curl -sS https://api.cloudflare.com/client/v4/user/tokens/verify \
  -H "Authorization: Bearer <PASTE_TOKEN>" \
  -H "Content-Type: application/json"
```

Expected JSON: `"status": "active"` and `"success": true`. If you get a 401,
the token isn't right — go back and recreate.

---

## Store on the Hetzner box

The token file lives at `/etc/letsencrypt/cloudflare.ini` with `root:root`
ownership and mode `600` (only root can read). Anything looser and certbot
will warn — and a leaked token lets anyone edit `openlen.com` DNS records
including taking over the TLS cert.

```bash
ssh root@<HETZNER_IP>

# Make sure the directory exists.
mkdir -p /etc/letsencrypt
chmod 700 /etc/letsencrypt

# Write the credentials file. The format below is exactly what
# certbot-dns-cloudflare expects.
cat > /etc/letsencrypt/cloudflare.ini <<'EOF'
dns_cloudflare_api_token = <PASTE_TOKEN_HERE>
EOF

# Lock it down.
chmod 600 /etc/letsencrypt/cloudflare.ini
chown root:root /etc/letsencrypt/cloudflare.ini

# Sanity check.
ls -la /etc/letsencrypt/cloudflare.ini
# Expected: -rw------- 1 root root <size> <date> /etc/letsencrypt/cloudflare.ini

exit
```

---

## After this

Run the main setup script — it expects `cloudflare.ini` to exist and will
issue the wildcard cert as part of step [7/8]:

```bash
# From your local machine:
scp infra/scripts/setup-hetzner.sh root@<HETZNER_IP>:/root/
ssh root@<HETZNER_IP> "bash /root/setup-hetzner.sh"
```

If `cloudflare.ini` is missing when the script runs, it logs a warning and
skips cert issuance — you can fix the file and re-run the script (it's
idempotent) or run `certbot certonly` manually with the same flags.

---

## Rotation

To rotate the token (e.g. after a suspected compromise or annually as
hygiene):

1. Generate a new token with the same permissions.
2. SSH into the box and replace the value in `/etc/letsencrypt/cloudflare.ini`.
3. Test: `certbot renew --dry-run`. If it succeeds, the new token works.
4. Delete the old token from Cloudflare's API Tokens page.

---

## Revoke if compromised

From Cloudflare dashboard → My Profile → API Tokens → find the token → **Roll**
or **Delete**. Then immediately rotate per above. Anyone holding a stale
token can no longer touch the zone once it's deleted.
