// @vitest-environment node
//
// `fixRedirectHost` (middleware.ts) existe para la caja: detrás de Caddy, Next
// arma algunas redirecciones con `localhost` o con el puerto interno, y se
// rehacen hacia https://openlen.com. Pero un build de producción corrido EN
// LOCAL también es `NODE_ENV=production`, y ahí cualquier redirección a
// localhost acababa en producción: la portada → `/new?brief=` y
// `localhost:3007/` saltaban a openlen.com (ensayo de caja de crear-es-len,
// 06/10). La diferencia la dice la petición: en la caja llega con el Host
// público (Caddy lo pasa tal cual); en local, con uno local.
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next-auth", () => ({ default: () => ({ auth: (h: unknown) => h }) }));
vi.mock("@/auth.config", () => ({ default: {} }));
vi.mock("next-intl/middleware", async () => {
  const { NextResponse } = await import("next/server");
  return { default: () => () => NextResponse.next() };
});
vi.mock("@/i18n/routing", () => ({ routing: { locales: ["en", "es"], defaultLocale: "en" } }));

let middleware: (req: NextRequest) => unknown;
let matcher: string;
beforeAll(async () => {
  // `IS_PROD` se lee al cargar el módulo.
  vi.stubEnv("NODE_ENV", "production");
  vi.resetModules();
  const mod = await import("@/middleware");
  middleware = mod.default as unknown as (req: NextRequest) => unknown;
  matcher = mod.config.matcher[0]!;
});
afterAll(() => vi.unstubAllEnvs());

const pide = async (url: string, headers: Record<string, string>) =>
  (await middleware(new NextRequest(new URL(url), { headers }))) as Response;

describe("🔴 fixRedirectHost: producción en la caja, producción en local", () => {
  it("🔴 en local (Host local) la redirección se queda en local", async () => {
    const res = await pide("http://localhost:3007/es/new?brief=hola", { host: "localhost:3007" });
    expect(res.headers.get("location")).toBe("http://localhost:3007/es/new?brief=hola&mode=ai");
  });

  it("también desde un *.localhost (el lienzo y los ensayos)", async () => {
    const res = await pide("http://ensayo.localhost:3007/es/new?brief=hola", { host: "ensayo.localhost:3007" });
    expect(res.headers.get("location")).toBe("http://ensayo.localhost:3007/es/new?brief=hola&mode=ai");
  });

  it("BRAZO DE CONTROL: en la caja (Host público, Next en 127.0.0.1) se rehace hacia openlen.com", async () => {
    const res = await pide("http://localhost:3000/es/new?brief=hola", { host: "openlen.com", "x-forwarded-host": "openlen.com" });
    expect(res.headers.get("location")).toBe("https://openlen.com/es/new?brief=hola&mode=ai");
  });

  it("BRAZO DE CONTROL: el puerto interno filtrado en openlen.com se sigue quitando", async () => {
    const res = await pide("http://openlen.com:3000/es/new?brief=hola", { host: "openlen.com:3000" });
    expect(res.headers.get("location")).toBe("https://openlen.com/es/new?brief=hola&mode=ai");
  });
});

// APPS EN EL ESCRITORIO (spec local 2026-11-26-apps-en-el-escritorio, §4.3): la ventana vive FUERA del segmento de idioma —su
// `scope` no puede cambiar con el idioma—, y el login devuelve a quien venía por el router con idioma, que le pone uno delante.
describe("apps en el escritorio: /desktop/<id> fuera del idioma", () => {
  const runs = (path: string) => new RegExp(`^${matcher}$`).test(path);

  it("el matcher deja en paz la ventana, su manifiesto y su icono", () => {
    expect(runs("/desktop/0b6f1c1e-8f4d-4a52-9b0e-2f7f6a1d3c55")).toBe(false);
    expect(runs("/desktop/0b6f1c1e-8f4d-4a52-9b0e-2f7f6a1d3c55/manifest.webmanifest")).toBe(false);
    expect(runs("/desktop/0b6f1c1e-8f4d-4a52-9b0e-2f7f6a1d3c55/icon")).toBe(false);
  });

  it("y sólo eso: el resto del sitio sigue pasando por el middleware (con barra, como `p/`)", () => {
    for (const path of ["/", "/es", "/es/desktop/abc", "/projects", "/pricing", "/desktops", "/desktop-apps-guide", "/es/new"]) expect(runs(path)).toBe(true);
    // Lo que ya estaba excluido sigue estándolo.
    for (const path of ["/p/abc", "/u/abc", "/api/x", "/icon.svg"]) expect(runs(path)).toBe(false);
  });

  it("/<idioma>/desktop/<id> —adonde el login devuelve a la persona— va a la ventana, con su query", async () => {
    const res = await pide("https://openlen.com/es/desktop/abc?x=1", { host: "openlen.com" });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("https://openlen.com/desktop/abc?x=1");
  });

  it("no toca otras rutas con idioma", async () => {
    const res = await pide("https://openlen.com/es/pricing", { host: "openlen.com" });
    expect(res.headers.get("location")).toBeNull();
  });
});
