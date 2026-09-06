// Run: npx tsx --require ./scripts/test-node-server-only-shim.cjs --test lib/agent/culpable-op-id.test.ts
//
// Lo que se prueba aquí NO es que resuelva: es que SE NIEGUE a resolver cuando
// no puede garantizar el nodo. `resolveOpIdByPath` sobre un documento que ha
// divergido no falla, ACIERTA A OTRO — y una dirección equivocada manda al
// modelo a editar un vecino en silencio, que es peor que el problema original.
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { tagWithOpIds } from "@/lib/html-ops";
import { resolverCulpableOpId } from "./culpable-op-id";

const DOC = `<!doctype html><html lang="es"><head><title>x</title></head><body>
<header><nav><a href="/">Inicio</a></nav></header>
<section id="hero">
  <div class="stack">
    <h1>Café nacido del fuego</h1>
    <span class="font-display text-xl w-[220px]">Volcánica</span>
  </div>
</section>
<section id="pie"><div class="stack"><span class="otra cosa">Nada</span></div></section>
</body></html>`;

const RUTA_SPAN =
  "section:nth-of-type(1) > div:nth-of-type(1) > span:nth-of-type(1)";

describe("resolverCulpableOpId", () => {
  it("devuelve el op-id del nodo que la sonda midió", () => {
    const { taggedHtml } = tagWithOpIds(DOC);
    const opId = resolverCulpableOpId(taggedHtml, RUTA_SPAN, "span.font-display.text-xl");
    assert.ok(opId, "no resolvió");
    // Y es el del SPAN, no el de su contenedor: nombrar al ancestro manda a
    // mirar donde no está la causa, que es el bug entero.
    assert.match(taggedHtml, new RegExp(`<span[^>]*data-op-id="${opId}"`));
  });

  it("se niega si la ETIQUETA del nodo resuelto no es la de la ruta", () => {
    const { taggedHtml } = tagWithOpIds(DOC);
    // Misma posición, otra etiqueta: es el caso de un documento que divergió.
    const ruta = "section:nth-of-type(1) > div:nth-of-type(1) > h1:nth-of-type(1)";
    assert.equal(resolverCulpableOpId(taggedHtml, ruta, "span.font-display"), null);
  });

  it("se niega si falta una de las clases que la sonda nombró", () => {
    const { taggedHtml } = tagWithOpIds(DOC);
    assert.equal(
      resolverCulpableOpId(taggedHtml, RUTA_SPAN, "span.font-display.no-esta"),
      null,
    );
  });

  it("se niega cuando la ruta no resuelve a nada", () => {
    const { taggedHtml } = tagWithOpIds(DOC);
    assert.equal(
      resolverCulpableOpId(taggedHtml, "section:nth-of-type(9) > span:nth-of-type(1)", "span"),
      null,
    );
  });

  it("sin ruta o sin documento no inventa nada", () => {
    const { taggedHtml } = tagWithOpIds(DOC);
    assert.equal(resolverCulpableOpId(taggedHtml, "", "span.font-display"), null);
    assert.equal(resolverCulpableOpId("", RUTA_SPAN, "span.font-display"), null);
  });

  it("una descripción SIN clases resuelve por etiqueta — no exige lo que no hay", () => {
    const { taggedHtml } = tagWithOpIds(DOC);
    assert.ok(resolverCulpableOpId(taggedHtml, RUTA_SPAN, "span"));
  });

  // EL CASO CARO, y el que justifica la corroboración: dos `span` con las
  // MISMAS dos primeras clases en secciones distintas. La descripción sola no
  // los distingue —por eso el modelo no podía— y la ruta sí.
  it("distingue dos nodos que la descripción confundiría", () => {
    const doc = DOC.replace(
      '<span class="otra cosa">Nada</span>',
      '<span class="font-display text-xl">Otro</span>',
    );
    const { taggedHtml } = tagWithOpIds(doc);
    const primero = resolverCulpableOpId(taggedHtml, RUTA_SPAN, "span.font-display.text-xl");
    const segundo = resolverCulpableOpId(
      taggedHtml,
      "section:nth-of-type(2) > div:nth-of-type(1) > span:nth-of-type(1)",
      "span.font-display.text-xl",
    );
    assert.ok(primero);
    assert.ok(segundo);
    assert.notEqual(primero, segundo, "la ruta tiene que separarlos");
  });
});
