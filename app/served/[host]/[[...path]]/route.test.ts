// /served/<host>/ — la página de un dominio propio, SÓLO en su propio host.
//
// Caddy reescribe la ruta y deja el Host del dominio. La ruta existe también
// en openlen.com, y hasta el 2026-10-04 servía ahí la página publicada: su
// JavaScript corría en el origen de la APP, con la sesión de quien abriera
// `https://openlen.com/served/<dominio>/`.
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// `PUBLISH_ROOT` se lee al cargar la ruta: se fija antes del import.
const raiz = vi.hoisted(() => {
  const base = process.env.TEMP || process.env.TMPDIR || "/tmp";
  const dir = `${base}/openlen-served-test-${process.pid}`;
  process.env.PUBLISH_ROOT = dir;
  return dir;
});

const mocks = vi.hoisted(() => ({ lookupDomain: vi.fn() }));
vi.mock("@/lib/custom-domains", () => ({ lookupDomain: mocks.lookupDomain }));

import { releaseAbManifests } from "@/lib/ab/serve";
import { PAGE_PERMISSIONS_POLICY } from "@/lib/publish/permissions-policy";
import { GET, HEAD } from "./route";

const DOMINIO = "landing.miempresa.com";
const PAGINA = "<!doctype html><html><body><h1>Mi empresa</h1><script>fetch('/api/projects')</script></body></html>";

