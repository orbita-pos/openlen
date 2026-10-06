// @vitest-environment node
//
// EL MIDDLEWARE Y EL HOST DEL LIENZO (pieza 9 de Len 2.5). En
// `lienzo-<etiqueta>.<dominio>` sólo responde el lienzo: todo —la página en
// su ruta, `/js/app.js`, `/en/login`— va a su ruta (las `rewrites` de
// next.config), y el middleware no lo manda ni al idioma ni al login.
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

import middleware from "@/middleware";

const HOST = `lienzo-${"a".repeat(32)}.openlen.app`;
const pide = (host: string, ruta: string) =>
  middleware(new NextRequest(new URL(ruta, `https://${host}`), { headers: { host } }));

describe("🔴 el middleware en un host lienzo", () => {
  // La reescritura al sitio del lienzo NO sale de aquí: son `rewrites` de
  // next.config (`lib/lienzo/site-rewrite.ts`, con el porqué medido el 06/10).
  // Una reescritura del middleware daba 500 en la caja.
  it("🔴 deja pasar sin reescribir ni redirigir: lo reescribe next.config", async () => {
    for (const ruta of ["/", "/?__lienzo=D1", "/menu/index.html?__lienzo=D1", "/en/login", "/new", "/api/lienzo/abc"]) {
      const res = await pide(HOST, ruta);
      expect(res.headers.get("x-middleware-next"), ruta).toBe("1");
      expect(res.headers.get("x-middleware-rewrite"), ruta).toBeNull();
      expect(res.headers.get("location"), ruta).toBeNull();
    }
  });

  it("🔴 ninguna ruta de un host lienzo llega al de idiomas ni al guardia de sesión", async () => {
    for (const ruta of ["/", "/new", "/es/projects", "/login", "/api/lienzo/abc"]) {
      expect((await pide(HOST, ruta)).headers.get("x-prueba-intl"), ruta).toBeNull();
    }
  });

  it("BRAZO DE CONTROL: fuera de un host lienzo, la app sigue igual (va al de idiomas)", async () => {
    const res = await pide("openlen.com", "/");
    expect(res.headers.get("x-prueba-intl")).toBe("1");
    expect(res.headers.get("x-middleware-rewrite") ?? "").not.toContain("/api/lienzo/site");
  });
});
