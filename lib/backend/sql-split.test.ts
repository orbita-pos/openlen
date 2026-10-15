// @vitest-environment node
import { describe, expect, it } from "vitest";

import { splitSqlStatements } from "./sql-split.mjs";

describe("partir una migración en sentencias", () => {
  it("por punto y coma", () => {
    expect(splitSqlStatements("create table a (id int);\ncreate table b (id int);\n")).toEqual([
      "create table a (id int)",
      "create table b (id int)",
    ]);
  });

  it("🔴 el cuerpo de una función con $$ no se parte", () => {
    const sql = `create function f() returns trigger language plpgsql as $$
begin
  insert into t values (1);
  return new;
end; $$;
create trigger x after insert on u for each row execute procedure f();`;
    const s = splitSqlStatements(sql);
    expect(s).toHaveLength(2);
    expect(s[0]).toContain("return new;");
    expect(s[1]).toMatch(/^create trigger/);
  });

  it("etiquetas $body$, comillas y comentarios con ; dentro", () => {
    const sql = `-- una; nota
select 'a;b', "c;d"; /* otro; comentario /* anidado; */ */ select $body$ x; y $body$;`;
    expect(splitSqlStatements(sql)).toEqual([`-- una; nota\nselect 'a;b', "c;d"`, `/* otro; comentario /* anidado; */ */ select $body$ x; y $body$`]);
  });

  it("comillas dobladas y un fichero sin ; final", () => {
    expect(splitSqlStatements("insert into t values ('it''s; fine')\n")).toEqual(["insert into t values ('it''s; fine')"]);
  });

  it("sólo comentarios o vacío: nada", () => {
    expect(splitSqlStatements("-- nada\n\n/* tampoco */\n")).toEqual([]);
  });

  // EL SERVIDOR ENTERO SE COLGÓ (ensayo del 14/10). Len escribió una migración
  // con separadores como `-- PERFILES ------…` (66 guiones) delante de cada
  // bloque, y `supabase db push` dejó el hilo principal al 100 % para siempre:
  // la regex que miraba si un trozo era «sólo comentarios» podía repartir esa
  // fila de guiones de 2^n maneras antes de rendirse. 40 guiones bastan para
  // verlo (segundos con la regex) sin colgar esta suite; 66 serían años.
  it("🔴 un separador de guiones delante del SQL no cuelga (era exponencial)", () => {
    const divider = `-- PERFILES ${"-".repeat(40)}\n`;
    const sql = `${divider}create table a (id int);\n${divider}create table b (id int);\n${divider}`;
    const t0 = performance.now();
    const s = splitSqlStatements(sql);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(s).toEqual([`${divider}create table a (id int)`, `${divider}create table b (id int)`]);
  });

  it("un trozo con sólo comentarios anidados tampoco es una sentencia", () => {
    expect(splitSqlStatements("/* fuera /* dentro; */ sigue */\n-- y otro\n")).toEqual([]);
  });
});
