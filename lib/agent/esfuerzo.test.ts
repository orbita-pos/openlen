import { describe, expect, it } from "vitest";
import { ESFUERZOS, presupuestoDeEsfuerzo, type EsfuerzoAgente } from "./esfuerzo";

describe("la postura se traduce a un número, y `auto` a nada", () => {
  it("`auto` NO produce número — el campo no se manda", () => {
    expect(presupuestoDeEsfuerzo("auto", 32_768)).toBeUndefined();
  });

  it("los cuatro niveles suben en orden", () => {
    const n = (e: EsfuerzoAgente) => presupuestoDeEsfuerzo(e, 32_768)!;
    expect(n("low")).toBeLessThan(n("medium"));
    expect(n("medium")).toBeLessThan(n("high"));
    expect(n("high")).toBeLessThan(n("xhigh"));
  });

  it("el número se recorta contra el techo de salida (regla de Claude Code)", () => {
    expect(presupuestoDeEsfuerzo("xhigh", 50)).toBeLessThan(50);
  });

  it("BRAZO DE CONTROL: con techo amplio NO se recorta", () => {
    expect(presupuestoDeEsfuerzo("xhigh", 32_768)).toBe(100);
  });

  it("el vocabulario empieza por `auto` y no incluye `none`", () => {
    expect(ESFUERZOS[0]).toBe("auto");
    expect(ESFUERZOS).not.toContain("none");
  });
});
