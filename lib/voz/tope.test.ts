import { describe, expect, it } from "vitest";
import { crearTopeDiario } from "./tope";

describe("crearTopeDiario", () => {
  it("deja pasar hasta el máximo y luego niega", () => {
    const t = crearTopeDiario(2, () => new Date("2026-10-01T10:00:00Z"));
    expect([t.intentar(), t.intentar(), t.intentar()]).toEqual([true, true, false]);
  });

  it("al cambiar de día vuelve a empezar", () => {
    let ahora = new Date("2026-10-01T23:00:00Z");
    const t = crearTopeDiario(1, () => ahora);
    expect(t.intentar()).toBe(true);
    expect(t.intentar()).toBe(false);
    ahora = new Date("2026-10-02T00:30:00Z");
    expect(t.intentar()).toBe(true);
  });
});
