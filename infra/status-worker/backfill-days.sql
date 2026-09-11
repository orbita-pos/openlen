-- Reconstruye `days` desde `checks`. Idempotente y AUTORITATIVO: pisa cada
-- (target, día) con la cuenta real, así que se puede re-ejecutar sin duplicar y
-- corrige cualquier deriva. Recorre `checks` entera UNA vez (~80k filas), así que
-- es una operación manual, no algo del cron:
--   npx wrangler d1 execute openlen-status --remote --file=backfill-days.sql
-- `WHERE true` es obligatorio: sin él SQLite no distingue el ON del upsert del
-- ON de un JOIN (documentado en sqlite.org/lang_upsert.html).
INSERT INTO days (target, day, total, failed)
SELECT target, date(ts / 1000, 'unixepoch'), COUNT(*), SUM(1 - ok)
FROM checks WHERE true
GROUP BY target, date(ts / 1000, 'unixepoch')
ON CONFLICT(target, day) DO UPDATE SET total = excluded.total, failed = excluded.failed;
