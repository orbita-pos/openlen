import { describe, expect, it } from "vitest";

import { checkSubdomainOrigin, requestingHost } from "./request-origin";

const h = (v: Record<string, string>) => ({
  get: (n: string) => v[n.toLowerCase()] ?? null,
});

const check = (
  headers: Record<string, string>,
  targetSub = "victima",
  dominios: Record<string, string> = {},
) =>
  checkSubdomainOrigin({
    headers: h(headers),
    targetSub,
    baseHost: "openlen.com",
    resolveCustomDomain: async (host) => dominios[host] ?? null,
  });

describe("de dónde dice el navegador que viene", () => {
  it("el Origin manda — en un POST el navegador lo pone siempre", () => {
    expect(requestingHost(h({ origin: "https://uno.openlen.com", host: "otro.openlen.com" })))
      .toBe("uno.openlen.com");
  });

  it("sin Origin, el Host; y se le quita el puerto", () => {
    expect(requestingHost(h({ host: "uno.openlen.com:443" }))).toBe("uno.openlen.com");
  });

  it("un Origin opaco no confunde: se cae al Host", () => {
    expect(requestingHost(h({ origin: "null", host: "uno.openlen.com" }))).toBe("uno.openlen.com");
  });

  it("sin nada, null", () => {
    expect(requestingHost(h({}))).toBeNull();
  });
});

/**
 * EL RELÉ. Un script en `victima.openlen.com` mandando a `/api/f/atacante`:
 * para la CSP es `'self'`, así que ni `connect-src` ni `form-action` lo ven.
 * Esta comprobación es lo único que puede detenerlo.
 */
describe("el relé entre proyectos", () => {
  it("otro subdominio enviando a este proyecto se RECHAZA", async () => {
    const r = await check({ origin: "https://atacante.openlen.com" }, "victima");
    expect(r).toEqual({ kind: "mismatch", from: "atacante.openlen.com" });
  });

  it("un dominio propio de OTRO proyecto también", async () => {
    const r = await check({ origin: "https://tiendadelatacante.com" }, "victima", {
      "tiendadelatacante.com": "atacante",
    });
    expect(r).toEqual({ kind: "mismatch", from: "tiendadelatacante.com" });
  });
});

describe("lo que tiene que seguir funcionando", () => {
  it("la propia página del proyecto", async () => {
    expect(await check({ origin: "https://victima.openlen.com" }, "victima")).toEqual({ kind: "match" });
  });

  // Si esto se rompe, quien tiene dominio propio se queda sin formularios — un
  // fallo peor y más visible que el riesgo que estamos cerrando.
  it("su dominio propio", async () => {
    const r = await check({ origin: "https://micosa.com" }, "victima", { "micosa.com": "victima" });
    expect(r).toEqual({ kind: "match" });
  });

  it("mayúsculas y puerto no rompen la comparación", async () => {
    expect(await check({ host: "VICTIMA.OpenLen.com:443" }, "victima")).toEqual({ kind: "match" });
  });
});

/**
 * LA REGLA CONSERVADORA: se rechaza sólo ante un desajuste POSITIVO. Lo que no
 * se puede identificar pasa. Este endpoint lo usan TODOS los formularios
 * publicados, y dejar sin enviar a alguien por un caso que no supimos leer
 * sería peor que el riesgo. El ataque igual queda cerrado: la página del
 * atacante tiene un host perfectamente identificable.
 */
describe("lo que no se puede identificar, pasa", () => {
  it("el host de la aplicación — ahí vive la vista previa del editor", async () => {
    expect(await check({ origin: "https://openlen.com" }, "victima")).toEqual({
      kind: "unknown",
      from: "openlen.com",
    });
  });

  it("un dominio propio que aún no conocemos", async () => {
    const r = await check({ origin: "https://recien-conectado.com" }, "victima");
    expect(r.kind).toBe("unknown");
  });

  it("sin cabeceras — un cliente que no es un navegador", async () => {
    expect(await check({}, "victima")).toEqual({ kind: "unknown", from: null });
  });

  it("un subdominio anidado no es una página publicada", async () => {
    const r = await check({ origin: "https://a.b.openlen.com" }, "victima");
    expect(r.kind).toBe("unknown");
  });
});
