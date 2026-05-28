# Edge cutover — nginx → openlen-edge

Step-by-step replacement of the production nginx web tier with the Rust
`openlen-edge` binary. After cutover, the edge serves:

- `openlen.com` + `www.openlen.com` — reverse-proxy to Next.js on
  `127.0.0.1:3000`; `/_next/static/*` and `/uploads/*` served direct
  from disk (Node never sees those bytes)
- `*.openlen.com` — static files per subdomain from
  `/var/www/openlen/<sub>/current/`, with `/assets/*` resolving to the
  sibling `<sub>/assets/` tree (survives release rotations) and
  `/uploads/*` skipping the per-sub disk in favor of the shared
  `/var/openlen/uploads`. `/c/*` + `/api/f/*` proxy to Node.
- Any verified custom domain — TLS issued on demand via Let's Encrypt,
  served via the LRU-backed lookup against `customDomains` then disk
  serve (no `/served/<host>/` Next round-trip). `/c/*` + `/api/*`
  proxy to Node.

There is a brief downtime window (~5 seconds) during the systemd swap.
Plan it at a low-traffic moment and DM the on-call team before starting.

**Pre-condition for this runbook**: the F2 S7 branch is merged to
`master`, the build artifacts in `crates/edge/` compile cleanly, and the
operator has SSH access to the box as `root` via `~/.ssh/openlen-admin`.

---

## 1. Pre-flight on your laptop

Run from the repo root before booking a maintenance window.

```bash
# Master is green and the edge artifacts compile + test clean.
git checkout master
git pull --ff-only
CARGO_TARGET_DIR=D:/rust/target cargo test -p openlen-edge --release
CARGO_TARGET_DIR=D:/rust/target cargo clippy -p openlen-edge --all-targets --release -- -D warnings
CARGO_TARGET_DIR=D:/rust/target cargo build -p openlen-edge --release

# Bench scripts parse cleanly.
bash -n infra/edge/install.sh infra/scripts/deploy-edge.sh
for f in bench/k6/*.js; do node --check "$f"; done

# Lockfile is committed (deploy-edge.sh's build will fail if it isn't).
git status crates/edge Cargo.lock
git push origin master
```

If anything fails — fix on the branch, don't continue.

---

## 2. Pre-flight on Hetzner

SSH in as root and confirm the box is healthy. Any red flag here =
postpone the cutover.

```bash
ssh -i ~/.ssh/openlen-admin root@178.156.175.171

# nginx config is currently valid (rollback depends on it).
nginx -t

# Wildcard cert has > 30 days of validity (we don't want to be inside the
# renewal window during the swap).
openssl x509 -enddate -noout -in /etc/letsencrypt/live/openlen.com/fullchain.pem

# Neon Postgres pool is healthy (the edge will open new connections immediately
# on first start — a saturated pool would manifest as cert-lookup 5xx).
PGPASSWORD=$(grep '^DATABASE_URL' /etc/openlen/openlen.env | sed -E 's/.*:([^@]+)@.*/\1/') \
  pg_isready -h <neon-host> -p 5432 || echo "pg_isready unavailable — check DATABASE_URL manually"

# Disk is not full. The cert state under /var/lib/openlen-edge/ + journald
# growth + Next.js standalone all need room.
df -h /

# Node app has been steady in the last hour (a flapping app would mask the
# bake-off's signal).
journalctl -u openlen-app --since "1 hour ago" --no-pager | tail -20

# R2 backups are recent — the safety net if anything corrupts the publish root.
ls -la /var/openlen/backups/ 2>/dev/null | head
# Last nightly rclone run should be under 24h old; check
# systemctl list-timers --no-pager | grep openlen-backup
```

If any check fails, **STOP**. Diagnose before going further.

---

## 3. DNS TTL pre-shortening (24h before cutover)

Drop the A record TTL for `openlen.com` and `*.openlen.com` from
whatever it is today (probably 1h or higher) to **60 seconds** in
Cloudflare. The cutover doesn't change DNS records — the same IP keeps
serving — but a low TTL gives us the option of a DNS-level rollback if
the entire box becomes unreachable.

Do this at least 24h ahead so the change has propagated. Revert to the
longer TTL a week after the soak completes.

---

## 4. Side-by-side deployment (bake-off phase)

The edge runs on a non-production port (`:8443`) so it doesn't fight
nginx. Run for at least 24h before the swap — long enough to catch
issuance + renewal edge cases.

