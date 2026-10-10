import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { diffCatalog, fingerprintOf, tablesToBackUp } from "./publish-migrations";

const col = (table: string, column: string, type = "text") => ({ schema: "public", table, column, type });

describe("qué destruye un cambio de tablas", () => {
  it("una tabla que desaparece, una columna que desaparece y un cambio de tipo", () => {
    const before = [col("ventas", "id", "bigint"), col("ventas", "descuento", "numeric"), col("ventas", "cantidad"), col("viejos", "id")];
    const after = [col("ventas", "id", "bigint"), col("ventas", "cantidad", "integer"), col("ventas", "nueva")];
    expect(diffCatalog(before, after)).toEqual({
      droppedTables: [{ schema: "public", table: "viejos" }],
      droppedColumns: [{ schema: "public", table: "ventas", column: "descuento" }],
      retyped: [{ schema: "public", table: "ventas", column: "cantidad", from: "text", to: "integer" }],
    });
  });

  it("añadir no destruye nada", () => {
    expect(diffCatalog([col("a", "id")], [col("a", "id"), col("a", "x"), col("b", "id")])).toEqual({ droppedTables: [], droppedColumns: [], retyped: [] });
  });

  it("la huella cambia si cambia una sentencia", () => {
    const a = fingerprintOf([{ version: "1", name: "x", statements: ["alter table a drop column b"] }]);
    const b = fingerprintOf([{ version: "1", name: "x", statements: ["alter table a drop column c"] }]);
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("se copian las tablas que pierden datos, una vez cada una", () => {
    expect(
      tablesToBackUp([
        { kind: "drop_column", table: "ventas", column: "descuento", count: 3 },
        { kind: "alter_type", table: "ventas", column: "cantidad", from: "text", to: "integer", count: 3 },
        { kind: "drop_table", table: "viejos", count: 1 },
        { kind: "delete_rows", migration: "1_x", statement: "delete from ventas", count: 9 },
      ]),
    ).toEqual(["ventas", "viejos"]);
  });
});
