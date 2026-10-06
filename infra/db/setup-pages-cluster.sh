#!/usr/bin/env bash
#
# EL CLÚSTER DE POSTGRES DE LAS PÁGINAS (plans/pages-backend/design.md, fase 7).
#
# Un clúster APARTE del de la app, en la misma caja: una base por proyecto
# (`ol_<ref>`), con los roles de Supabase (anon, authenticated, service_role,
# authenticator, supabase_auth_admin) que crea la app la primera vez que un
# proyecto pide su base (lib/backend/provision.ts). Carril D: también
# `supabase_storage_admin`, el dueño del esquema `storage`, que crea la app
# como este mismo administrador (lib/backend/storage/provision.ts), sin
# CREATEROLE ni LOGIN; y `supabase_realtime_admin`, el del esquema `realtime`
# (lib/backend/realtime/provision.ts). Lo de Realtime que sólo puede hacer un
# superusuario va en el paso 3b. Aparte para que el
# administrador de las páginas no tenga NADA que ver con la base de la app.
#
# El administrador NO es superusuario: CREATEDB + CREATEROLE + BYPASSRLS y
# `createrole_self_grant = 'set, inherit'` (Postgres 16+: sin eso no puede
# `SET ROLE` a los roles que él mismo crea, y `provisionDatabase` lo necesita).
# Medido el 2026-10-04 contra un Postgres 17 limpio con exactamente este rol:
# lib/backend/pg-e2e.test.ts 5/5, y la copia nocturna vuelca cada base entera.
# ⚠️ Los roles de Supabase tiene que crearlos ESTE administrador (lo hace la
# app sola): si los crea otro, no puede concederlos («permission denied to
# grant role "anon"», medido).
#
# Idempotente: se puede volver a correr. No toca contraseñas que ya existan.
#
# Uso, como root en la caja (Ubuntu + PostgreSQL 17 de PGDG):
#   sudo bash infra/db/setup-pages-cluster.sh
# y después reiniciar la app para que lea las variables:
#   sudo systemctl restart openlen-app

set -euo pipefail

PG_MAJOR="${PG_MAJOR:-17}"
CLUSTER="${PAGES_CLUSTER:-pages}"
PORT="${PAGES_PORT:-5433}"
ADMIN="openlen_pages_admin"
ENV_FILE="${OPENLEN_ENV_FILE:-/etc/openlen/openlen.env}"

[[ $EUID -eq 0 ]] || { echo "error: hay que correrlo como root" >&2; exit 1; }
command -v pg_createcluster >/dev/null || { echo "error: falta postgresql-common (pg_createcluster)" >&2; exit 1; }
[[ -f "$ENV_FILE" ]] || { echo "error: no existe $ENV_FILE" >&2; exit 1; }

# ── 1. El clúster ───────────────────────────────────────────────────────────
if pg_lsclusters --no-header | awk '{print $1"/"$2}' | grep -qx "$PG_MAJOR/$CLUSTER"; then
  echo "== clúster $PG_MAJOR/$CLUSTER: ya existe"
else
  echo "== clúster $PG_MAJOR/$CLUSTER: creándolo en el puerto $PORT"
  pg_createcluster "$PG_MAJOR" "$CLUSTER" --port "$PORT" -- --auth-local=peer --auth-host=scram-sha-256
fi

# carril D (pieza 15): el decodificador de wal2json que usa Realtime (PGDG).
if ! dpkg -s "postgresql-$PG_MAJOR-wal2json" >/dev/null 2>&1; then
  echo "== instalando postgresql-$PG_MAJOR-wal2json"
  apt-get install -y "postgresql-$PG_MAJOR-wal2json"
fi

CONF_DIR="/etc/postgresql/$PG_MAJOR/$CLUSTER/conf.d"
mkdir -p "$CONF_DIR"
# Sólo loopback: lo usa Next, en esta misma caja. Conexiones: un pool pequeño
# por base abierta (lib/backend/pg.ts: hasta 40 pools de 4 + los del admin).
cat > "$CONF_DIR/openlen-pages.conf" <<'CONF'
listen_addresses = '127.0.0.1'
max_connections = 220
password_encryption = scram-sha-256
# carril D (Len 2.5, pieza 15): postgres_changes de Realtime lee la WAL con
# wal2json desde un slot TEMPORAL por proyecto con suscriptores (se va con su
# conexión). `logical` pide reiniciar el clúster. El tope de WAL retenida es
# para que un slot atascado no llene el disco: pasado, Postgres lo invalida
# (y el servicio abre otro).
wal_level = logical
max_replication_slots = 64
max_slot_wal_keep_size = 2GB
CONF
chown -R postgres:postgres "/etc/postgresql/$PG_MAJOR/$CLUSTER"

