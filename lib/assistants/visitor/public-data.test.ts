// WHAT THE PAGE'S DATA SHOWS ANYONE (spec local 2026-11-06-asistente-propio, §4.2; phase 2B): read at publish from
// production's catalog — the tables and views the `anon` role can read — so `read_public_data` knows what it may read.
import { describe, expect, it, vi } from "vitest";

import { PUBLIC_DATA_MAX_COLUMNS, PUBLIC_DATA_MAX_TABLES, PUBLIC_TABLES_SQL, publicDataOf } from "./public-data";

const rows = (r: unknown[][]) => ({ kind: "rows" as const, columns: ["table_name", "columns"], rows: r, truncated: false });

describe("publicDataOf", () => {
  it("lists what anon can read: tables without RLS or with a SELECT policy for anon, and views anon can select", async () => {
    for (const piece of ["relrowsecurity", "polcmd", "'r'", "'*'", "polpermissive", "has_table_privilege", "'anon'", "nspname = 'public'"]) {
      expect(PUBLIC_TABLES_SQL, piece).toContain(piece);
    }
    const query = vi.fn(async () =>
      rows([
        ["huecos", [{ name: "dia", type: "date" }, { name: "hora", type: "time without time zone" }]],
        ["precios", JSON.stringify([{ name: "producto", type: "text" }])],
      ]),
    );
    expect(await publicDataOf("p1", query)).toEqual([
      { name: "huecos", columns: [{ name: "dia", type: "date" }, { name: "hora", type: "time without time zone" }] },
      { name: "precios", columns: [{ name: "producto", type: "text" }] },
    ]);
    expect(query).toHaveBeenCalledWith("p1", "live", PUBLIC_TABLES_SQL);
  });

  it("caps tables and columns", async () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ name: `c${i}`, type: "text" }));
    const query = async () => rows(Array.from({ length: 40 }, (_, i) => [`t${i}`, many]));
    const out = await publicDataOf("p1", query);
    expect(out).toHaveLength(PUBLIC_DATA_MAX_TABLES);
    expect(out[0]!.columns).toHaveLength(PUBLIC_DATA_MAX_COLUMNS);
    expect(PUBLIC_DATA_MAX_TABLES).toBe(30);
    expect(PUBLIC_DATA_MAX_COLUMNS).toBe(40);
  });

  it("no backend, no production or a failing query: nothing public", async () => {
    expect(await publicDataOf("p1", async () => null)).toEqual([]);
    expect(await publicDataOf("p1", async () => ({ kind: "no_live" as const }))).toEqual([]);
    expect(await publicDataOf("p1", async () => ({ kind: "error" as const, message: "boom" }))).toEqual([]);
    expect(await publicDataOf("p1", async () => { throw new Error("cluster down"); })).toEqual([]);
  });
});
