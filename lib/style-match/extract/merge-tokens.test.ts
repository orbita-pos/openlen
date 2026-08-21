import { describe, expect, it } from "vitest";

import type { ComputedStylesSweep, ElementSnapshot, ScrapeResult } from "../types";
import { extractTokens } from "./merge-tokens";

/**
 * La mitad DETERMINISTA de "hazme una como esta": colores, tipografía y
 * espaciado salen de los estilos CALCULADOS del render, no de que un modelo los
 * adivine mirando una foto. Eso es lo que hace que la paleta sea exacta y
 * gratis.
 *
 * Fixtures sintéticos a propósito: sin red, reproducible, y prueba el
 * clasificador — no si una web ajena cambió su diseño esta mañana.
 */
function el(
  tag: string,
  styles: Partial<ElementSnapshot["styles"]>,
  rect: Partial<ElementSnapshot["rect"]> = {},
): ElementSnapshot {
  return {
    tag,
    role: null,
    rect: { width: 200, height: 40, top: 0, left: 0, ...rect },
    zIndex: 0,
    styles: {
      color: "rgb(0, 0, 0)",
      backgroundColor: "rgba(0, 0, 0, 0)",
      borderColor: "rgb(0, 0, 0)",
      fontFamily: "Inter, sans-serif",
      fontSize: "16px",
      fontWeight: "400",
      lineHeight: "24px",
      letterSpacing: "normal",
      borderRadius: "0px",
      boxShadow: "none",
      padding: "0px",
      margin: "0px",
      gap: "0px",
      ...styles,
    },
  };
}

function scrape(elements: ElementSnapshot[]): ScrapeResult {
  const computedStyles: ComputedStylesSweep = {
    elements,
    documentHeight: 3000,
    documentWidth: 1440,
  };
  return {
    url: "https://ejemplo.test/",
    hostname: "ejemplo.test",
    finalUrl: "https://ejemplo.test/",
    html: "<html></html>",
    rendered: true,
    computedStyles,
    fetchedAt: new Date(),
    tier: 2,
    durationMs: 1,
    sizeBytes: 100,
  };
}

describe("el contrato: hace falta un render, no basta el HTML", () => {
  // No es un detalle: el orquestador se queda con el PRIMER nivel que funcione,
  // y el nivel 1 (fetch crudo) casi siempre funciona. Para esta feature hay que
  // pedir Puppeteer explícitamente, o no habrá ni paleta ni captura.
  it("sin estilos calculados LANZA, y lo dice claro", () => {
    const sinRender = { ...scrape([]), computedStyles: undefined };
    expect(() => extractTokens(sinRender)).toThrow(/computed styles|rendered/i);
  });
});

describe("la paleta sale MEDIDA del render", () => {
  it("el color más repetido manda, y los hex son exactos", () => {
    const elementos = [
      ...Array.from({ length: 20 }, () => el("p", { color: "rgb(17, 17, 17)" })),
      ...Array.from({ length: 3 }, () =>
        el("a", { color: "rgb(99, 91, 255)" }),
      ),
    ];
    const t = extractTokens(scrape(elementos));
    const todos = JSON.stringify(t).toLowerCase();
    // Hex exactos del render — nunca aproximados por un modelo mirando una foto.
    expect(todos).toContain("#111111");
    expect(todos).toContain("#635bff");
  });

  it("un documento sin nada no revienta — devuelve algo usable", () => {
    expect(() => extractTokens(scrape([]))).not.toThrow();
  });
});

describe("la tipografía", () => {
  it("recoge la familia que de verdad se usa", () => {
    const elementos = Array.from({ length: 10 }, () =>
      el("p", { fontFamily: '"Söhne", Helvetica, sans-serif' }),
    );
    const t = extractTokens(scrape(elementos));
    expect(JSON.stringify(t)).toContain("hne");
  });
});
