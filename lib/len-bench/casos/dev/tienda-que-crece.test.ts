import { describe, expect, it } from "vitest";

import { EXISTENCIAS_NUEVAS } from "./tienda-que-crece";

// La tabla de la hornada tal como la leyó el grader el 2026-10-02 (corrida
// lb-tienda-que-crece-86c595, brazo F2 de H15): Len puso cada pieza junto a las
// de su tipo, con su precio y lo que queda, y suspendió por el ORDEN.
const ANTES = "Taza de diario 350 ml avena moteado $240 7";
const DESPUES = "Plato hondo Ø 19 cm humo $320 12 Plato taquero Ø 14 cm crudo con borde barro $180 18";
const TAZA = "Taza espresso — — $190 10";
const PLATO = "Plato extendido — — $360 6";

describe("existencias-nuevas — las dos piezas con su precio y lo que queda, en cualquier orden", () => {
  it("🔴 la taza antes que el plato aprueba: el dueño no pidió un orden", () => {
    expect(EXISTENCIAS_NUEVAS.test(`${ANTES} ${TAZA} ${DESPUES} ${PLATO} Jarra de mesa 1.5 L agotado`)).toBe(true);
  });

  it("el plato antes que la taza también aprueba", () => {
    expect(EXISTENCIAS_NUEVAS.test(`${ANTES} ${PLATO} ${TAZA} ${DESPUES}`)).toBe(true);
  });

  it("BRAZO DE CONTROL: otro precio u otra existencia suspenden", () => {
    expect(EXISTENCIAS_NUEVAS.test(`${ANTES} ${TAZA} Plato extendido — — $360 5`)).toBe(false);
    expect(EXISTENCIAS_NUEVAS.test(`${ANTES} Taza espresso — — $180 10 ${PLATO}`)).toBe(false);
  });

  it("BRAZO DE CONTROL: falta una de las dos y suspende", () => {
    expect(EXISTENCIAS_NUEVAS.test(`${ANTES} ${TAZA} ${DESPUES}`)).toBe(false);
    expect(EXISTENCIAS_NUEVAS.test(`${ANTES} ${PLATO} ${DESPUES}`)).toBe(false);
  });
});
