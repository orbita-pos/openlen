import { describe, expect, it } from "vitest";

import type { ElementSnapshot } from "../types";
import { extractColors } from "./colors";

function el(
  tag: string,
  backgroundColor: string,
  width: number,
  height: number,
  color = "rgb(255, 255, 255)",
): ElementSnapshot {
  return {
    tag,
    role: null,
    rect: { width, height, top: 0, left: 0 },
    zIndex: 0,
    styles: {
      color,
      backgroundColor,
      borderColor: "rgba(0, 0, 0, 0)",
      fontFamily: "Inter",
      fontSize: "16px",
      fontWeight: "400",
      lineHeight: "24px",
      letterSpacing: "normal",
      borderRadius: "8px",
      boxShadow: "none",
      padding: "0px",
      margin: "0px",
      gap: "0px",
    },
  };
}

/**
 * EL CASO QUE SE MIDIÓ CONTRA UNA WEB REAL.
 *
 * linear.app: `body` en `rgb(8,9,10)` sobre 32,17 Mpx —ocho veces todo lo demás
 * junto— y el extractor la declaraba CLARA. El peso de este módulo está afinado
 * para encontrar la marca (raíz cuadrada del área, botones ×3, `body` a 0.3), y
 * con ese peso unas decenas de chips claros tapan el fondo de la página entera.
 *
 * Importa porque la polaridad viaja al brief como "Fondo claro" / "Fondo
 * oscuro". Equivocarla no es un matiz: le pide al modelo lo contrario de lo que
 * el usuario señaló, y encima contradice a la línea de carácter del mismo
 * bloque, que sí venía de mirar la captura.
 */
describe("la polaridad se decide por ÁREA, no por peso de marca", () => {
  const chipsClaros = (n: number) =>
    Array.from({ length: n }, () => el("button", "rgb(255, 255, 255)", 120, 40));

  it("un body negro enorme gana a muchos chips claros pequeños", () => {
    const elementos = [el("body", "rgb(8, 9, 10)", 1440, 22000), ...chipsClaros(60)];
    expect(extractColors(elementos, 22000, 1440).polarity).toBe("dark");
  });

  it("y al revés: un body blanco enorme gana a botones oscuros", () => {
    const elementos = [
      el("body", "rgb(255, 255, 255)", 1440, 8000),
      ...Array.from({ length: 40 }, () => el("button", "rgb(10, 10, 10)", 120, 40)),
    ];
    expect(extractColors(elementos, 8000, 1440).polarity).toBe("light");
  });

  // `rgba(255,255,255,0.02)` es literalmente el cuarto fondo por área de
  // linear.app. Contar un velo como si fuera blanco invierte la página.
  it("un velo casi transparente no cuenta como fondo claro", () => {
    const elementos = [
      el("body", "rgb(8, 9, 10)", 1440, 10000),
      el("div", "rgba(255, 255, 255, 0.02)", 1440, 9000),
    ];
    expect(extractColors(elementos, 10000, 1440).polarity).toBe("dark");
  });

  it("sin ningún fondo opaco no se inventa oscuridad", () => {
    const elementos = [el("div", "rgba(0, 0, 0, 0)", 1440, 900)];
    expect(extractColors(elementos, 900, 1440).polarity).toBe("light");
  });
});

/**
 * El azul de un enlace que nadie estilizó no es de nadie.
 *
 * `#0000EE` es lo que pinta el navegador por defecto, y aquí llegaba marcado
 * como señal de MARCA porque venía en un `<a>`. En una página cuyos enlaces
 * nadie estilizó, el color de marca declarado sería el azul de Chrome — y eso
 * viaja al brief como "usa este color". Medido en stripe.com: 4 enlaces sin
 * estilo y 6 hijos que heredaban de ellos.
 */
describe("los colores por defecto del navegador no son decisiones de diseño", () => {
  const enlaces = (color: string, n = 5) =>
    Array.from({ length: n }, () => el("a", "rgba(0, 0, 0, 0)", 140, 24, color));

  it("el azul de enlace sin estilizar no puede acabar de color de marca", () => {
    const conFondo = el("body", "rgb(255, 255, 255)", 1440, 4000);
    const { primary, accents } = extractColors([conFondo, ...enlaces("rgb(0, 0, 238)")], 4000, 1440);
    const hexes = [primary?.hex, ...accents.map((a) => a.hex)];
    expect(hexes).not.toContain("#0000ee");
  });

  it("pero un azul ELEGIDO por el sitio sí es marca, aunque se parezca", () => {
    const conFondo = el("body", "rgb(255, 255, 255)", 1440, 4000);
    const { primary } = extractColors([conFondo, ...enlaces("rgb(0, 20, 235)")], 4000, 1440);
    expect(primary?.hex).toBe("#0014eb");
  });

  /**
   * ESTE ES EL QUE SÓLO ENSEÑÓ LA WEB DE VERDAD.
   *
   * Con el filtro puesto sólo en `color`, los tests unitarios pasaban y
   * stripe.com seguía devolviendo #0000ee exactamente igual. Medido: 8
   * elementos lo traían en `borderColor`, porque el valor inicial de
   * `border-color` es `currentColor` — el mismo no-color del navegador
   * entrando por la puerta de al lado.
   */
  it("ni por el borde, que por defecto vale currentColor", () => {
    const conBorde = Array.from({ length: 8 }, () => {
      const e = el("div", "rgba(0, 0, 0, 0)", 200, 30, "rgb(0, 0, 238)");
      return { ...e, styles: { ...e.styles, borderColor: "rgb(0, 0, 238)" } };
    });
    const { primary, accents } = extractColors(
      [el("body", "rgb(255, 255, 255)", 1440, 4000), ...conBorde],
      4000,
      1440,
    );
    expect([primary?.hex, ...accents.map((a) => a.hex)]).not.toContain("#0000ee");
  });

  // Heredado: los hijos de un enlace sin estilizar traen el mismo color, así que
  // filtrar sólo por `<a>` dejaba entrar el azul igual, por la puerta de al lado.
  it("tampoco entra por los hijos que lo heredan", () => {
    const heredados = Array.from({ length: 6 }, () =>
      el("div", "rgba(0, 0, 0, 0)", 200, 30, "rgb(0, 0, 238)"),
    );
    const { primary, accents } = extractColors(
      [el("body", "rgb(255, 255, 255)", 1440, 4000), ...heredados],
      4000,
      1440,
    );
    expect([primary?.hex, ...accents.map((a) => a.hex)]).not.toContain("#0000ee");
  });
});
