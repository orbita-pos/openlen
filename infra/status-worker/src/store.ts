// Todo el SQL del monitor. index.ts orquesta; aquí vive lo que toca D1, para
// poder probarlo contra un SQLite de verdad (store.test.ts).
//
// 🔴 LA REGLA: NINGUNA consulta recorre `checks` entera. D1 gratis permite 5M
// filas leídas al día y cobra las que la consulta RECORRE, no las que devuelve.
// La versión anterior recalculaba 90 días de agregados desde la tabla cruda en
// cada vista de la página y en cada /api/summary del home: 44,5M filas/día
// (medido el 2026-09-10 con `wrangler d1 insights`), la cuota se agotaba en
// horas y status daba 1101 el resto del día — y el cron, sin cuota, dejaba de
// guardar: el monitor se quedaba ciego. Ahora el cron agrega AL ESCRIBIR, en
// `days`, y la página lee ≤ 270 filas de ahí. store.test.ts lo vigila con
// EXPLAIN QUERY PLAN.
import { TARGETS, dayCells, incidentsFromFailures, uptimePct, type CheckResult, type Incident, type Target, type TargetState } from "./logic";
import type { PageData, TargetView } from "./page";

const DAY_MS = 86_400_000;
const RETENTION_MS = 90 * DAY_MS;
const DAYS = 90;

/** YYYY-MM-DD en UTC — la misma clave que usa dayCells para las barras. */
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// `target IN (…)` delante de `ts` para que el índice (target, ts) sirva SIEMPRE.
// Con sólo `ts` SQLite necesita estadísticas para hacer skip-scan; sin ellas
// recorre el índice entero.
const TARGET_IN = TARGETS.map((_, i) => `?${i + 1}`).join(", ");
const AFTER_TARGETS = TARGETS.length + 1;

export async function readState(db: D1Database, target: Target): Promise<TargetState | null> {
  const row = await db
    .prepare(`SELECT status, since, fails FROM state WHERE target = ?1`)
    .bind(target)
    .first<{ status: "up" | "down"; since: number; fails: number }>();
  return row ?? null;
}

/** Guarda el check Y suma su día en `days`, en una transacción: o las dos, o ninguna. */
export async function persistCheck(db: D1Database, r: CheckResult, now: number): Promise<void> {
  await db.batch([
    db
      .prepare(`INSERT INTO checks (ts, target, ok, status, latency_ms) VALUES (?1, ?2, ?3, ?4, ?5)`)
      .bind(now, r.target, r.ok ? 1 : 0, r.status, r.latencyMs),
    db
      .prepare(
        `INSERT INTO days (target, day, total, failed) VALUES (?1, ?2, 1, ?3)
         ON CONFLICT(target, day) DO UPDATE SET total = total + 1, failed = failed + excluded.failed`,
      )
      .bind(r.target, utcDay(now), r.ok ? 0 : 1),
  ]);
}

export async function writeState(db: D1Database, target: Target, state: TargetState): Promise<void> {
  await db
    .prepare(
      `INSERT INTO state (target, status, since, fails) VALUES (?1, ?2, ?3, ?4)
       ON CONFLICT(target) DO UPDATE SET status = excluded.status, since = excluded.since, fails = excluded.fails`,
    )
    .bind(target, state.status, state.since, state.fails)
    .run();
}

export async function prune(db: D1Database, now: number): Promise<void> {
  await db
    .prepare(`DELETE FROM checks WHERE target IN (${TARGET_IN}) AND ts < ?${AFTER_TARGETS}`)
    .bind(...TARGETS, now - RETENTION_MS)
    .run();
  // `days` guarda exactamente las 90 barras que pinta la página.
  await db.prepare(`DELETE FROM days WHERE day < ?1`).bind(utcDay(now - (DAYS - 1) * DAY_MS)).run();
}

export async function gatherData(db: D1Database, now: number): Promise<PageData> {
  const firstDay = utcDay(now - (DAYS - 1) * DAY_MS);

  // Las 90 barras: ≤ 3 × 90 filas de `days`.
  const dayAgg = await db
    .prepare(`SELECT target, day, total, failed FROM days WHERE day >= ?1`)
    .bind(firstDay)
    .all<{ target: Target; day: string; total: number; failed: number }>();

  // 24 h: ventana MÓVIL exacta sobre `checks` (≤ 288 filas por target, por índice).
  const last24h = await db
    .prepare(
      `SELECT target, COUNT(*) AS total, SUM(ok) AS okc FROM checks
       WHERE target IN (${TARGET_IN}) AND ts >= ?${AFTER_TARGETS} GROUP BY target`,
    )
    .bind(...TARGETS, now - DAY_MS)
    .all<{ target: Target; total: number; okc: number }>();

  // 7 y 90 días: por DÍAS NATURALES UTC, los mismos que pintan las barras (hoy
  // incluido). Antes eran 168 h / 2.160 h móviles recorriendo la tabla cruda.
  const byDays = await Promise.all(
    [7, DAYS].map((n) =>
      db
        .prepare(`SELECT target, SUM(total) AS total, SUM(total - failed) AS okc FROM days WHERE day >= ?1 GROUP BY target`)
        .bind(utcDay(now - (n - 1) * DAY_MS))
        .all<{ target: Target; total: number; okc: number }>(),
    ),
  );

  // Sólo los fallos, por el índice parcial `checks_fail` (WHERE ok = 0 literal:
  // si cambia, SQLite deja de poder usarlo).
  const failures = await db
    .prepare(`SELECT ts, target FROM checks WHERE ok = 0 ORDER BY ts`)
    .all<{ ts: number; target: Target }>();

  // Última latencia: una fila por target, por índice.
  const lastLat = await db
    .prepare(
      TARGETS.map(
        (_, i) => `SELECT * FROM (SELECT target, latency_ms FROM checks WHERE target = ?${i + 1} ORDER BY ts DESC LIMIT 1)`,
      ).join(" UNION ALL "),
    )
    .bind(...TARGETS)
    .all<{ target: Target; latency_ms: number }>();

  const states = await db.prepare(`SELECT target, status, since FROM state`).all<{
    target: Target;
    status: "up" | "down";
    since: number;
  }>();

  const pctFor = (rows: Array<{ target: Target; total: number; okc: number }>, t: Target) => {
    const row = rows.find((r) => r.target === t);
    return row ? uptimePct(row.total, row.okc) : null;
  };

  const targets: TargetView[] = TARGETS.map((t) => {
    const st = states.results.find((r) => r.target === t);
    return {
      target: t,
      status: st?.status ?? "up",
      since: st?.since ?? now,
      lastLatencyMs: lastLat.results.find((r) => r.target === t)?.latency_ms ?? null,
      uptime: {
        d1: pctFor(last24h.results, t),
        d7: pctFor(byDays[0].results, t),
        d90: pctFor(byDays[1].results, t),
      },
      days: dayCells(
        dayAgg.results.filter((r) => r.target === t),
        DAYS,
        now,
      ),
    };
  });

  const incidents: Incident[] = incidentsFromFailures(failures.results).slice(0, 20);
  return { generatedAt: now, targets, incidents };
}
