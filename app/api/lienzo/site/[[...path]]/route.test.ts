// EL LIENZO SIRVE EL SITIO ENTERO (pieza 9 de Len 2.5): la página en la ruta
// que tendrá publicada y los ficheros de la carpeta, en su host
// `lienzo-<etiqueta>.<dominio>`. El almacén es el de verdad; la carpeta, un
// doble (la tabla `projectFiles`).
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  carpetas: {} as Record<string, Record<string, string>>,
  proyectos: {} as Record<string, { title: string; subdomain: string | null; data: Record<string, unknown> }>,
}));
vi.mock("@/lib/lienzo/proyecto-guardado", () => ({
  loadSavedProject: vi.fn(async (projectId: string) => mocks.proyectos[projectId] ?? null),
}));
vi.mock("@/lib/backend/files", () => ({
  listProjectFiles: vi.fn(async (projectId: string, prefix = "/") =>
    Object.fromEntries(Object.entries(mocks.carpetas[projectId] ?? {}).filter(([p]) => p.startsWith(prefix))),
  ),
}));

import { GET } from "./route";
import { guardarDocumento, vaciarAlmacenParaPruebas } from "@/lib/lienzo/almacen";
import { etiquetaDeLienzo } from "@/lib/lienzo/host";
import { PAGE_PERMISSIONS_POLICY } from "@/lib/publish/permissions-policy";
import { boxMarker } from "@/lib/agent/sandbox/box-marker";

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
    expect(res.headers.get("permissions-policy")).toBe(PAGE_PERMISSIONS_POLICY);
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

