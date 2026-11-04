// The `app_rows` source (spec local 2026-11-03-len-que-avisa, §7.2): new rows of a table of the app's PRODUCTION
// base, read with the production read-only role, after a cursor on a creation column. The live read is faked:
// each test says what Postgres answers to each query.
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { QueryOutcome } from "@/lib/backend/cli-core";

const live = vi.hoisted(() => ({ answer: (_sql: string): QueryOutcome | null => null, seen: [] as string[] }));
vi.mock("@/lib/backend/live-read", () => ({
  queryLive: async (_projectId: string, sql: string) => {
    live.seen.push(sql);
    return live.answer(sql);
  },
}));

const { appRowsSource, quoteIdent, quoteLiteral } = await import("./app-rows");
const { SourceError } = await import("./types");
const CTX = { timeZone: "UTC", now: new Date("2026-11-04T12:00:00Z"), ownerId: "owner" };

const rows = (columns: string[], data: unknown[][]): QueryOutcome => ({ kind: "rows", columns, rows: data, truncated: false });
const COLUMNS = rows(["column_name", "data_type"], [["id", "uuid"], ["created_at", "timestamp with time zone"], ["nombre", "text"], ["mesa", "integer"], ["fecha", "date"]]);
const PK = rows(["column_name"], [["id"]]);

/** A table `reservas` (id, created_at, nombre, mesa, fecha) whose rows after the cursor are `after`. */
function reservas(after: unknown[][], newest: unknown[] | null = ["2026-11-03 19:00:00.123456+00", "r9"]) {
  live.answer = (sql) => {
    if (sql.includes("information_schema.columns")) return sql.includes("'reservas'") ? COLUMNS : rows(["column_name", "data_type"], []);
    if (sql.includes("indisprimary")) return PK;
    if (sql.includes("DESC") && sql.includes("LIMIT 1")) return rows(["__openlen_at", "__openlen_key"], newest ? [newest] : []);
    if (sql.includes("LIMIT 200")) return rows(["id", "created_at", "nombre", "mesa", "fecha", "__openlen_at", "__openlen_key"], after);
    return { kind: "error", message: `unexpected ${sql}` };
  };
}

const PARAMS = { table: "reservas", created_column: "created_at" };
const STATE = { cursor: { at: "2026-11-03 19:00:00.123456+00", key: "r9" }, key_column: "id" };

beforeEach(() => {
  live.seen = [];
});

describe("validate", () => {
  it("refuses a table that does not exist in production, with a reason Len can tell", async () => {
    reservas([]);
    const r = await appRowsSource.validate("p1", { table: "reservaz", created_column: "created_at" }, CTX);
    expect(r).toEqual({ ok: false, reason: expect.stringContaining("reservaz") });
  });

  it("refuses a table without a timestamp creation column", async () => {
    reservas([]);
    const r = await appRowsSource.validate("p1", { table: "reservas", created_column: "nombre" }, CTX);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/nombre.*(timestamp|date)/);
    expect(!r.ok && r.reason).toMatch(/migration/);
  });

  it("refuses when the app has no production base yet", async () => {
    live.answer = () => null;
    const r = await appRowsSource.validate("p1", PARAMS, CTX);
    expect(r).toEqual({ ok: false, reason: expect.stringMatching(/publish/i) });
  });

  it("starts the cursor at the newest row, so existing rows never fire", async () => {
    reservas([]);
    expect(await appRowsSource.validate("p1", PARAMS, CTX)).toEqual({ ok: true, initialState: STATE });
  });

  it("an empty table starts at the beginning of time", async () => {
    reservas([], null);
    const r = await appRowsSource.validate("p1", PARAMS, CTX);
    expect(r.ok && r.initialState.cursor).toEqual({ at: "-infinity", key: "" });
  });
});

