// @vitest-environment node
//
// EL MIDDLEWARE Y EL HOST DEL LIENZO (pieza 9 de Len 2.5). En
// `lienzo-<etiqueta>.<dominio>` sólo responde el lienzo: todo —la página en
// su ruta, `/js/app.js`, `/en/login`— se reescribe a su ruta, y ninguna página
// de la app se pinta en un origen donde corre el JavaScript del dueño.
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

// El guardia de sesión de la app no interviene en un host lienzo; se dobla
// para no cargar Auth.js entero en la prueba.
vi.mock("next-auth", () => ({ default: () => ({ auth: (h: unknown) => h }) }));
vi.mock("@/auth.config", () => ({ default: {} }));
// El de idiomas, con una marca: es a donde va cualquier ruta de la app, y
// lo que el lienzo NO puede alcanzar.
vi.mock("next-intl/middleware", async () => {
  const { NextResponse } = await import("next/server");
  return { default: () => () => { const r = NextResponse.next(); r.headers.set("x-prueba-intl", "1"); return r; } };
});
vi.mock("@/i18n/routing", () => ({ routing: { locales: ["en", "es"], defaultLocale: "en" } }));

import middleware, { config } from "@/middleware";

const HOST = `lienzo-${"a".repeat(32)}.openlen.app`;
const pide = (host: string, ruta: string) =>
  middleware(new NextRequest(new URL(ruta, `https://${host}`), { headers: { host } }));

describe("🔴 el middleware en un host lienzo", () => {
  it("reescribe todo al sitio del lienzo, con la query", async () => {
    const casos: Array<[string, string]> = [
      ["/?__lienzo=D1", "/api/lienzo/site?__lienzo=D1"],
      ["/menu/index.html?__lienzo=D1", "/api/lienzo/site/menu/index.html?__lienzo=D1"],
      ["/js/app.js", "/api/lienzo/site/js/app.js"],
      ["/en/login", "/api/lienzo/site/en/login"],
      ["/new", "/api/lienzo/site/new"],
    ];
    for (const [ruta, destino] of casos) {
      const res = await pide(HOST, ruta);
      const reescrita = new URL(res.headers.get("x-middleware-rewrite") ?? "about:blank");
      expect(`${reescrita.pathname}${reescrita.search}`, ruta).toBe(destino);
      expect(res.headers.get("location"), ruta).toBeNull();
    }
  });

  it("🔴 sus propias rutas pasan TAL CUAL: ni reescritas ni por el de idiomas", async () => {
    const res = await pide(HOST, "/api/lienzo/abc");
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-prueba-intl")).toBeNull();
  });

  it("🔴 ninguna ruta de un host lienzo llega al de idiomas ni al guardia de sesión", async () => {
    for (const ruta of ["/", "/new", "/es/projects", "/login"]) {
      expect((await pide(HOST, ruta)).headers.get("x-prueba-intl"), ruta).toBeNull();
    }
  });

  it("BRAZO DE CONTROL: fuera de un host lienzo, la app sigue igual (va al de idiomas)", async () => {
    const res = await pide("openlen.com", "/");
    expect(res.headers.get("x-prueba-intl")).toBe("1");
    expect(res.headers.get("x-middleware-rewrite") ?? "").not.toContain("/api/lienzo/site");
  });

  it("🔴 el matcher alcanza en un host lienzo lo que el de la app deja fuera (ficheros y /api)", () => {
    const porHost = (config.matcher as unknown[]).find(
      (m): m is { source: string; has: Array<{ type: string; value: string }> } =>
        typeof m === "object" && m !== null && "has" in m,
    );
    expect(porHost?.source).toBe("/:path*");
    const valor = porHost!.has.find((h) => h.type === "host")!.value;
    // Next compara el valor anclado y contra el host SIN puerto.
    const casa = (h: string) => new RegExp(`^${valor}$`).test(h);
    expect(casa(HOST)).toBe(true);
    expect(casa(`lienzo-${"a".repeat(32)}.localhost`)).toBe(true);
    expect(casa("marea.openlen.app")).toBe(false);
    expect(casa("openlen.com")).toBe(false);
    expect(casa("lienzo-abc.openlen.app")).toBe(false);
  });
});
