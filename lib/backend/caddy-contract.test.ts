// @vitest-environment node
//
// Sin su regla en Caddy, /rest/v1/* y /auth/v1/* NO dan error: caen en
// `try_files` y se sirve la HOME estática con un 200. Y sin la exclusión de
// @doc, Cloudflare guardaría en el borde la respuesta de una sesión para
// dársela a otro. El Caddyfile es parte del backend y tiene su prueba.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const caddy = readFileSync(join(process.cwd(), "infra", "caddy", "Caddyfile"), "utf8");
const paginas = caddy.slice(caddy.indexOf("*.openlen.app {"), caddy.indexOf("\nlen.openlen.com {"));

describe("Caddy pasa el backend de las páginas a Next", () => {
  for (const ruta of ["/rest/v1/*", "/auth/v1/*"]) {
    it(`hay un handle ${ruta} en el bloque de las páginas, hacia Next`, () => {
      expect(paginas.length).toBeGreaterThan(0);
      const escaped = ruta.replace(/[/*]/g, (c) => `\\${c}`);
      const re = new RegExp(`handle ${escaped}\\s*\\{[\\s\\S]{0,200}?\\n\\t\\}`);
      const bloque = paginas.match(re);
      expect(bloque, `falta el handle ${ruta}`).not.toBeNull();
      expect(bloque![0]).toContain("reverse_proxy 127.0.0.1:3000");
    });

    it(`${ruta} está excluido de la caché pública`, () => {
      const linea = paginas.split("\n").find((l) => l.includes("not path") && l.includes("/api/f/*"));
      expect(linea).toBeDefined();
      expect(linea).toContain(ruta);
    });
  }
});

describe("el middleware de idiomas no toca el backend", () => {
  const src = readFileSync(join(process.cwd(), "middleware.ts"), "utf8");
  // En el fuente el patrón va con las barras dobladas de un literal de JS. Es
  // la PRIMERA entrada del `matcher`: la segunda (pieza 9, carril B) es la del
  // host del lienzo, que sólo corre en `lienzo-*` (lib/lienzo/middleware-lienzo.test.ts).
  const pattern = /matcher:\s*\[\s*"([^"]+)"/.exec(src)![1]!.replace(/\\\\/g, "\\");
  const matches = (path: string) => new RegExp(`^${pattern}$`).test(path);

  it("BRAZO DE CONTROL: el matcher sí casa una página de la app", () => {
    expect(matches("/new")).toBe(true);
    expect(matches("/es/projects")).toBe(true);
  });

  it("y no casa /rest/v1 ni /auth/v1", () => {
    expect(matches("/rest/v1/productos")).toBe(false);
    expect(matches("/auth/v1/verify")).toBe(false);
    expect(matches("/auth/v1/token")).toBe(false);
  });

  /* ── carril D: storage ── */
  it("ni /storage/v1 (las rutas sin punto: buckets, listar, firmar)", () => {
    expect(matches("/storage/v1/bucket")).toBe(false);
    expect(matches("/storage/v1/object/list/fotos")).toBe(false);
    expect(matches("/storage/v1/object/sign/fotos/u1/avatar")).toBe(false);
  });
});

/* ── carril D: storage ── (lib/backend/storage, plan-2-5/d-storage.md) */
describe("Caddy pasa /storage/v1 a Next y no le pone caché", () => {
  it("hay un handle /storage/v1/* en el bloque de las páginas, hacia Next", () => {
    const bloque = paginas.match(/handle \/storage\/v1\/\*\s*\{[\s\S]{0,200}?\n\t\}/);
    expect(bloque, "falta el handle /storage/v1/*").not.toBeNull();
    expect(bloque![0]).toContain("reverse_proxy 127.0.0.1:3000");
  });

  it("está en la línea `not path` de @doc (la de /api/f/*)", () => {
    const linea = paginas.split("\n").find((l) => l.includes("not path") && l.includes("/api/f/*"));
    expect(linea).toContain("/storage/v1/*");
  });

  it("@assets no le pone su caché de un mes a un .png de Storage (puede ser privado)", () => {
    const i = paginas.indexOf("@assets");
    const assets = paginas.slice(i, paginas.indexOf("\n\theader @assets", i));
    expect(assets).toContain("not path /storage/v1/*");
  });

  // Los de la carpeta (pieza 9, carril B): `header` + `reverse_proxy` DUPLICA
  // la cabecera, y un `sw.svg` privado saldría con dos Cache-Control.
  for (const nombre of ["carpeta", "webmanifest", "markdown"]) {
    it(`@${nombre} tampoco le estampa sus cabeceras a un objeto de Storage`, () => {
      const i = paginas.indexOf(`\t@${nombre} {`);
      expect(i).toBeGreaterThan(0);
      expect(paginas.slice(i, paginas.indexOf("\n\t}", i))).toContain("not path /storage/v1/*");
    });
  }
});
