# Neon → Hetzner — Plan & Decision Record

> Master strategy doc. Captures the decision, the research from two design passes, what's already done,
> and the exact steps to cut over **when** it's worth it. The operational file index lives in `README.md`;
> the step-by-step cutover lives in `MIGRATION_RUNBOOK.md`. This doc is the "why / when / what we found".

---

## 0. Current status — PAUSED (deliberately)

- **On Neon FREE ($0) right now.** A prior ~$20 bill (a paid plan + scale-to-zero defeated by a warm
  connection) was escaped by self-downgrading to free. Today: HTTP driver in prod + Rust edge not live +
  low traffic ⇒ scale-to-zero works ⇒ **$0, zero ops.**
- **Decision: prepare now, cut over on a trigger — not today.** Migrating now saves $0 (already at $0) and
  adds DBA work. Nothing is deleted; everything below is on the shelf, ready.

## 1. Triggers — cut over to Hetzner WHEN any of these hit

1. **Rust edge cutover ships.** `crates/edge` holds a persistent `sqlx` pool → keeps Neon compute warm 24/7
   → burns the free tier's 100 CU-hours in ~4 days → Neon **suspends compute** (on free it's downtime, not a
   bill). This is the most likely trigger.
2. **Outgrow the free tier:** 0.5 GB storage · 100 CU-hours/mo · 5 GB egress.
3. **You want the beats-Neon capabilities for their own sake** (ZFS branching, owned keys, query insight),
   not for cost — i.e. you want OFF Neon on principle.

Until then, staying on Neon free is genuinely the cheapest **and** lowest-effort option.

## 2. What's already DONE (app side) — verified, reversible

| Change | State |
|---|---|
| `lib/db/index.ts` → **auto-selects** `neon-http` (for `*.neon.tech`) vs `pg` (self-hosted box) | ✅ done |
| `auth.config.ts` (new) — edge-safe split so `pg` never enters the middleware/edge bundle | ✅ done |
| `auth.ts` → full config = `...authConfig` + adapter + providers | ✅ done |
| `middleware.ts` → uses the DB-free `auth` | ✅ done |
| `package.json` → +`pg` +`@types/pg`, −`@neondatabase/serverless` | ✅ done |
| `tsc --noEmit` + `next build` (Middleware compiled, no pg in edge) | ✅ green |

