// @vitest-environment node
//
// The `app_rows` source against a REAL Postgres, as production's read-only role sees it (final review C1): SELECT
// only, NOINHERIT. `information_schema.table_constraints` hides the keys of a table that role can only SELECT, so
// the primary key is read from `pg_index`, like the rest of the backend does.
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { QueryOutcome } from "@/lib/backend/cli-core";

const base = vi.hoisted(() => ({ pg: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/backend/live-read", () => ({
  queryLive: async (_projectId: string, sql: string): Promise<QueryOutcome> => {
    const pg = base.pg as PGlite;
    try {
      const r = await pg.query<unknown[]>(sql, [], { rowMode: "array" });
      return { kind: "rows", columns: r.fields.map((f) => f.name), rows: r.rows, truncated: false };
    } catch (err) {
      return { kind: "error", message: (err as Error).message, code: (err as { code?: string }).code };
    }
  },
}));

const { appRowsSource } = await import("./app-rows");
const { evaluate } = await import("../trigger");
const CTX = { timeZone: "UTC", now: new Date("2026-11-04T12:00:00Z"), ownerId: "owner" };

const pg = () => base.pg as PGlite;

beforeEach(async () => {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE reservas (id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), dia date NOT NULL DEFAULT current_date, hora time, mesa int, nombre text);
    INSERT INTO reservas (id, created_at, dia, hora, mesa, nombre) VALUES
      ('00000000-0000-0000-0000-000000000001', '2026-11-03 10:00:00+00', '2026-11-14', '21:00', 4, 'Ana'),
      ('00000000-0000-0000-0000-000000000002', '2026-11-03 11:00:00+00', '2026-11-15', '20:00', 2, 'Luis');
    CREATE ROLE ro NOLOGIN NOINHERIT;
    GRANT USAGE ON SCHEMA public TO ro;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO ro;
    SET ROLE ro;`);
  base.pg = db;
});

describe("app_rows as the production read-only role", () => {
  it("finds the table's primary key and starts at its newest row", async () => {
    const v = await appRowsSource.validate("p1", { table: "reservas", created_column: "created_at" }, CTX);
    expect(v).toEqual({ ok: true, initialState: { key_column: "id", cursor: { at: expect.any(String), key: "00000000-0000-0000-0000-000000000002" } } });
    // The cursor is Postgres's own text of the newest row's instant, in the session's zone.
    const at = v.ok ? (v.initialState as { cursor: { at: string } }).cursor.at : "";
    expect((await pg().query<{ same: boolean }>(`SELECT $1::timestamptz = '2026-11-03 11:00:00+00'::timestamptz AS same`, [at])).rows[0]!.same).toBe(true);
  });

  it("then sees a row added after it", async () => {
    const v = await appRowsSource.validate("p1", { table: "reservas", created_column: "created_at" }, CTX);
    if (!v.ok) throw new Error(v.reason);
    await pg().exec(`RESET ROLE; INSERT INTO reservas (id, created_at, nombre) VALUES ('00000000-0000-0000-0000-000000000003', '2026-11-03 12:00:00+00', 'Marta'); SET ROLE ro;`);
    const o = await appRowsSource.observe("p1", { table: "reservas", created_column: "created_at" }, v.initialState, CTX);
    expect(o.changes.map((c) => c.detail.nombre)).toEqual(["Marta"]);
  });

  it("refuses a date column: rows of the same day can't be told apart by when they came", async () => {
    const v = await appRowsSource.validate("p1", { table: "reservas", created_column: "dia" }, CTX);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/timestamp/);
  });

  it("reads older rows by their fields, each value compared in its column's type (Task 13)", async () => {
    const v = await appRowsSource.validate("p1", { table: "reservas", created_column: "created_at" }, CTX);
    if (!v.ok) throw new Error(v.reason);
    const out = (await appRowsSource.read("p1", { table: "reservas", created_column: "created_at" }, {
      keys: [],
      state: v.initialState,
      match: [{ field: "dia", value: "2026-11-14" }, { field: "hora", value: "21:00" }, { field: "mesa", value: "4" }], ctx: CTX })) as { matching: { nombre: string }[] };
    expect(out.matching.map((r) => r.nombre)).toEqual(["Ana"]);
  });

  it("a field that isn't a column of the table is said, with the columns there are", async () => {
    const v = await appRowsSource.validate("p1", { table: "reservas", created_column: "created_at" }, CTX);
    if (!v.ok) throw new Error(v.reason);
    await expect(
      appRowsSource.read("p1", { table: "reservas", created_column: "created_at" }, { keys: [], state: v.initialState, match: [{ field: "mesa\" OR 1=1 --", value: "4" }], ctx: CTX }),
    ).rejects.toThrow(/no column .*Columns: .*mesa/);
  });
});

// «Esperar es una fuente» (spec local 2026-11-04-hazlo, §7.4.3): with after_hours a row wakes the task N hours after it
// was created, as it is then; the judge never schedules a wait. Postgres's own clock decides the age.
describe("app_rows with after_hours", () => {
  const PARAMS = { table: "esperan", created_column: "created_at", after_hours: 24 };
  const R1 = "00000000-0000-0000-0000-0000000000e1";
  async function table(type: "timestamptz" | "timestamp", rows: { id: string; hoursAgo: number; confirmada: boolean }[]) {
    const now = type === "timestamptz" ? "now()" : "localtimestamp";
    await pg().exec(`RESET ROLE;
      CREATE TABLE esperan (id uuid PRIMARY KEY, created_at ${type} NOT NULL, confirmada boolean NOT NULL DEFAULT false);
      GRANT SELECT ON esperan TO ro;
      ${rows.map((r) => `INSERT INTO esperan VALUES ('${r.id}', ${now} - interval '${r.hoursAgo} hours', ${r.confirmada});`).join("\n")}
      SET ROLE ro;`);
  }
  const age = (id: string, hoursAgo: number, type: "timestamptz" | "timestamp" = "timestamptz") =>
    pg().exec(`RESET ROLE; UPDATE esperan SET created_at = ${type === "timestamptz" ? "now()" : "localtimestamp"} - interval '${hoursAgo} hours' WHERE id = '${id}'; SET ROLE ro;`);
  const started = async (params = PARAMS) => {
    const v = await appRowsSource.validate("p1", params, CTX);
    if (!v.ok) throw new Error(v.reason);
    return v.initialState;
  };

  it("with after_hours a row wakes the task only once it is that old", async () => {
    await table("timestamptz", [{ id: R1, hoursAgo: 23, confirmada: false }]);
    const state = await started();
    const young = await appRowsSource.observe("p1", PARAMS, state, CTX);
    expect(young.changes).toEqual([]);
    await age(R1, 25);
    const old = await appRowsSource.observe("p1", PARAMS, young.state, CTX);
    expect(old.changes.map((c) => c.detail.id)).toEqual([R1]);
    expect((await appRowsSource.observe("p1", PARAMS, old.state, CTX)).changes).toEqual([]);
  });

  it("a row that stopped matching before the hours passed never wakes it", async () => {
    await table("timestamptz", [{ id: R1, hoursAgo: 10, confirmada: false }]);
    const state = await started();
    await pg().exec(`RESET ROLE; UPDATE esperan SET confirmada = true WHERE id = '${R1}'; SET ROLE ro;`);
    await age(R1, 25);
    const o = await appRowsSource.observe("p1", PARAMS, state, CTX);
    // It comes of age, and the trigger reads it as it is then.
    expect(o.changes.map((c) => c.detail.id)).toEqual([R1]);
    expect(evaluate({ changes: o.changes, conditions: [{ field: "confirmada", op: "eq", value: "false" }] }).candidate).toBeNull();
  });

  it("rows already past the mark when the task is made never fire", async () => {
    await table("timestamptz", [{ id: R1, hoursAgo: 30, confirmada: false }]);
    const state = await started();
    expect((await appRowsSource.observe("p1", PARAMS, state, CTX)).changes).toEqual([]);
  });

  it("with a timestamp without time zone column too", async () => {
    await table("timestamp", [{ id: R1, hoursAgo: 23, confirmada: false }]);
    const state = await started();
    expect((await appRowsSource.observe("p1", PARAMS, state, CTX)).changes).toEqual([]);
    await age(R1, 25, "timestamp");
    expect((await appRowsSource.observe("p1", PARAMS, state, CTX)).changes.map((c) => c.detail.id)).toEqual([R1]);
  });

  it("without after_hours a new row still fires when it is created", async () => {
    await table("timestamptz", []);
    const params = { table: "esperan", created_column: "created_at" };
    const state = await started(params);
    await pg().exec(`RESET ROLE; INSERT INTO esperan VALUES ('${R1}', now(), false); SET ROLE ro;`);
    expect((await appRowsSource.observe("p1", params, state, CTX)).changes.map((c) => c.detail.id)).toEqual([R1]);
  });
});