### 4a. Run install.sh

From the box, with the repo checked out at the same SHA as the laptop:

```bash
cd /opt/openlen-app
git pull --ff-only
sudo bash infra/edge/install.sh
```

The script is idempotent. Verify the output ends with the "Next steps"
block.

### 4b. Ship the binary

From your laptop:

```bash
bash infra/scripts/deploy-edge.sh
```

The script builds for `x86_64-unknown-linux-gnu`, checks the 8.0 MiB
cap, rsyncs to `/usr/local/bin/openlen-edge.new`, and atomically `mv`s
into place. Conditional restart skips the systemctl call when the unit
isn't enabled yet, which is exactly what we want at this step.

### 4c. Fill /etc/openlen/edge.env

On the box, copy the template and fill the two required values:

```bash
sudo install -m 0640 -o root -g openlen-edge \
  /opt/openlen-app/infra/edge/edge.env.example /etc/openlen/edge.env

sudo $EDITOR /etc/openlen/edge.env
# - OPENLEN_EDGE_DATABASE_URL=<the Neon URL from /etc/openlen/openlen.env>
# - OPENLEN_EDGE_ACME_CONTACT=ops@openlen.com   (already set in template)
# - OPENLEN_EDGE_BIND=0.0.0.0:8443              (BAKE-OFF only — production swap unsets this)
# - OPENLEN_EDGE_BIND_HTTP=off                  (BAKE-OFF only — nginx still owns :80)
# - RUST_LOG=info,openlen_edge=debug            (extra signal during bake-off)
```

Double-check perms — `ls -l /etc/openlen/edge.env` must show
`-rw-r----- root openlen-edge`.

### 4d. Start the edge as a sidecar

```bash
sudo systemctl start openlen-edge
sudo systemctl status openlen-edge --no-pager
sudo journalctl -u openlen-edge -n 80 --no-pager
```

Status should be `active (running)`. Logs should show
`openlen-edge listening` with the configured bind + a few `loaded
persisted cert` lines (zero on first boot is normal).

### 4e. Smoke the sidecar

```bash
# 1. TLS handshake + apex proxy works.
curl -k -I --resolve openlen.com:8443:127.0.0.1 https://openlen.com:8443

# 2. A real subdomain serves static.
curl -k -I --resolve mirror.openlen.com:8443:127.0.0.1 \
  https://mirror.openlen.com:8443

# 3. Metrics endpoint is alive.
curl -s http://127.0.0.1:9090/metrics | head -20
```

All three must return success (200/30x on the curls, Prometheus text
on /metrics). Any failure → debug before continuing.

### 4f. Bench bake-off (the GO/NO-GO gate)

This is the load-test that decides the cutover. Run from the box —
laptop benches over the open internet add too much variance.

```bash
cd /opt/openlen-app
bash bench/run-baseline.sh    # OPENLEN_TARGET defaults to :443 = nginx
bash bench/run-edge.sh        # OPENLEN_TARGET defaults to :8443 = edge sidecar
python3 bench/diff.py
```

The diff applies three gates per scenario:

- **edge median RPS ≥ 95 % of nginx RPS**
- **edge p99 latency ≤ 120 % of nginx p99**
- **edge error rate ≤ nginx error rate + 0.1 pp**

If `diff.py` exits non-zero, **STOP. NO CUTOVER.** Investigate
(check `journalctl -u openlen-edge`, the Grafana dashboard for the
edge's request-duration histogram, and whether the box's CPU/RAM is the
bottleneck for either side). Re-bench after the fix; only proceed when
all three gates pass for all four scenarios.

### 4g. Sidecar soak (24-48h)

Leave the edge running on `:8443` for at least 24 hours, ideally 48.
The operator watches:

- **Grafana** — `OpenLen Edge` dashboard. Request rate should track the
  bench profile; error rate stays at 0; p99 latency stays under the
  bench baseline.
- **journald** — `journalctl -u openlen-edge --since "1 day ago"`.
  Should have zero panics. Cert issuance lines fire for any new custom
  domain.
- **Prometheus alerts** — see `infra/grafana/openlen-edge-alerts.yaml`
  (loaded after F2 S7 ships). Alert silence = soak passing.

If any of those go sideways during the soak → **STOP**. The sidecar
can be killed cleanly (`systemctl stop openlen-edge`) without
production impact since nginx still owns :443.

---

## 5. The swap (~5 seconds of downtime)

