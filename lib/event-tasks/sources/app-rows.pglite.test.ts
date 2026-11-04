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
    const v = await appRowsSource.validate("p1", { table: "reservas", created_column: "created_at" });
    expect(v).toEqual({ ok: true, initialState: { key_column: "id", cursor: { at: expect.any(String), key: "00000000-0000-0000-0000-000000000002" } } });
    // The cursor is Postgres's own text of the newest row's instant, in the session's zone.
    const at = v.ok ? (v.initialState as { cursor: { at: string } }).cursor.at : "";
    expect((await pg().query<{ same: boolean }>(`SELECT $1::timestamptz = '2026-11-03 11:00:00+00'::timestamptz AS same`, [at])).rows[0]!.same).toBe(true);
  });

  it("then sees a row added after it", async () => {
    const v = await appRowsSource.validate("p1", { table: "reservas", created_column: "created_at" });
    if (!v.ok) throw new Error(v.reason);
    await pg().exec(`RESET ROLE; INSERT INTO reservas (id, created_at, nombre) VALUES ('00000000-0000-0000-0000-000000000003', '2026-11-03 12:00:00+00', 'Marta'); SET ROLE ro;`);
    const o = await appRowsSource.observe("p1", { table: "reservas", created_column: "created_at" }, v.initialState);
    expect(o.changes.map((c) => c.detail.nombre)).toEqual(["Marta"]);
  });

  it("refuses a date column: rows of the same day can't be told apart by when they came", async () => {
    const v = await appRowsSource.validate("p1", { table: "reservas", created_column: "dia" });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/timestamp/);
  });

  it("reads older rows by their fields, each value compared in its column's type (Task 13)", async () => {
    const v = await appRowsSource.validate("p1", { table: "reservas", created_column: "created_at" });
    if (!v.ok) throw new Error(v.reason);
    const out = (await appRowsSource.read("p1", { table: "reservas", created_column: "created_at" }, {
      keys: [],
      state: v.initialState,
      match: [{ field: "dia", value: "2026-11-14" }, { field: "hora", value: "21:00" }, { field: "mesa", value: "4" }],
    })) as { matching: { nombre: string }[] };
    expect(out.matching.map((r) => r.nombre)).toEqual(["Ana"]);
  });

  it("a field that isn't a column of the table is said, with the columns there are", async () => {
    const v = await appRowsSource.validate("p1", { table: "reservas", created_column: "created_at" });
    if (!v.ok) throw new Error(v.reason);
    await expect(
      appRowsSource.read("p1", { table: "reservas", created_column: "created_at" }, { keys: [], state: v.initialState, match: [{ field: "mesa\" OR 1=1 --", value: "4" }] }),
    ).rejects.toThrow(/no column .*Columns: .*mesa/);
  });
});
