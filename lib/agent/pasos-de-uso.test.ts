// La entrada de `use_page` se comprueba ANTES de abrir el navegador: una
// llamada que no valida no corre ni un paso (el orden del ejecutor de Claude
// Code). Cada rechazo dice qué cambiar.
import { describe, expect, it } from "vitest";

import { MAX_PASOS, validarPasos } from "./pasos-de-uso";

const error = (bruto: unknown) => {
  const r = validarPasos(bruto);
  if (r.ok) throw new Error("tenía que rechazarse");
  return r.error;
};

describe("validarPasos", () => {
  it("acepta los cinco verbos y within con click y choose", () => {
    const r = validarPasos([
      { click: "Agregar", within: "Vela" },
      { type: "3", into: "Metros" },
      { choose: "Nogal" },
      { reload: true },
      { read: "Total" },
    ]);
    expect(r).toEqual({
      ok: true,
      pasos: [{ click: "Agregar", within: "Vela" }, { type: "3", into: "Metros" }, { choose: "Nogal" }, { reload: true }, { read: "Total" }],
    });
  });

  it("type puede teclear un texto vacío (vaciar un campo) pero necesita into", () => {
    expect(validarPasos([{ type: "", into: "Código" }]).ok).toBe(true);
    expect(error([{ type: "hola" }])).toContain("needs `into`");
  });

  it("rechaza una lista vacía, o que no es lista, o demasiado larga", () => {
    expect(error([])).toContain("at least one step");
    expect(error("click Agregar")).toContain("at least one step");
    expect(error(Array.from({ length: MAX_PASOS + 1 }, () => ({ read: "x" })))).toContain("Split it into two visits");
  });

  it("un paso hace UNA cosa, y lo dice por su número", () => {
    expect(error([{ read: "Total" }, { click: "A", read: "B" }])).toContain("Step 2 carries `click` and `read`");
    expect(error([{}])).toContain("doesn't say what to do");
  });

  it("un parámetro inesperado se nombra (como Claude Code)", () => {
    expect(error([{ click: "A", selector: "#a" }])).toContain("unexpected parameter `selector`");
  });

  it("into y within sólo donde tienen sentido; reload es true", () => {
    expect(error([{ click: "A", into: "B" }])).toContain("`into` only goes with `type`");
    expect(error([{ read: "A", within: "B" }])).toContain("`within` only goes with `click` or `choose`");
    expect(error([{ reload: "sí" }])).toContain('{"reload": true}');
  });

  it("un texto vacío o demasiado largo no vale", () => {
    expect(error([{ click: "   " }])).toContain("`click` has to be a text");
    expect(error([{ read: "x".repeat(201) }])).toContain("`read` has to be a text");
  });
});
