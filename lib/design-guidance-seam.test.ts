import { describe, expect, it } from "vitest";
import { BEHAVIOR_ORDER, BEHAVIORS } from "./behaviors/registry";
import { buildAgentSystemPrompt } from "./agent/catalog";
// NOT imported from the route.ts files themselves: a Next.js `route.ts` file
// may only export the recognized route-handler bindings (GET/POST/runtime/…)
// — Next's generated .next/types/app/api/**/route.ts type-checks the
// module's exports against that whitelist, so `export const SYSTEM_PROMPT`
// inside route.ts fails `tsc --noEmit`. Both routes split their prompt into
// a sibling system-prompt.ts (a plain module Next's router never touches,
// and — usefully for this test — with no native/DB/auth imports, so it can
// be statically imported straight under vitest, no node:test needed).
import { SYSTEM_PROMPT as GENERATE_SYSTEM_PROMPT } from "../app/api/generate/system-prompt";
import { SYSTEM_PROMPT as AI_DESIGN_SYSTEM_PROMPT } from "../app/api/templates/ai-design/system-prompt";

// Arreglo 3 (revisión final de rama, feat/conductas) — THE SEAM GUARD.
//
// lib/design-guidance-v2.ts exists: 765 lines, uncommitted, a fork from a
// prior session. It contains the ORIGINAL lie this whole "Conductas" feature
// was built to make structurally impossible — "Procedural <script> at
// end-of-body for SVG path computation IS OK" — and has ZERO notion of
// CONDUCTAS. Its own header says wiring it into /api/generate would be "an
// import change". It is NOT deleted (it's the owner's file, from his own
// prior session), so the only honest defense is a guard AT THE SEAM: assert
// the REAL system prompt of the 3 live AI surfaces — /api/generate,
// /api/templates/ai-design (Chat), and the Agent — contains EVERY behavior
// marker in BEHAVIOR_ORDER. Not a hand-picked "data-ol-countdown" alone: this
// walks the actual registry, so behavior #8 is covered here too,
// automatically, the day it's registered.
//
// This goes red the INSTANT someone changes one of those three imports from
// design-guidance to design-guidance-v2 (or otherwise drops the CONDUCTAS
// section) — turning a ledger aviso into an enforced guarantee. Demonstrated
// by temporarily swapping app/api/generate/system-prompt.ts's import in the
// final verification pass of this branch's review (see
// .superpowers/sdd/final-fix-b-report.md for the literal red→revert output).
describe("Arreglo 3 — el guardia de la costura design-guidance vs design-guidance-v2", () => {
  const SURFACES: Array<[string, () => string]> = [
    ["/api/generate (SYSTEM_PROMPT)", () => GENERATE_SYSTEM_PROMPT],
    ["/api/templates/ai-design (SYSTEM_PROMPT — la pestaña Chat)", () => AI_DESIGN_SYSTEM_PROMPT],
    ["el Agente (buildAgentSystemPrompt())", () => buildAgentSystemPrompt()],
  ];

  it("BEHAVIOR_ORDER no está vacío — si esto falla, el resto de la prueba no exige nada", () => {
    expect(BEHAVIOR_ORDER.length).toBeGreaterThan(0);
  });

  describe.each(SURFACES)("%s", (_surfaceName, getPrompt) => {
    it.each(BEHAVIOR_ORDER)("contiene el marcador de la conducta '%s'", (name) => {
      const prompt = getPrompt();
      const marker = BEHAVIORS[name].marker;
      expect(
        prompt,
        `falta "${marker}" — ¿se cambió el import de lib/design-guidance por lib/design-guidance-v2, ` +
          `o se rompió la interpolación de DESIGN_GUIDANCE?`,
      ).toContain(marker);
    });

    it("contiene la sección CONDUCTAS (no solo marcadores sueltos)", () => {
      expect(getPrompt()).toContain("CONDUCTAS");
    });


  });
});

// La puerta de generación no manda gusto nuestro. Siete páginas de siete nichos
// distintos salían con el MISMO hero porque le pasábamos el de Mirror como
// fragmento de referencia y el orden de las secciones como esqueleto. Lo que
// queda es lo que la máquina necesita: OpenLen borra todo el JavaScript, así
// que sin CONDUCTAS un acordeón llega muerto.
describe("la puerta de generación manda contrato, no gusto", () => {
  it("lleva el contrato de publicación", () => {
    expect(GENERATE_SYSTEM_PROMPT).toContain("CONDUCTAS");
    expect(GENERATE_SYSTEM_PROMPT).toContain("<!doctype html>");
  });

  it.each([
    ["los fragmentos copiados de Mirror", "reference-snippet"],
    ["el orden de las secciones", "SECTION SKELETON"],
    ["las recetas de CSS", "CSS RECIPES"],
    ["la barra de diseño", "DESIGN BAR"],
    ["las marcas ficticias", "FICTIONAL BRANDS"],
    ["la escala tipográfica", "text-4xl"],
    // Existía porque las páginas de Gemini se truncaban contra el tope. En
    // DeepSeek la salida más larga medida fue 12,338 tokens de 60,000, y
    // 65,536 se acepta: comprimía para evitar un problema que no ocurre.
    ["la presión a comprimir la salida", "OUTPUT EFFICIENCY"],
  ])("no lleva %s", (_name, marker) => {
    expect(GENERATE_SYSTEM_PROMPT).not.toContain(marker);
  });

  // Las superficies de EDICIÓN son otra decisión: ahí el modelo no diseña una
  // página desde cero, retoca una que ya existe.
  it("la guía completa sigue existiendo para las superficies de edición", () => {
    expect(AI_DESIGN_SYSTEM_PROMPT).toContain("SECTION SKELETON");
  });
});
