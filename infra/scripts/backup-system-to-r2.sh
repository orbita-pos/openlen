#!/usr/bin/env bash
#
# Nightly system backup → R2 `openlen-backup` bucket. Complements
# backup-published-to-r2.sh (which covers /var/www/openlen): this one covers
# everything else a dead box would lose —
#   uploads/   /var/openlen/uploads (skipped if prod stores uploads in R2)
#   db/        encrypted pg_dump of Neon, newest 7 kept
#   pages/     encrypted tar of every page database (`ol_<ref>`) + its roles,
#              newest 7 kept (the pages backend cluster, PAGES_DATABASE_URL)
#   etc/       encrypted tar of /etc/openlen (minus backup.pass), newest 7 kept
#   manifest/  which openlen units/timers are enabled + tool versions
#
# Triggered by openlen-backup-system.timer. Manual run:
#   bash infra/scripts/backup-system-to-r2.sh
#
# Requires:
#   /etc/openlen/rclone.conf  — [r2-published] remote (same file the pages
#                               backup uses; its token must reach the
#                               openlen-backup bucket too)
#   /etc/openlen/backup.pass  — encryption passphrase. NOT backed up with the
#                               data it encrypts; the operator keeps a copy in
#                               their password manager. Without it the db/ and
#                               etc/ objects are unreadable.
#   pg_dump — version >= the Neon server major version.
#   psql + pg_dumpall — for the pages cluster (same postgresql-client package).

set -uo pipefail
# No -e: sections run isolated so one transient failure (a flaky rclone call,
# a missing tool) doesn't skip the sections after it. Failures accumulate into
# FAILED and the script exits 1 at the end so systemd still flags the run.
# The two preflight checks below stay hard exits — without them nothing after
# can succeed anyway.

RCLONE_CONF="${RCLONE_CONF:-/etc/openlen/rclone.conf}"
REMOTE="${OPENLEN_SYSBACKUP_REMOTE:-r2-published:openlen-backup}"
PASS_FILE="${OPENLEN_BACKUP_PASS:-/etc/openlen/backup.pass}"
ENV_FILE="${OPENLEN_ENV_FILE:-/etc/openlen/openlen.env}"
UPLOADS_DIR="${UPLOADS_DIR:-/var/openlen/uploads}"
KEEP=7

STAMP="$(date -u +%Y%m%d)"
# Hard exit: sin -e global, un mktemp fallido dejaría WORK="" y los artefactos
# (incluido el dump SIN cifrar) caerían en / — preflight, igual que los checks
# de rclone.conf y backup.pass.
WORK="$(mktemp -d)" || { echo "error: mktemp failed" >&2; exit 1; }
trap 'rm -rf "$WORK"' EXIT

[[ -f "$RCLONE_CONF" ]] || { echo "error: no rclone config at $RCLONE_CONF" >&2; exit 1; }
[[ -f "$PASS_FILE" ]] || { echo "error: no passphrase at $PASS_FILE" >&2; exit 1; }

FAILED=0
warn() { FAILED=1; echo "warn: $*" >&2; }

rc() { rclone --config "$RCLONE_CONF" --retries 3 "$@"; }

encrypt() { # encrypt SRC DST
  openssl enc -aes-256-cbc -pbkdf2 -pass "file:$PASS_FILE" -in "$1" -out "$2"
}

# Keep the newest $KEEP objects under REMOTE/<prefix>/ (names embed the date,
# so lexicographic sort == chronological). List-based on purpose: an age-based
# prune could delete every copy if the backup had been failing for a week.
prune() { # prune PREFIX
  local fail=0 listing
  # lsf capturado aparte: con el process substitution su exit status se
  # descartaba y un fallo real de listado parecía "sin candidatos".
  listing="$(rc lsf "$REMOTE/$1/" | sort | head -n "-$KEEP")" || return 1
  while read -r f; do
    [[ -n "$f" ]] && { rc deletefile "$REMOTE/$1/$f" && echo "  pruned $1/$f" || fail=1; }
  done <<< "$listing"
  return "$fail"
}

# ── 1. uploads ──────────────────────────────────────────────────────────────
if [[ -d "$UPLOADS_DIR" ]]; then
  echo "== uploads: sync $UPLOADS_DIR"
  # No --copy-links here on purpose: uploads has no symlinks (unlike the pages
  # backup, which needs it to follow releases/current).
  rc sync "$UPLOADS_DIR/" "$REMOTE/uploads/" --transfers 8 --log-level INFO || warn "uploads: sync falló"
else
  echo "== uploads: skip ($UPLOADS_DIR not present — prod likely stores uploads in R2)"
fi

# ── 2. DB dump (Neon) ───────────────────────────────────────────────────────
# Direct (unpooled) URL first: pg_dump can't ride a transaction pooler.
DB_URL=""
if [[ -f "$ENV_FILE" ]]; then
  for key in DATABASE_URL_DIRECT DATABASE_URL_UNPOOLED DATABASE_URL; do
    DB_URL="$(grep -E "^${key}=" "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '"' || true)"
    [[ -n "$DB_URL" ]] && { echo "== db: dumping via $key"; break; }
  done
  [[ -z "$DB_URL" ]] && echo "== db: skip (no DATABASE_URL in $ENV_FILE)" >&2
else
  echo "== db: skip (no $ENV_FILE)"
fi

