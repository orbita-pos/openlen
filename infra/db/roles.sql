-- OpenLen — least-privilege roles. Run AS postgres AFTER the DB exists:
--   sudo -u postgres psql -v ON_ERROR_STOP=1 -f roles.sql
--
-- Passwords come from psql variables so they never land in shell history. Pass
-- them from /etc/openlen/db.env, e.g.:
--   set -a; . /etc/openlen/db.env; set +a
--   sudo -u postgres psql -v ON_ERROR_STOP=1 \
--     -v app_pw="$OPENLEN_APP_PASSWORD"        -v migrate_pw="$OPENLEN_MIGRATE_PASSWORD" \
--     -v backup_pw="$OPENLEN_BACKUP_PASSWORD"  -v edge_pw="$OPENLEN_EDGE_RO_PASSWORD" \
--     -v metrics_pw="$OPENLEN_METRICS_PASSWORD" -f roles.sql
--
-- Idempotent: re-running just resets passwords/grants.

\set ON_ERROR_STOP on

-- ── Roles ────────────────────────────────────────────────────────────────────
-- openlen_migrate: the ONLY DDL role (drizzle-kit). Owns the schema's objects.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='openlen_migrate') THEN
    CREATE ROLE openlen_migrate LOGIN;
  END IF;
END $$;
ALTER ROLE openlen_migrate PASSWORD :'migrate_pw';

-- openlen_app: DML only, owns nothing. A leaked app credential can't DROP a table.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='openlen_app') THEN
    CREATE ROLE openlen_app LOGIN;
  END IF;
END $$;
ALTER ROLE openlen_app PASSWORD :'app_pw';

-- openlen_edge_ro: SELECT-only for the Rust edge custom-domain lookup.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='openlen_edge_ro') THEN
    CREATE ROLE openlen_edge_ro LOGIN;
  END IF;
END $$;
ALTER ROLE openlen_edge_ro PASSWORD :'edge_pw';

-- openlen_backup: read + replication for pgBackRest / a future warm replica.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='openlen_backup') THEN
    CREATE ROLE openlen_backup LOGIN REPLICATION;
  END IF;
END $$;
ALTER ROLE openlen_backup PASSWORD :'backup_pw';

-- openlen_metrics: postgres_exporter (read-only monitoring views).
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='openlen_metrics') THEN
    CREATE ROLE openlen_metrics LOGIN;
  END IF;
END $$;
ALTER ROLE openlen_metrics PASSWORD :'metrics_pw';
GRANT pg_monitor TO openlen_metrics;

-- ── Database ─────────────────────────────────────────────────────────────────
-- Create the DB owned by the migrate role (so it owns objects restored into it).
SELECT 'CREATE DATABASE openlen OWNER openlen_migrate'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname='openlen') \gexec

-- ── Grants (run inside the openlen DB) ───────────────────────────────────────
\connect openlen

-- public schema owned by migrate; app/edge get scoped access.
ALTER SCHEMA public OWNER TO openlen_migrate;
GRANT USAGE ON SCHEMA public TO openlen_app, openlen_edge_ro, openlen_metrics;

-- App: full DML on all current + future tables/sequences (no DDL).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES    IN SCHEMA public TO openlen_app;
GRANT USAGE, SELECT, UPDATE          ON ALL SEQUENCES IN SCHEMA public TO openlen_app;
ALTER DEFAULT PRIVILEGES FOR ROLE openlen_migrate IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO openlen_app;
ALTER DEFAULT PRIVILEGES FOR ROLE openlen_migrate IN SCHEMA public
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO openlen_app;

-- Edge: SELECT only (it only reads customDomains).
GRANT SELECT ON ALL TABLES IN SCHEMA public TO openlen_edge_ro;
ALTER DEFAULT PRIVILEGES FOR ROLE openlen_migrate IN SCHEMA public
  GRANT SELECT ON TABLES TO openlen_edge_ro;

-- Metrics: read on stats views via pg_monitor (already granted above) — no table grants needed.