Do this when the bake-off + soak are both green. Have a second admin
on call.

### 5a. Stop the sidecar

```bash
sudo systemctl stop openlen-edge
```

### 5b. Promote the env to production binds

```bash
sudo $EDITOR /etc/openlen/edge.env
# - OPENLEN_EDGE_BIND=0.0.0.0:443      (was 8443)
# - OPENLEN_EDGE_BIND_HTTP=0.0.0.0:80  (was off — edge owns the HTTP
#                                       redirect + ACME HTTP-01 now)
# - RUST_LOG=info,openlen_edge=info    (drop the debug verbosity)
```

### 5c. Stop nginx

```bash
sudo systemctl stop nginx
```

This is the start of the downtime window. Apex + wildcard subdomain
TLS handshakes fail until 5e.

### 5d. Disable nginx (do not remove yet — rollback needs it)

```bash
sudo systemctl disable nginx
```

The unit file stays on disk. `systemctl start nginx` is the rollback
command if anything goes wrong in the next 5 minutes.

### 5e. Start the edge on production ports

```bash
sudo systemctl start openlen-edge
sudo systemctl enable openlen-edge
sudo systemctl status openlen-edge --no-pager
```

Status should be `active (running)`. `journalctl -u openlen-edge
-n 50 --no-pager` should show `openlen-edge listening` with the new
bind (`:443`).

### 5f. Smoke test — STOP if any fails

```bash
bash /opt/openlen-app/infra/edge/smoke-test.sh
```

That script runs the eight checks from section 6 below and exits
non-zero on the first failure. Any failure → roll back per section 7.

### 5g. Done — start the soak window timer

Note the cutover time, post in #ops, leave a watch on Grafana + journald
for the next hour minimum.

---

## 6. Smoke test post-cutover

`infra/edge/smoke-test.sh` runs these eight checks. They're written as
shell functions so a failure prints exactly which check broke.

1. **Apex returns 200** — `curl -sI https://openlen.com`
2. **Server header identifies the edge** — `Server: openlen-edge/...`
3. **Wildcard subdomain returns HTML** —
   `curl -s https://mirror.openlen.com` (or whatever sub the operator
   picked as the canary; defaults to `mirror`)
4. **Shared uploads serve direct** — `curl -sI
   https://openlen.com/uploads/<known-file>` + assert `Cache-Control`
   contains `immutable`
5. **Next.js static serves direct** — `curl -sI
   https://openlen.com/_next/static/<known-file>` + assert
   `Cache-Control` contains `immutable, max-age=31536000`
6. **Analytics beacon proxies** — `curl -sI
   https://mirror.openlen.com/c/<known-projectId>` — must reach Node
   (200 or 4xx, NOT 502)
7. **Form submission proxies** — `curl -X POST
   https://mirror.openlen.com/api/f/<known-sub>` (same — Node owns
   the response)
8. **Custom domain TLS + serve** — `curl -sI
   https://<known-verified-custom-domain>` — handshake succeeds, body
   matches the linked project

The script summarises with `8/8 PASS` or `X/8 FAIL: <list>` and exits
0/1. Any FAIL = rollback.

---

## 7. Rollback procedures (per step)

Pick the one matching where the failure surfaced.

### 7a. Failed during 4f (bench gate)

The edge is still on :8443; nginx never stopped. **No downtime.**

```bash
sudo systemctl stop openlen-edge
# Investigate: journalctl, Grafana, profile. Fix on a branch.
# Re-run install.sh + deploy-edge.sh, re-bench. Do NOT continue to 5.
```

### 7b. Failed during 4g (sidecar soak)

Same as 7a — sidecar only.

### 7c. Failed during 5e (edge wouldn't start on :443)

The edge stopped, then both nginx + edge are stopped. **Active
downtime.**

```bash
sudo systemctl start nginx
sudo systemctl enable nginx
sudo systemctl status nginx --no-pager
# nginx is back. Diagnose the edge failure in parallel:
sudo journalctl -u openlen-edge --since "5 minutes ago" --no-pager
```

The Caddy-era unit file is irrelevant; this rollback hits the same
nginx config that was running pre-cutover.

### 7d. Failed during 5f (smoke test)

The edge is running on :443 but smoke shows a regression. **Edge is
serving real traffic, possibly incorrectly.**

```bash
sudo systemctl stop openlen-edge
sudo systemctl start nginx
sudo systemctl enable nginx
sudo systemctl disable openlen-edge
sudo bash /opt/openlen-app/infra/edge/smoke-test.sh  # confirm prod restored
```