if [[ -n "$DB_URL" ]]; then
  if pg_dump "$DB_URL" --format=custom --no-owner --file="$WORK/db.dump"; then
    encrypt "$WORK/db.dump" "$WORK/openlen-$STAMP.dump.enc" \
      && rc copyto "$WORK/openlen-$STAMP.dump.enc" "$REMOTE/db/openlen-$STAMP.dump.enc" \
      || warn "db: encrypt/subida falló"
    prune db || warn "db: prune falló"
  else
    warn "db: pg_dump falló"
  fi
fi

# ── 2b. Las bases de las páginas (lib/backend, plans/pages-backend) ─────────
# Una base de Postgres por proyecto (`ol_<ref>`) en el clúster de las páginas:
# los datos y los usuarios de cada página publicada. Se vuelca cada una con el
# administrador del clúster (PAGES_DATABASE_URL: CREATEDB CREATEROLE BYPASSRLS y
# `createrole_self_grant = 'set, inherit'`, así que lee todo, RLS incluido), más
# los roles SIN contraseña: la de cada rol de desarrollador vive cifrada en
# `projectBackends` (base de la app, sección 2) y la de `authenticator` en
# openlen.env. Probado el 2026-10-04 con ese mismo rol contra un Postgres 17.
pages_url_for() { # pages_url_for DB — la URL del administrador con otra base
  local u="$PAGES_URL" q=""
  if [[ "$u" == *\?* ]]; then q="?${u#*\?}"; u="${u%%\?*}"; fi
  echo "${u%/*}/$1$q"
}
PAGES_URL=""
if [[ -f "$ENV_FILE" ]]; then
  PAGES_URL="$(grep -E '^PAGES_DATABASE_URL=' "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '"' || true)"
fi
if [[ -z "$PAGES_URL" ]]; then
  echo "== pages: skip (no PAGES_DATABASE_URL in $ENV_FILE)"
else
  echo "== pages: las bases del clúster de las páginas"
  mkdir -p "$WORK/pages"
  pages_ok=1
  pg_dumpall -d "$PAGES_URL" --roles-only --no-role-passwords > "$WORK/pages/roles.sql" \
    || { warn "pages: roles falló"; pages_ok=0; }
  if dbs="$(psql "$PAGES_URL" -XAtc "select datname from pg_database where datname like 'ol\_%' order by 1")"; then
    n=0
    while read -r db; do
      [[ -z "$db" ]] && continue
      if pg_dump "$(pages_url_for "$db")" --format=custom --file="$WORK/pages/$db.dump"; then
        n=$((n + 1))
      else
        warn "pages: pg_dump de $db falló"; pages_ok=0
      fi
    done <<< "$dbs"
    echo "  $n bases volcadas"
  else
    warn "pages: listar las bases falló"; pages_ok=0
  fi
  # Lo que haya se sube aunque falte algo (mejor una copia parcial que
  # ninguna); sólo se poda con una copia completa.
  if tar -C "$WORK" -cf "$WORK/pages.tar" pages \
      && encrypt "$WORK/pages.tar" "$WORK/pages-$STAMP.tar.enc" \
      && rc copyto "$WORK/pages-$STAMP.tar.enc" "$REMOTE/pages/pages-$STAMP.tar.enc"; then
    (( pages_ok )) && { prune pages || warn "pages: prune falló"; }
  else
    warn "pages: tar/encrypt/subida falló"
  fi
fi

# ── 3. /etc/openlen (minus the passphrase that encrypts it) ─────────────────
# NOT /etc/letsencrypt: this backup runs as openlen-deploy, which can't read
# certbot's root-only cloudflare.ini (600 root:root) or the ssl-cert-group
# private keys — tar would exit non-zero and sink the whole /etc upload with
# it. The certs are disposable anyway (certbot re-issues on a fresh box via
# DNS-01); the token is an off-box secret in the operator's password manager,
# recreated during recovery (see infra/DR_RUNBOOK.md §0/§3), same treatment
# as rclone.conf.
echo "== etc: /etc/openlen"
# --exclude is relative to tar's -C start dir (/etc); stripping the /etc/
# prefix from PASS_FILE keeps this correct for nested overrides of
# OPENLEN_BACKUP_PASS, and is a no-op for the default backup.pass path.
if tar -C /etc -czf "$WORK/etc.tar.gz" --exclude "${PASS_FILE#/etc/}" openlen \
    && encrypt "$WORK/etc.tar.gz" "$WORK/etc-$STAMP.tar.gz.enc"; then
  rc copyto "$WORK/etc-$STAMP.tar.gz.enc" "$REMOTE/etc/etc-$STAMP.tar.gz.enc" || warn "etc: subida falló"
  prune etc || warn "etc: prune falló"
else
  warn "etc: tar/encrypt falló"
fi

# ── 4. manifest — what a fresh box must re-enable ──────────────────────────
{
  echo "generated: $(date -u -Is)"
  echo "== enabled openlen units =="
  systemctl list-unit-files 'openlen-*' --no-pager 2>/dev/null || true
  echo "== timers =="
  systemctl list-timers 'openlen-*' --all --no-pager 2>/dev/null || true
  echo "== versions =="
  node --version 2>/dev/null || true
  caddy version 2>/dev/null || true
  google-chrome --version 2>/dev/null || true
  pg_dump --version 2>/dev/null || true
} > "$WORK/manifest.txt"
rc copyto "$WORK/manifest.txt" "$REMOTE/manifest/manifest.txt" || warn "manifest: subida falló"

if (( FAILED )); then
  echo "system backup: TERMINÓ CON FALLOS PARCIALES ($STAMP)" >&2
  exit 1
fi
echo "system backup ok: $STAMP"
