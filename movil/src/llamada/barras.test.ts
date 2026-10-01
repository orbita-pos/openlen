import { describe, expect, it } from "vitest";
import { barrasDeVisitas } from "./barras";

describe("las barras de la tarjeta de visitas", () => {
  it("el día más alto mide 44 px y lleva su número; el último es hoy", () => {
    const b = barrasDeVisitas([{ dia: "2026-09-29", vistas: 10 }, { dia: "2026-09-30", vistas: 20 }, { dia: "2026-10-01", vistas: 5 }]);
    expect(b.map((x) => x.alto)).toEqual([22, 44, 11]);
    expect(b.map((x) => x.esMax)).toEqual([false, true, false]);
    expect(b.map((x) => x.esHoy)).toEqual([false, false, true]);
  });

  it("todo a cero no divide entre cero", () => {
    expect(barrasDeVisitas([{ dia: "2026-10-01", vistas: 0 }])[0]!.alto).toBe(0);
  });
});
