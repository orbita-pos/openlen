import { describe, expect, it } from "vitest";

import { systemPromptFor } from "@/app/api/generate/system-prompt";
import { aiDesignSystemMessage } from "@/app/api/templates/ai-design/system-prompt";
import { buildAgentSystemPrompt } from "@/lib/agent/catalog";
import { REDESIGN_JS_CLAUSES, buildRedesignPrompt } from "@/lib/agent/redesign";
import { swapJsClauses } from "@/lib/ai/js-clause";

// LO QUE ESTA PRUEBA VIGILA, y por qué no bastaban las que ya había.
//
// `js-clause.test.ts` comprueba la MECÁNICA del intercambio sobre cadenas de
// laboratorio. `system-prompt.test.ts` comprueba el contrato mínimo. Ninguna de
// las dos MONTA las cinco superficies de verdad — y el 2026-08-31 eso escondía
// dos defectos a la vez:
//
//   · el Agente seguía leyendo «UN solo `<script>`», falso desde que crear corre
//     con `sanitize: false`;
//   · y el rediseño interpolaba `DESIGN_GUIDANCE` ENTERA volteando sólo dos
//     cláusulas, así que su regla 5 decía «puedes escribir JavaScript» y quince
//     líneas más abajo el contrato incrustado decía «NO JAVASCRIPT — it does not
//     survive». Las dos cosas, en el mismo prompt. La cabecera de js-clause.ts
//     ya tiene medido quién gana esa discusión: la prohibición.
//
// Las dos pasaron todas las suites verdes. Lo que faltaba era montar el prompt
// final y mirarlo.
//
// 🔴 Si añades una superficie que arme un prompt de modelo, añádela AQUÍ.

/** Frases que ya no son ciertas en ninguna superficie. */
const MENTIRAS: readonly [string, string][] = [
  ["el horneado de vídeo, borrado el 2026-08-26", "is turned into an in-page player automatically"],
  ["la prohibición de embebidos que ya no existe", "No embedded map, no Spotify, no Calendly"],
  ["el límite de un solo script (ES)", "UN solo `<script>`"],
  ["el límite de un solo script (EN)", "exactly ONE `<script>`"],
  ["la prohibición del JavaScript (ES)", "NINGÚN JavaScript sobrevive"],
  ["la prohibición del JavaScript (EN)", "• NO JAVASCRIPT — it does not survive"],
  ["la prohibición del iframe (ES)", "NINGÚN `<iframe>` sobrevive"],
];

function superficies(): [string, string][] {
  return [
    // `{}` es el camino REAL: el mínimo es opt-OUT, sólo el literal "0" lo apaga.
    ["crear (contrato mínimo)", systemPromptFor({})],
    ["crear (contrato completo)", systemPromptFor({ OPENLEN_MIN_CONTRACT: "0" })],
    ["chat (ai-design)", aiDesignSystemMessage()],
    ["len (agente)", buildAgentSystemPrompt()],
    [
      "len (rediseño)",
      // La MISMA lista que usa la ruta, importada — no una copia.
      swapJsClauses(
        buildRedesignPrompt({ instruction: "x", html: "<h1>x</h1>" } as never),
        REDESIGN_JS_CLAUSES,
      ),
    ],
  ];
}

describe("ninguna superficie le miente al modelo sobre lo que sobrevive", () => {
  for (const [nombre, prompt] of superficies()) {
    for (const [queEs, frase] of MENTIRAS) {
      it(`${nombre} — ya no dice ${queEs}`, () => {
        expect(prompt).not.toContain(frase);
      });
    }
  }
});

describe("y todas saben cómo se pone un mapa que de verdad funciona", () => {
  for (const [nombre, prompt] of superficies()) {
    // El rediseño no lleva el bloque de embebidos (su regla 5 es sólo sobre
    // JavaScript), así que se le exige lo mismo que al resto SÓLO si menciona
    // iframes. Lo que no se acepta de ninguna es que ofrezca la forma MUERTA.
    it(`${nombre} — si habla de iframes, da la forma sin clave`, () => {
      if (!/iframe/i.test(prompt)) return;
      expect(prompt).toContain("maps.google.com/maps?q=");
    });
  }
});
