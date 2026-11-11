// @vitest-environment node
//
// PUBLIC_TABLES_SQL against real Postgres (PGlite): what `anon` can read is what RLS lets it read.
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

import { PUBLIC_TABLES_SQL, publicDataOf } from "./public-data";

describe("PUBLIC_TABLES_SQL", () => {
  it("🔴 lists the tables anon can read rows of and the views granted to it — never a table RLS closes to anon", async () => {
    const pg = new PGlite();
    for (const s of [
      `create role anon nologin`,
      `create role authenticated nologin`,
      // Open: RLS off.
      `create table precios (producto text, precio numeric)`,
      // RLS on with a SELECT policy for anon: readable.
      `create table huecos (dia date, hora time, libre boolean, cliente text)`,
      `alter table huecos enable row level security`,
      `create policy huecos_ver on huecos for select to anon using (libre)`,
      // RLS on with a policy only for authenticated: closed to anon.
      `create table reservas (dia date, cliente text, telefono text)`,
      `alter table reservas enable row level security`,
      `create policy reservas_suyas on reservas for select to authenticated using (true)`,
      // RLS on with no policy: closed.
      `create table notas (texto text)`,
      `alter table notas enable row level security`,
      // A view granted to anon.
      `create view menu as select producto from precios`,
      `grant select on precios, huecos, reservas, notas, menu to anon, authenticated`,
      // A table without the grant.
      `create table interna (x int)`,
    ])
      await pg.query(s);
    const res = await pg.query<Record<string, unknown>>(PUBLIC_TABLES_SQL, [], { rowMode: "array" } as never);
    const out = await publicDataOf("p1", async () => ({
      kind: "rows",
      columns: res.fields.map((f) => f.name),
      rows: res.rows as unknown as unknown[][],
      truncated: false,
    }));
    expect(out!.map((t) => t.name)).toEqual(["huecos", "menu", "precios"]);
    expect(out!.find((t) => t.name === "huecos")!.columns).toEqual([
      { name: "dia", type: "date" },
      { name: "hora", type: "time without time zone" },
      { name: "libre", type: "boolean" },
      { name: "cliente", type: "text" },
    ]);
  });
});
