// EN UN HOST LIENZO SÓLO RESPONDE EL LIENZO (pieza 9 de Len 2.5). El
// middleware manda todo lo de `lienzo-<etiqueta>.<dominio>` a la ruta del
// lienzo: la página en su ruta, los ficheros de la carpeta, y nada de la app
// —ni el login ni el taller— en un origen donde corre el JavaScript del dueño.
import { describe, expect, it } from "vitest";
import { lienzoRewrite } from "./site-rewrite";

const H = `lienzo-${"a".repeat(32)}.openlen.app`;

describe("🔴 en un host lienzo sólo responde el lienzo", () => {
  it("todo va al sitio del lienzo…", () => {
    expect(lienzoRewrite(H, "/")).toBe("/api/lienzo/site");
    expect(lienzoRewrite(H, "/menu/index.html")).toBe("/api/lienzo/site/menu/index.html");
    expect(lienzoRewrite(H, "/js/app.js")).toBe("/api/lienzo/site/js/app.js");
    expect(lienzoRewrite(H, "/en/login")).toBe("/api/lienzo/site/en/login");
    expect(lienzoRewrite(H, "/api/projects/x")).toBe("/api/lienzo/site/api/projects/x");
    expect(lienzoRewrite(`lienzo-${"a".repeat(32)}.localhost:3007`, "/new")).toBe("/api/lienzo/site/new");
  });

  it("…salvo sus propias rutas (el documento por id, y la del sitio, que no se reescribe a sí misma)", () => {
    expect(lienzoRewrite(H, "/api/lienzo/abc")).toBeNull();
    expect(lienzoRewrite(H, "/api/lienzo/site/js/app.js")).toBeNull();
  });

  it("fuera de un host lienzo no se toca nada", () => {
    expect(lienzoRewrite("openlen.com", "/js/app.js")).toBeNull();
    expect(lienzoRewrite("marea.openlen.app", "/")).toBeNull();
    expect(lienzoRewrite("lienzo-abc.openlen.app", "/")).toBeNull();
    expect(lienzoRewrite(null, "/")).toBeNull();
  });
});
