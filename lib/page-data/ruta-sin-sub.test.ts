// @vitest-environment node
//
// `/api/d/<almacén>` — la ruta sin subdominio. Es una cáscara sobre la de
// siempre: saca el sitio del host y delega. Lo que hay que impedir es que un
// día decida algo por su cuenta (permisos, cuota, origen) y las dos rutas
// empiecen a contestar distinto a la misma página.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { GET, POST } from "@/app/api/d/[sub]/route";

const ruta = readFileSync(join(process.cwd(), "app", "api", "d", "[sub]", "route.ts"), "utf8");

const ctx = (store: string) => ({ params: Promise.resolve({ sub: store }) });

describe("la ruta sin subdominio", () => {
  it("sin una página publicada detrás no escribe en nadie: 404 sitio_desconocido", async () => {
    const casos: Record<string, string>[] = [{}, { host: "openlen.app" }, { origin: "https://a.b.openlen.app" }];
    for (const headers of casos) {
      const r = await POST(
        new Request("https://openlen.app/api/d/carrito", { method: "POST", headers, body: "{}" }),
        ctx("carrito"),
      );
      expect(r.status).toBe(404);
      expect(await r.json()).toEqual({ error: "sitio_desconocido" });
    }
    const r = await GET(new Request("https://openlen.app/api/d/carrito"), ctx("carrito"));
    expect(r.status).toBe(404);
  });

  it("saca el sitio con las MISMAS reglas y todos los dominios publicados", () => {
    expect(ruta).toContain("subDeLaPagina");
    expect(ruta).toContain("publishedBaseHosts()");
    expect(ruta).toContain("resolveCustomDomainSub");
  });

  it("delega los cuatro verbos en la ruta de siempre, sin decidir nada", () => {
    expect(ruta).toMatch(/from "\.\/\[store\]\/route"/);
    for (const verbo of ["GET", "POST", "PATCH", "DELETE"]) {
      expect(ruta).toMatch(new RegExp(`export function ${verbo}\\(`));
    }
    for (const pieza of ["validaDocumento", "permite(", "cabe(", "checkAndConsume", "listar("]) {
      expect(ruta).not.toContain(pieza);
    }
  });

  it("corre en nodejs y sin caché, como la otra", () => {
    expect(ruta).toContain('export const runtime = "nodejs"');
    expect(ruta).toContain('export const dynamic = "force-dynamic"');
  });
});
