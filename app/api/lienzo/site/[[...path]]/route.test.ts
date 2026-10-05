// EL LIENZO SIRVE EL SITIO ENTERO (pieza 9 de Len 2.5): la página en la ruta
// que tendrá publicada y los ficheros de la carpeta, en su host
// `lienzo-<etiqueta>.<dominio>`. El almacén es el de verdad; la carpeta, un
// doble (la tabla `projectFiles`).
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  carpetas: {} as Record<string, Record<string, string>>,
}));
vi.mock("@/lib/backend/files", () => ({
  listProjectFiles: vi.fn(async (projectId: string, prefix = "/") =>
    Object.fromEntries(Object.entries(mocks.carpetas[projectId] ?? {}).filter(([p]) => p.startsWith(prefix))),
  ),
}));

import { GET } from "./route";
import { guardarDocumento, vaciarAlmacenParaPruebas } from "@/lib/lienzo/almacen";
import { etiquetaDeLienzo } from "@/lib/lienzo/host";

const SECRETO = "s3cr3t";
const P1 = "4f9c10cb-8781-48f1-b291-c5d146579f09";
const P2 = "0e0c4d1a-1b2c-4d3e-8f90-a1b2c3d4e5f6";
const host = (id: string) => `${etiquetaDeLienzo(id, { AUTH_SECRET: SECRETO })}.openlen.app`;

const pide = (h: string, ruta: string) => {
  const url = new URL(ruta, `https://${h}`);
  const path = url.pathname.split("/").filter(Boolean);
  return GET(new Request(url, { headers: { host: h } }), { params: Promise.resolve({ path }) });
};

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("AUTH_SECRET", SECRETO);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://openlen.com");
  vi.stubEnv("NODE_ENV", "production");
  vaciarAlmacenParaPruebas();
  mocks.carpetas = {
    [P1]: {
      "/js/app.js": "document.title = 'cargó'",
      "/data/menu.json": "[]",
      "/tests/a.spec.ts": "test()",
      "/supabase/migrations/0001_init.sql": "create table t ();",
    },
  };
});

describe("GET /api/lienzo/site — el documento en su ruta", () => {
  it("la home en `/` con ?__lienzo, con las cabeceras del lienzo", async () => {
    const doc = guardarDocumento({ html: "<!doctype html><p>home</p>", projectId: P1, userId: "u1", pagina: null });
    const res = await pide(host(P1), `/?__lienzo=${doc}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<p>home</p>");
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-security-policy")).toBe("frame-ancestors https://openlen.com");
    expect(res.headers.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=()");
  });

  it("una página en `/<slug>/index.html`; en otra ruta, 404", async () => {
    const doc = guardarDocumento({ html: "<p>menu</p>", projectId: P1, userId: "u1", pagina: "menu" });
    expect((await pide(host(P1), `/menu/index.html?__lienzo=${doc}`)).status).toBe(200);
    expect((await pide(host(P1), `/?__lienzo=${doc}`)).status).toBe(404);
    expect((await pide(host(P1), `/otra/index.html?__lienzo=${doc}`)).status).toBe(404);
  });

  it("🔴 el documento de OTRO proyecto, 404 (el mismo 404 uniforme)", async () => {
    const ajeno = guardarDocumento({ html: "<p>ajeno</p>", projectId: P2, userId: "u2", pagina: null });
    const res = await pide(host(P1), `/?__lienzo=${ajeno}`);
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("sin ?__lienzo o con uno desconocido, 404", async () => {
    guardarDocumento({ html: "<p>home</p>", projectId: P1, userId: "u1", pagina: null });
    expect((await pide(host(P1), "/")).status).toBe(404);
    expect((await pide(host(P1), "/?__lienzo=no-existe")).status).toBe(404);
  });
});

describe("GET /api/lienzo/site — los ficheros de la carpeta", () => {
  it("🔴 con un documento vivo del proyecto, el fichero con su tipo y sin caché", async () => {
    guardarDocumento({ html: "<p>home</p>", projectId: P1, userId: "u1", pagina: null });
    const res = await pide(host(P1), "/js/app.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("document.title = 'cargó'");
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await pide(host(P1), "/data/menu.json")).headers.get("content-type")).toBe("application/json; charset=utf-8");
  });

  it("🔴 SIN documento vivo del proyecto, 404: el host solo no es la llave", async () => {
    expect((await pide(host(P1), "/js/app.js")).status).toBe(404);
  });

  it("🔴 con la etiqueta de OTRO proyecto, 404: no se sirven los ficheros de P1", async () => {
    guardarDocumento({ html: "<p>p2</p>", projectId: P2, userId: "u2", pagina: null });
    guardarDocumento({ html: "<p>p1</p>", projectId: P1, userId: "u1", pagina: null });
    expect((await pide(host(P2), "/js/app.js")).status).toBe(404);
  });

  it("lo que no se publica (pruebas, migraciones) y las rutas reservadas, 404", async () => {
    guardarDocumento({ html: "<p>home</p>", projectId: P1, userId: "u1", pagina: null });
    expect((await pide(host(P1), "/tests/a.spec.ts")).status).toBe(404);
    expect((await pide(host(P1), "/supabase/migrations/0001_init.sql")).status).toBe(404);
    expect((await pide(host(P1), "/api/f/x")).status).toBe(404);
    expect((await pide(host(P1), "/js/no-existe.js")).status).toBe(404);
  });

  it("🔴 fuera de un host lienzo, nada: ni en la app ni en una publicada", async () => {
    const doc = guardarDocumento({ html: "<p>home</p>", projectId: P1, userId: "u1", pagina: null });
    expect((await pide("openlen.com", "/js/app.js")).status).toBe(404);
    expect((await pide("openlen.com", `/?__lienzo=${doc}`)).status).toBe(404);
    expect((await pide("marea.openlen.app", "/js/app.js")).status).toBe(404);
  });

  it("🔴 con la etiqueta VIEJA (el UUID sin guiones), nada", async () => {
    guardarDocumento({ html: "<p>home</p>", projectId: P1, userId: "u1", pagina: null });
    expect((await pide("lienzo-4f9c10cb878148f1b291c5d146579f09.openlen.app", "/js/app.js")).status).toBe(404);
  });
});
