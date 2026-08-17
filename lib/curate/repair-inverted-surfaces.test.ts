// Medido en el barrido de 10 páginas del 2026-08-16: el modelo construye un
// panel oscuro dentro de una página clara y no declara el color del texto, así
// que el titular hereda el de la página —oscuro— y queda oscuro sobre oscuro.
// Pasó en `saas` (panel #111B30→#0E1626 sobre página #F6F3EE) y en
// `physical-product-sale` (#1e1915). Las rejas no lo ven: el contraste de la
// PÁGINA está bien, el que falla es el del panel.
import { describe, expect, it } from "vitest";
import { repairInvertedSurfaces } from "./repair-inverted-surfaces";

const page = (modelCss: string, htmlStyle = "--ol-bg:#F6F3EE;--ol-fg:#282521") =>
  `<!doctype html><html class="cream" style="${htmlStyle}"><head>
<style data-openlen-creative="">${modelCss}</style></head><body>x</body></html>`;

describe("repairInvertedSurfaces", () => {
  it("gives a dark panel on a light page a text colour it can be read in", () => {
    const out = repairInvertedSurfaces(page(":root{--olm-panel:#0E1626}.cta{background:var(--olm-panel);padding:20px}"));

    expect(out).toContain("color:var(--ol-bg)");
  });

  it("reads the stops of a gradient, which is how the real panel was painted", () => {
    const out = repairInvertedSurfaces(page(
      ":root{--olm-panel:#0E1626;--olm-panel-2:#111B30}"
      + ".cta{background:radial-gradient(720px 320px at 50% -20%,rgba(255,180,84,.15),transparent 60%),"
      + "linear-gradient(180deg,var(--olm-panel-2),var(--olm-panel));padding:76px}",
    ));

    expect(out).toContain("color:var(--ol-bg)");
  });

  it("leaves a surface that agrees with the page alone", () => {
    const untouched = page(":root{--olm-card:#FFFFFF}.card{background:var(--olm-card);padding:20px}");

    expect(repairInvertedSurfaces(untouched)).toBe(untouched);
  });

  it("never overrides a colour the model chose", () => {
    const chosen = page(":root{--olm-panel:#0E1626}.cta{background:var(--olm-panel);color:#ff0000}");

    expect(repairInvertedSurfaces(chosen)).toBe(chosen);
  });

  it("says nothing about a background it cannot judge", () => {
    // A gradient with only translucent stops describes no surface colour, and
    // guessing one is how a repair becomes a defect.
    const opaque = page(".veil{background:linear-gradient(rgba(0,0,0,.05),transparent)}");

    expect(repairInvertedSurfaces(opaque)).toBe(opaque);
  });

  it("works the other way round on a dark page", () => {
    const out = repairInvertedSurfaces(
      page(":root{--olm-sheet:#FAF7F0}.sheet{background:var(--olm-sheet);padding:20px}", "--ol-bg:#09090B;--ol-fg:#F7F1ED"),
    );

    // --ol-bg is the dark pole here, which is exactly what a light sheet needs.
    expect(out).toContain("color:var(--ol-bg)");
  });

  it("leaves the library's own stylesheets untouched", () => {
    // Only the model's sheets are repaired. A library fragment's colours were
    // reviewed with its own markup; rewriting them is not a repair, it is a
    // second opinion nobody asked for.
    const library = `<!doctype html><html class="cream" style="--ol-bg:#F6F3EE;--ol-fg:#282521"><head>
<style>:root{--x:#0E1626}.frag{background:var(--x)}</style></head><body>x</body></html>`;

    expect(repairInvertedSurfaces(library)).toBe(library);
  });

  it("is idempotent", () => {
    const once = repairInvertedSurfaces(page(":root{--olm-panel:#0E1626}.cta{background:var(--olm-panel)}"));

    expect(repairInvertedSurfaces(once)).toBe(once);
  });
});