Then diagnose. Common smoke failures and what they usually mean:

| Failing check | Likely cause |
|---|---|
| Apex 200 → 502 | edge can't reach Node — check `OPENLEN_EDGE_NODE_URL` |
| Server header missing | a tower layer dropped it — check the unit's env |
| /uploads/ 404 | `OPENLEN_EDGE_UPLOADS_ROOT` wrong, or perms |
| /_next/static/ 404 | `OPENLEN_EDGE_NEXT_STATIC_ROOT` wrong, or perms |
| /c/ 502 | Node up? Try `curl localhost:3000/c/...` |
| /api/f/ 502 | same — proxy to Node failing |
| Custom domain handshake fails | `OPENLEN_EDGE_ACME_*` or DB lookup empty/wrong |

### 7e. During the soak window (post-cutover)

Same procedure as 7d. The edge can be replaced with nginx at any time
during the first 7 days while we keep both unit files on disk.

---

## 8. Soak window (7 days post-cutover)

The edge stays on the production ports; nginx is disabled but its
config + binary remain on disk. The soak passes when ALL of these hold
for 7 consecutive days:

- **error rate < 0.1 %** — Grafana panel "Status class distribution",
  PromQL `sum(rate(openlen_edge_requests_total{status_class="5xx"}[5m])) / sum(rate(openlen_edge_requests_total[5m]))`
- **p99 latency within bench baseline +20 %** — Grafana panel
  "Latency p50/p95/p99 by route kind"; the bench's `bench/results/edge/`
  p99 is the floor
- **zero panics** — `journalctl -u openlen-edge --since "1 day ago" |
  grep -i 'panic\|FATAL' | wc -l` must return 0
- **cert renewals work** — if any cert falls inside the threshold
  window during the soak, the renewal-due gauge should rise then drop
  to 0 (renewal sweep ran successfully)
- **on-demand TLS for new custom domains** — adding a new custom domain
  via the workspace UI + visiting it should issue a fresh cert without
  manual intervention

Grafana alert rules in `infra/grafana/openlen-edge-alerts.yaml` cover
the automated gates. Manual checks for the cert ones.

---

## 9. nginx removal (after 7 clean days of soak)

```bash
# 1. Snapshot what we're about to delete (cheap, ~1 MB).
sudo tar czf /root/nginx-backup-pre-removal.tar.gz \
  /etc/nginx /var/log/nginx

# 2. Remove the packages.
sudo apt-get remove --purge nginx-full nginx-common

# 3. Remove the now-orphaned config dir (the .conf files we put there).
sudo rm -rf /etc/nginx

# 4. Keep the access logs around for 30 days — they're the only record of
#    nginx-era request patterns. Logrotate cleans them up.
# (no-op — /var/log/nginx/ stays; logrotate handles aging.)

# 5. Update openlen-app.service: remove `After=nginx.service`, add
#    `After=openlen-edge.service`. Re-deploy:
sudo $EDITOR /etc/systemd/system/openlen-app.service
sudo systemctl daemon-reload
sudo systemctl restart openlen-app
```

Step 5 keeps openlen-app dependent on the edge being up — useful so
that an edge restart cascades a clean app restart instead of leaving the
app talking to a dead listener.

Do NOT remove nginx earlier than 7 days — the rollback path in
section 7 depends on it.

---

## 10. Activating rate-limit (F4 S2) post-cutover

The edge ships with a per-IP rate limiter (60-second burst + 1-hour
sustained) that drops 429 BEFORE the request reaches Node. It defaults
**off** so the cutover stays safe; activate gradually once the basic
soak is clean and you've watched a few hours of normal traffic
distribution.

### 10a. Pre-flight (10 min)

Confirm the new env vars are set in `/etc/openlen/edge.env`:

```bash
grep -E '^OPENLEN_EDGE_RATE_LIMIT' /etc/openlen/edge.env || true
# Expect either empty (using defaults) or explicit overrides — both fine.
```

Pick starting limits based on observed traffic. Pull last hour's
distribution from Grafana:

```promql
topk(20, sum by (host) (rate(openlen_edge_requests_total[1h])))
```

If your hottest legitimate origin sits at ~200 rps for short bursts,
set per-min ≥ 300 (default) and per-hour ≥ that origin's hourly total
× 1.2 for margin. Aggressive limits trip false positives; conservative
limits catch fewer bots — start permissive, tighten after seeing the
blocked-by-IP histogram.

