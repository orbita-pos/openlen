# Domain Connect — onboarding runbook

Domain Connect is the open protocol (https://www.domainconnect.org/) that
Resend and Vercel use for "one-click" DNS setup. After CF approves our
templates, an OpenLen user with a Cloudflare-managed domain will click
**One-click setup with Cloudflare** in the Custom Domain modal, get sent
to CF, approve, and come back to a fully-configured record set — no
copy-pasting DNS values.

Code wiring is already in place (`lib/domain-connect.ts`, the API route,
the modal button). What's left is the **per-provider onboarding**, which
is a one-time manual process per DNS provider.

---

## What this directory holds

```
infra/domain-connect/
├── README.md                                           ← this file
└── templates/
    ├── openlen.com.custom-domain-subdomain.json        ← for landing.miempresa.com
    └── openlen.com.custom-domain-apex.json             ← for miempresa.com
```

The two templates are the contract with each DNS provider: "if a user
asks for service X, add these records". CF validates the JSON against
their own ruleset (`-cloudflare` linter flag) on top of the protocol-
generic Domain Connect linter.

---

## Steps remaining (one-time setup)

### 1 — Generate the signing keypair

Run locally, once:

```bash
npm run domain-connect:keygen
```

The script prints:
- `DOMAIN_CONNECT_SIGNING_KEY=…` — paste into both `.env.local` and `infra/.env.production`
- One or more `TXT` records to publish at `v1.dc.openlen.com`

The key never leaves your machine + the server. The public counterpart
that lives in DNS is what each DNS provider fetches to verify every
Apply URL we send their users.

### 2 — Publish the public key in DNS

Open the Cloudflare dashboard for `openlen.com` → DNS → Add record:

| Field | Value |
|---|---|
| Type | TXT |
| Name | `v1.dc` |
| Content | (paste the `p=1,d=…` value from step 1's output) |
| TTL | Auto / 1h |
| Proxy status | DNS only (gray cloud) |

If the script printed multiple `p=` chunks, add one TXT record per chunk
at the same name (Cloudflare accepts multiple TXT records at one host).

Verify:

```bash
dig +short TXT v1.dc.openlen.com
```

Should show the `p=1,d=…` blob.

### 3 — Fork + PR the templates

Templates have to live in the canonical Domain Connect repo so DNS
providers can audit them. Fork on GitHub:

```bash
# in a scratch dir, NOT the openlen-pages repo
gh repo fork Domain-Connect/Templates --clone
cd Templates
cp /path/to/openlen-pages/infra/domain-connect/templates/openlen.com.*.json .
git add openlen.com.custom-domain-apex.json openlen.com.custom-domain-subdomain.json
git commit -m "Add OpenLen custom-domain templates"
git push -u origin master
gh pr create --title "Add OpenLen custom-domain templates" --body-file - <<'EOF'
Two templates supporting the two ways an OpenLen user might point a domain
at their landing page:

- `openlen.com.custom-domain-apex.json` — root domain (yoursite.com)
  - A @ → 178.156.175.171
  - TXT _openlen-challenge → %token%

- `openlen.com.custom-domain-subdomain.json` — subdomain (landing.yoursite.com)
  - CNAME %host% → custom.openlen.com (lets us migrate origin transparently)
  - TXT _openlen-challenge.%host% → %token%

`syncPubKeyDomain` is `dc.openlen.com`; the v1 key is published at
`v1.dc.openlen.com` (visible via `dig +short TXT v1.dc.openlen.com`).

Logo: https://openlen.com/icon.svg
Site: https://openlen.com

Validated locally with the Domain Connect linter (and the `-cloudflare`
flag — both templates pass).
EOF
```

Domain Connect maintainers usually merge within a week.

### 4 — Onboard with Cloudflare

In parallel to the PR (CF doesn't wait for it to merge), send an email
to `domain-connect@cloudflare.com`:

> Subject: OpenLen — Domain Connect template onboarding
>
> Hi Cloudflare team,
>
> We've published two Domain Connect templates for OpenLen, an open-source
> landing-page builder. We'd like to onboard them as a Service Provider
> in the Cloudflare Domain Connect ecosystem so customers with CF-managed
> zones can one-click DNS-configure their domains for our service.
>
> **Template PRs:**
>  - https://github.com/Domain-Connect/Templates/pull/<N>
>
> **Files (also attached as raw JSON):**
>  - openlen.com.custom-domain-apex.json
>  - openlen.com.custom-domain-subdomain.json
>
> **Public key domain:** `dc.openlen.com`. v1 key published at
> `v1.dc.openlen.com` (TXT, currently active).
>
> **Logo:** https://openlen.com/icon.svg (also attached as SVG)
>
> **Proxy status preferences:**
>  - A records → **off** (DNS only). OpenLen needs direct traffic to its
>    origin for TLS termination + on-demand cert issuance.
>  - CNAME records → off (same reason).
>
> **Service site:** https://openlen.com
>
> **Account ID (testing):** <fill in if you want to be on the staging allow-
> list before public rollout — find it under CF Dashboard → right-side panel>
>
> Thanks!
> — Jesús, OpenLen

Once CF responds + approves (~1-2 weeks per their docs), the templates
become live in their flow. No code deploy needed on our side — the
existing `discoverDnsProvider` + Apply-URL builder will start working
for CF-managed zones automatically.

### 5 — Repeat for additional providers (optional, later)

Same process per provider. The Domain Connect spec is open, but each
provider has their own onboarding contact + review. Useful additions
after Cloudflare:

- **GoDaddy**: most non-tech registrar customers. Contact via the
  Domain Connect site's GoDaddy section.
- **IONOS**: EU customers default here.
- **NameSilo**: indie-hacker crowd, easy onboarding.

Each one just requires a fresh email + the same templates (they're
provider-agnostic).

---

## How to verify it's actually working end-to-end

Once steps 1–4 are done + CF has approved:

1. Add a custom domain in /new → Custom domain modal
2. Type a domain that's on a CF-managed zone (e.g. one of yours that
   uses CF nameservers)
3. The modal should show **"One-click setup with Cloudflare"** above the
   manual DNS records. If it only shows the manual panel: either the
   probe is still in-flight, or the domain isn't CF-managed, or signing
   isn't configured — check the browser DevTools network tab for the
   `connect-url` response.
4. Click → land on `dash.cloudflare.com/domain-connect/...` → approve
5. Click the "Verify" button in the modal (or wait 30s for auto-poll)
6. Status → Verified · TLS active

---

## Rotating the signing key

Domain Connect supports multiple active keys per `syncPubKeyDomain` so
rotation is non-breaking. To roll over from v1 to v2:

1. Run `npm run domain-connect:keygen` again, edit the script's `KEY_ID`
   constant to `v2` first (or copy the script + change the constant).
2. Publish the new TXT at `v2.dc.openlen.com`.
3. Update `lib/domain-connect.ts` `KEY_ID` constant to `v2` + redeploy.
4. After ~30 days, remove the v1 TXT record.

The DNS provider's signature-check looks at the `key=` parameter on the
URL, so as long as both v1 + v2 are present in DNS during the cutover,
no signed URL becomes invalid.
