import { describe, expect, it } from "vitest";

import {
  MAX_PRUEBA_BYTES,
  MODEL_PRUEBA_ATTR,
  extractModelPrueba,
  extractPruebaFromEdits,
  modelPruebaPromptBlock,
} from "./model-prueba";

const ON = { OPENLEN_MODEL_JS: "1" };
const OFF = { OPENLEN_MODEL_JS: "0" };

const conPrueba = (json: string) =>
  `<!doctype html><html><body><h1>x</h1>
<script data-openlen-model-runtime>document.title = "x";</script>
<script type="application/json" ${MODEL_PRUEBA_ATTR}>${json}</script>
</body></html>`;

const BUENA = '[{"clic":"#empezar","entonces":[{"donde":"#reloj","que":"cambia"}]}]';

describe("extractModelPrueba", () => {
  it("saca los pasos que el modelo declaró", () => {
    const r = extractModelPrueba(conPrueba(BUENA));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pasos).toEqual([
      { clic: "#empezar", veces: 1, entonces: [{ donde: "#reloj", que: "cambia" }] },
    ]);
  });

  it("una página sin bloque no es un error — es que no hay prueba", () => {
    expect(extractModelPrueba("<!doctype html><html><body>hola</body></html>")).toEqual({
      ok: false,
      reason: "ausente",
    });
  });

  it("dos bloques no se fusionan", () => {
    const doble = conPrueba(BUENA).replace(
      "</body>",
      `<script type="application/json" ${MODEL_PRUEBA_ATTR}>${BUENA}</script></body>`,
    );
    expect(extractModelPrueba(doble)).toEqual({ ok: false, reason: "varios" });
  });

  it("JSON roto se descarta con su motivo, no revienta", () => {
    expect(extractModelPrueba(conPrueba("[{clic:"))).toEqual({ ok: false, reason: "json_invalido" });
  });

  it("un JSON gigante se rechaza antes de parsearlo", () => {
    const grande = `[{"clic":"#a","entonces":[{"donde":"#b","que":"contiene","valor":"${"x".repeat(MAX_PRUEBA_BYTES)}"}]}]`;
    expect(extractModelPrueba(conPrueba(grande))).toEqual({ ok: false, reason: "demasiado_grande" });
  });

  it("hereda las reglas del Agente: un selector ambiguo se rechaza entero", () => {
    // La coma casa con varios elementos, y una prueba ambigua miente. El
    // validador es EL MISMO que usa `editar_pagina` — un vocabulario que se
    // acepta al crear y se rechaza al editar serían dos productos.
    const r = extractModelPrueba(conPrueba('[{"clic":"#a, #b","entonces":[{"donde":"#r","que":"cambia"}]}]'));
    expect(r).toEqual({ ok: false, reason: "selector_invalido" });
  });

  it("un paso que no hace nada se rechaza", () => {
    expect(extractModelPrueba(conPrueba('[{"entonces":[{"donde":"#r","que":"visible"}]}]'))).toEqual({
      ok: false,
      reason: "sin_accion",
    });
  });

  it("`contiene` sin valor con qué comparar se rechaza", () => {
    expect(
      extractModelPrueba(conPrueba('[{"clic":"#a","entonces":[{"donde":"#r","que":"contiene"}]}]')),
    ).toEqual({ ok: false, reason: "falta_valor" });
  });

  it("un JSON que no es una lista se rechaza", () => {
    expect(extractModelPrueba(conPrueba('{"clic":"#a"}'))).toEqual({ ok: false, reason: "vacia" });
  });
});

