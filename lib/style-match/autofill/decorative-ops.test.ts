// Medido en `school-website` del barrido del 2026-08-16. El rellenador escribió
// copia dentro de elementos decorativos:
//
//   <span class="link__icon" aria-hidden="true">Colegio Horizonte</span>
//   <span class="link__arrow" aria-hidden="true">Comenzar</span>
//
// El primero es un círculo dimensionado para un glifo, así que el nombre del
// negocio salía cortado ("Col egi"); el segundo es una flecha, así que
// "Comenzar" aparecía suelto en el borde derecho de cada tarjeta.
//
// `aria-hidden="true"` significa "esto no es contenido". Un lector de pantalla
// no lo anuncia, y por eso mismo el texto que se le meta es texto que el usuario
// ve pero que la página declara inexistente.
import { describe, expect, it } from "vitest";
import { dropDecorativeOps } from "./decorative-ops";

const TAGGED = `<div>
<span class="link__icon" aria-hidden="true" data-op-id="a1">✦</span>
<span class="link__title" data-op-id="a2">Título</span>
<span class="link__arrow" aria-hidden='true' data-op-id="a3">→</span>
<img data-op-id="a4" alt="" aria-hidden="true">
</div>`;

const op = (target: string) => ({ type: "replace" as const, target, newHtml: "Colegio Horizonte" });

describe("dropDecorativeOps", () => {
  it("refuses an op aimed at an aria-hidden element", () => {
    const kept = dropDecorativeOps([op("a1"), op("a2")], TAGGED);

    expect(kept.map((o) => o.target)).toEqual(["a2"]);
  });

  it("does not care how the attribute was quoted", () => {
    expect(dropDecorativeOps([op("a3")], TAGGED)).toEqual([]);
  });

  it("keeps every op when nothing is decorative", () => {
    const ops = [op("a2")];

    expect(dropDecorativeOps(ops, TAGGED)).toEqual(ops);
  });

  it("keeps an op whose target it cannot find, rather than guessing", () => {
    // A target we cannot locate is not evidence of anything. Dropping it would
    // silently discard real copy.
    const ops = [op("nope")];

    expect(dropDecorativeOps(ops, TAGGED)).toEqual(ops);
  });

  it("is not fooled by aria-hidden on a different element", () => {
    const html = '<span aria-hidden="true" data-op-id="x">✦</span><span data-op-id="y">Real</span>';

    expect(dropDecorativeOps([op("y")], html).map((o) => o.target)).toEqual(["y"]);
  });
});
