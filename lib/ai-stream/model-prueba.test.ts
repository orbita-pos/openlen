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
    expect(r.prueba.modo).toBe("spec");
    if (r.prueba.modo !== "spec") return;
    expect(r.prueba.pasos).toEqual([
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

  it("hereda las reglas del Agente: el mismo validador, y desde el 04/09 más corto", () => {
    // El validador sigue siendo EL MISMO que usa `editar_pagina` —un
    // vocabulario que se acepte al crear y se rechace al editar serían dos
    // productos— pero ya no juzga la FORMA del selector: eso se cuenta en el
    // navegador (`querySelectorAll(sel).length`), donde un `#a, #b` sale como
    // «señala 2 elementos» y como fallo DE LA PRUEBA, sin acusar a la página.
    // Ver la lápida en `behavior-spec.ts`: la regex tiró 2 pruebas buenas de 11.
    const r = extractModelPrueba(conPrueba('[{"clic":"#a, #b","entonces":[{"donde":"#r","que":"cambia"}]}]'));
    expect(r.ok).toBe(true);
    // Lo que SÍ sigue rechazándose aquí: una cadena que no es un selector.
    const vacio = extractModelPrueba(conPrueba('[{"clic":"  ","entonces":[{"donde":"#r","que":"cambia"}]}]'));
    expect(vacio).toEqual({ ok: false, reason: "selector_invalido" });
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
  // RETIRADA con el interruptor. Fijaba que con `OPENLEN_MODEL_JS` apagado el
  // bloque de la prueba declarada no costara ni un token. Ahora el JavaScript
  // es de todos, así que la prueba declarada también.

  it("enseña el marcador y el vocabulario cerrado", () => {
    const b = modelPruebaPromptBlock();
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
      modelPruebaPromptBlock(),
    );
    expect(ejemplo).not.toBeNull();
    expect(extractModelPrueba(conPrueba(ejemplo![1]!)).ok).toBe(true);
  });

  it("le dice que no compare contra el reloj ni el azar", () => {
    // El falso positivo MEDIDO: una prueba que esperaba `49:59` donde
    // reiniciar da `50:00`. Es la advertencia que evita pagar una reparación
    // por una promesa mal escrita.
    expect(modelPruebaPromptBlock()).toMatch(/reloj o del azar/);
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
    expect(r.prueba.modo).toBe("spec");
    if (r.prueba.modo !== "spec") return;
    expect(r.prueba.pasos[0]!.clic).toBe("#empezar");
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

  it("hereda el MISMO validador — y por tanto la misma relajación del 04/09", () => {
    // Las dos superficies tienen que aceptar y rechazar lo mismo, o el modelo
    // aprende un vocabulario al crear y otro al editar.
    expect(
      extractPruebaFromEdits(SOBRE('<prueba>[{"clic":"#a, #b","entonces":[{"donde":"#r","que":"cambia"}]}]</prueba>')).ok,
    ).toBe(true);
    expect(
      extractPruebaFromEdits(SOBRE('<prueba>[{"clic":"  ","entonces":[{"donde":"#r","que":"cambia"}]}]</prueba>')),
    ).toEqual({ ok: false, reason: "selector_invalido" });
  });

  it("tolera espacios y saltos de línea alrededor del JSON", () => {
    expect(extractPruebaFromEdits(SOBRE(`\n<prueba>\n  ${BUENA}\n</prueba>\n`)).ok).toBe(true);
  });
});

describe("el bloque de prompt, según el sobre", () => {
  it("al Chat se le enseña `<prueba>`, NUNCA la forma del documento", () => {
    // Enseñarle una sintaxis que su superficie no acepta es garantizar que la
    // copie y que la prueba se tire en silencio en cada turno.
    const b = modelPruebaPromptBlock("edits");
    expect(b).toContain("<prueba>");
    expect(b).toContain("</edits>");
    expect(b).not.toContain(MODEL_PRUEBA_ATTR);
  });

  it("al crear se le enseña el script, NUNCA `<prueba>`", () => {
    const b = modelPruebaPromptBlock("documento");
    expect(b).toContain(MODEL_PRUEBA_ATTR);
    expect(b).not.toContain("<prueba>");
  });

  it("el ejemplo del sobre del Chat PASA su propio parser", () => {
    const ejemplo = /<prueba>(\[[\s\S]*?\])<\/prueba>/.exec(modelPruebaPromptBlock("edits"));
    expect(ejemplo).not.toBeNull();
    expect(extractPruebaFromEdits(`<edits></edits><prueba>${ejemplo![1]}</prueba>`).ok).toBe(true);
  });

  // RETIRADA con el interruptor. Fijaba que con `OPENLEN_MODEL_JS` apagado el
  // bloque de la prueba declarada no costara ni un token. Ahora el JavaScript
  // es de todos, así que la prueba declarada también.

});