describe("el bloque de prompt", () => {
  it("con el interruptor apagado no cuesta un solo token", () => {
    expect(modelPruebaPromptBlock(OFF)).toBe("");
    expect(modelPruebaPromptBlock({})).toBe("");
  });

  it("enseña el marcador y el vocabulario cerrado", () => {
    const b = modelPruebaPromptBlock(ON);
    expect(b).toContain(MODEL_PRUEBA_ATTR);
    expect(b).toContain('"que"');
    for (const verbo of ["cambia", "contiene", "es", "visible", "oculto"]) {
      expect(b).toContain(verbo);
    }
  });

  it("el ejemplo que le enseñamos PASA nuestro propio validador", () => {
    // Si el ejemplo del prompt no fuera válido, el modelo lo copiaría y la
    // prueba se tiraría en silencio en cada generación.
    const ejemplo = /<script type="application\/json" [^>]+>\s*(\[[\s\S]*?\])\s*<\/script>/.exec(
      modelPruebaPromptBlock(ON),
    );
    expect(ejemplo).not.toBeNull();
    expect(extractModelPrueba(conPrueba(ejemplo![1]!)).ok).toBe(true);
  });

  it("le dice que no compare contra el reloj ni el azar", () => {
    // El falso positivo MEDIDO: una prueba que esperaba `49:59` donde
    // reiniciar da `50:00`. Es la advertencia que evita pagar una reparación
    // por una promesa mal escrita.
    expect(modelPruebaPromptBlock(ON)).toMatch(/reloj o del azar/);
  });
});

// ── EL SOBRE DEL CHAT ───────────────────────────────────────────────────────
// El Chat entrega `<edits>`, no un documento. La prueba va al lado, DESPUÉS
// del cierre — dentro sería un hijo que `parseOps` (que vive en Rust) tendría
// que aprender a ignorar.
describe("extractPruebaFromEdits", () => {
  const SOBRE = (extra: string) => `<edits>
<edit op="replace" target="runtime"><script data-openlen-model-runtime>var a=1;</script></edit>
</edits>${extra}`;

  it("saca la prueba de detrás del bloque de ediciones", () => {
    const r = extractPruebaFromEdits(SOBRE(`\n<prueba>${BUENA}</prueba>`));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pasos[0]!.clic).toBe("#empezar");
  });

  it("un turno sin prueba no es un error — la mayoría no toca el comportamiento", () => {
    expect(extractPruebaFromEdits(SOBRE(""))).toEqual({ ok: false, reason: "ausente" });
  });

  it("dos bloques no se fusionan", () => {
    const r = extractPruebaFromEdits(SOBRE(`<prueba>${BUENA}</prueba><prueba>${BUENA}</prueba>`));
    expect(r).toEqual({ ok: false, reason: "varios" });
  });

  it("JSON roto se descarta con su motivo", () => {
    expect(extractPruebaFromEdits(SOBRE("<prueba>[{clic:</prueba>"))).toEqual({
      ok: false,
      reason: "json_invalido",
    });
  });

  it("hereda el MISMO validador — un selector ambiguo se rechaza igual", () => {
    const r = extractPruebaFromEdits(
      SOBRE('<prueba>[{"clic":"#a, #b","entonces":[{"donde":"#r","que":"cambia"}]}]</prueba>'),
    );
    expect(r).toEqual({ ok: false, reason: "selector_invalido" });
  });

  it("tolera espacios y saltos de línea alrededor del JSON", () => {
    expect(extractPruebaFromEdits(SOBRE(`\n<prueba>\n  ${BUENA}\n</prueba>\n`)).ok).toBe(true);
  });
});

describe("el bloque de prompt, según el sobre", () => {
  it("al Chat se le enseña `<prueba>`, NUNCA la forma del documento", () => {
    // Enseñarle una sintaxis que su superficie no acepta es garantizar que la
    // copie y que la prueba se tire en silencio en cada turno.
    const b = modelPruebaPromptBlock(ON, "edits");
    expect(b).toContain("<prueba>");
    expect(b).toContain("</edits>");
    expect(b).not.toContain(MODEL_PRUEBA_ATTR);
  });

  it("al crear se le enseña el script, NUNCA `<prueba>`", () => {
    const b = modelPruebaPromptBlock(ON, "documento");
    expect(b).toContain(MODEL_PRUEBA_ATTR);
    expect(b).not.toContain("<prueba>");
  });

  it("el ejemplo del sobre del Chat PASA su propio parser", () => {
    const ejemplo = /<prueba>(\[[\s\S]*?\])<\/prueba>/.exec(modelPruebaPromptBlock(ON, "edits"));
    expect(ejemplo).not.toBeNull();
    expect(extractPruebaFromEdits(`<edits></edits><prueba>${ejemplo![1]}</prueba>`).ok).toBe(true);
  });

  it("apagado, ningún sobre cuesta un token", () => {
    expect(modelPruebaPromptBlock(OFF, "edits")).toBe("");
    expect(modelPruebaPromptBlock(OFF, "documento")).toBe("");
  });
});
