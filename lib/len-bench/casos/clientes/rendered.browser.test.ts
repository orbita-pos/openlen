// lib/len-bench/casos/clientes/rendered.browser.test.ts
// @vitest-environment node
//
// THE PAGE AS A VISITOR SEES IT, for the calibration sheet (15/11): the judge in a run reads the published page
// painted in Chromium (graders.ts `textoPintadoDelSitio`); the sheet the judge is calibrated on must show the same thing.
import type { Browser } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { lanzarNavegador } from "../../navegador";
import { renderedText } from "./rendered";

let navegador: Browser;
beforeAll(async () => {
  navegador = await lanzarNavegador();
}, 60_000);
afterAll(async () => {
  await navegador?.close();
});

describe("renderedText", () => {
  it("what the page's own script paints is there; what it replaces is not", async () => {
    const html = `<!doctype html><html><body><main id="app">Cargando…</main><script>document.getElementById("app").innerHTML = "<h2>Menú del día</h2><p>Chilaquiles verdes</p>";</script></body></html>`;
    const t = await renderedText(navegador, { html, pages: { contacto: { html: "<body><p>Escríbenos</p></body>" } } });
    expect(t).toContain("Chilaquiles verdes");
    expect(t).not.toContain("Cargando…");
    // Every page, home first.
    expect(t.indexOf("Menú del día")).toBeLessThan(t.indexOf("Escríbenos"));
  }, 60_000);
  it("a blank page is empty text", async () => {
    expect((await renderedText(navegador, { html: "" })).trim()).toBe("");
  }, 60_000);
});
