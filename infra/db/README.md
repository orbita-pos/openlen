# OpenLen — self-hosted Postgres (Neon-level, dedicated DB box)

Replaces Neon with a self-hosted Postgres on a **dedicated Hetzner CX33 (8 GB)**, private-network only.
The app stays on the CX22. Goal: match Neon's durability/PITR and **beat** it on owned keys, cheap
retention, true 3-2-1, free query insight, instant ZFS branching, and a *proven* restore — for ~€6.49/mo
(≈$7, vs the ~$20 Neon bill), flat and predictable.

The app is already driver-portable: `lib/db/index.ts` is on `node-postgres` (pg) over the standard wire
protocol, and `auth.ts` was split into an edge-safe `auth.config.ts` (tsc + `next build` green). The cutover
below is a `pg_dump | restore` + a `DATABASE_URL` swap — **zero further app code changes**.

## Conventions (used by every file here)

| Thing | Value |
|---|---|
| DB box (private IP) | `10.0.0.3`  ← set to your real vSwitch IP |
| App box (private IP) | `10.0.0.2` |
| Postgres | 17.x from PGDG apt (`apt.postgresql.org`) |
| Database | `openlen` |
| pgBackRest stanza | `openlen` |
| ZFS pool / datasets | `pgpool/data` → `/var/lib/postgresql/17/main`, `pgpool/wal` → `…/wal` |
| Roles (least-priv) | `openlen_app` (DML) · `openlen_migrate` (DDL only) · `openlen_backup` (read+replication) · `openlen_edge_ro` (SELECT) · `openlen_metrics` (pg_monitor) |
| Secrets | `/etc/openlen/db.env` on the box, `640 root:postgres` (mirrors the app's `/etc/openlen/openlen.env`) |
| Connection (app) | `postgresql://openlen_app:***@10.0.0.3:6432/openlen?sslmode=require` (via PgBouncer) |
| Connection (migrations) | `postgresql://openlen_migrate:***@10.0.0.3:5432/openlen?sslmode=require` (DIRECT — bypass PgBouncer for DDL) |

## Implementation order (the 12 steps)

0. Provision CX33 (x86, 8 GB), attach to the private network. Hetzner Cloud Firewall: deny all inbound except SSH-from-your-IP. **Never** a public 5432.
1. `setup-db-box.sh` — PGDG PG17 + ZFS pool/datasets (zstd, recordsize=32K, separate WAL, `zfs_arc_max` cap) + tuned `postgresql.conf` + `pg_hba.conf` + self-signed server cert.
2. `roles.sql` — the 4 least-priv roles + grants.
3. **Cutover**: `pg_dump` from Neon → restore into the box → smoke → keep Neon as fallback. *(MIGRATION_RUNBOOK.md)*
4. PgBouncer (transaction mode) — kills the surprise-bill mechanism. *(next batch)*
5. pgBackRest 2-repo (R2 + Hetzner Storage Box), AES-256, async WAL → flip `archive_mode=on`. *(next batch)*
6. sanoid ZFS snapshots + nightly logical `pg_dump` to R2. *(next batch)*
7. postgres_exporter + node_exporter → existing Prometheus/Grafana. *(next batch)*
8. **Restore drill** (weekly, hcloud ephemeral VM, asserts table invariants) — the keystone. *(next batch)*
9. Survival alerts (backup-age, txid-wraparound, disk-free) after ~2 weeks baseline. *(next batch)*
10. `pg-branch.sh` (ZFS clone), weekly `zpool scrub`, pgvector, unattended-upgrades (postgresql blacklisted). *(next batch)*
11. (optional) pgweb SQL console behind Caddy auth. *(next batch)*

## Files

| File | Tier | Status |
|---|---|---|
| `setup-db-box.sh` | 0/1 | ✅ this batch |
| `conf/postgresql.openlen.conf` | 1 | ✅ this batch |
| `conf/pg_hba.openlen.conf` | 4 | ✅ this batch |
| `roles.sql` | 4 | ✅ this batch |
| `MIGRATION_RUNBOOK.md` | 0/3 | ✅ this batch |
| `pgbackrest.conf` + `openlen-pgbackup.{service,timer}` | 2 | ⏳ next batch |
| `restore-drill.sh` + `openlen-restore-drill.{service,timer}` | 2 | ⏳ next batch |
| `pgbouncer.ini` + unit, exporters, alerts, `pg-branch.sh`, sanoid | 1–3 | ⏳ next batch |

> ⚠️ **Read `setup-db-box.sh` before running it.** The ZFS pool step is destructive to the target device and
> is guarded behind `CONFIRM_WIPE=yes`. Everything else is idempotent.
