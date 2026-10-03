import { describe, expect, it } from "vitest";
import { cleanName, normalizeEmail, roleFromInput, safeBackPath } from "./input";

describe("normalizeEmail", () => {
  it("minúsculas y sin espacios", () => {
    expect(normalizeEmail("  Ana@Tienda.MX ")).toBe("ana@tienda.mx");
  });
  it("rechaza lo que no parece un correo", () => {
    for (const malo of ["", "ana", "ana@", "@x.mx", "ana@x", "a b@x.mx", 7, null]) {
      expect(normalizeEmail(malo)).toBeNull();
    }
  });
});

describe("cleanName", () => {
  it("recorta y colapsa espacios", () => {
    expect(cleanName("  Marta   López ")).toBe("Marta López");
    expect(cleanName("   ")).toBeNull();
    expect(cleanName(3)).toBeNull();
  });
});

describe("roleFromInput", () => {
  const cuentas = { registro: "cerrado" as const, papeles: ["cajero"] };
  it("un papel declarado vale; vacío es sin papel; ausente no toca", () => {
    expect(roleFromInput("cajero", cuentas)).toBe("cajero");
    expect(roleFromInput(null, cuentas)).toBeNull();
    expect(roleFromInput("", cuentas)).toBeNull();
    expect(roleFromInput(undefined, cuentas)).toBeUndefined();
  });
  it("un papel que la página no declara se rechaza", () => {
    expect(roleFromInput("gerente", cuentas)).toBe(false);
    expect(roleFromInput(["cajero"], cuentas)).toBe(false);
  });
});

describe("safeBackPath", () => {
  it("una ruta de la página vale", () => {
    expect(safeBackPath("/caja?x=1")).toBe("/caja?x=1");
  });
  // 🔴 Lo que convertiría el regreso del dueño en una redirección abierta.
  it("nada que lleve a otro host", () => {
    for (const malo of ["//malo.mx", "/\\malo.mx", "https://malo.mx", "javascript:alert(1)", "caja", "/ca\nja", 3]) {
      expect(safeBackPath(malo)).toBe("/");
    }
  });
});