describe("observe", () => {
  it("returns rows after the cursor ordered by (created, key) and moves the cursor to the last one", async () => {
    reservas([
      ["r10", "2026-11-03T19:05:00Z", "Ana", 4, "2026-11-08", "2026-11-03 19:05:00+00", "r10"],
      ["r11", "2026-11-03T19:06:00Z", "Luis", 4, "2026-11-08", "2026-11-03 19:06:00+00", "r11"],
    ]);
    const o = await appRowsSource.observe("p1", PARAMS, STATE, CTX);
    expect(o.state).toEqual({ cursor: { at: "2026-11-03 19:06:00+00", key: "r11" }, key_column: "id" });
    expect(o.changes.map((c) => c.detail)).toEqual([
      { id: "r10", created_at: "2026-11-03T19:05:00Z", nombre: "Ana", mesa: 4, fecha: "2026-11-08" },
      { id: "r11", created_at: "2026-11-03T19:06:00Z", nombre: "Luis", mesa: 4, fecha: "2026-11-08" },
    ]);
    expect(o.changes[0]).toMatchObject({ subject: "reservas", summary: "created_at: 2026-11-03T19:05:00Z · nombre: Ana · mesa: 4", at: "2026-11-03 19:05:00+00" });
    const query = live.seen.at(-1)!;
    expect(query).toContain(`ORDER BY "created_at", "id"::text`);
    expect(query).toContain(`'2026-11-03 19:00:00.123456+00'`);
  });

  it("no new rows keeps the state as it was", async () => {
    reservas([]);
    expect(await appRowsSource.observe("p1", PARAMS, STATE, CTX)).toEqual({ state: STATE, changes: [] });
  });

  it("reads at most 200 rows and keeps the cursor at the 200th, so the next check continues", async () => {
    const many = Array.from({ length: 200 }, (_, i) => [`k${i}`, "t", "x", 1, "d", `2026-11-03 19:${String(10 + Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}+00`, `k${i}`]);
    reservas(many);
    const o = await appRowsSource.observe("p1", PARAMS, STATE, CTX);
    expect(o.changes).toHaveLength(200);
    expect(o.state.cursor.key).toBe("k199");
    expect(live.seen.at(-1)).toContain("LIMIT 200");
  });

  it("after a restart it compares once and returns every row since the cursor in one observation", async () => {
    reservas([
      ["r10", "a", "Ana", 1, "d", "2026-11-03 19:05:00+00", "r10"],
      ["r11", "b", "Luis", 2, "d", "2026-11-03 21:40:00+00", "r11"],
    ]);
    const o = await appRowsSource.observe("p1", PARAMS, STATE, CTX);
    expect(o.changes).toHaveLength(2);
    expect(live.seen.filter((s) => s.includes("LIMIT 200"))).toHaveLength(1);
  });

  it("a dropped creation column throws a SourceError column_missing", async () => {
    live.answer = () => ({ kind: "error", message: 'column "created_at" does not exist', code: "42703" });
    await expect(appRowsSource.observe("p1", PARAMS, STATE, CTX)).rejects.toEqual(new SourceError("column_missing", 'column "created_at" does not exist'));
  });

  it("a dropped table throws table_missing, and no production base throws no_live", async () => {
    live.answer = () => ({ kind: "error", message: 'relation "reservas" does not exist', code: "42P01" });
    await expect(appRowsSource.observe("p1", PARAMS, STATE, CTX)).rejects.toMatchObject({ reason: "table_missing" });
    live.answer = () => null;
    await expect(appRowsSource.observe("p1", PARAMS, STATE, CTX)).rejects.toMatchObject({ reason: "no_live" });
  });
});

describe("quoting", () => {
  it("identifiers come quoted, a quote doubled", () => {
    expect(quoteIdent('a"b')).toBe('"a""b"');
    expect(quoteLiteral("O'Brien")).toBe("'O''Brien'");
  });

  it("a table name with a quote reaches SQL only as a quoted identifier", async () => {
    reservas([]);
    await appRowsSource.observe("p1", { table: 'a"b', created_column: "created_at" }, STATE, CTX).catch(() => undefined);
    expect(live.seen.at(-1)).toContain(`FROM "a""b"`);
  });
});

describe("read", () => {
  it("returns the candidate's rows by key and the 20 before them", async () => {
    live.answer = (sql) =>
      sql.includes("LIMIT 20")
        ? rows(["id", "nombre"], [["r8", "Eva"]])
        : sql.includes("IN (")
          ? rows(["id", "nombre"], [["r10", "Ana"]])
          : { kind: "error", message: "unexpected" };
    expect(await appRowsSource.read("p1", PARAMS, { keys: ["r10"], state: STATE, ctx: CTX })).toEqual({ items: [{ id: "r10", nombre: "Ana" }], previous: [{ id: "r8", nombre: "Eva" }] });
    expect(live.seen.find((s) => s.includes("IN ("))).toContain(`"id"::text IN ('r10')`);
  });
});
