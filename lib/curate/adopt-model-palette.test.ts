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
    // The declaration that PAINTS is what counts, not the token's name — see
    // the "a name can invert a role" block below for why that matters.
    const out = adoptModelPalette(
      page(":root{--bg:#070606;--ink:#d8d0c2}body{background:var(--bg);color:var(--ink)}"),
    );

    expect(olToken(out, "--ol-bg")).toBe("#070606");
    expect(olToken(out, "--ol-fg")).toBe("#d8d0c2");
  });

  it("leaves the page theme alone when the model declared colours but painted nothing", () => {
    // Tokens sitting at :root that body never uses are not the page's floor.
    const out = adoptModelPalette(page(":root{--bg:#070606}"));

    expect(olToken(out, "--ol-bg")).toBe("#09090B");
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
    const out = adoptModelPalette(
      page(":root{--bg:#111111}</style><style>:root{--bg:#070606}body{background:var(--bg)}"),
    );

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

describe("adoptModelPalette — a name can invert a role", () => {
  // Measured on the third horror run: the model declared `--ink:#050505` and
  // painted `body{background:var(--ink)}` with it. `--ink` conventionally means
  // the TEXT colour, so a name table maps it to --ol-fg and ships near-black
  // text on a near-black page. That run only escaped because it also declared
  // `body{color:var(--bone)}`, which resolved later and overwrote the mistake.
  //
  // So the two roles that decide whether the page can be read are taken ONLY
  // from what body paints. A name is a guess, and a wrong guess here is
  // invisible text.
  const olToken = (html: string, name: string) =>
    html.match(new RegExp(`${name}:\s*([^;"]*)`))?.[1]?.trim() ?? null;

  const inverted = `<!doctype html><html class="dark" style="--ol-bg:#09090B;--ol-fg:#F7F1ED">
<head><style>:root{--ink:#050505}body{background:var(--ink)}</style></head><body>x</body></html>`;

  it("never lets a token name decide the text colour", () => {
    const out = adoptModelPalette(inverted);

    expect(olToken(out, "--ol-bg")).toBe("#050505");
    // NOT #050505 — the direction's foreground survives rather than the page
    // going black-on-black.
    expect(olToken(out, "--ol-fg")).toBe("#F7F1ED");
  });

  it("still lets names carry the roles body cannot express", () => {
    const withSurface = `<!doctype html><html class="dark" style="--ol-bg:#09090B;--ol-surface:#151318;--ol-accent:#B91C35;--ol-accent-r:185, 28, 53">
<head><style>:root{--surface:#1a1416;--accent:#c02030}</style></head><body>x</body></html>`;
    const out = adoptModelPalette(withSurface);

    expect(olToken(out, "--ol-surface")).toBe("#1a1416");
    expect(olToken(out, "--ol-accent")).toBe("#c02030");
  });
});

describe("adoptModelPalette — background and foreground are one decision", () => {
  // Measured on the comedy-club run: the model designed a DARK page
  // (`--olm-ink:#120d0b`) while the direction said cream. The mode guard
  // refused its background, correctly — and then the foreground it chose FOR
  // that background was adopted anyway, because only the background had a
  // guard. The page shipped `--ol-bg:#FFF8E8` with `--ol-fg:#f4e9d4`: cream
  // text on cream paper.
  //
  // A foreground picked for a background we refused describes nothing. Partial
  // adoption is worse than none.
  const olToken = (html: string, name: string) =>
    html.match(new RegExp(`${name}:\s*([^;"]*)`))?.[1]?.trim() ?? null;

  const contradicting = `<!doctype html><html class="cream" style="--ol-bg:#FFF8E8;--ol-fg:#2D2018">
<head><style>:root{--ink:#120d0b;--paper:#f4e9d4}
body{background:var(--ink);color:var(--paper)}</style></head><body>x</body></html>`;

  it("keeps both when the background is refused", () => {
    const out = adoptModelPalette(contradicting);

    expect(olToken(out, "--ol-bg")).toBe("#FFF8E8");
    expect(olToken(out, "--ol-fg")).toBe("#2D2018");
  });

  it("still takes both when the background is accepted", () => {
    const agreeing = `<!doctype html><html class="dark" style="--ol-bg:#09090B;--ol-fg:#F7F1ED">
<head><style>:root{--ink:#120d0b;--paper:#f4e9d4}
body{background:var(--ink);color:var(--paper)}</style></head><body>x</body></html>`;

    const out = adoptModelPalette(agreeing);

    expect(olToken(out, "--ol-bg")).toBe("#120d0b");
    expect(olToken(out, "--ol-fg")).toBe("#f4e9d4");
  });
});
