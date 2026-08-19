import { describe, expect, it } from "vitest";

import { bindColorsToTokens } from "./bind-colors-to-tokens";

const page = (modelCss: string, theme = "--ol-bg:#0e0b09;--ol-fg:#f4e9d8;--ol-accent:#fe717b") =>
  `<!doctype html><html style="${theme}"><head><style data-openlen-creative>${modelCss}</style></head><body></body></html>`;

describe("atar colores literales a su token", () => {
  it("ata el literal idéntico al token que vale lo mismo", () => {
    const out = bindColorsToTokens(page(".hero{color:#f4e9d8;background:#0e0b09}"));
    expect(out.bound).toBe(2);
    expect(out.html).toContain("color:var(--ol-fg)");
    expect(out.html).toContain("background:var(--ol-bg)");
  });

  it("no toca un color que el modelo eligió de verdad", () => {
    // El 51% de los colores a mano son nuevos. Reescribirlos cambiaría el
    // diseño, y eso sería peor que el problema que resuelve esta pasada.
    const out = bindColorsToTokens(page(".badge{color:#7fd08a}"));
    expect(out.bound).toBe(0);
    expect(out.html).toContain("color:#7fd08a");
  });

  it("acepta el mismo color escrito con otra notación", () => {
    const out = bindColorsToTokens(page(".a{color:#F4E9D8}.b{color:#f4e9d8ff}", "--ol-fg:#f4e9d8"));
    expect(out.bound).toBe(2);
  });

  it("no ata un valor que dos tokens comparten", () => {
    const out = bindColorsToTokens(page(".a{color:#111111}", "--ol-bg:#111111;--ol-surface:#111111"));
    expect(out.bound).toBe(0);
  });

  it("deja en paz las hojas que no son del modelo", () => {
    const html = `<!doctype html><html style="--ol-fg:#f4e9d8"><head><style data-sec="hero-1">.x{color:#f4e9d8}</style></head><body></body></html>`;
    expect(bindColorsToTokens(html)).toEqual({ html, bound: 0 });
  });

  it("nunca reescribe donde viven los valores", () => {
    const out = bindColorsToTokens(page(":root{--olm-ink:#f4e9d8}.x{color:#f4e9d8}", "--ol-fg:#f4e9d8"));
    expect(out.html).toContain("--olm-ink:#f4e9d8");
  });

  it("ignora un :root que pierde contra el style= de <html>", () => {
    // El marcador de dirección declara su propia paleta en un :root que el
    // atributo en línea gana. Cosecharlo ataba el literal al valor que NO se
    // ve, y la página cambiaba de color en pantalla.
    const html = `<!doctype html><html style="--ol-surface:#fbf7ef"><head>`
      + `<style data-openlen-visual-engine="creative-direction/1.0">:root{--ol-surface:#ffffff}</style>`
      + `<style data-openlen-creative>.card{background:#ffffff}</style></head><body></body></html>`;
    const out = bindColorsToTokens(html);
    expect(out.bound).toBe(0);
    expect(out.html).toContain("background:#ffffff");
  });

  it("es idempotente", () => {
    const once = bindColorsToTokens(page(".hero{color:#f4e9d8}"));
    expect(bindColorsToTokens(once.html)).toEqual({ html: once.html, bound: 0 });
  });

  it("no rompe un degradado del que sólo una parada es token", () => {
    const out = bindColorsToTokens(page(".h{background:linear-gradient(#0e0b09,#7fd08a)}"));
    expect(out.bound).toBe(1);
    expect(out.html).toContain("linear-gradient(var(--ol-bg),#7fd08a)");
  });
});
