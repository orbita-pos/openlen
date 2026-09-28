import { describe, expect, it } from "vitest";

import { BYTES_POR_PLAN, MAX_BYTES_DOCUMENTO, bytesDe } from "./cuota";
import type { AlmacenDeclarado } from "./declaracion";
import { decidirLote } from "./lote";

// H3 de Len 2.x: un Edit de /datos/<almacen>.json llega como un LOTE. La ficha
// (plans/len-2/hipotesis/H3-datos-y-memoria-como-ficheros.md) pone como
// condición de muerte cualquier escritura que se salte la validación o la
// cuota, y dice que eso lo sujetan las pruebas: son éstas.

const MENU: AlmacenDeclarado = { modo: "lectura", caducaDias: null, campos: { plato: "texto", precio: "numero" } };
const TACO = { plato: "Taco", precio: 25 };
const existentes = new Map<string, Record<string, unknown>>([["a1", TACO]]);
const vacio = { cambios: [], altas: [], bajas: [] };
const base = { almacen: MENU, plan: "free" as const, usados: 1000, existentes };

describe("decidirLote", () => {
  it("un cambio, un alta y una baja válidos pasan, con los documentos validados", () => {
    const r = decidirLote({
      ...base,
      existentes: new Map([...existentes, ["b2", { plato: "Gringa", precio: 70 }]]),
      lote: { cambios: [{ id: "a1", doc: { plato: "Taco", precio: 30 } }], altas: [{ plato: "Torta", precio: 60 }], bajas: ["b2"] },
    });
    expect(r).toEqual({ ok: true, cambios: [{ id: "a1", doc: { plato: "Taco", precio: 30 } }], altas: [{ plato: "Torta", precio: 60 }], bajas: ["b2"] });
  });

  it("🔴 una sola fila mala tumba el lote entero: nada se devuelve para aplicar", () => {
    const r = decidirLote({
      ...base,
      lote: { cambios: [{ id: "a1", doc: { plato: "Taco", precio: 30 } }], altas: [{ plato: "Torta", precio: "sesenta" }], bajas: [] },
    });
    expect(r.ok).toBe(false);
    expect(r).toEqual({ ok: false, error: "campo_invalido:precio" });
  });

  it("un id que no existe, en un cambio o en una baja, es no_encontrado (editar no inserta)", () => {
    expect(decidirLote({ ...base, lote: { ...vacio, cambios: [{ id: "zz", doc: TACO }] } })).toEqual({ ok: false, error: "no_encontrado" });
    expect(decidirLote({ ...base, lote: { ...vacio, bajas: ["zz"] } })).toEqual({ ok: false, error: "no_encontrado" });
  });

  it("el mismo id cambiado y quitado a la vez es un error, no dos descuentos de cuota", () => {
    const r = decidirLote({ ...base, lote: { cambios: [{ id: "a1", doc: TACO }], altas: [], bajas: ["a1"] } });
    expect(r).toEqual({ ok: false, error: "id_repetido" });
  });

  it("una fila más grande que el tope por documento es documento_grande", () => {
    const r = decidirLote({ ...base, lote: { ...vacio, altas: [{ plato: "x".repeat(MAX_BYTES_DOCUMENTO), precio: 1 }] } });
    expect(r).toEqual({ ok: false, error: "documento_grande" });
  });

  it("🔴 la cuota se mira con el LOTE: tres altas que caben de una en una pero no juntas se rechazan todas", () => {
    const fila = { plato: "x".repeat(8000), precio: 1 };
    const hueco = 2 * bytesDe(fila) + 10; // caben dos, no tres
    const usados = BYTES_POR_PLAN.free - hueco;
    expect(decidirLote({ ...base, usados, lote: { ...vacio, altas: [fila, fila] } }).ok).toBe(true); // brazo de control
    expect(decidirLote({ ...base, usados, lote: { ...vacio, altas: [fila, fila, fila] } })).toEqual({ ok: false, error: "cuota_llena" });
  });

  it("con la cuota llena, cambiar una fila por otra del mismo tamaño SÍ se puede (lo que sale descuenta)", () => {
    const r = decidirLote({ ...base, usados: BYTES_POR_PLAN.free, lote: { ...vacio, cambios: [{ id: "a1", doc: { plato: "Tako", precio: 25 } }] } });
    expect(r.ok).toBe(true);
    // Y una fila de más, no.
    expect(decidirLote({ ...base, usados: BYTES_POR_PLAN.free, lote: { ...vacio, altas: [TACO] } })).toEqual({ ok: false, error: "cuota_llena" });
  });
});
