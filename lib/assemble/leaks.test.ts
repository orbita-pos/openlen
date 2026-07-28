import { describe, it, expect } from "vitest";
import { detectTemplateLeaks, brandToken, visibleTextBlocks } from "./leaks";

const TEMPLATE = `<!doctype html><html><head><title>MORADA — Inmobiliaria de propiedades singulares</title></head><body>
  <h2>¿Por qué MORADA?</h2>
  <p>Selección curada esta temporada. Cada una visitada, medida y fotografiada por nuestro equipo.</p>
  <p>Un equipo pequeño y especializado. Tu agente es tu agente de principio a fin.</p>
  <span>Hablemos</span>
  <span>Propiedades</span>
</body></html>`;

/** Relleno perfecto: no queda una sola frase de la plantilla. */
const FILLED_CLEAN = `<!doctype html><html><head><title>Residencias Monterrey</title></head><body>
  <h2>¿Por qué Residencias Monterrey?</h2>
  <p>Casas de autor en San Pedro y Valle, cada una verificada por nuestro equipo local.</p>
  <p>Acompañamos cada compra de principio a fin, con un asesor asignado desde el primer día.</p>
  <span>Hablemos</span>
  <span>Propiedades</span>
</body></html>`;

/** Relleno real: el encabezado y un párrafo se quedaron como estaban. */
const FILLED_LEAKY = `<!doctype html><html><head><title>Residencias Monterrey</title></head><body>
  <h2>¿Por qué MORADA?</h2>
  <p>Selección curada esta temporada. Cada una visitada, medida y fotografiada por nuestro equipo.</p>
  <p>Acompañamos cada compra de principio a fin, con un asesor asignado desde el primer día.</p>
  <span>Hablemos</span>
  <span>Propiedades</span>
</body></html>`;

describe("brandToken", () => {
  it("saca la marca de la plantilla del <title>", () => {
    expect(brandToken(TEMPLATE)).toBe("morada");
  });
  it("ignora separadores y palabras cortas", () => {
    expect(brandToken('<html><head><title>FRAGOR — Roguelike de acción</title></head></html>')).toBe("fragor");
  });
  it("devuelve null si no hay título", () => {
    expect(brandToken("<html><body>hola</body></html>")).toBeNull();
  });
});

describe("visibleTextBlocks", () => {
  it("ignora script y style", () => {
    const blocks = visibleTextBlocks(
      "<html><body><script>const copy = 'texto de script aqui';</script><p>Texto visible de verdad</p></body></html>",
    );
    expect([...blocks].some((b) => b.includes("script"))).toBe(false);
    expect([...blocks].some((b) => b.includes("texto visible"))).toBe(true);
  });
});

describe("detectTemplateLeaks", () => {
  it("no reporta nada dañino cuando el relleno cubrió la página", () => {
    const r = detectTemplateLeaks(TEMPLATE, FILLED_CLEAN);
    expect(r.damaging).toEqual([]);
  });

  it("las etiquetas genéricas compartidas NO cuentan como daño", () => {
    const r = detectTemplateLeaks(TEMPLATE, FILLED_CLEAN);
    // "Hablemos" y "Propiedades" siguen ahí en las dos, y está bien.
    expect(r.shared.length).toBeGreaterThan(0);
    expect(r.damaging.length).toBe(0);
  });

  it("caza el encabezado que nombra la plantilla y el párrafo heredado", () => {
    const r = detectTemplateLeaks(TEMPLATE, FILLED_LEAKY);
    expect(r.damaging.some((b) => b.includes("morada"))).toBe(true);
    expect(r.damaging.some((b) => b.includes("selección curada"))).toBe(true);
    expect(r.damaging.length).toBe(2);
  });

  it("una frase NUEVA que use la marca como palabra común no es fuga", () => {
    // "morada" también significa vivienda: solo cuenta si es la MISMA frase.
    const filled = FILLED_CLEAN.replace(
      "<span>Hablemos</span>",
      "<p>Encuentra la morada que llevas años imaginando, en el norte de la ciudad.</p>",
    );
    const r = detectTemplateLeaks(TEMPLATE, filled);
    expect(r.damaging).toEqual([]);
  });
});
