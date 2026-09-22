import { describe, expect, it } from "vitest";

import { MAX_PRUEBA_JS_BYTES } from "@/lib/agent/prueba-js";
import { avisoPruebaDescartada, extractPruebaFromEdits, modelPruebaPromptBlock } from "./model-prueba";

// ⚰️ Aquí vivían un `ON` y un `OFF` con `OPENLEN_MODEL_JS`, y las pruebas del
// sobre del DOCUMENTO (`<script data-openlen-prueba>`) y del DSL en JSON. El
// interruptor se borró el 2026-08-26; el sobre del documento y el DSL, el
// 2026-09-22.

const BUENA = 'var antes = await ui.texto("#reloj"); await ui.clic("#empezar"); await ui.cambiaDe("#reloj", antes);';

// ── EL SOBRE DEL CHAT ───────────────────────────────────────────────────────
// El Chat entrega `<edits>`, no un documento. La prueba va al lado, DESPUÉS
// del cierre — dentro sería un hijo que `parseOps` (que vive en Rust) tendría
// que aprender a ignorar.
describe("extractPruebaFromEdits", () => {
  const SOBRE = (extra: string) => `<edits>
<edit op="replace" target="runtime"><script data-openlen-model-runtime>var a=1;</script></edit>
</edits>${extra}`;

  it("saca el programa de detrás del bloque de ediciones", () => {
    expect(extractPruebaFromEdits(SOBRE(`\n<prueba>${BUENA}</prueba>`))).toEqual({
      ok: true,
      prueba: { codigo: BUENA },
    });
  });

  it("un turno sin prueba no es un error — la mayoría no toca el comportamiento", () => {
    expect(extractPruebaFromEdits(SOBRE(""))).toEqual({ ok: false, reason: "ausente" });
  });

  it("dos bloques no se fusionan", () => {
    const r = extractPruebaFromEdits(SOBRE(`<prueba>${BUENA}</prueba><prueba>${BUENA}</prueba>`));
    expect(r).toEqual({ ok: false, reason: "varios" });
  });

  it("tolera espacios y saltos de línea alrededor del programa", () => {
    expect(extractPruebaFromEdits(SOBRE(`\n<prueba>\n  ${BUENA}\n</prueba>\n`))).toEqual({
      ok: true,
      prueba: { codigo: BUENA },
    });
  });

  it("uno que pasa del tope se rechaza con su motivo, no revienta", () => {
    const grande = `await ui.clic("#a"); // ${"x".repeat(MAX_PRUEBA_JS_BYTES)}`;
    expect(extractPruebaFromEdits(SOBRE(`<prueba>${grande}</prueba>`))).toEqual({
      ok: false,
      reason: "demasiado_grande",
    });
  });

  it("un bloque vacío no es una promesa", () => {
    expect(extractPruebaFromEdits(SOBRE("<prueba>  </prueba>"))).toEqual({ ok: false, reason: "vacia" });
  });

  // 🔴 EL DSL RETIRADO SE NOMBRA, no se convierte ni se ejecuta. Un modelo que
  // copia su historial seguirá mandando la lista de pasos un tiempo; tratarla
  // como JS la haría fallar en el navegador acusando a la PRUEBA con un error
  // de sintaxis que no dice por qué.
  it("🔴 la lista de pasos del DSL retirado se rechaza con su nombre", () => {
    const dsl = '[{"clic":"#empezar","entonces":[{"donde":"#reloj","que":"cambia"}]}]';
    expect(extractPruebaFromEdits(SOBRE(`<prueba>${dsl}</prueba>`))).toEqual({
      ok: false,
      reason: "prueba_retirada",
    });
    expect(extractPruebaFromEdits(SOBRE('<prueba>{"clic":"#a"}</prueba>'))).toEqual({
      ok: false,
      reason: "prueba_retirada",
    });
  });
});

describe("avisoPruebaDescartada", () => {
  // Lo lee el DUEÑO en el texto del turno, y el modelo en el siguiente. Hasta
  // el 2026-09-22 un rechazo sólo iba al log y el modelo creía haber prometido.
  it("dice que NO se comprobó, que el cambio está, y por qué — en cada motivo", () => {
    for (const motivo of ["prueba_retirada", "varios", "vacia", "demasiado_grande"] as const) {
      const aviso = avisoPruebaDescartada(motivo);
      expect(aviso, motivo).toMatch(/no se comprobó/);
      expect(aviso, motivo).toMatch(/El cambio está guardado/);
    }
    expect(avisoPruebaDescartada("prueba_retirada")).toMatch(/ya no se usa/);
  });

  it("no le da al dueño la receta del modelo", () => {
    for (const motivo of ["prueba_retirada", "varios", "vacia", "demasiado_grande"] as const) {
      expect(avisoPruebaDescartada(motivo), motivo).not.toMatch(/ui\.|<prueba>|JSON/);
    }
  });
});

describe("el bloque de prompt", () => {
  it("enseña `<prueba>` detrás de `</edits>`, y sólo en MODE A", () => {
    const b = modelPruebaPromptBlock();
    expect(b).toContain("<prueba>");
    expect(b).toContain("</edits>");
    expect(b).toContain("MODE A");
    // Ni la forma del documento ni el DSL: enseñar una sintaxis que la
    // superficie no acepta es garantizar que la copie.
    expect(b).not.toContain("data-openlen-prueba");
    expect(b).not.toMatch(/"entonces"|"que"\s*:/);
  });

  it("el vocabulario de `ui.*` es el mismo que lee el Agente", () => {
    const b = modelPruebaPromptBlock();
    for (const verbo of ["ui.clic", "ui.desplaza", "ui.escribe", "ui.texto", "ui.cambiaDe", "ui.atributoCambiaDe"]) {
      expect(b).toContain(verbo);
    }
    expect(b).toContain("El bloque `<prueba>` es tu prueba como programa JavaScript");
  });

  it("el ejemplo que le enseñamos PASA su propio extractor", () => {
    // Si el ejemplo del prompt no fuera válido, el modelo lo copiaría y la
    // prueba se tiraría en cada turno.
    const ejemplo = /<prueba>([\s\S]*?)<\/prueba>/.exec(modelPruebaPromptBlock());
    expect(ejemplo).not.toBeNull();
    expect(extractPruebaFromEdits(`<edits></edits><prueba>${ejemplo![1]}</prueba>`).ok).toBe(true);
  });

  it("le dice que no compare contra el reloj ni el azar", () => {
    // El falso positivo MEDIDO: una prueba que esperaba `49:59` donde
    // reiniciar da `50:00`.
    expect(modelPruebaPromptBlock()).toMatch(/reloj o del azar/);
  });
});
