// @vitest-environment node
//
// UN IDIOMA QUE NO SALE TIENE QUE OÍRSE.
//
// `localizeForPublish` cae blando por idioma y `publishToDir` publica la raíz
// igual — eso está bien, una traducción caída no debe tumbar la publicación.
// Lo que estaba mal es que no lo contaba NADIE: el dueño encendía tres
// banderas en el modal, la app le decía que fue bien, y no había ninguna
// traducción. El único rastro era un `console.warn` que nadie lee.
//
// Medido el 2026-08-28: la traducción llevaba desde su estreno sin producir un
// solo idioma —0 filas en projectTranslations sobre 41 páginas publicadas— y
// nadie lo supo. No porque el fallo fuera sutil, sino porque era MUDO.
//
// Se publica de verdad, a disco de verdad, como las demás pruebas de publish.
import { describe, it, expect, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const RAIZ = mkdtempSync(path.join(tmpdir(), "ol-fallidos-"));
process.env.PUBLISH_ROOT = RAIZ;
process.env.OPENLEN_IMAGE_BAKE = "0";
process.env.OPENLEN_FONT_BAKE = "0";
process.env.OPENLEN_IMAGERY = "0";

import { publishToDir } from "./filesystem";

afterAll(() => rmSync(RAIZ, { recursive: true, force: true }));

const doc = (titulo: string, lang: string) =>
  `<!doctype html><html lang="${lang}"><head><title>${titulo}</title></head><body><h1>${titulo}</h1></body></html>`;

describe("los idiomas pedidos que no salieron", () => {
  it("cuando salen todos, no hay nada que avisar", async () => {
    const r = await publishToDir({
      subdomain: "fallidos-todos",
      html: doc("Portada", "es"),
      sourceLang: "es",
      localesPedidos: ["en", "fr"],
      buildLocaleDocs: async () => [
        { locale: "en", html: doc("Home", "en") },
        { locale: "fr", html: doc("Accueil", "fr") },
      ],
    });
    expect(r.locales.sort()).toEqual(["en", "fr"]);
    expect(r.localesFallidos).toEqual([]);
  });

  // EL CASO QUE IMPORTA: la caída es PARCIAL. La raíz y el inglés salen, el
  // francés no. Antes esto era indistinguible del caso de arriba.
  it("nombra el que se cayó, y sólo ése", async () => {
    const r = await publishToDir({
      subdomain: "fallidos-uno",
      html: doc("Portada", "es"),
      sourceLang: "es",
      localesPedidos: ["en", "fr"],
      buildLocaleDocs: async () => [{ locale: "en", html: doc("Home", "en") }],
    });
    expect(r.locales).toEqual(["en"]);
    expect(r.localesFallidos).toEqual(["fr"]);
  });

  // Y el caso real que se midió: NINGUNO sale. La publicación es un éxito
  // —la página está online— y aun así hay tres cosas que decir.
  it("cuando no sale ninguno, los nombra todos y la raíz publica igual", async () => {
    const r = await publishToDir({
      subdomain: "fallidos-todos-no",
      html: doc("Portada", "es"),
      sourceLang: "es",
      localesPedidos: ["en", "fr", "ja"],
      buildLocaleDocs: async () => [],
    });
    expect(r.locales).toEqual([]);
    expect(r.localesFallidos.sort()).toEqual(["en", "fr", "ja"]);
    expect(r.sha).toBeTruthy(); // la raíz SÍ se publicó
  });

  // Un fallo del traductor entero (excepción, no array vacío) cuenta igual: el
  // dueño pidió idiomas y no los tiene, y el motivo le da lo mismo.
  it("si el traductor revienta, también se nombran", async () => {
    const r = await publishToDir({
      subdomain: "fallidos-revienta",
      html: doc("Portada", "es"),
      sourceLang: "es",
      localesPedidos: ["ja"],
      buildLocaleDocs: async () => {
        throw new Error("upstream 500");
      },
    });
    expect(r.localesFallidos).toEqual(["ja"]);
  });

  // Sin idiomas pedidos no hay ruido: `localesFallidos` no puede convertirse en
  // un aviso permanente para las páginas de un solo idioma, que son casi todas.
  it("una página sin idiomas no genera aviso", async () => {
    const r = await publishToDir({
      subdomain: "fallidos-ninguno",
      html: doc("Portada", "es"),
      sourceLang: "es",
    });
    expect(r.localesFallidos).toEqual([]);
  });
});
