# OpenLen — Neon → self-hosted Postgres cutover runbook

Zero-data-loss cutover. **Neon stays live as the fallback until the box is verified.** Nothing is
irreversible until the very last step (decommission Neon), and even then a final dump is archived.

Prereqs: a fresh CX33 on the private network; the app already on `node-postgres` (done — `tsc` + `next
build` green). Have the current Neon `DATABASE_URL` handy (the standard string, not the `-pooler`/HTTP one).

---

## 1. Stand up the box  (Tier 0/1)

```bash
# On the CX33, as root, with infra/db/ copied over:
ZPOOL_DEVICE=/dev/sdb PRIVATE_IP=10.0.0.3 APP_IP=10.0.0.2 CONFIRM_WIPE=yes \
  bash setup-db-box.sh
```

Then secrets + roles:

```bash
$EDITOR /etc/openlen/db.env          # set 5 strong passwords
set -a; . /etc/openlen/db.env; set +a
sudo -u postgres psql -v ON_ERROR_STOP=1 \
  -v app_pw="$OPENLEN_APP_PASSWORD"        -v migrate_pw="$OPENLEN_MIGRATE_PASSWORD" \
  -v backup_pw="$OPENLEN_BACKUP_PASSWORD"  -v edge_pw="$OPENLEN_EDGE_RO_PASSWORD" \
  -v metrics_pw="$OPENLEN_METRICS_PASSWORD" -f roles.sql
```

**Firewall (do it in the Hetzner Console, not the box):** a Cloud Firewall on the CX33 that DENIES all
inbound except SSH-from-your-IP and TCP 5432/6432 from `10.0.0.2/32` (the app box) on the private net.
Verify 5432 is unreachable from the public internet: `nc -vz <public-ip> 5432` from your laptop → refused.

---

## 2. Cutover  (Tier 0 step 3)

Dump from Neon and restore into the box. The schema is vanilla; `pg_dump -Fc` + `pg_restore` is clean.
Use the **migrate** role (owns objects) and the **direct** 5432 port.

```bash
# From the DB box (or anywhere on the private net). Use PG17's pg_dump.
DEST="postgresql://openlen_migrate:${OPENLEN_MIGRATE_PASSWORD}@127.0.0.1:5432/openlen"

# 1. Dump Neon (custom format, parallel-restorable). --no-owner/--no-privileges so
#    objects land owned by openlen_migrate and our roles.sql grants apply.
pg_dump "$NEON_DATABASE_URL" -Fc --no-owner --no-privileges -f /tmp/openlen.dump

# 2. Restore. -j 2 = parallel; the DB already exists (roles.sql made it).
pg_restore -d "$DEST" --no-owner --no-privileges -j 2 /tmp/openlen.dump

# 3. Re-apply grants for app/edge on the freshly-restored tables:
sudo -u postgres psql -d openlen -c "
  GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES    IN SCHEMA public TO openlen_app;
  GRANT USAGE,SELECT,UPDATE         ON ALL SEQUENCES IN SCHEMA public TO openlen_app;
  GRANT SELECT                      ON ALL TABLES    IN SCHEMA public TO openlen_edge_ro;"
```

**Verify parity** before pointing the app at it:

```bash
# Row counts should match Neon for the key tables.
for t in users projects templates sections customDomains accounts sessions; do
  echo -n "$t: "; sudo -u postgres psql -tAc "SELECT count(*) FROM \"$t\"" openlen
done
shred -u /tmp/openlen.dump   # contains all your data — don't leave it on disk
```

---

## 3. Point the app at the box  (still reversible)

On the **CX22**, edit `/etc/openlen/openlen.env`:

```bash
# App → via PgBouncer once it's up (Tier 2); until then, direct 5432 is fine:
DATABASE_URL=postgresql://openlen_app:<app_pw>@10.0.0.3:5432/openlen?sslmode=require
# drizzle-kit DDL must bypass PgBouncer and use the migrate role + DIRECT port:
MIGRATE_DATABASE_URL=postgresql://openlen_migrate:<migrate_pw>@10.0.0.3:5432/openlen?sslmode=require
```

Edit `/etc/openlen/edge.env`:

```bash
OPENLEN_EDGE_DATABASE_URL=postgresql://openlen_edge_ro:<edge_pw>@10.0.0.3:5432/openlen?sslmode=require
```

```bash
systemctl restart openlen-app openlen-edge
```

> The `pg` driver auto-enables TLS for `sslmode=require` (see `lib/db/index.ts`). The self-signed cert
> means `sslmode=require` (encrypt, don't verify CA). Upgrade to `verify-full` + a real cert during
> hardening — see below.

**Smoke test:** log in, open `/projects`, create + publish a project, hit a custom-domain page (edge read).
Watch `journalctl -u openlen-app -f` for DB errors. If anything breaks, flip `DATABASE_URL` back to Neon and
restart — you're still fully reversible here.

---

## 4. Durability — DO NOT skip  (Tier 2, next batch)

Until the box has tested backups it is **less safe than Neon**. Next batch ships:
`pgbackrest.conf` (R2 + Storage Box, AES-256) → then flip `archive_mode=on` in `conf.d/10-openlen.conf`
and restart → first `pgbackrest stanza-create` + full backup → the **weekly restore drill** (the keystone).
Only after the drill is green is the box at Neon's durability level.

---

## 5. Decommission Neon  (final, after ~1 week of clean operation)

1. Take one last `pg_dump -Fc` of Neon, age-encrypt it, push to R2 as a cold archive.
2. Update the legal subprocessor list — `app/[locale]/subprocessors/page.tsx` + `privacy/page.tsx` name
   "Neon — Postgres database hosting"; remove it (self-hosted on Hetzner, already listed).
3. Cancel/delete the Neon project. Done — flat €6.49/mo, no metered surprises.

---

## Hardening follow-ups (post-cutover, not blocking)

- **TLS verify-full:** issue a real server cert (internal CA or the box's hostname via Let's Encrypt DNS-01),
  set the app/edge URLs to `sslmode=verify-full&sslrootcert=…`. Replaces the self-signed cert.
- **drizzle.config.ts:** prefer `MIGRATE_DATABASE_URL ?? DATABASE_URL` so `db:push`/`db:generate` use the
  DDL role on the direct port (next batch wires this 1-liner).
- **unattended-upgrades** with `postgresql*` blacklisted (OS CVEs auto-patch; PG restarts stay manual).