The app **still runs against Neon today** (pg speaks Neon's standard string), so cutover = a `DATABASE_URL`
swap. **Not committed** (lives in the working tree).

### ✅ Deploy landmine — CLOSED
`lib/db/index.ts` now **auto-selects the driver** from `DATABASE_URL`: `neon-http` for `*.neon.tech`
(stateless → scale-to-zero stays alive), `pg` for the self-hosted box. So a `deploy:prod` (which ships the
working tree) is **safe on Neon free** today, and cutover stays a one-variable change. Verified: `tsc` +
`next build` green, Middleware still edge-clean (98 kB). Both drivers are deps; the `auth.config.ts` split
keeps either out of the edge bundle.

## 3. The architecture (from the design pass) — what beats Neon vs what we drop

### Beats Neon (self-host lets you have what Neon won't)
- **Proven restore** — an automated weekly drill that restores to a throwaway VM and asserts your real table
  invariants. Neon's backups are a black box you can never restore-drill. *The single biggest genuine win.*
- **Owned AES-256 keys** · **arbitrary cheap retention** · **true 3-2-1** (R2 + Hetzner Storage Box) ·
  **immutable backups** (R2 Object Lock — even a rooted box can't purge history).
- **Free, unbounded `pg_stat_statements` + `auto_explain` plans** (Neon gates Query Insights + wipes on
  scale-to-zero).
- **Instant ZFS `clone` branching + `rollback`** (Neon charges per branch and can only go forward).
- **Network isolation · 4 least-priv roles · `full_page_writes=off` on ZFS · any extension · no metered surprises.**

### Merely matches Neon
PITR-to-the-second (pgBackRest WAL→R2, RPO ~60s) · PgBouncer pooling · scram-sha-256 · web SQL console (pgweb) · OS patching.

### Consciously DROPPED (anti-vanity — judgment-based)
- ❌ **Patroni/etcd or pg_auto_failover auto-failover** — adds split-brain risk + €12-25/mo and moves product
  uptime by ~zero, because Next/Caddy/edge are all single-node. Hardening the DB alone is the wrong place.
- ❌ PG18 `file_copy_method=clone` (reflink) — not production-recommended on ZFS; `zfs clone` already covers it.
- ❌ WAL-G as a second engine — pick **one** (pgBackRest); its 2-repo + delta restore wins for a solo operator.
- ❌ LUKS at-rest disk encryption pre-v1 — encrypt where data LEAVES the box (the backups, already AES-256).

### DEFERRED (designed-in, ~1h to add when justified)
Warm **async streaming replica** on a 2nd box (the right next step once there are paying users) · `pg_stat_monitor` · `pgcat` (only with read replicas) · `syncoid`.

## 4. Topology — two options, decide at cutover

| | **Co-locate on existing CX22** (€0) | **Dedicated CX33** (€6.49/mo) |
|---|---|---|
| Box | Postgres next to Next/Caddy/edge on the 4 GB box | New 8 GB box, DB only; app stays on CX22 |
| RAM for PG | ~0.5–1 GB `shared_buffers`; ZFS ARC fights the app | 2 GB `shared_buffers` + ZFS ARC ~3 GB capped + headroom |
| Filesystem | **ext4 recommended** (skip ZFS to avoid ARC contention) | ZFS (branching + snapshots + scrub) |
| Keeps the durability wins? | **✅ yes** (backups/PITR/keys/restore are RAM-independent) | ✅ yes |
| ZFS branching / future replica / blast-radius isolation | ❌ deferred (needs a 2nd box anyway) | ✅ yes |
| Verdict | **Not "bajo nivel"** — the pragmatic €0 path; keeps what matters most | "Lo pro" — only worth it for the headroom/branching/replica |

**Recommendation:** if the goal is *own my data + escape Neon cheaply* → **co-locate on the CX22 (ext4 + pgBackRest)**.
Reach for the dedicated CX33 only when you specifically want ZFS branching or a warm replica with breathing room.
*(If dedicated: same Hetzner **location** as the CX22 — same network zone is required for the private network; same DC = sub-ms latency.)*

### RPO / RTO (either topology)
- **RPO ~60s** (continuous WAL archiving, `archive_timeout=60s`) — matches Neon's PITR.
- **RTO:** bad migration / fat-finger → `zfs rollback` <2 min (ZFS) or PITR-to-timestamp ~5–15 min; full box-loss
  disaster → ~15–45 min (provision + restore from R2). Gated by a **rehearsed** drill, not by buying a cluster.

## 5. Cost comparison (June 2026)

| Option | Monthly | Notes |
|---|---|---|
| Neon free | **$0** | 0.5 GB · 100 CU-h · 5 GB egress; zero ops. **Where you are now.** |
| Neon paid (Launch) | ~$5–25 | usage: $0.106/CU-h + $0.35/GB-mo; the tier you'd land on if the edge kills scale-to-zero |
| The bill that triggered this | ~$20 | one-time, already escaped |
| **Co-locate on CX22** | **€0 extra** | you inherit ops; no new hardware |
| **Dedicated CX33 (8 GB)** | **€6.49** | ~65% under the $20 bill, flat; DB isolated + headroom |

## 6. Implementation order (when the trigger hits)

1. ~~deploy-safe driver~~ ✅ done (auto-select in `lib/db/index.ts`)
2. Provision the box (co-locate: nothing; dedicated: CX33 same location + private network + Hetzner firewall, no public 5432).
3. `setup-db-box.sh` — PG17 + (ZFS on dedicated / ext4 on co-locate) + tuned `postgresql.conf` + `pg_hba` + cert. *(adapt 8 GB→4 GB tuning if co-locate)*
4. `roles.sql` — 4 least-priv roles.
5. **Cutover**: `pg_dump` Neon → restore → verify row counts → smoke → Neon stays as fallback. *(MIGRATION_RUNBOOK.md)*
6. PgBouncer (transaction mode) — kills the surprise-bill mechanism.
7. pgBackRest 2-repo (R2 + Storage Box), AES-256, async WAL → flip `archive_mode=on` → first full backup.
8. **Restore drill** (weekly, hcloud ephemeral VM, asserts invariants) — *the keystone; until green, DR is unproven*.
9. sanoid snapshots (ZFS only) + nightly logical `pg_dump` to R2.
10. postgres_exporter + node_exporter → existing Grafana; survival alerts (backup-age, txid-wraparound, disk) after ~2 weeks baseline.
11. (ZFS only) `pg-branch.sh` + weekly `zpool scrub`; pgvector; unattended-upgrades (postgresql blacklisted).
12. Decommission Neon: final encrypted dump to R2 + update the legal subprocessor pages (`subprocessors`/`privacy`) that name Neon.

## 7. Honest bottom line

You're at **$0 on Neon free with zero ops** — so there's no rush. Keep it. The prep is done and parked. When a
real trigger hits, cutover is a `pg_dump`/restore + a `DATABASE_URL` swap, and **co-locating on the CX22 you
already have is plenty** (not bajo nivel — it keeps the durability wins that actually matter). Spend on the
dedicated box only when you want ZFS branching or a replica. The one loose end worth closing today is the
**deploy-safe driver** so a stray deploy can't quietly burn your free tier.
