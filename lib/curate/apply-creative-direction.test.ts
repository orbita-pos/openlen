import { describe, expect, it } from "vitest";

import { applyCreativeDirection } from "./apply-creative-direction";
import { buildDeterministicCreativeDirection } from "@/lib/generation/deterministic-creative-direction";
import { buildDeterministicIntent } from "./deterministic-page-input";
import { paletteFromAccent } from "@/lib/generation/palette-from-accent";

const BASE = buildDeterministicCreativeDirection(
  buildDeterministicIntent("Clínica dental familiar en Coyoacán, atención a niños y adultos"),
).direction;

const ELECTED = { ...BASE, mode: "light" as const, palette: paletteFromAccent("#2E86C1", "light") };

const PAGE = `<!doctype html><html lang="es" class="dark" style="--ol-bg:#09090B;--ol-fg:#F7F1ED;--ol-accent:#B91C35;--ol-radius:10px;--ol-font-display:'Fraunces', serif"><head>
<style data-openlen-visual-engine="creative-direction/1.0">:root{--ol-background:#09090B;--ol-accent:#B91C35}</style>
</head><body><section>hola</section></body></html>`;

describe("repintar una página compuesta con la dirección elegida", () => {
  const out = applyCreativeDirection(PAGE, ELECTED);

  it("deja el modo y los colores de la dirección en <html>", () => {
    expect(out).toMatch(/<html[^>]*class="light[^"]*"/);
    expect(out).toContain(`--ol-bg: ${ELECTED.palette.background}`);
    expect(out).toContain(`--ol-fg: ${ELECTED.palette.foreground}`);
    expect(out.toLowerCase()).not.toContain("#09090b");
  });

  it("no toca la geometría ni la tipografía con las que ya se midió el render", () => {
    expect(out).toContain("--ol-radius: 10px");
    expect(out).toContain("--ol-font-display: 'Fraunces', serif");
  });

  it("reescribe el marcador, y sigue habiendo exactamente uno", () => {
    expect(out.match(/data-openlen-visual-engine="creative-direction\/1\.0"/g)).toHaveLength(1);
    expect(out).toContain(`--ol-background:${ELECTED.palette.background}`);
    expect(out).not.toContain("--ol-background:#09090B");
  });

  it("conserva las demás clases del documento", () => {
    const withClasses = PAGE.replace('class="dark"', 'class="dark scroll-smooth"');
    expect(applyCreativeDirection(withClasses, ELECTED)).toMatch(/class="light scroll-smooth"/);
  });

  it("es idempotente: repintar dos veces da el mismo documento", () => {
    expect(applyCreativeDirection(out, ELECTED)).toBe(out);
  });

  it("no rompe un documento sin marcador ni sin <html>", () => {
    expect(applyCreativeDirection("<div>suelto</div>", ELECTED)).toBe("<div>suelto</div>");
    const noMarker = "<!doctype html><html class=\"dark\"><head></head><body></body></html>";
    expect(applyCreativeDirection(noMarker, ELECTED)).toMatch(/class="light"/);
  });
});
