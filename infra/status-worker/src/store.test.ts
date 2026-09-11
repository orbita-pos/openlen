// El SQL del monitor contra un SQLite DE VERDAD (node:sqlite), con el
// schema.sql real.
//
// POR QUÉ EXISTE: el 2026-09-10 status.openlen.com llevaba semanas cayéndose
// cada día con 1101. D1 gratis permite 5M filas leídas/día y la cuenta leía
// 44,5M: cada vista de la página (y cada /api/summary del home) recalculaba 90
// días de agregados RECORRIENDO la tabla cruda — `dayAgg` sola eran 37,5M
// (medido con `wrangler d1 insights`). Al agotarse la cuota fallaba también el
// cron: el monitor se quedaba ciego y sin alertas el resto del día.
//
// La guarda de abajo corre SIN `ANALYZE` a propósito: sin estadísticas SQLite
// no usa skip-scan, y es el peor caso — una consulta que sólo es barata con
// estadísticas es una consulta que un día deja de serlo.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { DatabaseSync as DatabaseSyncT } from "node:sqlite";
import { describe, expect, test } from "vitest";
import { RUN_MS, TARGETS, dayCells, incidentsFromFailures, uptimePct, type CheckResult, type Target } from "./logic";
import { gatherData, persistCheck, prune, readState, writeState } from "./store";

// Por require y no por import: Vite 2 no tiene `node:sqlite` en su lista de
// módulos nativos, le quita el prefijo y busca un paquete `sqlite` que no existe.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
type DatabaseSync = DatabaseSyncT;

// `__dirname` y no `import.meta.url`: en el entorno de vitest del repo no es un `file:`.
const SCHEMA = readFileSync(join(__dirname, "..", "schema.sql"), "utf8");
const BACKFILL = readFileSync(join(__dirname, "..", "backfill-days.sql"), "utf8");

type Param = string | number | null;

/** Lo mínimo de D1Database que usa store.ts, sobre node:sqlite. Anota cada SQL. */
function d1(db: DatabaseSync, log: string[] = []): D1Database {
  const stmt = (sql: string, params: Param[] = []) => ({
    sql,
    params,
    bind: (...p: Param[]) => stmt(sql, p),
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    first: async () => db.prepare(sql).get(...params) ?? null,
    run: async () => {
      db.prepare(sql).run(...params);
      return { success: true };
    },
  });
  return {
    prepare: (sql: string) => {
      log.push(sql);
      return stmt(sql);
    },
    batch: async (list: Array<ReturnType<typeof stmt>>) => {
      db.exec("BEGIN");
      try {
        for (const s of list) db.prepare(s.sql).run(...s.params);
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      return list.map(() => ({ success: true }));
    },
  } as unknown as D1Database;
}

function freshDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  return db;
}

/** Filas de `checks` que una consulta recorre ENTERA (SCAN), salvo el índice parcial de fallos. */
function fullScansOfChecks(db: DatabaseSync, sql: string): string[] {
  const plan = db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all() as Array<{ detail: string }>;
  return plan
    .map((r) => r.detail)
    .filter((d) => /^SCAN checks\b/.test(d) && !/USING INDEX checks_fail\b/.test(d));
}

// 2026-09-10 00:00 UTC — alineado a medianoche a propósito (ver ventanas).
const NOW = Date.UTC(2026, 8, 10);
const DAY = 86_400_000;

describe("la guarda: ninguna consulta recorre `checks` entera", () => {
  test("ni la página / /api/summary, ni el cron", async () => {
    const db = freshDb();
    const log: string[] = [];
    const store = d1(db, log);
    const r: CheckResult = { target: "app", ok: true, status: 200, latencyMs: 90 };

    await persistCheck(store, r, NOW);
    const prev = await readState(store, "app");
    await writeState(store, "app", { status: "up", since: prev?.since ?? NOW, fails: 0 });
    await prune(store, NOW);
    await gatherData(store, NOW);

    const offenders = log
      .map((sql) => ({ sql: sql.replace(/\s+/g, " ").trim(), scans: fullScansOfChecks(db, sql) }))
      .filter((o) => o.scans.length > 0);
    expect(offenders).toEqual([]);
  });
});

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

interface Run {
  ts: number;
  target: Target;
  ok: boolean;
  latencyMs: number;
}

