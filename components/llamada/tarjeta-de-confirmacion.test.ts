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

// Lo mismo, con la revisión de seguridad (spec local 2026-10-15): la tarjeta sabe
// pintar lo grave con «Publicar igual», pero esta lectura tiraba `seguridad` y
// la tarjeta salía como un «Publicar» de siempre (ensayo de caja del 2026-10-16).
// Y `secretosQueFaltan` (las Edge Functions), igual.
const FP = "c".repeat(64);
const secreto = {
  key: "secret_in_client:/src/panel-key.ts:supabase_secret",
  source: "rule",
  severity: "HIGH",
  category: "secret_in_client",
  file: "/src/panel-key.ts",
  line: 1,
  description: "",
  exploitScenario: "",
  recommendation: "",
  params: { provider: "Supabase" },
};
const medio = { ...secreto, key: "k-medio", severity: "MEDIUM", category: "test_secret_in_client", params: { provider: "Stripe" } };

describe("tarjetaDeConfirmacion y la revisión de seguridad", () => {
  it("🔴 lo grave llega a la tarjeta", () => {
    const seguridad = { fingerprint: FP, blocking: [secreto], medium: [medio] };
    expect(tarjetaDeConfirmacion({ ...BASE, seguridad })).toEqual({
      tipo: "publicar",
      confirm: { action: "publish", subdominio: "tiendita", idiomas: [], republicar: true, seguridad },
    });
  });

  it("🔴 STRIPE (spec local 2026-10-21): the reader keeps the stripe field, and drops one without its shape", () => {
    const stripe = { create: { products: 1, prices: 1, paymentLinks: 1, shippingRates: 0, portalConfigurations: 0, webhookEndpoints: 0 }, swaps: 1, chargesEnabled: false, unknownRefs: [] };
    const t = tarjetaDeConfirmacion({ ...BASE, stripe });
    expect(t?.tipo === "publicar" && t.confirm.stripe).toEqual(stripe);
    for (const bad of [{ create: "x", swaps: 1 }, { swaps: 1 }, "stripe", null]) {
      const u = tarjetaDeConfirmacion({ ...BASE, stripe: bad });
      expect(u?.tipo === "publicar" && "stripe" in u.confirm).toBe(false);
    }
  });

  it("🔴 y los secretos de producción que faltan", () => {
    const t = tarjetaDeConfirmacion({ ...BASE, secretosQueFaltan: ["STRIPE_SECRET_KEY", 7] });
    expect(t?.tipo === "publicar" && t.confirm.secretosQueFaltan).toEqual(["STRIPE_SECRET_KEY"]);
  });

  it("CONTRA-PRUEBA: algo que no tiene la forma no se pinta", () => {
    for (const seguridad of [
      { blocking: [secreto], medium: [] },
      { fingerprint: FP, blocking: "no es lista", medium: [] },
      { fingerprint: FP, blocking: [{ ...secreto, severity: "LOW" }], medium: [] },
      { fingerprint: FP, blocking: [{ ...secreto, key: 3 }], medium: [] },
      { fingerprint: FP, blocking: [secreto], medium: [{ ...medio, category: null }] },
      "seguridad",
      null,
    ]) {
      const t = tarjetaDeConfirmacion({ ...BASE, seguridad });
      expect(t?.tipo === "publicar" && "seguridad" in t.confirm).toBe(false);
    }
    for (const secretosQueFaltan of [[], "STRIPE_SECRET_KEY", [3], null]) {
      const t = tarjetaDeConfirmacion({ ...BASE, secretosQueFaltan });
      expect(t?.tipo === "publicar" && "secretosQueFaltan" in t.confirm).toBe(false);
    }
  });
});
