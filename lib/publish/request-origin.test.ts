import { describe, expect, it } from "vitest";

import { checkSubdomainOrigin, publishedBaseHosts, requestingHost } from "./request-origin";

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

// ── DOS DOMINIOS SIRVIENDO LO MISMO ─────────────────────────────────────────
//
// 🔴 El agujero que abrió `openlen.app` el 2026-08-23. Las mismas carpetas de
// /var/www/openlen se sirven por .com y por .app, pero este check sólo conocía
// uno: un envío desde `victima.openlen.app` no termina en `.openlen.com`, así
// que caía en «no identificable» y PASABA — el relé de exfiltración entre
// proyectos que esta función existe para cerrar, reabierto por el dominio
// nuevo. Las 13 pruebas de arriba pasaban igual con el fallo puesto.
describe("cuando varios dominios sirven las mismas páginas", () => {
  const dos = (headers: Record<string, string>, targetSub = "victima") =>
    checkSubdomainOrigin({
      headers: h(headers),
      targetSub,
      baseHost: ["openlen.com", "openlen.app"],
      resolveCustomDomain: async () => null,
    });

  it("🔴 un envío CRUZADO desde el dominio nuevo se rechaza igual que desde el viejo", async () => {
    for (const desde of ["https://otro.openlen.com", "https://otro.openlen.app"]) {
      const r = await dos({ origin: desde }, "victima");
      expect(r.kind, desde).toBe("mismatch");
    }
  });

  it("y el envío legítimo pasa por cualquiera de los dos", async () => {
    for (const desde of ["https://victima.openlen.com", "https://victima.openlen.app"]) {
      expect((await dos({ origin: desde }, "victima")).kind, desde).toBe("match");
    }
  });

  it("el host de la app sigue siendo «no identificable» en los dos", async () => {
    // La vista previa del editor y los enlaces de borrador viven ahí: no son
    // la página publicada de nadie, y rechazarlos rompería el editor.
    for (const desde of ["https://openlen.com", "https://www.openlen.app"]) {
      expect((await dos({ origin: desde }, "victima")).kind, desde).toBe("unknown");
    }
  });

  it("una lista con un solo dominio se comporta igual que la cadena de siempre", async () => {
    const uno = await checkSubdomainOrigin({
      headers: h({ origin: "https://otro.openlen.com" }),
      targetSub: "victima",
      baseHost: ["openlen.com"],
      resolveCustomDomain: async () => null,
    });
    expect(uno).toEqual(await check({ origin: "https://otro.openlen.com" }, "victima"));
  });
});

describe("publishedBaseHosts", () => {
  it("incluye el dominio nuevo Y el viejo por omisión", async () => {
    const hosts = publishedBaseHosts({});
    expect(hosts).toContain("openlen.com");
    expect(hosts).toContain("openlen.app");
  });

  it("mover PUBLISH_BASE_HOST no deja al otro sin comprobar", async () => {
    // El accidente que esto impide: cambiar dónde nacen las páginas nuevas y
    // dejar, sin querer, el dominio viejo fuera del check de procedencia.
    const hosts = publishedBaseHosts({ PUBLISH_BASE_HOST: "openlen.app" });
    expect(hosts).toContain("openlen.app");
    expect(hosts).toContain("openlen.com");
  });

  it("sin duplicados, y se puede acotar a mano", async () => {
    expect(publishedBaseHosts({ PUBLISH_BASE_HOST: "openlen.com", OPENLEN_LEGACY_BASE_HOSTS: "openlen.com" }))
      .toEqual(["openlen.com"]);
  });
});
