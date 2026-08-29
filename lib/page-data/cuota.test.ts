import { describe, expect, it } from "vitest";
import { BYTES_POR_PLAN, MAX_BYTES_DOCUMENTO, bytesDe, cabe } from "./cuota";

describe("bytesDe", () => {
  it("mide el JSON serializado", () => {
    expect(bytesDe({ a: "hola" })).toBe(Buffer.byteLength(JSON.stringify({ a: "hola" })));
  });

  it("cuenta bytes UTF-8, no caracteres", () => {
    expect(bytesDe({ a: "ñ" })).toBeGreaterThan(bytesDe({ a: "n" }));
  });
});

describe("cabe", () => {
  it("un documento por encima del tope se rechaza aunque haya sitio", () => {
    expect(cabe({ plan: "pro", usados: 0, entrantes: MAX_BYTES_DOCUMENTO + 1 })).toEqual({
      ok: false,
      razon: "documento_grande",
    });
  });

  it("acepta mientras quepa", () => {
    expect(cabe({ plan: "free", usados: 0, entrantes: 1000 })).toEqual({ ok: true });
  });

  it("rechaza cuando el proyecto llenó su cuota", () => {
    expect(cabe({ plan: "free", usados: BYTES_POR_PLAN.free, entrantes: 1 })).toEqual({
      ok: false,
      razon: "cuota_llena",
    });
  });

  // Sin esto, cambiar un documento por otro del mismo tamaño falla en cuanto el
  // proyecto está lleno — y editar el carrito se vuelve imposible.
  it("al reemplazar, descuenta lo que se va", () => {
    expect(
      cabe({ plan: "free", usados: BYTES_POR_PLAN.free, entrantes: 500, salientes: 500 }),
    ).toEqual({ ok: true });
  });

  it("pro tiene diez veces lo de free", () => {
    expect(BYTES_POR_PLAN.pro).toBe(BYTES_POR_PLAN.free * 10);
  });
});
