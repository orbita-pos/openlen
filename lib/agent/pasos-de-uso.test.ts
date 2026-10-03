// La entrada de `usar_pagina` se comprueba ANTES de abrir el navegador: una
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
  it("acepta los cinco verbos y dentro_de con pulsa y elige", () => {
    const r = validarPasos([
      { pulsa: "Agregar", dentro_de: "Vela" },
      { escribe: "3", en: "Metros" },
      { elige: "Nogal" },
      { recarga: true },
      { lee: "Total" },
    ]);
    expect(r).toEqual({
      ok: true,
      pasos: [{ pulsa: "Agregar", dentro_de: "Vela" }, { escribe: "3", en: "Metros" }, { elige: "Nogal" }, { recarga: true }, { lee: "Total" }],
    });
  });

  it("escribe puede teclear un texto vacío (vaciar un campo) pero necesita en", () => {
    expect(validarPasos([{ escribe: "", en: "Código" }]).ok).toBe(true);
    expect(error([{ escribe: "hola" }])).toContain("needs `en`");
  });

  it("rechaza una lista vacía, o que no es lista, o demasiado larga", () => {
    expect(error([])).toContain("at least one step");
    expect(error("pulsa Agregar")).toContain("at least one step");
    expect(error(Array.from({ length: MAX_PASOS + 1 }, () => ({ lee: "x" })))).toContain("Split it into two visits");
  });

  it("un paso hace UNA cosa, y lo dice por su número", () => {
    expect(error([{ lee: "Total" }, { pulsa: "A", lee: "B" }])).toContain("Step 2 carries `pulsa` and `lee`");
    expect(error([{}])).toContain("doesn't say what to do");
  });

  it("un parámetro inesperado se nombra (como Claude Code)", () => {
    expect(error([{ pulsa: "A", selector: "#a" }])).toContain("unexpected parameter `selector`");
  });

  it("en y dentro_de sólo donde tienen sentido; recarga es true", () => {
    expect(error([{ pulsa: "A", en: "B" }])).toContain("`en` only goes with `escribe`");
    expect(error([{ lee: "A", dentro_de: "B" }])).toContain("`dentro_de` only goes with `pulsa` or `elige`");
    expect(error([{ recarga: "sí" }])).toContain('{"recarga": true}');
  });

  it("un texto vacío o demasiado largo no vale", () => {
    expect(error([{ pulsa: "   " }])).toContain("`pulsa` has to be a text");
    expect(error([{ lee: "x".repeat(201) }])).toContain("`lee` has to be a text");
  });
});
