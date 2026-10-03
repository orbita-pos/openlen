import { describe, expect, it } from "vitest";
import { isSameOriginRead, isSameOriginRequest } from "./same-origin";

const BASES = ["openlen.app", "openlen.com"];
const dominios: Record<string, string> = { "mitienda.mx": "tienda", "otra.mx": "malo" };

function pide(cabeceras: Record<string, string>, sub = "tienda") {
  return isSameOriginRequest({
    headers: { get: (n) => cabeceras[n.toLowerCase()] ?? null },
    targetSub: sub,
    baseHost: BASES,
    resolveCustomDomain: async (h) => dominios[h] ?? null,
  });
}

describe("isSameOriginRequest", () => {
  it("la propia página pasa", async () => {
    expect(await pide({ origin: "https://tienda.openlen.app", "sec-fetch-site": "same-origin" })).toBe(true);
    // Sin Sec-Fetch-Site (un navegador viejo) basta el Origin.
    expect(await pide({ origin: "https://tienda.openlen.app" })).toBe(true);
  });

  it("su dominio propio también", async () => {
    expect(await pide({ origin: "https://mitienda.mx" })).toBe(true);
  });

  // 🔴 El ataque que esto cierra: una página hermana, que para el navegador es
  // el mismo sitio y manda la cookie de la caja.
  it("un subdominio hermano NO pasa", async () => {
    expect(await pide({ origin: "https://malo.openlen.app", "sec-fetch-site": "same-site" })).toBe(false);
    expect(await pide({ origin: "https://malo.openlen.app" })).toBe(false);
    expect(await pide({ origin: "https://otra.mx" })).toBe(false);
  });

  // 🔴 BRAZO DE CONTROL de la diferencia con `checkSubdomainOrigin`: lo que no
  // se puede identificar NO pasa, y el Host —que es el de destino— no cuenta.
  it("sin Origin, con Origin null o con uno desconocido, no pasa", async () => {
    expect(await pide({ host: "tienda.openlen.app" })).toBe(false);
    expect(await pide({ origin: "null", host: "tienda.openlen.app" })).toBe(false);
    expect(await pide({ origin: "https://openlen.com" })).toBe(false);
    expect(await pide({ origin: "https://desconocido.example" })).toBe(false);
  });

  it("un Sec-Fetch-Site que no es same-origin no pasa aunque el Origin cuadre", async () => {
    expect(await pide({ origin: "https://tienda.openlen.app", "sec-fetch-site": "cross-site" })).toBe(false);
    expect(await pide({ origin: "https://tienda.openlen.app", "sec-fetch-site": "none" })).toBe(false);
  });
});

describe("isSameOriginRead", () => {
  const h = (v: string | null) => ({ get: (n: string) => (n === "sec-fetch-site" ? v : null) });
  it("pasa sin la cabecera o desde la propia página", () => {
    expect(isSameOriginRead(h(null))).toBe(true);
    expect(isSameOriginRead(h("same-origin"))).toBe(true);
  });
  it("no pasa desde un hermano ni desde otro sitio", () => {
    expect(isSameOriginRead(h("same-site"))).toBe(false);
    expect(isSameOriginRead(h("cross-site"))).toBe(false);
  });
});
