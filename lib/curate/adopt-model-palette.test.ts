// El sandbox existe para que el modelo REDISEÑE. Cuando lo hace, se define su
// propia paleta (`--bg:#070606`, `--ink:#d8d0c2`) mientras el <html> sigue
// llevando la de la dirección (`--ol-bg:#09090B`) — y los fragmentos de la
// biblioteca, atados a `--ol-*`, pintan con esa. Resultado medido en la corrida
// horror-experience del 2026-08-16: cuatro negros distintos en una página y una
// costura visible donde una sección cálida toca el fondo frío.
//
// Decisión de Jesús: el tema ADOPTA la del modelo (el diseñador es el modelo;
// el tema es el piso, no el techo), en vez de atarle el CSS y aplanarle las
// capas que pintó a propósito.
import { describe, expect, it } from "vitest";
import { adoptModelPalette } from "./adopt-model-palette";

const page = (rootCss: string, htmlStyle = "--ol-bg:#09090B;--ol-fg:#F7F1ED;--ol-accent:#B91C35;--ol-accent-r:185, 28, 53") =>
  `<!doctype html><html lang="es" class="dark" style="${htmlStyle}"><head>
<style>${rootCss}</style></head><body><h1>EL UMBRAL</h1></body></html>`;

const olToken = (html: string, name: string) =>
  html.match(new RegExp(`${name}:\\s*([^;"]*)`))?.[1]?.trim() ?? null;

describe("adoptModelPalette", () => {
  it("lifts the model's page background onto --ol-bg so there is one black", () => {
    const out = adoptModelPalette(page(":root{--bg:#070606;--ink:#d8d0c2}"));

    expect(olToken(out, "--ol-bg")).toBe("#070606");
    expect(olToken(out, "--ol-fg")).toBe("#d8d0c2");
  });

  it("recomputes --ol-accent-r, or every rgba() built from it lies", () => {
    const out = adoptModelPalette(page(":root{--accent:#b31212}"));

    expect(olToken(out, "--ol-accent")).toBe("#b31212");
    expect(olToken(out, "--ol-accent-r")).toBe("179, 18, 18");
  });

  it("ignores a token the assembler already bound", () => {
    // `--bg:var(--ol-bg)` is the binding doing its job — adopting it would make
    // --ol-bg reference itself.
    const out = adoptModelPalette(page(":root{--bg:var(--ol-bg)}"));

    expect(olToken(out, "--ol-bg")).toBe("#09090B");
  });

  it("takes the last declaration, the way the cascade does", () => {
    const out = adoptModelPalette(page(":root{--bg:#111111}</style><style>:root{--bg:#070606}"));

    expect(olToken(out, "--ol-bg")).toBe("#070606");
  });

  it("refuses a background that would invert the page's declared mode", () => {
    // The page says class="dark" and every section the model painted assumes
    // it. A light --bg here is a mistake or an injection, and adopting it would
    // turn the library fragments white under dark text.
    const out = adoptModelPalette(page(":root{--bg:#ffffff}"));

    expect(olToken(out, "--ol-bg")).toBe("#09090B");
  });

  it("leaves a page the model never repainted exactly as it was", () => {
    const untouched = page(":root{--nav-h:64px}");

    expect(adoptModelPalette(untouched)).toBe(untouched);
  });

  it("ignores anything that is not a colour", () => {
    const out = adoptModelPalette(page(':root{--bg:url("http://x.test/a.png")}'));

    expect(olToken(out, "--ol-bg")).toBe("#09090B");
  });
});

describe("adoptModelPalette — namespaced palettes", () => {
  // Measured on the second horror run: the model called its tokens `--um-bg` /
  // `--um-bone` (UM for UMBRAL). It invents the prefix per run, so matching
  // token NAMES catches the conventional case and misses this one entirely —
  // and this one still shipped the seam (#070505 under var(--ol-bg) #09090B).
  const namespaced = `<!doctype html><html lang="es" class="dark" style="--ol-bg:#09090B;--ol-fg:#F7F1ED">
<head><style>:root{--um-bg:#070505;--um-bone:#e8e0d4}
body{background:var(--um-bg);color:var(--um-bone)}</style></head><body><h1>x</h1></body></html>`;

  const olToken = (html: string, name: string) =>
    html.match(new RegExp(`${name}:\s*([^;"]*)`))?.[1]?.trim() ?? null;

  it("takes what body actually paints, whatever the model named it", () => {
    const out = adoptModelPalette(namespaced);

    expect(olToken(out, "--ol-bg")).toBe("#070505");
    expect(olToken(out, "--ol-fg")).toBe("#e8e0d4");
  });

  it("does not chase a var chain that ends at the binding", () => {
    // `:root{--bg:var(--ol-bg)}` is the assembler's binding. Resolving through
    // it and adopting the result would point --ol-bg at its own value.
    const bound = `<!doctype html><html class="dark" style="--ol-bg:#09090B">
<head><style>:root{--bg:var(--ol-bg)}body{background:var(--bg)}</style></head><body>x</body></html>`;

    expect(olToken(adoptModelPalette(bound), "--ol-bg")).toBe("#09090B");
  });

  it("still refuses a body background that inverts the declared mode", () => {
    const inverted = `<!doctype html><html class="dark" style="--ol-bg:#09090B">
<head><style>:root{--um-bg:#fafafa}body{background:var(--um-bg)}</style></head><body>x</body></html>`;

    expect(olToken(adoptModelPalette(inverted), "--ol-bg")).toBe("#09090B");
  });
});
