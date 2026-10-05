// «ABRIR EN PESTAÑA» CORRE EN `.app`, NO EN LA APP (2026-10-04).
//
// Hasta ese día `/raw?bake=1` se servía en primer nivel SIN sandbox: el
// JavaScript del proyecto —el que escribe Len, lo remezclado y, con la entrada
// como Vercel, lo pegado y lo clonado— corría como openlen.com, con la sesión
// del dueño. Ahora la pestaña se va al lienzo, `lienzo-<id>.<dominio de
// páginas>`, donde la página tiene su origen (y su `localStorage`); y lo que se
// sigue sirviendo aquí va siempre con origen opaco.
//
// El almacén del lienzo, `documentoDeVista` y la ruta GET del lienzo son los de
// verdad (con el binding nativo): se sigue la redirección hasta el documento.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  limit: vi.fn(),
  bake: vi.fn(async (html: string) => `${html}<!--horneado-->`),
}));

vi.mock("@/auth", () => ({ auth: mocks.auth }));
vi.mock("drizzle-orm", () => ({ and: (...a: unknown[]) => a, eq: (l: unknown, r: unknown) => [l, r] }));
vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: mocks.limit }) }) }) },
  schema: { projects: { id: "id", userId: "userId", data: "data", title: "title", subdomain: "subdomain", logoUrl: "logoUrl" } },
}));
// Sólo el horneado de la reserva (lee la base); el del lienzo
// (`bakeModulesForPreviewHtml`, puro) es el de verdad.
vi.mock("@/lib/publish/preview-bake", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/publish/preview-bake")>()),
  bakeModulesForPreview: mocks.bake,
}));

import { GET } from "./route";
import { GET as GET_SITIO } from "@/app/api/lienzo/site/[[...path]]/route";
import { vaciarAlmacenParaPruebas } from "@/lib/lienzo/almacen";
import { etiquetaDeLienzo } from "@/lib/lienzo/host";
import { TAB_SANDBOX_CSP, EMBED_SANDBOX_CSP } from "@/lib/publish/embed-sandbox";

const ID = "4f9c10cb-8781-48f1-b291-c5d146579f09";
// La etiqueta es un HMAC del id con AUTH_SECRET (pieza 9 de Len 2.5).
const SECRETO = "s3cr3t";
const ETIQUETA = etiquetaDeLienzo(ID, { AUTH_SECRET: SECRETO })!;

/** Lo que contesta el lienzo en la URL a la que redirige (su host y su ruta). */
const abrir = (destino: URL) =>
  GET_SITIO(new Request(destino, { headers: { host: destino.host } }), {
    params: Promise.resolve({ path: destino.pathname.split("/").filter(Boolean) }),
  });
const SCRIPT = "<script>localStorage.setItem('carrito','1')</script>";
const HOME = `<!doctype html><html lang="es"><head><title>Tienda</title></head><body><h1>Tienda</h1>${SCRIPT}</body></html>`;
const MENU = `<!doctype html><html lang="es"><head><title>Menú</title></head><body><h1>Menú</h1>${SCRIPT}</body></html>`;

function pide(query: string, dest?: string): Request {
  return new Request(`https://openlen.com/api/projects/${ID}/raw${query}`, {
    headers: { host: "openlen.com", ...(dest ? { "sec-fetch-dest": dest } : {}) },
  });
}
const params = { params: Promise.resolve({ id: ID }) };

beforeEach(() => {
  vi.clearAllMocks();
  vaciarAlmacenParaPruebas();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("PUBLISH_BASE_HOST", "openlen.app");
  vi.stubEnv("LIENZO_BASE_HOST", "");
  vi.stubEnv("OPENLEN_LIENZO_ORIGEN", "");
  vi.stubEnv("AUTH_SECRET", SECRETO);
  mocks.auth.mockResolvedValue({ user: { id: "u1" } });
  mocks.limit.mockResolvedValue([
    { data: { html: HOME, pages: { menu: { html: MENU } }, settings: {} }, title: "Tienda", subdomain: null, logoUrl: null },
  ]);
});
afterEach(() => vi.unstubAllEnvs());

describe("«abrir en pestaña» — /raw?bake=1 en primer nivel", () => {
  it("🔴 redirige al lienzo en .app, y allí está la página con su JavaScript", async () => {
    const res = await GET(pide("?bake=1", "document"), params);

    expect(res.status).toBe(303);
    const destino = new URL(res.headers.get("location")!);
    expect(destino.origin).toBe(`https://${ETIQUETA}.openlen.app`);
    // La ruta de la publicada, con el documento en `__lienzo` (pieza 9).
    expect(destino.pathname).toBe("/");
    expect(destino.searchParams.get("__lienzo")).toMatch(/^[\w-]+$/);

    // Lo que contesta el lienzo en ESE host: el documento, con su script.
    const lienzo = await abrir(destino);
    expect(lienzo.status).toBe(200);
    const html = await lienzo.text();
    expect(html).toContain("<h1>Tienda</h1>");
    expect(html).toContain("localStorage.setItem('carrito','1')");
    // Con su origen: nada de `sandbox` en la respuesta del lienzo.
    expect(lienzo.headers.get("content-security-policy") ?? "").not.toContain("sandbox");
  });

  it("?page= lleva esa página al lienzo, no la portada", async () => {
    const res = await GET(pide("?bake=1&page=menu", "document"), params);
    const destino = new URL(res.headers.get("location")!);
    expect(destino.pathname).toBe("/menu/index.html");
    const html = await (await abrir(destino)).text();
    expect(html).toContain("<h1>Menú</h1>");
    expect(html).not.toContain("<h1>Tienda</h1>");
  });

  it("una página que no existe sigue siendo 404, sin guardar nada en el lienzo", async () => {
    const res = await GET(pide("?bake=1&page=nope", "document"), params);
    expect(res.status).toBe(404);
  });

  it("sin sesión, 401: no se redirige ni se hornea nada", async () => {
    mocks.auth.mockResolvedValue(null);
    const res = await GET(pide("?bake=1", "document"), params);
    expect(res.status).toBe(401);
    expect(res.headers.get("location")).toBeNull();
  });

  // LA RESERVA. Con el lienzo apagado no hay a dónde ir, y entonces se sirve
  // aquí — pero con origen opaco, nunca como openlen.com.
  it("con el lienzo apagado se sirve aquí, con sandbox y SIN allow-same-origin", async () => {
    vi.stubEnv("OPENLEN_LIENZO_ORIGEN", "0");
    const res = await GET(pide("?bake=1", "document"), params);
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toBe(TAB_SANDBOX_CSP);
    expect(csp).not.toContain("allow-same-origin");
    expect(await res.text()).toContain("<!--horneado-->");
  });
});

describe("lo que /raw sigue sirviendo, siempre con origen opaco", () => {
  it("la miniatura incrustada: la estricta", async () => {
    const res = await GET(pide("", "iframe"), params);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(EMBED_SANDBOX_CSP);
    expect(res.headers.get("location")).toBeNull();
  });

  it("🔴 /raw abierto a mano en una pestaña: sandbox, no el origen de la app", async () => {
    const res = await GET(pide("", "document"), params);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(TAB_SANDBOX_CSP);
  });

  it("?bake=1 incrustado no se va al lienzo: se sirve aquí, opaco", async () => {
    const res = await GET(pide("?bake=1", "iframe"), params);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toBe(EMBED_SANDBOX_CSP);
  });
});
