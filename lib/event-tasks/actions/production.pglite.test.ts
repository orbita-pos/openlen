// @vitest-environment node
//
// What a card's actions are checked against, read from a REAL Postgres as production's read-only role sees it (spec
// local 2026-11-04-hazlo-que-se-puede-y-mas-fuentes, §7.1): the table's columns, one row by its key, and whether a value
// fits its column — Postgres converts the literal to the column's type when it reads the query, so nothing is written.
import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { QueryOutcome } from "@/lib/backend/cli-core";

const base = vi.hoisted(() => ({ pg: null as unknown }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/backend/live-read", () => ({
  queryLive: async (_projectId: string, sql: string): Promise<QueryOutcome> => {
    try {
      const r = await (base.pg as PGlite).query<unknown[]>(sql, [], { rowMode: "array" });
      return { kind: "rows", columns: r.fields.map((f) => f.name), rows: r.rows, truncated: false };
    } catch (err) {
      return { kind: "error", message: (err as Error).message, code: (err as { code?: string }).code };
    }
  },
}));

const { castCheck, readRow, tableColumns } = await import("./production");

beforeEach(async () => {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE reservas (id uuid PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now(), hora time, mesa int, nombre text);
    INSERT INTO reservas (id, hora, mesa, nombre) VALUES ('00000000-0000-0000-0000-000000000002', '21:00', 4, 'Luis');
    CREATE ROLE ro NOLOGIN NOINHERIT;
    GRANT USAGE ON SCHEMA public TO ro;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO ro;
    SET ROLE ro;`);
  base.pg = db;
});

describe("production reads for a card's actions", () => {
  it("lists the table's columns with their types", async () => {
    expect(await tableColumns("p1", "reservas")).toEqual({
      columns: [
        { name: "id", type: "uuid" },
        { name: "created_at", type: "timestamp with time zone" },
        { name: "hora", type: "time without time zone" },
        { name: "mesa", type: "integer" },
        { name: "nombre", type: "text" },
      ],
    });
    expect(await tableColumns("p1", "nada")).toBeNull();
  });

  it("reads one row by its key, or none", async () => {
    const row = await readRow("p1", "reservas", "id", "00000000-0000-0000-0000-000000000002");
    expect(row).toMatchObject({ mesa: 4, nombre: "Luis", hora: "21:00:00" });
    // As Postgres writes it, never a JS Date: a card's «before» must compare equal when the owner applies it.
    expect(typeof row!.created_at).toBe("string");
    expect(await readRow("p1", "reservas", "id", "00000000-0000-0000-0000-000000000009")).toBeNull();
  });

  it("says whether a value fits its column, without writing", async () => {
    expect(await castCheck("p1", "reservas", "mesa", "6")).toBeNull();
    expect(await castCheck("p1", "reservas", "hora", "22:00")).toBeNull();
    expect(await castCheck("p1", "reservas", "mesa", "la seis")).toMatch(/integer/);
    expect(await castCheck("p1", "reservas", "mesa", "6'); DROP TABLE reservas; --")).toMatch(/integer/);
    expect(await readRow("p1", "reservas", "id", "00000000-0000-0000-0000-000000000002")).not.toBeNull();
  });
});
