import { describe, expect, it } from "vitest";

import { decideEnvironment, isPublicObjectRead } from "./environment-routing";

const MINE = "lienzo-0123456789abcdef0123456789abcdef";
const OTHER = "lienzo-ffffffffffffffffffffffffffffffff";
const base = { referer: null, lienzoLabel: MINE, hasLive: true };

describe("qué entorno le toca a una petición", () => {
  it("el lienzo de este proyecto → borrador", () => {
    expect(decideEnvironment({ ...base, origin: `https://${MINE}.openlen.app` })).toEqual({ kind: "env", environment: "draft", attributed: true });
  });

  it("el lienzo de OTRO proyecto → 403, nunca producción", () => {
    expect(decideEnvironment({ ...base, origin: `https://${OTHER}.openlen.app` }).kind).toBe("forbidden");
  });

  it("un lienzo sin etiqueta propia que comparar (sin secreto) → 403", () => {
    expect(decideEnvironment({ ...base, lienzoLabel: null, origin: `https://${MINE}.openlen.app` }).kind).toBe("forbidden");
  });

  it("los ojos de Len (origen de medida en loopback) → borrador", () => {
    for (const origin of ["http://127.0.0.1:41234", "http://localhost:3000", "http://[::1]:8080"]) {
      expect(decideEnvironment({ ...base, origin })).toEqual({ kind: "env", environment: "draft", attributed: true });
    }
  });

  it("la publicada o un dominio propio → producción", () => {
    expect(decideEnvironment({ ...base, origin: "https://tienda.openlen.app" })).toEqual({ kind: "env", environment: "live", attributed: true });
    expect(decideEnvironment({ ...base, origin: "https://www.mitienda.mx" })).toEqual({ kind: "env", environment: "live", attributed: true });
  });

  it("sin Origin ni Referer (servidor, curl, un <img>) → producción, sin atribuir", () => {
    expect(decideEnvironment({ ...base, origin: null })).toEqual({ kind: "env", environment: "live", attributed: false });
    expect(decideEnvironment({ ...base, origin: "null" })).toEqual({ kind: "env", environment: "live", attributed: false });
  });

  it("sin Origin, el Referer decide", () => {
    expect(decideEnvironment({ ...base, origin: null, referer: "https://tienda.openlen.app/menu" })).toEqual({ kind: "env", environment: "live", attributed: true });
  });

  it("sin producción todavía, todo lo que no es un lienzo ajeno va al borrador", () => {
    expect(decideEnvironment({ ...base, hasLive: false, origin: null })).toEqual({ kind: "env", environment: "draft", attributed: false });
    expect(decideEnvironment({ ...base, hasLive: false, origin: "https://tienda.openlen.app" })).toEqual({ kind: "env", environment: "draft", attributed: true });
    expect(decideEnvironment({ ...base, hasLive: false, origin: `https://${OTHER}.openlen.app` }).kind).toBe("forbidden");
  });
});

describe("una lectura pública de Storage", () => {
  it("GET y HEAD de object/public y render/image/public", () => {
    expect(isPublicObjectRead(new Request("https://x.openlen.app/storage/v1/object/public/fotos/a.png"))).toBe(true);
    expect(isPublicObjectRead(new Request("https://x.openlen.app/storage/v1/render/image/public/fotos/a.png", { method: "HEAD" }))).toBe(true);
  });
  it("lo demás no", () => {
    expect(isPublicObjectRead(new Request("https://x.openlen.app/storage/v1/object/fotos/a.png"))).toBe(false);
    expect(isPublicObjectRead(new Request("https://x.openlen.app/storage/v1/object/public/fotos/a.png", { method: "POST" }))).toBe(false);
    expect(isPublicObjectRead(new Request("https://x.openlen.app/rest/v1/productos"))).toBe(false);
  });
});