function pide(host: string): Request {
  return new Request(`https://${host}/served/${DOMINIO}`, { headers: { host } });
}
const params = () => ({ params: Promise.resolve({ host: DOMINIO }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lookupDomain.mockResolvedValue({ projectId: "p1", subdomain: "demo", verified: true });
  mkdirSync(path.join(raiz, "demo", "current"), { recursive: true });
  writeFileSync(path.join(raiz, "demo", "current", "index.html"), PAGINA);
});
afterAll(() => rmSync(raiz, { recursive: true, force: true }));

describe("/served/<host>/", () => {
  it("en su propio host sirve la página publicada", async () => {
    const res = await GET(pide(DOMINIO), params());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(PAGINA);
    // La misma que la publicada en *.openlen.app: la página puede pedir cámara,
    // micrófono y ubicación, y el navegador se lo pregunta al visitante.
    expect(res.headers.get("permissions-policy")).toBe(PAGE_PERMISSIONS_POLICY);
  });

  it("también con puerto y en mayúsculas", async () => {
    const res = await GET(pide("Landing.MiEmpresa.com:443"), params());
    expect(res.status).toBe(200);
  });

  it("🔴 pedida desde openlen.com, 404: la página no corre en el origen de la app", async () => {
    const res = await GET(pide("openlen.com"), params());
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("fetch('/api/projects')");
    // Ni se pregunta por el dominio: la respuesta no depende de que exista.
    expect(mocks.lookupDomain).not.toHaveBeenCalled();
  });

  it("HEAD igual", async () => {
    expect((await HEAD(pide("openlen.com"), params())).status).toBe(404);
    expect((await HEAD(pide(DOMINIO), params())).status).toBe(200);
  });
});

// LA CARPETA EN UN DOMINIO PROPIO (pieza 9 de Len 2.5, nota 7 de C). Caddy
// manda todo el dominio propio por aquí, así que la carpeta la sirve esta ruta:
// con su tipo y revalidándose siempre, como `public/` en Vercel. Hasta ahora
// todo lo que no era HTML salía inmutable 30 días — también un `sw.js`, que
// dejaría a los visitantes en la versión vieja.
describe("/served/<host>/ — los ficheros de la carpeta", () => {
  const fichero = (ruta: string, contenido: string) => {
    const abs = path.join(raiz, "demo", "current", ...ruta.split("/").filter(Boolean));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, contenido);
  };
  const pideRuta = (ruta: string) =>
    GET(new Request(`https://${DOMINIO}${ruta}`, { headers: { host: DOMINIO } }), {
      params: Promise.resolve({ host: DOMINIO, path: ruta.split("/").filter(Boolean) }),
    });

  it("🔴 un fichero de la carpeta se revalida siempre y lleva su tipo", async () => {
    const casos: Array<[string, string]> = [
      ["/js/app.js", "text/javascript; charset=utf-8"],
      ["/js/m.mjs", "text/javascript; charset=utf-8"],
      ["/sw.js", "text/javascript; charset=utf-8"],
      ["/manifest.webmanifest", "application/manifest+json; charset=utf-8"],
      ["/data/menu.json", "application/json; charset=utf-8"],
      ["/docs/leeme.md", "text/markdown; charset=utf-8"],
      ["/css/site.css", "text/css; charset=utf-8"],
    ];
    for (const [ruta, tipo] of casos) {
      fichero(ruta, "x");
      const res = await pideRuta(ruta);
      expect(res.status, ruta).toBe(200);
      expect(res.headers.get("content-type"), ruta).toBe(tipo);
      expect(res.headers.get("cache-control"), ruta).toBe("public, max-age=0, must-revalidate");
    }
  });

  // Since the folder took images (28/10, 386f31d27) an image of the folder is named after its file, not its
  // content: dropping a new logo.png on the Code lens, or Len resizing /img/hero.jpg in place, keeps the URL. It
  // revalidates like a js — immutable, a visitor kept the old one for a month. What carries its content in its
  // name (/assets/) stays immutable.
  it("BRAZO DE CONTROL: lo de /assets/ (nombre con hash) sigue inmutable; una imagen de la carpeta se revalida", async () => {
    mkdirSync(path.join(raiz, "demo", "assets"), { recursive: true });
    writeFileSync(path.join(raiz, "demo", "assets", "abc123.js"), "x");
    fichero("/foto.png", "x");
    expect((await pideRuta("/assets/abc123.js")).headers.get("cache-control")).toBe("public, max-age=2592000, immutable");
    expect((await pideRuta("/foto.png")).headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
  });

  // REVALIDATING COSTS AN EMPTY ANSWER, as Caddy's file_server gives on *.openlen.app: a custom domain has no
  // Cloudflare in front, and without a validator every visit downloaded every file of the folder again.
  const pideCon = (ruta: string, headers: Record<string, string>) =>
    GET(new Request(`https://${DOMINIO}${ruta}`, { headers: { host: DOMINIO, ...headers } }), {
      params: Promise.resolve({ host: DOMINIO, path: ruta.split("/").filter(Boolean) }),
    });

  it("🔴 a file carries its validators, and the same ETag gets a 304 with no body", async () => {
    fichero("/img/logo.png", "logo-v1");
    const first = await pideRuta("/img/logo.png");
    const etag = first.headers.get("etag");
    expect(etag).toMatch(/^W\/"[0-9a-z]+-[0-9a-z]+"$/);
    expect(first.headers.get("last-modified")).toBeTruthy();
    const again = await pideCon("/img/logo.png", { "if-none-match": etag! });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    expect(again.headers.get("etag")).toBe(etag);
    expect(again.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
  });

  it("🔴 a file that changed under the same name is sent whole again", async () => {
    fichero("/img/logo.png", "logo-v1");
    const etag = (await pideRuta("/img/logo.png")).headers.get("etag")!;
    fichero("/img/logo.png", "logo-version-2");
    const again = await pideCon("/img/logo.png", { "if-none-match": etag });
    expect(again.status).toBe(200);
    expect(await again.text()).toBe("logo-version-2");
  });

  it("If-Modified-Since at the file's time is a 304 too; If-None-Match wins when both come", async () => {
    fichero("/css/site.css", "body{}");
    const first = await pideRuta("/css/site.css");
    const lastModified = first.headers.get("last-modified")!;
    expect((await pideCon("/css/site.css", { "if-modified-since": lastModified })).status).toBe(304);
    expect((await pideCon("/css/site.css", { "if-modified-since": lastModified, "if-none-match": 'W/"other"' })).status).toBe(200);
  });
});

// LAS APPS WEB EN UN DOMINIO PROPIO (spec local 2026-10-07-apps): un fuente se
// publica COMPILADO en su ruta (la entrada de una app es su paquete, plan 02) y
// tiene que salir como JavaScript (un módulo con otro tipo no se ejecuta).
describe("/served/<host>/ — una app web", () => {
  const pideRuta = (ruta: string) =>
    GET(new Request(`https://${DOMINIO}/served/${DOMINIO}${ruta}`, { headers: { host: DOMINIO } }), {
      params: Promise.resolve({ host: DOMINIO, path: ruta.split("/").filter(Boolean) }),
    });

  beforeEach(() => {
    mkdirSync(path.join(raiz, "demo", "current", "src"), { recursive: true });
    writeFileSync(path.join(raiz, "demo", "current", "src", "App.tsx"), "export default 1;");
  });

  it("un .tsx compilado sale como JavaScript y se revalida siempre", async () => {
    const res = await pideRuta("/src/App.tsx");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
  });
});

// A/B EN UN DOMINIO PROPIO (revisión del 19/11, puntos 7 y 11). El experimento vive bajo la raíz
// reservada `openlen/` de la release: `openlen/ab.json` es el manifiesto y `openlen/ab/<id>/b/` el
// árbol de la variante B. Un visitante nunca los lee directo, se escriba como se escriba la ruta.
describe("/served/<host>/ — A/B", () => {
  const MANIFIESTO = {
    version: 1,
    releaseSha: "abc123456789",
    experiments: [
      {
        id: "ab_9f3c2a1b",
        cookieName: "ol_ab_9f3c2a1b",
        targetPath: "/",
        includeLocales: false,
        locales: [],
        splitBps: 5000,
        salt: "3f9a1c8e7b2d4012",
        prefixB: "openlen/ab/ab_9f3c2a1b/b",
        overrideParam: "_ol_ab",
        expiresAt: null,
        // Inside the experiment, as the publisher writes it.
        overrides: ["/css/site.css", "/img/hero.png"],
      },
    ],
  };
  const release = () => path.join(raiz, "demo", "current");
  const escribe = (rel: string, contenido: string) => {
    const abs = path.join(release(), ...rel.split("/"));
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, contenido);
  };
  const pideRuta = (
    ruta: string,
    init: {
      cookie?: string;
      query?: string;
      /** The scheme Node sees (behind Caddy it is always http). */
      scheme?: "http" | "https";
      /** What Caddy says the visitor used. */
      forwardedProto?: string;
    } = {},
  ) => {
    const partes = ruta.split("/").filter(Boolean);
    return GET(
      new Request(`${init.scheme ?? "https"}://${DOMINIO}${ruta}${init.query ?? ""}`, {
        headers: {
          host: DOMINIO,
          "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/131.0.0.0 Safari/537.36",
          "cf-connecting-ip": "203.0.113.10",
          ...(init.cookie ? { cookie: init.cookie } : {}),
          ...(init.forwardedProto ? { "x-forwarded-proto": init.forwardedProto } : {}),
        },
      }),
      { params: Promise.resolve({ host: DOMINIO, path: partes }) },
    );
  };

  beforeEach(() => {
    rmSync(path.join(release(), "openlen"), { recursive: true, force: true });
    escribe("openlen/ab.json", JSON.stringify(MANIFIESTO));
    escribe("openlen/ab/ab_9f3c2a1b/b/index.html", "<h1>Variante B</h1>");
    escribe("openlen/figure-0a1b2c3d.js", "figure()");
    escribe("css/site.css", "body{color:red}");
    escribe("openlen/ab/ab_9f3c2a1b/b/css/site.css", "body{color:blue}");
    escribe("css/other.css", "body{margin:0}");
    escribe("img/hero.png", "PNG-A");
  });

  it("🔴 el manifiesto y el árbol de B dan 404 escritos de cualquier modo", async () => {
    for (const ruta of [
      "/openlen/ab.json",
      "/openlen/ab.json/",
      "/openlen/%61b.json",
      "/openlen/./ab.json",
      "/openlen//ab.json",
      "/foo/../openlen/ab.json",
      "/OPENLEN/AB.JSON",
      "/openlen/ab/ab_9f3c2a1b/b/index.html",
      "/openlen/%61b/ab_9f3c2a1b/b/index.html",
    ]) {
      const res = await pideRuta(ruta);
      expect(res.status, ruta).toBe(404);
      expect(await res.text(), ruta).not.toContain("experiments");
    }
  });

  it("los otros ficheros de openlen/ se siguen sirviendo", async () => {
    const res = await pideRuta("/openlen/figure-0a1b2c3d.js");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("figure()");
  });

  it("la cookie b sirve la variante B desde su árbol, sin caché compartida", async () => {
    const res = await pideRuta("/", { cookie: "ol_ab_9f3c2a1b=b" });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("<h1>Variante B</h1>");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("vary")).toBe("Cookie");
    expect(res.headers.get("x-openlen-ab")).toBe("ab_9f3c2a1b:b");
  });

  // 🔴 Detrás de Caddy, Node ve siempre http: la cookie sale Secure según lo que dice Caddy
  // (X-Forwarded-Proto), o el esquema del sitio, y no según el protocolo de la petición que ve Node.
  it("la cookie del primer visitante sale Secure según X-Forwarded-Proto, no según lo que ve Node", async () => {
    const setCookie = async (init: Parameters<typeof pideRuta>[1]) =>
      (await pideRuta("/", init)).headers.get("set-cookie") ?? "";
    expect(await setCookie({ scheme: "http", forwardedProto: "https" })).toContain("; Secure");
    expect(await setCookie({ scheme: "http", forwardedProto: "https, http" })).toContain("; Secure");
    // El encabezado manda también cuando dice lo contrario.
    expect(await setCookie({ scheme: "https", forwardedProto: "http" })).not.toContain("Secure");
    // Sin encabezado y sin esquema configurado: el que ve la petición.
    expect(await setCookie({ scheme: "http" })).not.toContain("Secure");
    expect(await setCookie({ scheme: "https" })).toContain("; Secure");
  });

  it("sin X-Forwarded-Proto, el esquema configurado del sitio (https en producción) manda sobre lo que ve Node", async () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://openlen.com");
    try {
      const res = await pideRuta("/", { scheme: "http" });
      expect(res.headers.get("set-cookie")).toContain("; Secure");
    } finally {
      vi.unstubAllEnvs();
    }
  });

  // Un fichero que B sobrescribe (el manifiesto lo lista) es no-store PARA TODOS, también para el
  // control: la caché se llena por URL y un solo cuerpo guardado llegaría a quien le toca el otro.
  it("un fichero sobrescrito por B es no-store para B y para el control, y uno que no lo es no cambia", async () => {
    const b = await pideRuta("/css/site.css", { cookie: "ol_ab_9f3c2a1b=b" });
    expect(await b.text()).toBe("body{color:blue}");
    expect(b.headers.get("cache-control")).toBe("no-store");
    expect(b.headers.get("vary")).toBe("Cookie");
    expect(b.headers.get("etag")).toBeNull();

    const control = await pideRuta("/css/site.css");
    expect(await control.text()).toBe("body{color:red}");
    expect(control.headers.get("cache-control")).toBe("no-store");

    // B lo lista pero no lo trae: se sirve el del control, y también sin guardar.
    const faltaEnB = await pideRuta("/img/hero.png", { cookie: "ol_ab_9f3c2a1b=b" });
    expect(await faltaEnB.text()).toBe("PNG-A");
    expect(faltaEnB.headers.get("cache-control")).toBe("no-store");

    // Un fichero que nadie decide conserva su caché.
    const otro = await pideRuta("/css/other.css", { cookie: "ol_ab_9f3c2a1b=b" });
    expect(await otro.text()).toBe("body{margin:0}");
    expect(otro.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    expect(otro.headers.get("x-openlen-ab")).toBeNull();
  });

  it("el parámetro de QA manda un fichero a B también", async () => {
    const res = await pideRuta("/css/site.css", { query: "?_ol_ab=b" });
    expect(await res.text()).toBe("body{color:blue}");
  });
});

