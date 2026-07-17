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

CREATE TABLE IF NOT EXISTS state (
  target TEXT PRIMARY KEY,
  status TEXT NOT NULL,       -- 'up' | 'down'
  since INTEGER NOT NULL,     -- epoch ms del inicio del estado vigente
  fails INTEGER NOT NULL DEFAULT 0
);
