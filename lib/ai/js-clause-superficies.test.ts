import { describe, expect, it } from "vitest";

import { systemPromptFor } from "@/app/api/generate/system-prompt";
import { aiDesignSystemMessage } from "@/app/api/templates/ai-design/system-prompt";
import { buildAgentSystemPrompt } from "@/lib/agent/catalog";
import { redesignPromptFinal } from "@/lib/agent/redesign";
import { swapJsClauses } from "@/lib/ai/js-clause";
import { LIBRERIAS, bloqueDeLibrerias } from "@/lib/librerias";

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
      // LO QUE LA RUTA MANDA, por su unica puerta. Antes esto repetia a mano
      // los dos pasos del ensamblado —recorte y cambio de clausulas—, que es
      // como una prueba acaba midiendo su propia copia en vez del codigo.
      redesignPromptFinal({ instruction: "x", html: "<h1>x</h1>" } as never),
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

// ─── LAS LIBRERIAS, EN LAS CINCO ───────────────────────────────────────────
//
// La tercera de las tres listas del hallazgo 4. Las otras dos —el saneador y
// las ops de cabeza— las vigila `lib/ai/librerias-acuerdo.test.ts` contra el
// binding REAL; ésta vigila la que no necesita nativo y es la que se olvida:
// una capacidad que el prompt no nombra es una capacidad que no existe. Es la
// leccion medida de js-clause.ts, donde el JavaScript llevaba abierto dias y
// salian 0 de 6 paginas con codigo porque el prompt seguia prohibiendolo.
describe("las cinco superficies ofrecen las librerias", () => {
  for (const [nombre, prompt] of superficies()) {
    it(`${nombre} — trae el bloque, y una sola vez`, () => {
      const bloque = bloqueDeLibrerias();
      expect(prompt).toContain(bloque);
      expect(prompt.split(bloque).length - 1).toBe(1);
    });

    for (const l of LIBRERIAS) {
      it(`${nombre} — ${l.nombre}: URL exacta + SRI + global`, () => {
        for (const sc of l.scripts) {
          expect(prompt).toContain(sc.url);
          expect(prompt).toContain(sc.sri);
        }
        expect(prompt).toContain(l.global);
        if (l.css !== null) expect(prompt).toContain(l.css);
      });
    }

    it(`${nombre} — dice que los demas CDN no sobreviven`, () => {
      // Sin esta frase el modelo escribe jsdelivr, que es lo que ha visto un
      // millon de veces, y el saneador se lo borra.
      expect(prompt).toContain("jsdelivr");
    });
  }
});
