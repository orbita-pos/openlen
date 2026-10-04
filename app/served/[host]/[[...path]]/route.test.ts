// /served/<host>/ — la página de un dominio propio, SÓLO en su propio host.
//
// Caddy reescribe la ruta y deja el Host del dominio. La ruta existe también
// en openlen.com, y hasta el 2026-10-04 servía ahí la página publicada: su
// JavaScript corría en el origen de la APP, con la sesión de quien abriera
// `https://openlen.com/served/<dominio>/`.
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
