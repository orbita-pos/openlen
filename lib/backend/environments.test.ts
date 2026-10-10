import { describe, expect, it } from "vitest";

import { classifyExistingBackend, dbNameOf, newScope, readOnlyRoleOf, SCOPE_RE } from "./environments";

const REF = "abcdefghijklmnopqrst";

describe("los entornos del backend de un proyecto", () => {
  it("el scope nuevo lleva _d o _l", () => {
    expect(newScope(REF, "draft")).toBe(`${REF}_d`);
    expect(newScope(REF, "live")).toBe(`${REF}_l`);
  });

  it("el scope de antes (= ref) también vale", () => {
    expect(SCOPE_RE.test(REF)).toBe(true);
    expect(dbNameOf(REF)).toBe(`ol_${REF}`);
  });

  it("la base y el rol de lectura salen del scope", () => {
    expect(dbNameOf(`${REF}_d`)).toBe(`ol_${REF}_d`);
    expect(readOnlyRoleOf(`${REF}_l`)).toBe(`ol_${REF}_l_ro`);
  });

  it("un scope que no es de los nuestros no llega al SQL", () => {
    expect(() => dbNameOf("x; drop database y")).toThrow();
    expect(() => newScope("CORTO", "draft")).toThrow();
  });

  it("la base de antes es producción si el proyecto está publicado", () => {
    expect(classifyExistingBackend({ status: "published" })).toBe("live");
    expect(classifyExistingBackend({ status: "draft" })).toBe("draft");
    expect(classifyExistingBackend({ status: null })).toBe("draft");
  });
});
