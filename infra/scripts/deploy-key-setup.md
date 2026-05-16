# Deploy user SSH key — generate, install, verify

The Next.js app (Session 11+) deploys generated HTML to `*.openlen.com` by
SCPing files into `/var/www/openlen/<subdomain>/` over SSH as the
`openlen-deploy` user. That user accepts only public-key auth (no password)
and is locked to the web-root directory by group permissions.

This runbook covers the one-time key generation + handshake. After this,
the Next.js app simply uses the private key from `OPENLEN_DEPLOY_KEY`.

---

## Step 1 — Generate the key pair (on your local machine)

Ed25519 — small, fast, well-supported:

```bash
ssh-keygen -t ed25519 \
  -C "openlen-deploy@nextjs-app" \
  -f ~/.ssh/openlen-deploy \
  -N ""
```

`-N ""` skips the passphrase so the Next.js app can use the key
non-interactively in production. **Treat the private key like a database
password** — it's a single-point-of-entry to the deploy user's home + web
root.

Output:
- `~/.ssh/openlen-deploy` — private key (NEVER commit, NEVER share)
- `~/.ssh/openlen-deploy.pub` — public key (safe to push to the box)

### Windows / PowerShell variant

```powershell
ssh-keygen -t ed25519 `
  -C "openlen-deploy@nextjs-app" `
  -f "$HOME\.ssh\openlen-deploy" `
  -N '""'
```

---

## Step 2 — Push the public key to Hetzner

The setup script (`setup-hetzner.sh`) already created the
`/home/openlen-deploy/.ssh/authorized_keys` file (empty, mode 600, owned by
the deploy user). Append your public key to it:

```bash
# Append (NOT overwrite) so multiple keys can coexist.
ssh root@<HETZNER_IP> "cat >> /home/openlen-deploy/.ssh/authorized_keys" \
  < ~/.ssh/openlen-deploy.pub

# Confirm.
ssh root@<HETZNER_IP> "cat /home/openlen-deploy/.ssh/authorized_keys"
```

You should see your `ssh-ed25519 AAAA... openlen-deploy@nextjs-app` line.

---

## Step 3 — Verify access end-to-end

From your local machine:

```bash
ssh -i ~/.ssh/openlen-deploy openlen-deploy@<HETZNER_IP> "whoami && ls -la /var/www/openlen"
```

Expected output:
```
openlen-deploy
total 12
drwxrwsr-x  3 openlen-deploy www-data 4096 ...  .
drwxr-xr-x  3 root           root     4096 ...  ..
drwxrwsr-x  2 openlen-deploy www-data 4096 ...  _default
```

If you get `Permission denied (publickey)`, the public key wasn't appended
correctly — re-run Step 2 and re-check ownership:
```bash
ssh root@<HETZNER_IP> "ls -la /home/openlen-deploy/.ssh/"
# authorized_keys must be -rw------- owned by openlen-deploy
```

---

## Step 4 — Test a write

Verify the deploy user can actually write files (and nginx can serve them):

```bash
ssh -i ~/.ssh/openlen-deploy openlen-deploy@<HETZNER_IP> \
  "mkdir -p /var/www/openlen/test && \
   echo '<!doctype html><h1>Hello from test.openlen.com</h1>' \
     > /var/www/openlen/test/index.html"

curl -sS https://test.openlen.com
# Expected: <!doctype html><h1>Hello from test.openlen.com</h1>
```

If `curl` returns 404 + the default page: the file write probably went to
a different path. Check `ls /var/www/openlen/test/` via SSH.

---

## Step 5 — Wire the private key into Next.js (Session 11 — preview)

Session 11 reads the private key from an env var. The expected shape:

```bash
# .env.local (development)
OPENLEN_DEPLOY_KEY="$(cat ~/.ssh/openlen-deploy)"
OPENLEN_DEPLOY_HOST=<HETZNER_IP>
OPENLEN_DEPLOY_USER=openlen-deploy
OPENLEN_DEPLOY_PATH=/var/www/openlen
```

For Vercel: paste the multi-line private key into the Environment Variables
panel as a single value. Vercel preserves newlines correctly.

For self-host: keep the key in a file with mode 600 (or use a secrets
manager like Doppler / Infisical) and reference it from `.env.local`.

---

## Rotation

To rotate the deploy key (annually as hygiene, or after any suspected
compromise):

1. Generate a new key with a different filename (e.g. `openlen-deploy-2026q3`).
2. Append the new public key to authorized_keys (Step 2).
3. Update `OPENLEN_DEPLOY_KEY` in Next.js to the new private key.
4. Deploy + verify Next.js can still SCP.
5. Edit `/home/openlen-deploy/.ssh/authorized_keys` on the box and remove
   the old key's line.
6. Delete the old private key from your local machine.

---

## Lockdown hardening (optional, recommended for prod)

Once everything works, tighten the deploy user's SSH so the key can ONLY
do SCP — no interactive shell, no port-forwarding:

```bash
# On the box, edit /etc/ssh/sshd_config and append:
Match User openlen-deploy
    ForceCommand internal-sftp
    AllowTcpForwarding no
    X11Forwarding no
    PermitTunnel no
```

Then `sudo systemctl reload sshd`. After this, `ssh openlen-deploy@...
whoami` will fail (no shell), but `scp ./file openlen-deploy@.../path` still
works. Session 11's SCP-based deploy will be unaffected; this is just
defense-in-depth in case the private key ever leaks.

---

## Troubleshooting

| Symptom                                       | Fix |
|-----------------------------------------------|---|
| `Permission denied (publickey)`               | Re-check `authorized_keys` ownership + mode 600 |
| `Permission denied` writing to `/var/www/openlen` | User isn't in `www-data` group — re-run setup-hetzner.sh |
| `Host key verification failed`                | `ssh-keygen -R <HETZNER_IP>` then retry |
| Vercel env var mangles newlines               | Use single-line PEM via `awk 'NF{printf "%s\\n",$0}' key` |
