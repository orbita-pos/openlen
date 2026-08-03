// Mis plataformas en el camino de PUBLICACIÓN. Antes la banda solo la rellenaba
// el seed (crear proyecto / «Aplicar a mis páginas»), así que el creador editaba
// sus handles, los veía en /p/[id] y publicaba los viejos — y una banda que
// llegara vacía a data.html publicaba un "Encuéntrame en" sobre un hueco.
// Run: npx tsx --require ./scripts/test-node-server-only-shim.cjs --test lib/publish/platforms-band-publish.test.ts
import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildModuleSection } from "./module-sections";

// Bakes que tocan red apagados; el sello sigue encendido (Rust puro).
process.env.OPENLEN_IMAGE_BAKE = "0";
process.env.OPENLEN_FONT_BAKE = "0";
process.env.OPENLEN_LOCALIZE = "0";

const root = mkdtempSync(path.join(tmpdir(), "olplat-"));
process.env.PUBLISH_ROOT = root;

import { publishToDir } from "./filesystem";

const DOC = (lang: string) =>
  `<!doctype html>\n<html lang="${lang}"><head><meta charset="utf-8"><title>kira</title></head>\n` +
  `<body><h1>kira</h1>${buildModuleSection("platforms", { lang })}</body></html>`;

function published(sub: string): string {
  const current = path.join(root, sub, "current");
  let dir: string;
  try {
    // El entorno de test en Windows escribe un archivo-marcador con el sha.
    dir = path.join(root, sub, "releases", readFileSync(current, "utf8").trim());
  } catch {
    dir = current;
  }
  return readFileSync(path.join(dir, "index.html"), "utf8");
}

describe("publishToDir + banda Mis plataformas", () => {
  after(() => rmSync(root, { recursive: true, force: true }));

  it("rellena la banda con los handles FRESCOS que llegan al publicar", async () => {
    await publishToDir({
      subdomain: "platfresh",
      html: DOC("es"),
      platforms: [
        { type: "twitch", url: "kira" },
        { type: "kofi", url: "kira" },
      ],
    });
    const out = published("platfresh");
    assert.match(out, /href="https:\/\/twitch\.tv\/kira"/);
    assert.match(out, /href="https:\/\/ko-fi\.com\/kira"/);
    assert.ok(out.includes("Encuéntrame en"), "el encabezado de la banda sigue ahí");
  });

  it("un handle EDITADO se publica sin pasar por «Aplicar a mis páginas»", async () => {
    // data.html llega con la banda ya sembrada con el handle viejo: publicar
    // debe re-rellenarla, no respetar lo horneado en el borrador.
    const stale = DOC("es").replace(
      "<div data-ol-platforms-section></div>",
      '<div data-ol-platforms-section><a href="https://twitch.tv/VIEJO">Twitch</a></div>',
    );
    await publishToDir({
      subdomain: "platedit",
      html: stale,
      platforms: [{ type: "twitch", url: "nuevo" }],
    });
    const out = published("platedit");
    assert.match(out, /href="https:\/\/twitch\.tv\/nuevo"/);
    assert.ok(!out.includes("twitch.tv/VIEJO"), "el handle viejo no se publica");
  });

  it("sin plataformas borra la banda ENTERA — nunca un encabezado sobre un hueco", async () => {
    await publishToDir({ subdomain: "platempty", html: DOC("es"), platforms: [] });
    const out = published("platempty");
    assert.ok(!out.includes("data-ol-platforms-section"), "marcador fuera");
    assert.ok(!out.includes("Encuéntrame en"), "encabezado fuera con su banda");
    assert.ok(out.includes("<h1>kira</h1>"), "el resto de la página intacto");
  });

  it("perfil ausente (platforms sin pasar) también borra la banda", async () => {
    await publishToDir({ subdomain: "platnull", html: DOC("es") });
    const out = published("platnull");
    assert.ok(!out.includes("data-ol-platforms-section"));
    assert.ok(!out.includes("Encuéntrame en"));
  });

  it("en una página en inglés la tarjeta genérica NO sale en español", async () => {
    await publishToDir({
      subdomain: "platen",
      html: DOC("en"),
      platforms: [{ type: "website", url: "tunegocio.mx" }],
    });
    const out = published("platen");
    assert.ok(out.includes("Find me on"), "encabezado en inglés");
    assert.ok(out.includes("Website"), "tarjeta en inglés");
    assert.ok(!out.includes("Sitio web"), "sin español suelto en una página en inglés");
  });

  it("la banda publicada no lleva script ni iframe (contrato de página sellada)", async () => {
    await publishToDir({
      subdomain: "platseal",
      html: DOC("es"),
      platforms: [{ type: "twitch", url: "kira" }],
    });
    const out = published("platseal");
    const band = out.slice(out.indexOf("Encuéntrame en"));
    assert.ok(!/<iframe/i.test(band), "sin iframes");
  });
});
