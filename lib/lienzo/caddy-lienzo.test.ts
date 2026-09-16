// CADDY Y EL LIENZO. Spec 2026-09-15, corregida al leer el bloque: un `handle`
// de ruta (orden definido), no una regla por host. Y la exclusión de `@doc`,
// que la spec no tenía: sin ella Caddy estampa `Cache-Control: public,
// s-maxage=3600` y Cloudflare podría guardar un borrador en el borde.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RUTAS_SOLO_PUBLICADA } from "./rutas-solo-publicada";

const RAIZ = join(import.meta.dirname, "..", "..");
const sinComentarios = (s: string) => s.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
const CADDY = sinComentarios(readFileSync(join(RAIZ, "infra", "caddy", "Caddyfile"), "utf8"));

function bloque(texto: string, apertura: string): string {
  const i = texto.indexOf(apertura);
  if (i < 0) throw new Error(`no está «${apertura.trim()}»`);
  let prof = 0;
  for (let j = texto.indexOf("{", i); j < texto.length; j++) {
    if (texto[j] === "{") prof++;
    else if (texto[j] === "}" && --prof === 0) return texto.slice(i, j + 1);
  }
  throw new Error("bloque sin cerrar");
}

const PAGINAS = bloque(CADDY, "\n*.openlen.app {");

describe("Caddy y el lienzo", () => {
  it("🔴 /api/lienzo/* pasa a Next y sin X-Frame-Options", () => {
    const h = bloque(PAGINAS, "handle /api/lienzo/* {");
    expect(h).toContain("header -X-Frame-Options");
    expect(h).toContain("reverse_proxy 127.0.0.1:3000");
  });

  it("🔴 /api/lienzo/* está fuera de la caché pública de @doc", () => {
    const doc = bloque(PAGINAS, "@doc {");
    expect(doc).toMatch(/not path [^\n]*\/api\/lienzo\/\*/);
  });

  it("todo handle que pasa a Next es de la lista «sólo publicada» o es el lienzo", () => {
    const pasan = [...PAGINAS.matchAll(/handle (\/[^\s{]+) \{([^}]*)\}/g)]
      .filter(([, , cuerpo]) => cuerpo!.includes("reverse_proxy"))
      .map(([, ruta]) => ruta!);
    expect(pasan.length).toBeGreaterThan(5);
    for (const ruta of pasan) {
      if (ruta === "/api/lienzo/*") continue;
      expect(RUTAS_SOLO_PUBLICADA, `${ruta} pasa a Next y el aviso del lienzo no lo conoce`).toContain(ruta.replace(/\*$/, ""));
    }
  });

  it("CONTRA-PRUEBA: las páginas publicadas siguen sin dejarse enmarcar", () => {
    expect(bloque(PAGINAS, "header {")).toContain('X-Frame-Options "SAMEORIGIN"');
  });
});
