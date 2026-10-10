// La tarjeta «Publicar» de Len lleva lo que publicar hará con los datos. El
// evento `confirm` viene del stream y se lee campo a campo: un campo que esta
// lectura no conoce se pierde, y fue lo que pasó con `cambiosDeDatos` — la
// tarjeta sabía pintar «Esta publicación borra datos reales», pero nunca le
// llegaba (medido en el recorrido del 2026-10-09).
import { describe, expect, it } from "vitest";
import { tarjetaDeConfirmacion } from "./puente-a-len";

const BASE = { action: "publish", subdominio: "tiendita", idiomas: [], republicar: true };

describe("tarjetaDeConfirmacion y los datos", () => {
  it("🔴 lo destructivo llega a la tarjeta", () => {
    const cambiosDeDatos = {
      kind: "pending",
      migrations: ["20261010064600_quitar_categoria"],
      destructive: [{ kind: "drop_column", table: "productos", column: "categoria", count: 1 }],
    };
    expect(tarjetaDeConfirmacion({ ...BASE, cambiosDeDatos })).toEqual({
      tipo: "publicar",
      confirm: { action: "publish", subdominio: "tiendita", idiomas: [], republicar: true, cambiosDeDatos },
    });
  });

  it("y la primera publicación con su casilla", () => {
    const cambiosDeDatos = { kind: "first_publish", migrations: ["20261010061618_pos"] };
    const t = tarjetaDeConfirmacion({ ...BASE, republicar: false, cambiosDeDatos });
    expect(t?.tipo === "publicar" && t.confirm.cambiosDeDatos).toEqual(cambiosDeDatos);
  });

  it("CONTRA-PRUEBA: algo que no tiene la forma no se pinta", () => {
    for (const cambiosDeDatos of [
      { kind: "otra" },
      { kind: "pending", migrations: "no es lista", destructive: null },
      { kind: "pending", migrations: [], destructive: [{ kind: "drop_column", table: "t" }] },
      "pending",
      null,
    ]) {
      const t = tarjetaDeConfirmacion({ ...BASE, cambiosDeDatos });
      expect(t?.tipo === "publicar" && "cambiosDeDatos" in t.confirm).toBe(false);
    }
  });
});
