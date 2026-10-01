import { describe, expect, it } from "vitest";
import { fechaLocal, fechaValida, restarDias, zonaValida } from "./zona";

describe("zonaValida", () => {
  it("acepta una zona IANA", () => {
    expect(zonaValida("America/Mexico_City")).toBe("America/Mexico_City");
  });
  it("rechaza basura, vacíos y lo que no es texto", () => {
    expect(zonaValida("Marte/Base")).toBeNull();
    expect(zonaValida("  ")).toBeNull();
    expect(zonaValida(42)).toBeNull();
    expect(zonaValida("x".repeat(65))).toBeNull();
  });
});

describe("fechaLocal", () => {
  it("a las 19:00 de Ciudad de México el día es el de México, no el de UTC", () => {
    // 2026-10-01T01:00Z = 30/09 19:00 en Ciudad de México (UTC−6 todo el año desde 2022).
    const instante = new Date("2026-10-01T01:00:00Z");
    expect(fechaLocal(instante, "America/Mexico_City")).toBe("2026-09-30");
    expect(fechaLocal(instante, "UTC")).toBe("2026-10-01");
  });
});

describe("restarDias y fechaValida", () => {
  it("resta cruzando el mes", () => {
    expect(restarDias("2026-10-01", 1)).toBe("2026-09-30");
    expect(restarDias("2026-10-01", 6)).toBe("2026-09-25");
  });
  it("valida el formato y el calendario", () => {
    expect(fechaValida("2026-09-30")).toBe("2026-09-30");
    expect(fechaValida("2026-02-30")).toBeNull();
    expect(fechaValida("30/09/2026")).toBeNull();
    expect(fechaValida(undefined)).toBeNull();
  });
});