// ── LAS APPS WEB (spec local 2026-10-07-apps) ───────────────────────────────
describe("GET /api/lienzo/site — una app web", () => {
  const APP = { catalogo: "2026-10", entrada: "/src/main.jsx" };
  beforeEach(() => {
    mocks.carpetas[P1] = {
      ...mocks.carpetas[P1],
      "/src/main.jsx": 'import App from "./App";\nimport { createRoot } from "react-dom/client";\ncreateRoot(document.body).render(<App />);',
      "/src/App.tsx": "export default function App(): JSX.Element { return <h1>{import.meta.env.VITE_SUPABASE_URL}</h1>; }",
      "/src/Roto.jsx": "export default () => <div",
    };
  });
  const vivo = (extra: { app?: typeof APP | null; entorno?: Record<string, string> } = { app: APP }) =>
    guardarDocumento({ html: "<div id=root></div>", projectId: P1, userId: "u1", pagina: null, ...extra });

  it("🔴 la ENTRADA es el paquete (plan 02): JavaScript, sin un import del catálogo por su nombre, con App y su entorno dentro", async () => {
    delete mocks.carpetas[P1]!["/src/Roto.jsx"];
    vivo({ app: APP, entorno: { VITE_SUPABASE_URL: "https://abc.openlen.app" } });
    const main = await pide(host(P1), "/src/main.jsx");
    expect(main.status).toBe(200);
    expect(main.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(main.headers.get("cache-control")).toBe("no-store");
    const js = await main.text();
    expect(js).not.toMatch(/\bfrom\s*["']react/);
    // El JSX de la app, traducido (los mensajes de React de desarrollo sí citan
    // `<App />` como ejemplo: se mira el de main.jsx, no la cadena suelta).
    expect(js).not.toContain("document.body).render(<App");
    expect(js).toContain("https://abc.openlen.app");
  }, 60_000);

  it("🔴 un fuente roto, aunque nadie lo importe: la entrada es el módulo que lanza su error (como al publicar, que se niega)", async () => {
    vivo();
    const js = await (await pide(host(P1), "/src/main.jsx")).text();
    // Pinta la capa de error, como Vite (sin documento, nada) y LANZA, con fichero y línea.
    expect(() => new Function(js)()).toThrow(/\/src\/Roto\.jsx:1/);
  }, 60_000);

  it("🔴 como la publicada: ni el catálogo suelto ni los fuentes sueltos (van DENTRO del paquete)", async () => {
    vivo();
    expect((await pide(host(P1), "/openlen/vendor/2026-10/react.js")).status).toBe(404);
    expect((await pide(host(P1), "/src/App.tsx")).status).toBe(404);
    expect((await pide(host(P1), "/src/Roto.jsx")).status).toBe(404);
  });

  // ⚠️ Decía «un .tsx se compila» y pasaba porque el módulo de error tampoco
  // llevaba `<h1>`: en una PÁGINA el JSX no compila (el runtime automático
  // importa `react/jsx-runtime`, y una página no importa paquetes; ver
  // lib/apps/servir.test.ts). Lo destapó la capa de error, que trae el trozo de
  // código. Lo que sí se cumple: el navegador nunca recibe el fuente tal cual.
  it("en una PÁGINA, /js/app.js sigue como está y un .tsx nunca se sirve tal cual", async () => {
    vivo({ app: null });
    expect(await (await pide(host(P1), "/js/app.js")).text()).toBe("document.title = 'cargó'");
    expect((await (await pide(host(P1), "/src/App.tsx")).text()).startsWith("export default function App")).toBe(false);
  });

  it("🔴 /tests y /supabase siguen sin servirse, aunque sean .ts", async () => {
    vivo();
    expect((await pide(host(P1), "/tests/a.spec.ts")).status).toBe(404);
  });

  it("🔴 sin un documento vivo del proyecto, ni el paquete", async () => {
    expect((await pide(host(P1), "/src/main.jsx")).status).toBe(404);
  });
});

// LA CAJA DE LEN (plan local 2026-10-21-playwright-in-the-box): con la marca que pone el proxy de E2B,
// el lienzo le sirve el BORRADOR GUARDADO en cualquier ruta de página — lo mismo que ven los ojos —,
// sin pedir un documento vivo. Sin marca válida y de este proyecto, todo sigue como antes.
describe("GET /api/lienzo/site — la vista del borrador para la caja", () => {
  const marca = (id: string) => boxMarker(id, { AUTH_SECRET: SECRETO })!;
  const pideDesdeLaCaja = (h: string, ruta: string, valor: string) => {
    const url = new URL(ruta, `https://${h}`);
    const path = url.pathname.split("/").filter(Boolean);
    return GET(new Request(url, { headers: { host: h, "x-openlen-caja": valor } }), { params: Promise.resolve({ path }) });
  };

  beforeEach(() => {
    mocks.proyectos = {
      [P1]: {
        title: "Panadería",
        subdomain: "masa",
        data: { html: "<!doctype html><html><body><p>home guardada</p></body></html>", pages: { menu: { html: "<!doctype html><html><body><p>menú guardado</p></body></html>" } } },
      },
    };
  });

  it("la home en `/`, guardada, con las cabeceras del lienzo", async () => {
    const res = await pideDesdeLaCaja(host(P1), "/", marca(P1));
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("<p>home guardada</p>");
    expect(res.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("una página en `/menu`, `/menu/` y `/menu/index.html`; una que no existe, 404", async () => {
    for (const ruta of ["/menu", "/menu/", "/menu/index.html"]) {
      const res = await pideDesdeLaCaja(host(P1), ruta, marca(P1));
      expect(res.status, ruta).toBe(200);
      expect(await res.text()).toContain("<p>menú guardado</p>");
    }
    expect((await pideDesdeLaCaja(host(P1), "/nada", marca(P1))).status).toBe(404);
  });

  it("la carpeta que se publica, sin documento vivo; lo que no se publica, 404", async () => {
    const res = await pideDesdeLaCaja(host(P1), "/js/app.js", marca(P1));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("document.title = 'cargó'");
    expect((await pideDesdeLaCaja(host(P1), "/tests/a.spec.ts", marca(P1))).status).toBe(404);
  });

  it("🔴 la marca de OTRO proyecto, o una falsa, no abre nada", async () => {
    mocks.proyectos[P2] = { title: "Otro", subdomain: null, data: { html: "<p>ajeno</p>" } };
    expect((await pideDesdeLaCaja(host(P1), "/", marca(P2))).status).toBe(404);
    expect((await pideDesdeLaCaja(host(P1), "/", `${P1}.${"0".repeat(32)}`)).status).toBe(404);
  });

  it("sin marca, `/` sin documento sigue siendo 404", async () => {
    expect((await pide(host(P1), "/")).status).toBe(404);
  });
});