### 10b. Enable + reload (1 min)

```bash
# /etc/openlen/edge.env
OPENLEN_EDGE_RATE_LIMIT_ENABLED=1
# Optional overrides — sane defaults documented in edge.env.example
# OPENLEN_EDGE_RATE_LIMIT_PER_IP_PER_MIN=300
# OPENLEN_EDGE_RATE_LIMIT_PER_IP_PER_HOUR=5000

sudo systemctl restart openlen-edge
sudo systemctl status openlen-edge   # expect "active (running)"
```

The startup log line shows the active config:

```bash
sudo journalctl -u openlen-edge -n 50 --no-pager | grep -i 'rate.limit'
# edge rate-limit enabled per_min=300 per_hour=5000 exempt_paths=[...] trusted_proxies=0
```

### 10c. Verify (5 min)

```bash
# 1. /metrics surfaces the new counters
curl -s http://127.0.0.1:9090/metrics | grep openlen_edge_rate_limit
#   openlen_edge_rate_limit_decisions_total{result="allowed"} 17
#   openlen_edge_rate_limit_decision_duration_seconds_count 17
#   openlen_edge_rate_limit_memory_hits_total{source="peer_addr"} 17

# 2. ACME challenges still pass (exempt). Force a renewal-check probe:
curl -sk -o /dev/null -w '%{http_code}\n' \
  https://openlen.com/.well-known/acme-challenge/probe
# Expect 404 (no challenge file), NOT 429.

# 3. Synthetic burst from a test machine ONLY (not from prod):
#    From your laptop — replace IP with one you control:
for i in $(seq 1 350); do curl -sk -o /dev/null -w '%{http_code}\n' \
  https://demo.openlen.com/ ; done | sort | uniq -c
# Expect: ~300 × 200, ~50 × 429 (with the default per-min=300).
```

### 10d. Soak (24-72 h)

Watch four Grafana panels (add to the openlen-edge dashboard):

- **Decisions / sec, by result** — `sum by (result)
  (rate(openlen_edge_rate_limit_decisions_total[1m]))` — `blocked`
  should be a tiny minority of `allowed`. A spike in `blocked` with no
  `error` correlation = real abuse caught. A spike in `error` =
  limiter failures (would fail-open, but worth a look).
- **Decision latency p99** — `histogram_quantile(0.99,
  sum(rate(openlen_edge_rate_limit_decision_duration_seconds_bucket[5m]))
  by (le))` — memory-bucket should run sub-100 µs. If p99 climbs past
  10 ms, something's wrong (lock contention? GC pause?).
- **IP source distribution** — `sum by (source)
  (rate(openlen_edge_rate_limit_memory_hits_total[5m]))` — should be
  dominated by `cf_connecting_ip` in prod. If `peer_addr` dominates,
  Cloudflare's not forwarding the header (or trusted_proxies is
  misconfigured).
- **5xx ratio** — unchanged from baseline. If 5xx rises after enabling
  rate-limit, the limiter is mis-classifying legitimate traffic as
  abuse and Node's failing under the increased retry pressure.

### 10e. Rollback (~5 sec)

If the soak shows false positives or the metrics look wrong:

```bash
# /etc/openlen/edge.env
OPENLEN_EDGE_RATE_LIMIT_ENABLED=0
sudo systemctl restart openlen-edge
```

The restart is a fresh process. SmartCache state (in-memory) is
discarded — limits are not "remembered" across restarts. This is the
deliberate trade-off for the memory-only mode: an unwanted block clears
the moment you flip the switch. No DB rollback, no migration, no
forward-compat shim.

### 10f. Tuning checklist

After 7 days of soak the per-IP defaults usually need one of:

- **Tighten** if `blocked` ratio is consistently < 0.01 % and your
  `topk(IP)` histogram shows steady high-volume probers — drop
  per-min to 150-200, per-hour to 2500-3500.
- **Loosen** if `blocked` includes IPs from Grafana's known-good
  origins (search engines, monitoring services, your office NAT) —
  raise per-hour to 10 000+; consider adding their IPs to
  `OPENLEN_EDGE_RATE_LIMIT_TRUSTED_PROXIES` if Cloudflare isn't already
  fronting them.

Limit tuning is iterative — never on call alone; do it after a
session of correlating Grafana counters against the access logs.
