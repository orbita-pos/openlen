// La Permissions-Policy de las páginas: UNA cadena, cinco sitios que la mandan.
//
// La publicada la pone Caddy (bloque *.openlen.app); los dominios propios, la
// ruta /served; el lienzo, sus dos rutas; y el crate `edge` la copia por
// paridad. Hasta el 2026-10-13 las cinco decían `camera=(), microphone=(),
// geolocation=()`: ninguna página podía escanear un código con la cámara, oír
// el micrófono ni pedir la ubicación. Entró el 2026-05-25 como relleno del
// commit de los dominios propios, sin un porqué escrito.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_PERMISSIONS_POLICY } from "./permissions-policy";

const RAIZ = join(import.meta.dirname, "..", "..");
const leer = (...ruta: string[]) => readFileSync(join(RAIZ, ...ruta), "utf8");

describe("la Permissions-Policy de las páginas", () => {
  it("deja a la PROPIA página pedir cámara, micrófono y ubicación (el navegador pregunta al visitante)", () => {
    expect(PAGE_PERMISSIONS_POLICY).toBe("camera=(self), microphone=(self), geolocation=(self)");
  });

  it("🔴 Caddy manda la misma en *.openlen.app", () => {
    const caddy = leer("infra", "caddy", "Caddyfile");
    const bloque = caddy.slice(caddy.indexOf("\n*.openlen.app {"));
    const cabeceras = /header \{([\s\S]*?)\n\t\}/.exec(bloque)![1]!;
    expect(/Permissions-Policy "([^"]*)"/.exec(cabeceras)?.[1]).toBe(PAGE_PERMISSIONS_POLICY);
  });

  it("🔴 el crate edge copia la misma", () => {
    const rs = leer("crates", "edge", "src", "server.rs");
    expect(/const PERMISSIONS_POLICY_VALUE: &str = "([^"]*)";/.exec(rs)?.[1]).toBe(PAGE_PERMISSIONS_POLICY);
  });

  it("🔴 ninguna ruta de páginas vuelve a escribir la cadena a mano", () => {
    for (const ruta of [
      ["app", "api", "lienzo", "[docId]", "route.ts"],
      ["app", "api", "lienzo", "site", "[[...path]]", "route.ts"],
      ["app", "served", "[host]", "[[...path]]", "route.ts"],
    ]) {
      const src = leer(...ruta);
      expect(src, ruta.join("/")).toContain("PAGE_PERMISSIONS_POLICY");
      expect(src, ruta.join("/")).not.toMatch(/camera=\(/);
    }
  });
});
