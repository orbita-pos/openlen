-- D1 schema — idempotente; se aplica con:
--   npx wrangler d1 execute openlen-status --remote --file=schema.sql
CREATE TABLE IF NOT EXISTS checks (
  ts INTEGER NOT NULL,        -- epoch ms del run
  target TEXT NOT NULL,       -- 'app' | 'pages' | 'api'
  ok INTEGER NOT NULL,        -- 0/1
  status INTEGER,             -- HTTP status; NULL si error de red/timeout
  latency_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS checks_target_ts ON checks(target, ts);
-- Sólo los fallos (pocas filas): la lista de incidentes los lee sin recorrer la
-- tabla. La consulta tiene que decir `WHERE ok = 0` literal para poder usarlo.
CREATE INDEX IF NOT EXISTS checks_fail ON checks(ts) WHERE ok = 0;

-- Agregado por día, mantenido por el cron (un upsert por check, en el mismo
-- batch que el INSERT). La página lee de aquí las 90 barras y las ventanas de
-- 7 y 90 días: ≤ 270 filas en vez de la tabla cruda entera — ver src/store.ts.
-- Al crearla por primera vez sobre datos existentes: backfill-days.sql.
CREATE TABLE IF NOT EXISTS days (
  target TEXT NOT NULL,
  day TEXT NOT NULL,          -- YYYY-MM-DD (UTC)
  total INTEGER NOT NULL,
  failed INTEGER NOT NULL,
  PRIMARY KEY (target, day)
);

CREATE TABLE IF NOT EXISTS state (
  target TEXT PRIMARY KEY,
  status TEXT NOT NULL,       -- 'up' | 'down'
  since INTEGER NOT NULL,     -- epoch ms del inicio del estado vigente
  fails INTEGER NOT NULL DEFAULT 0
);