/** 20 días de runs cada 5 min hasta NOW: un incidente en `pages` (3 fallos seguidos) y un fallo suelto en `api`. */
function history(): Run[] {
  const runs: Run[] = [];
  const start = NOW - 20 * DAY;
  for (let ts = start; ts < NOW; ts += RUN_MS) {
    const i = (ts - start) / RUN_MS;
    for (const target of TARGETS) {
      const ok = !(target === "pages" && i >= 100 && i <= 102) && !(target === "api" && i === 5000);
      runs.push({ ts, target, ok, latencyMs: 100 + (i % 7) + TARGETS.indexOf(target) });
    }
  }
  return runs;
}

async function seedViaCron(runs: Run[]) {
  const db = freshDb();
  const store = d1(db);
  for (const r of runs) {
    await persistCheck(store, { target: r.target, ok: r.ok, status: r.ok ? 200 : 503, latencyMs: r.latencyMs }, r.ts);
  }
  return { db, store };
}

describe("gatherData devuelve lo que dicen los datos", () => {
  test("barras, 24 h / 7 d / 90 d, latencia e incidentes, contra un cálculo independiente", async () => {
    const runs = history();
    const { store } = await seedViaCron(runs);
    const data = await gatherData(store, NOW);

    for (const t of TARGETS) {
      const mine = runs.filter((r) => r.target === t);
      const buckets = new Map<string, { total: number; failed: number }>();
      for (const r of mine) {
        const b = buckets.get(utcDay(r.ts)) ?? { total: 0, failed: 0 };
        b.total++;
        if (!r.ok) b.failed++;
        buckets.set(utcDay(r.ts), b);
      }
      const dayRows = [...buckets].map(([day, b]) => ({ day, ...b }));
      const fromDay = (first: string) => {
        const rows = dayRows.filter((r) => r.day >= first);
        const total = rows.reduce((s, r) => s + r.total, 0);
        return uptimePct(total, total - rows.reduce((s, r) => s + r.failed, 0));
      };
      const last24h = mine.filter((r) => r.ts >= NOW - DAY);
      const view = data.targets.find((v) => v.target === t)!;

      expect(view.days).toEqual(dayCells(dayRows, 90, NOW));
      expect(view.uptime.d1).toBe(uptimePct(last24h.length, last24h.filter((r) => r.ok).length));
      expect(view.uptime.d7).toBe(fromDay(utcDay(NOW - 6 * DAY)));
      expect(view.uptime.d90).toBe(fromDay(utcDay(NOW - 89 * DAY)));
      expect(view.lastLatencyMs).toBe(mine.reduce((a, b) => (b.ts > a.ts ? b : a)).latencyMs);
    }

    const failures = runs.filter((r) => !r.ok).map((r) => ({ ts: r.ts, target: r.target }));
    expect(data.incidents).toEqual(incidentsFromFailures(failures).slice(0, 20));
    // El fixture ejercita de verdad los fallos: si esto no se cumple, lo de arriba no prueba nada.
    expect(data.incidents).toHaveLength(1);
    expect(data.targets.find((v) => v.target === "pages")!.uptime.d90).toBeLessThan(100);
    expect(data.targets.find((v) => v.target === "pages")!.days.some((d) => d.state === "degraded")).toBe(true);
  });
});

describe("backfill-days.sql", () => {
  test("reconstruye `days` exactamente igual que el cron, y re-ejecutarlo no duplica", async () => {
    const runs = history();
    const { db: viaCron } = await seedViaCron(runs);

    const raw = freshDb();
    const ins = raw.prepare(`INSERT INTO checks (ts, target, ok, status, latency_ms) VALUES (?, ?, ?, ?, ?)`);
    for (const r of runs) ins.run(r.ts, r.target, r.ok ? 1 : 0, r.ok ? 200 : 503, r.latencyMs);

    const q = `SELECT target, day, total, failed FROM days ORDER BY target, day`;
    raw.exec(BACKFILL);
    expect(raw.prepare(q).all()).toEqual(viaCron.prepare(q).all());
    raw.exec(BACKFILL);
    expect(raw.prepare(q).all()).toEqual(viaCron.prepare(q).all());
  });
});

describe("prune", () => {
  test("la retención se lleva lo viejo de `checks` Y de `days`", async () => {
    const db = freshDb();
    const store = d1(db);
    const r: CheckResult = { target: "app", ok: true, status: 200, latencyMs: 90 };
    await persistCheck(store, r, NOW - 91 * DAY);
    await persistCheck(store, r, NOW - DAY);

    await prune(store, NOW);

    expect(db.prepare(`SELECT ts FROM checks`).all()).toEqual([{ ts: NOW - DAY }]);
    expect(db.prepare(`SELECT day FROM days`).all()).toEqual([{ day: utcDay(NOW - DAY) }]);
  });
});
