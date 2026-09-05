// LO QUE SUJETA QUE EL EXPERIMENTO SIGNIFIQUE ALGO.
//
// Un brazo de control que en secreto es igual al tratamiento da un resultado
// nulo muy convincente: «no hay diferencia» sería verdad sobre dos corridas
// idénticas, y nadie lo notaría porque los números salen bien. Estas pruebas
// vigilan las tres formas en que este experimento podría mentir:
//
//   1. que el sobre mínimo NO sea mínimo (el prompt no se cambió de verdad);
//   2. que le falten las herramientas y falle por eso y no por su sobre;
//   3. que le falten los HECHOS DEL MOTOR y falle por una regla que nadie le
//      contó — lo que haría ganar al sobre grande por hacer trampa.
import { describe, expect, it } from "vitest";
import { buildAgentSystemPrompt, buildFunctionDeclarations } from "@/lib/agent/catalog";
import { HERRAMIENTAS_MINIMAS, PROMPT_MINIMO, herramientasDelSobre } from "./sobres";

const TODAS = buildFunctionDeclarations({});

describe("los dos sobres son de verdad distintos", () => {
  it("el mínimo es una fracción del de OpenLen", () => {
    const grande = buildAgentSystemPrompt().length;
    expect(PROMPT_MINIMO.length).toBeLessThan(grande * 0.1);
  });

  it("el mínimo NO lleva el contrato de publicación", () => {
    expect(PROMPT_MINIMO).not.toContain("LO QUE LA PUBLICACIÓN IMPONE");
    expect(PROMPT_MINIMO).not.toContain("--accent");
    expect(PROMPT_MINIMO).not.toContain("REGLAS DURAS");
  });

  it("el de OpenLen sí los lleva — si no, no habría nada que comparar", () => {
    const grande = buildAgentSystemPrompt();
    expect(grande).toContain("LO QUE LA PUBLICACIÓN IMPONE");
    expect(grande).toContain("REGLAS DURAS");
  });
});

// 🔴 EL CORTE, y es la decisión que hace justo el experimento. Los hechos del
// MOTOR van en los dos brazos: en una terminal esas restricciones no existen,
// pero aquí sí, y no decírselas al brazo mínimo sería castigarlo por una regla
// que nadie le contó — o sea, hacer trampa a favor de la hipótesis.
describe("el sobre mínimo lleva los hechos del motor, no consejo", () => {
  it("dice que los on* se borran", () => {
    expect(PROMPT_MINIMO).toContain("on*");
    expect(PROMPT_MINIMO).toContain("addEventListener");
  });

  it("dice que el script sobrevive", () => {
    expect(PROMPT_MINIMO).toMatch(/SOBREVIVE/i);
  });

  it("dice qué iframes se permiten", () => {
    expect(PROMPT_MINIMO).toContain("Google Maps, YouTube y Vimeo");
  });

  it("dice cómo se dirige una edición", () => {
    expect(PROMPT_MINIMO).toContain("data-op-id");
  });

  // CONTRA-PRUEBA: no se le cuela diseño por la puerta de atrás. Si algún día
  // alguien "ayuda" al brazo mínimo con una regla de gusto, el experimento deja
  // de medir el sobre y esta prueba es lo único que lo diría.
  it("CONTRA-PRUEBA: no le dice cómo tiene que QUEDAR la página", () => {
    for (const gusto of ["acento", "tipografía", "jerarquía", "sombra", "paleta", "espaciado"]) {
      expect(PROMPT_MINIMO.toLowerCase()).not.toContain(gusto);
    }
  });
});

describe("las herramientas de cada brazo", () => {
  it("openlen las lleva todas", () => {
    expect(herramientasDelSobre(TODAS, "openlen")).toHaveLength(TODAS.length);
    expect(TODAS.length).toBeGreaterThan(20);
  });

  it("el mínimo lleva exactamente los cuatro verbos de edición", () => {
    const nombres = herramientasDelSobre(TODAS, "minimo").map((t) => String(t.name));
    expect(nombres.sort()).toEqual([...HERRAMIENTAS_MINIMAS].sort());
  });

  // Si el catálogo se renombra, el brazo mínimo se quedaría sin herramientas y
  // "perdería" el experimento por eso, en silencio. Tiene que LANZAR.
  it("LANZA si el catálogo cambió de nombres", () => {
    const mutilado = TODAS.filter((t) => t.name !== "editar_html");
    expect(() => herramientasDelSobre(mutilado, "minimo")).toThrow(/catálogo cambió/i);
  });

  it("y las cuatro existen de verdad en el catálogo de producción", () => {
    const nombres = new Set(TODAS.map((t) => String(t.name)));
    for (const h of HERRAMIENTAS_MINIMAS) expect(nombres.has(h), `falta ${h}`).toBe(true);
  });
});
