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

const AGENT_JS_OFF = { OPENLEN_MODEL_JS: "0" } as const;

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
    // EL AGENTE SALE DE ESTA LISTA el 2026-08-26. Su prompt ya no lleva la
    // sección CONDUCTAS: con el JavaScript libre, la respuesta a «haz que este
    // botón filtre» es que el modelo lo escriba, no que cablee `data-ol-filter`.
    // La costura que este guardia vigila —que las superficies no caigan al
    // design-guidance-v2 por un cambio de import— sigue vigilada en las otras
    // dos, y ésas todavía ofrecen conductas.

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

// Ninguna superficie manda gusto nuestro. Volvió por tres puertas en un día:
// el esqueleto de secciones dentro de DESIGN_GUIDANCE, la captura de una
// plantilla curada adjunta al brief, y un segundo mensaje `<reference>` que se
// presentaba al modelo como "the design taste catalog" — ése pasaba por debajo
// de una guarda que sólo miraba el system prompt.
//
// Lo que sí viaja es contrato: OpenLen borra todo el JavaScript (de ahí
// CONDUCTAS) y el linter del contrato exige el vocabulario de tokens, del que
// dependen los controles de tema del editor.
describe("ninguna superficie manda gusto nuestro", () => {
  const PROMPTS: Array<[string, () => string]> = [
    ["crear", () => GENERATE_SYSTEM_PROMPT],
    ["editar", () => AI_DESIGN_SYSTEM_PROMPT],
    ["Agente", () => buildAgentSystemPrompt(AGENT_JS_OFF)],
  ];

  it.each(PROMPTS)("%s lleva el contrato de publicación", (_name, getPrompt) => {
    expect(getPrompt()).toContain("DESIGN CONTRACT — token vocabulary");
  });

  // CONDUCTAS aparte: el Agente ya no las ofrece desde el 2026-08-26. Con el
  // JavaScript libre, «haz que este botón filtre» lo resuelve el modelo
  // escribiéndolo, no cableando `data-ol-filter`. Las otras dos superficies
  // todavía las llevan, y hasta que se retiren (paso 6) esto las vigila.
  it.each(PROMPTS.filter(([n]) => n !== "Agente"))(
    "%s todavía ofrece CONDUCTAS",
    (_name, getPrompt) => {
      expect(getPrompt()).toContain("CONDUCTAS");
    },
  );

  const GUSTO = [
    ["el orden de las secciones", "SECTION SKELETON"],
    ["la barra de diseño", "DESIGN BAR"],
    ["las marcas ficticias", "FICTIONAL BRANDS"],
    ["las precisiones tipográficas", "TYPOGRAPHY PRECISIONS"],
    ["los fragmentos copiados de Mirror", "reference-snippet"],
    ["las recetas de CSS", "CSS RECIPES"],
    ["la presión a comprimir la salida", "OUTPUT EFFICIENCY"],
    ["el ojo de otras cuatro empresas", "Linear"],
  ] as const;

  for (const [surface, getPrompt] of PROMPTS) {
    it.each(GUSTO)(`${surface} no lleva %s`, (_name, marker) => {
      expect(getPrompt()).not.toContain(marker);
    });
  }

  // Las fuentes son gusto, no contrato. NADA en la tubería exige una lista:
  // normalize_font iza la familia que venga (su <link> de 12 es precarga, no
  // lista blanca), el saneador no toca <link>, y la CSS de publicación deja
  // `style-src` sin fijar. Aun así las tres superficies decían "Allowed
  // families:" con seis — y por eso una página de terror no podía tener
  // tipografía de terror.
  it.each(PROMPTS)("%s no cierra la lista de tipografías", (_name, getPrompt) => {
    expect(getPrompt()).not.toMatch(/Allowed families/i);
  });

  // El catálogo de gusto no viajaba por el system prompt sino por un mensaje
  // aparte, así que la guarda tiene que mirar el código, no sólo el prompt.
  it("nadie importa el catálogo de gusto", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry === ".next") continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) { walk(full); continue; }
        if (!/\.tsx?$/.test(entry) || /\.test\.tsx?$/.test(entry)) continue;
        if (full.endsWith(join("lib", "design-guidance.ts"))) continue;
        if (readFileSync(full, "utf8").includes("DESIGN_REFERENCE")) offenders.push(full);
      }
    };
    walk(join(process.cwd(), "app"));
    walk(join(process.cwd(), "lib"));
    expect(offenders, offenders.join(", ")).toEqual([]);
  });
});
