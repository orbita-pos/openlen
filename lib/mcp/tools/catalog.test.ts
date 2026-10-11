// @vitest-environment node
// Lo que revisan los directorios de Anthropic y OpenAI, comprobado en CI:
// título y las cuatro pistas explícitas, nombres ≤ 64 en snake_case, esquema
// plano sin combinadores en la raíz, y descripciones sin precios ni órdenes
// de llamar a otras herramientas «después».
import { describe, expect, it } from "vitest";
import * as z from "zod4";
import { ALL_TOOLS } from "./index";

describe("el catálogo de herramientas", () => {
  it("tiene las trece de las Partes 1 y 2, sin repetir", () => {
    const names = ALL_TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    expect([...names].sort()).toEqual([
      "create_project", "delete_file", "edit_file", "get_diagnostics", "get_docs", "get_project",
      "list_projects", "publish", "read_file", "search_files", "unpublish", "view_page", "write_file",
    ]);
  });

  it("las que publican son destructivas y de mundo abierto; las de leer, de sólo lectura", () => {
    const by = Object.fromEntries(ALL_TOOLS.map((t) => [t.name, t.annotations]));
    for (const n of ["publish", "unpublish"]) expect(by[n]).toMatchObject({ destructiveHint: true, openWorldHint: true });
    for (const n of ["list_projects", "get_project", "read_file", "search_files", "get_docs", "get_diagnostics", "view_page"]) {
      expect(by[n]).toMatchObject({ readOnlyHint: true });
    }
    for (const n of ["write_file", "delete_file"]) expect(by[n]).toMatchObject({ destructiveHint: true });
  });

  for (const t of ALL_TOOLS) {
    it(`${t.name}: cumple lo de los directorios`, () => {
      expect(t.name).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
      expect(t.title.length).toBeGreaterThan(0);
      for (const k of ["readOnlyHint", "destructiveHint", "idempotentHint", "openWorldHint"] as const) {
        expect(typeof t.annotations[k]).toBe("boolean");
      }
      const schema = z.toJSONSchema(t.inputSchema) as Record<string, unknown>;
      expect(schema.type).toBe("object");
      for (const k of ["anyOf", "oneOf", "allOf", "$ref"]) expect(schema).not.toHaveProperty(k);
      expect(t.description).not.toMatch(/\$\d|USD|price|credits? cost/i);
      expect(t.description).not.toMatch(/\bthen call\b|\bafter this,? call\b/i);
    });
  }
});
