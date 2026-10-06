// @vitest-environment node
//
// EN UN HOST LIENZO SÓLO RESPONDE EL LIENZO (pieza 9 de Len 2.5). Las
// `rewrites` de next.config mandan todo lo de `lienzo-<etiqueta>.<dominio>` a
// la ruta del lienzo: la página en su ruta, los ficheros de la carpeta, y nada
// de la app —ni el login ni el taller— en un origen donde corre el JavaScript
// del dueño. Se resuelven con el código del router de Next (`resolve-rewrites`).
import { describe, expect, it } from "vitest";
import nextConfig from "@/next.config";
import { etiquetaDelHost } from "./prefijo";
import { resolveRewrites } from "./resolve-rewrites";
import { LIENZO_REWRITES } from "./site-rewrite";

const H = `lienzo-${"a".repeat(32)}.openlen.app`;
const ruta = (host: string, url: string) => resolveRewrites(LIENZO_REWRITES, host, url).pathname;

describe("🔴 en un host lienzo sólo responde el lienzo", () => {
  it("todo va al sitio del lienzo…", () => {
    expect(ruta(H, "/")).toBe("/api/lienzo/site");
    expect(ruta(H, "/menu/index.html")).toBe("/api/lienzo/site/menu/index.html");
    expect(ruta(H, "/js/app.js")).toBe("/api/lienzo/site/js/app.js");
    expect(ruta(H, "/en/login")).toBe("/api/lienzo/site/en/login");
    expect(ruta(H, "/api/projects/x")).toBe("/api/lienzo/site/api/projects/x");
    expect(ruta(H, "/favicon.ico")).toBe("/api/lienzo/site/favicon.ico");
    expect(ruta(H, "/api/lienzos/x")).toBe("/api/lienzo/site/api/lienzos/x");
    expect(ruta(`lienzo-${"a".repeat(32)}.localhost:3007`, "/new")).toBe("/api/lienzo/site/new");
    expect(ruta(`LIENZO-${"A".repeat(32)}.openlen.app`, "/")).toBe("/api/lienzo/site");
  });

  it("…con la query: el documento que se pide va en `__lienzo`", () => {
    expect(resolveRewrites(LIENZO_REWRITES, H, "/?__lienzo=D1").query.__lienzo).toBe("D1");
    expect(resolveRewrites(LIENZO_REWRITES, H, "/menu/index.html?__lienzo=a%20b%26c").query.__lienzo).toBe("a b&c");
  });

  it("…salvo sus propias rutas (el documento por id, y la del sitio, que no se reescribe a sí misma)", () => {
    expect(ruta(H, "/api/lienzo")).toBe("/api/lienzo");
    expect(ruta(H, "/api/lienzo/abc")).toBe("/api/lienzo/abc");
    expect(ruta(H, "/api/lienzo/site/js/app.js")).toBe("/api/lienzo/site/js/app.js");
  });

  it("fuera de un host lienzo no se toca nada", () => {
    expect(ruta("openlen.com", "/js/app.js")).toBe("/js/app.js");
    expect(ruta("marea.openlen.app", "/")).toBe("/");
    expect(ruta("lienzo-abc.openlen.app", "/")).toBe("/");
    expect(ruta(`lienzo-${"a".repeat(32)}`, "/")).toBe("/");
  });

  it("el host que reescribe Next es el que lee `etiquetaDelHost`", () => {
    const hosts = [H, "openlen.com", "marea.openlen.app", "lienzo-abc.openlen.app", `lienzo-${"g".repeat(32)}.openlen.app`];
    for (const host of hosts) {
      expect(ruta(host, "/") !== "/", host).toBe(etiquetaDelHost(host) !== null);
    }
  });

  it("🔴 next.config las pone en beforeFiles (antes que `public/`)", async () => {
    const config = nextConfig as { rewrites?: () => Promise<{ beforeFiles?: unknown[] }> };
    expect((await config.rewrites!()).beforeFiles).toEqual(expect.arrayContaining(LIENZO_REWRITES));
  });
});
