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
beforeAll(async () => {
  // `IS_PROD` se lee al cargar el módulo.
  vi.stubEnv("NODE_ENV", "production");
  vi.resetModules();
  middleware = (await import("@/middleware")).default as unknown as (req: NextRequest) => unknown;
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