systemctl enable "postgresql@$PG_MAJOR-$CLUSTER" >/dev/null
systemctl restart "postgresql@$PG_MAJOR-$CLUSTER"

psql_pages() { sudo -u postgres psql -p "$PORT" -X -v ON_ERROR_STOP=1 "$@"; }

# ── 2. Las variables de la app (sin pisar las que ya estén) ─────────────────
env_get() { grep -E "^$1=" "$ENV_FILE" | head -n1 | cut -d= -f2- | tr -d '"' || true; }
ADMIN_URL="$(env_get PAGES_DATABASE_URL)"
if [[ -z "$ADMIN_URL" ]]; then
  ADMIN_PW="$(openssl rand -hex 24)"
  ADMIN_URL="postgresql://$ADMIN:$ADMIN_PW@127.0.0.1:$PORT/postgres"
  echo "PAGES_DATABASE_URL=$ADMIN_URL" >> "$ENV_FILE"
  echo "== PAGES_DATABASE_URL añadida a $ENV_FILE"
else
  ADMIN_PW="$(echo "$ADMIN_URL" | sed -E 's#^[a-z]+://[^:]+:([^@]+)@.*#\1#')"
  echo "== PAGES_DATABASE_URL: ya estaba"
fi
if [[ -z "$(env_get PAGES_AUTHENTICATOR_PASSWORD)" ]]; then
  # Sólo [A-Za-z0-9]: la app la pega en SQL como literal y en URLs.
  echo "PAGES_AUTHENTICATOR_PASSWORD=$(openssl rand -hex 24)" >> "$ENV_FILE"
  echo "== PAGES_AUTHENTICATOR_PASSWORD añadida a $ENV_FILE"
else
  echo "== PAGES_AUTHENTICATOR_PASSWORD: ya estaba"
fi

# ── 3. El administrador ─────────────────────────────────────────────────────
# La contraseña entra por variable de psql (stdin), no por la línea de órdenes.
psql_pages -v admin="$ADMIN" -v pw="$ADMIN_PW" <<'SQL'
select format('create role %I login', :'admin')
 where not exists (select from pg_roles where rolname = :'admin') \gexec
select format('alter role %I with login createdb createrole bypassrls nosuperuser password %L', :'admin', :'pw') \gexec
select format('alter role %I set createrole_self_grant = %L', :'admin', 'set, inherit') \gexec
SQL
echo "== $ADMIN listo (CREATEDB CREATEROLE BYPASSRLS, createrole_self_grant = 'set, inherit')"

# ── 3b. Realtime (carril D, pieza 15) ───────────────────────────────────────
# Sólo un superusuario puede dar estas dos cosas:
#   · `SET ON PARAMETER log_min_messages` al administrador: la función
#     `realtime.list_changes` de Supabase lo lleva (`SET log_min_messages TO
#     'fatal'`), y sin él no la puede crear (medido con
#     lib/backend/realtime/production-roles.pglite.test.ts).
#   · El rol `openlen_realtime`, LOGIN REPLICATION y NADA más (ni miembro de
#     nada): el que lee el slot de wal2json. El administrador NO recibe
#     REPLICATION: su sesión llega a los roles de todos los proyectos, y por el
#     slot no corre código del proyecto (lib/backend/realtime/wal-reader.ts).
REALTIME_PW="$(env_get PAGES_REALTIME_PASSWORD)"
if [[ -z "$REALTIME_PW" ]]; then
  REALTIME_PW="$(openssl rand -hex 24)"
  echo "PAGES_REALTIME_PASSWORD=$REALTIME_PW" >> "$ENV_FILE"
  echo "== PAGES_REALTIME_PASSWORD añadida a $ENV_FILE"
fi
psql_pages -v admin="$ADMIN" -v pw="$REALTIME_PW" <<'SQL'
select format('grant set on parameter log_min_messages to %I', :'admin') \gexec
select 'create role openlen_realtime login replication'
 where not exists (select from pg_roles where rolname = 'openlen_realtime') \gexec
select format('alter role openlen_realtime with login replication nosuperuser nocreatedb nocreaterole nobypassrls password %L', :'pw') \gexec
SQL
echo "== openlen_realtime listo (LOGIN REPLICATION) y log_min_messages para $ADMIN"

# ── 4. Comprobación ─────────────────────────────────────────────────────────
PGPASSWORD="$ADMIN_PW" psql "postgresql://$ADMIN@127.0.0.1:$PORT/postgres" -XAtc \
  "select current_user, rolcreatedb, rolcreaterole, rolbypassrls, rolsuper from pg_roles where rolname = current_user"
echo "== hecho. Falta: sudo systemctl restart openlen-app"
