// @vitest-environment node
//
// LAS VARIANTES DE IDIOMA TAMBIÉN EJECUTAN.
//
// Una variante es la MISMA página traducida, del mismo release. Cuando el
// script vivía fuera del documento se injertaba DESPUÉS de construirlas, así
// que `/` salía viva y `/en/` muerta: el carrito funcionaba en español y no en
// inglés, sin nada que lo explicara.
//
// Ahora el script es parte del documento del que salen las traducciones, así
// que lo llevan por construcción. Esta prueba se queda porque el traductor
// PODRÍA comérselo — es el único sitio donde eso se vería.
//
// Se llama a `publishToDir` de verdad, con disco de verdad. Lo que se mide no
// es «hay un script» sino que **la CSP de cada documento lo autoriza por hash**:
// injertar después de sellar produce exactamente el mismo fichero a la vista y
// una página que el navegador deja muda.
import { describe, it, expect, afterAll } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const RAIZ = mkdtempSync(path.join(tmpdir(), "ol-locales-"));
process.env.PUBLISH_ROOT = RAIZ;
process.env.OPENLEN_IMAGE_BAKE = "0";
process.env.OPENLEN_FONT_BAKE = "0";
process.env.OPENLEN_IMAGERY = "0";

import { publishToDir } from "./filesystem";

const MARCA = "__JS_CON_IDIOMAS__";
const CODIGO = `document.getElementById("b").addEventListener("click",function(){window.${MARCA}=1});`;
const doc = (titulo: string, lang: string) =>
  `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><title>${titulo}</title></head>\n<body><h1>${titulo}</h1><button id="b">pulsa</button><script>${CODIGO}</script></body></html>`;

const SUB = "e2elocales";

/** ¿La CSP de ESTE documento autoriza ESTE script? */
function cspAutoriza(html: string, codigo: string): boolean {
  const b64 = createHash("sha256").update(codigo, "utf8").digest("base64");
  const csp = /content="([^"]*script-src[^"]*)"/i.exec(html)?.[1] ?? "";
  return csp.includes(`'sha256-${b64}'`);
}

function vivo(rel: string): string {
  const base = path.join(RAIZ, SUB);
  try {
    return readFileSync(path.join(base, "current", rel), "utf8");
  } catch {
    const sha = readFileSync(path.join(base, "current"), "utf8").trim();
    return readFileSync(path.join(base, "releases", sha, rel), "utf8");
  }
}

afterAll(() => rmSync(RAIZ, { recursive: true, force: true }));

describe("el JavaScript del modelo llega a las variantes de idioma", () => {
  it("publica /, /en/ y /fr/ y las tres lo ejecutan", async () => {
    await publishToDir({
      subdomain: SUB,
      // El script viaja DENTRO del documento — ya no hay parámetro que pasar.
      html: doc("Portada", "es"),
      sourceLang: "es",
      // El traductor de verdad cuesta una llamada al modelo; lo que se mide
      // aquí es el ORDEN (injertar → sellar), no la traducción.
      buildLocaleDocs: async () => [
        { locale: "en", html: doc("Home", "en") },
        { locale: "fr", html: doc("Accueil", "fr") },
      ],
    });

    for (const [etiqueta, rel] of [
      ["/", "index.html"],
      ["/en/", "en/index.html"],
      ["/fr/", "fr/index.html"],
    ] as const) {
      const html = vivo(rel);
      expect(html, `${etiqueta} salió sin el script`).toContain(MARCA);
      expect(
        cspAutoriza(html, CODIGO),
        `${etiqueta} lleva el script y su propia CSP lo bloquea`,
      ).toBe(true);
    }
  }, 60_000);
});
