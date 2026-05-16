# DNS migration: Hostinger → Cloudflare for `openlen.com`

This runbook moves authoritative DNS for `openlen.com` from Hostinger to
Cloudflare. Cloudflare is required because:

1. **Free wildcard DNS hosting.** Hostinger's DNS doesn't support wildcard A
   records on shared hosting plans without an upsell.
2. **API token support** for the DNS-01 ACME challenge — needed to issue a
   Let's Encrypt **wildcard** TLS cert covering `*.openlen.com`. HTTP-01
   challenge can't issue wildcards.
3. **Free DDoS protection** as a bonus (we leave proxy OFF for DNS-only mode;
   see "Proxy mode" below).

The migration is reversible — Hostinger DNS records stay in their dashboard
until you delete them. You can swap the nameservers back at any point.

---

## Pre-flight

- [ ] Domain `openlen.com` is registered at Hostinger
- [ ] You can sign in to Hostinger and reach the domain's DNS / nameserver
      settings
- [ ] You have (or can create) a Cloudflare account
- [ ] Hetzner box is provisioned, you know its public IPv4 — call it
      `<HETZNER_IP>` below
- [ ] Vercel project (apex `openlen.com` and `www`) is already configured at
      Vercel's end; you have their published A / CNAME targets handy

---

## Step 1 — Add `openlen.com` to Cloudflare

1. Sign in at <https://dash.cloudflare.com/>. Create a free account if you
   don't have one.
2. **Add a Site** → enter `openlen.com` → select the **Free** plan.
3. Cloudflare scans Hostinger's existing DNS records and pre-populates them.
   This scan is best-effort — verify the next step before continuing.

---

## Step 2 — Configure DNS records in Cloudflare (BEFORE switching nameservers)

Open the DNS tab for `openlen.com` and ensure these records exist:

| Type  | Name               | Content                         | Proxy     | TTL  |
|-------|--------------------|---------------------------------|-----------|------|
| A     | `openlen.com`      | `76.76.21.21` (Vercel anycast)  | DNS only  | Auto |
| CNAME | `www`              | `cname.vercel-dns.com`          | DNS only  | Auto |
| A     | `*`                | `<HETZNER_IP>`                  | DNS only  | Auto |

Optional (add later if you want email forwarding):

| Type  | Name | Content                  | Proxy    | TTL  |
|-------|------|--------------------------|----------|------|
| MX    | `@`  | `mx1.forwardemail.net`   | DNS only | Auto |
| MX    | `@`  | `mx2.forwardemail.net`   | DNS only | Auto |
| TXT   | `@`  | `v=spf1 include:forwardemail.net -all` | DNS only | Auto |

Delete any leftover Hostinger A / AAAA records that don't match the table
above. Stale records cause split-brain TLS issues later.

### Proxy mode

**All records: Proxy OFF (DNS only / grey cloud).** Cloudflare's orange-cloud
proxy adds latency for nginx on Hetzner and breaks the Let's Encrypt DNS-01
challenge for the `*` wildcard. We use Cloudflare for **DNS hosting only**.
If we later want CDN for landings, we'll enable proxy on the wildcard record
specifically once the cert is renewing cleanly.

### Why the apex points at Vercel, not Hetzner

`openlen.com` (apex) and `www` serve the Next.js marketing + workspace app,
which is deployed to Vercel. The Hetzner box only serves **landing pages
under wildcard subdomains** (`<sub>.openlen.com`). This separation means:

- Vercel scales the app
- Hetzner serves the static HTML output of the generator
- Wildcard cert covers both apex and every subdomain

Vercel's anycast `76.76.21.21` is their public A target. If Vercel publishes a
different IP at the time you run this, use whatever Vercel's project settings
page tells you.

---

## Step 3 — Note Cloudflare's nameservers

Cloudflare assigns 2 nameservers per zone, with names like:

```
xxx.ns.cloudflare.com
yyy.ns.cloudflare.com
```

Find them in the Cloudflare dashboard at **Overview → Nameservers**. Copy
both — you need them in the next step.

---

## Step 4 — Switch nameservers at Hostinger

1. Sign in to <https://hpanel.hostinger.com/>.
2. **Domains → `openlen.com` → DNS / Nameservers**.
3. Choose **Use custom nameservers** (the exact label varies by Hostinger
   UI version — look for "child nameservers" or similar).
4. Paste both Cloudflare nameservers. Save.

Hostinger will warn that DNS will change. Confirm. The domain registrar
update propagates worldwide in 1–48h (usually 1–2h).

---

## Step 5 — Wait for propagation

Verify with `dig` (Mac/Linux) or `nslookup` (Windows):

```bash
dig NS openlen.com +short
```

Expected output:
```
xxx.ns.cloudflare.com.
yyy.ns.cloudflare.com.
```

If you still see Hostinger nameservers (e.g. `ns1.dns-parking.com`), wait
30 min and try again. If you still see them after 4h, **flag the operator**
— Hostinger sometimes requires email confirmation before nameserver changes
go live.

While waiting, you can also verify with:
- <https://dnschecker.org/?domain=openlen.com&type=NS>
- Cloudflare dashboard → Overview → site status should turn green ("Active")
  within a few minutes of nameserver propagation.

---

## Step 6 — Verify record resolution

Once Cloudflare shows "Active":

```bash
# Apex points to Vercel anycast
dig A openlen.com +short
# → 76.76.21.21

# www points to Vercel CNAME
dig CNAME www.openlen.com +short
# → cname.vercel-dns.com.

# Wildcard resolves any subdomain to Hetzner
dig A test.openlen.com +short
dig A anything.openlen.com +short
# → <HETZNER_IP> for both
```

If any of these return wrong/empty answers, recheck Cloudflare's DNS tab and
re-save the record.

---

## Done — proceed to TLS

Once DNS is resolving correctly:

1. Generate the Cloudflare API token — see [`CLOUDFLARE_TOKEN.md`](./CLOUDFLARE_TOKEN.md).
2. Run the Hetzner setup script — see [`../scripts/setup-hetzner.sh`](../scripts/setup-hetzner.sh).
3. Install the nginx config — see [`../nginx/install-config.sh`](../nginx/install-config.sh).
4. Smoke-test — see [`../scripts/smoke-test.md`](../scripts/smoke-test.md).

---

## Rollback

If something breaks and you need to revert to Hostinger DNS:

1. At Hostinger → DNS / Nameservers → choose **Use Hostinger nameservers**
   (or whatever the default option is labelled).
2. Wait for propagation (same 1–48h window).
3. Hostinger's DNS records were never deleted, so they take over again.
4. TLS cert at Hetzner will keep working — the cert is bound to the
   domain name, not the DNS host. Renewal will fail until you either
   revert DNS or move the cert process to HTTP-01 challenge.
