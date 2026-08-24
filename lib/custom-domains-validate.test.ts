import { describe, it, expect } from "vitest";
import { validateDomain } from "./custom-domains";

describe("validateDomain — lo que la plataforma no deja reclamar", () => {
  // El 2026-08-23 empezaron a servirse páginas en openlen.app y esta lista se
  // quedó con sólo el .com. Un dominio que sirve páginas se reserva SIEMPRE:
  // si no, se reclama por la puerta de atrás lo que la de delante rechaza.
  it("los dos dominios de páginas están reservados", () => {
    for (const d of [
      "mitienda.openlen.com",
      "mitienda.openlen.app",
      "openlen.com",
      "openlen.app",
      "www.openlen.app",
    ]) {
      const r = validateDomain(d);
      expect(r.ok, `${d} debería estar reservado`).toBe(false);
    }
  });

  it("un dominio de verdad sí se puede reclamar", () => {
    expect(validateDomain("mitaller.mx")).toEqual({ ok: true, value: "mitaller.mx" });
    expect(validateDomain("https://Mi-Taller.MX/precios")).toEqual({
      ok: true,
      value: "mi-taller.mx",
    });
  });

  it("el punto inicial importa — myopenlen.app no es nuestro", () => {
    expect(validateDomain("myopenlen.app").ok).toBe(true);
  });
});