// Una publicación cambia `current` de golpe. Lo que la ruta sirve de UNA petición tiene que salir de
// UNA release: la que leyó su manifiesto, no la que apunte `current` cuando toque leer el fichero.
describe("/served/<host>/ — un cambio de release a mitad de petición", () => {
  it("el control sale de la misma release que el manifiesto y B, aunque `current` cambie entre una lectura y otra", async () => {
    mocks.lookupDomain.mockResolvedValue({ projectId: "p2", subdomain: "swap", verified: true });
    const sub = path.join(raiz, "swap");
    const [r1, r2] = ["r1", "r2"].map((r) => path.join(sub, "releases", r));
    for (const [dir, nombre] of [[r1, "R1"], [r2, "R2"]] as const) {
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "index.html"), `<h1>${nombre}</h1>`);
    }
    const link = path.join(sub, "current");
    rmSync(link, { recursive: true, force: true });
    symlinkSync(r1, link, "junction");

    // Justo después de que la ruta lea el manifiesto de la release que `current` nombraba, se publica otra.
    const real = releaseAbManifests.get.bind(releaseAbManifests);
    const espia = vi.spyOn(releaseAbManifests, "get").mockImplementation(async (dir: string) => {
      const respuesta = await real(dir);
      rmSync(link, { recursive: true, force: true });
      symlinkSync(r2, link, "junction");
      return respuesta;
    });
    try {
      const res = await GET(new Request(`https://${DOMINIO}/`, { headers: { host: DOMINIO } }), {
        params: Promise.resolve({ host: DOMINIO, path: [] }),
      });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("<h1>R1</h1>");
    } finally {
      espia.mockRestore();
      rmSync(link, { recursive: true, force: true });
    }
  });
});
