import { describe, expect, it } from "vitest";

import { objectiveBreakage } from "./objective-breakage";

describe("rotura objetiva", () => {
  it("una página sana no da motivos", () => {
    expect(objectiveBreakage({ mobileOverflow: false, invalidGeometry: false, unreadableText: [], typographyHierarchy: null })).toEqual([]);
  });

  // No medir no es prueba de rotura: una página entera no puede caerse porque
  // Chrome no arrancó.
  it("un render que no se pudo hacer no acusa a la página", () => {
    expect(objectiveBreakage(null)).toEqual([]);
    expect(objectiveBreakage(undefined)).toEqual([]);
  });

  it("nombra el desborde y la geometría", () => {
    const reasons = objectiveBreakage({ mobileOverflow: true, invalidGeometry: true });
    expect(reasons).toHaveLength(2);
    expect(reasons[0]).toContain("390px");
    expect(reasons[1]).toContain("geometría");
  });

  // Al reparador se le mandaba la palabra "typography" y no tocaba nada: una
  // categoría no dice qué cambiar. Los motivos llevan números.
  it("da los píxeles, no la categoría", () => {
    expect(objectiveBreakage({ typographyHierarchy: { rule: "h1_not_dominant", h1FontPx: 24, heroBodyFontPx: 20 } })[0])
      .toBe("el titular mide 24px y el cuerpo 20px — no se distinguen");
    expect(objectiveBreakage({ typographyHierarchy: { rule: "h1_too_small", h1FontPx: 18, heroBodyFontPx: 16 } })[0])
      .toContain("18px");
  });

  it("dice cuántos textos son ilegibles y cuál es el peor", () => {
    const reasons = objectiveBreakage({ unreadableText: [{ contrast: 1.87 }, { contrast: 1.02 }] });
    expect(reasons[0]).toContain("2 texto(s)");
    expect(reasons[0]).toContain("1.02:1");
  });

  it("una regla de tipografía que no conoce no inventa un motivo", () => {
    expect(objectiveBreakage({ typographyHierarchy: { rule: "algo_nuevo", h1FontPx: 40, heroBodyFontPx: 18 } })).toEqual([]);
  });
});
