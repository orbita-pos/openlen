// Tercera cara de la misma causa raíz del 2026-08-16: el modelo y el
// ensamblador comparten el vocabulario de tokens pero no su significado.
//
// Medido en la corrida `horror-experience`: el modelo declaró `--ink:#050505`
// (su FONDO) y pintó `#ol-gallery-4{background:var(--ink)}`. Sobre ESE MISMO
// <section> la biblioteca había declarado `--ink:var(--ol-fg)` — `--ink` es el
// TEXTO para ella — y una custom property declarada sobre el elemento tapa la
// de :root. El modelo pidió negro y recibió el color de la letra.
//
// Arbitrar entre los dos significados rompe a alguno: quitar la atadura deja el
// texto del fragmento en #050505 sobre fondo oscuro. La colisión se elimina, no
// se arbitra — el vocabulario del modelo se aísla en su propio prefijo.
import { describe, expect, it } from "vitest";
import { isolateModelTokens } from "./isolate-model-tokens";

const doc = (modelCss: string, libraryCss = "") =>
  `<!doctype html><html><head>
<style>${libraryCss}</style>
<style data-openlen-creative="">${modelCss}</style>
</head><body><section id="ol-gallery-4" data-sec="derived-gallery-4">x</section></body></html>`;

describe("isolateModelTokens", () => {
  it("renames what the model declared, so the library keeps its own meaning", () => {
    const out = isolateModelTokens(
      doc(":root{--ink:#050505}#ol-gallery-4{background:var(--ink)}",
          '[data-sec="derived-gallery-4"]{--ink:var(--ol-fg);color:var(--ink)}'),
    );

    // The model's page now paints with its own black…
    expect(out).toContain("--olm-ink:#050505");
    expect(out).toContain("background:var(--olm-ink)");
    // …and the library's text still follows the page theme, untouched.
    expect(out).toContain('[data-sec="derived-gallery-4"]{--ink:var(--ol-fg);color:var(--ink)}');
  });

  it("leaves a token the model USES but never declared", () => {
    // `--line` belongs to the fragment. Renaming a use the model does not own
    // would point it at nothing and the border would vanish.
    const out = isolateModelTokens(doc("#ol-gallery-4{border-color:var(--line)}"));

    expect(out).toContain("border-color:var(--line)");
    expect(out).not.toContain("--olm-line");
  });

  it("never renames the page theme's own tokens", () => {
    const out = isolateModelTokens(doc(":root{--ol-accent:#b31212}#x{color:var(--ol-accent)}"));

    expect(out).toContain("--ol-accent:#b31212");
    expect(out).not.toContain("--olm-ol-accent");
  });

  it("covers the per-section sheets too, not only the page one", () => {
    const html = `<!doctype html><html><head>
<style data-openlen-creative="">:root{--ink:#050505}</style>
<style data-openlen-creative-section="ol-hero-2">#ol-hero-2{background:var(--ink)}</style>
</head><body>x</body></html>`;

    const out = isolateModelTokens(html);

    expect(out).toContain("background:var(--olm-ink)");
  });

  it("leaves a page the model never styled exactly as it was", () => {
    const untouched = "<!doctype html><html><head><style>:root{--ink:#111}</style></head><body>x</body></html>";

    expect(isolateModelTokens(untouched)).toBe(untouched);
  });

  it("is idempotent — a second pass must not double-prefix", () => {
    const once = isolateModelTokens(doc(":root{--ink:#050505}#x{color:var(--ink)}"));

    expect(isolateModelTokens(once)).toBe(once);
  });
});
