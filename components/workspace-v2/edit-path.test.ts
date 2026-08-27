import { describe, expect, it } from "vitest";

import { buildEditPath, editChildTags, isEditorNode } from "./edit-path";

function montar(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body;
}

describe("buildEditPath — cómo se nombra un elemento para el servidor", () => {
  it("construye la miga de pan hasta body, excluido", () => {
    const body = montar(
      "<header><h1>a</h1></header><main><section><div><p>x</p></div></section></main>",
    );
    const p = body.querySelector("p")!;
    expect(buildEditPath(p)).toBe(
      "main:nth-of-type(1) > section:nth-of-type(1) > div:nth-of-type(1) > p:nth-of-type(1)",
    );
  });

  it("cuenta por TIPO, no por posición entre hermanos", () => {
    // El <span> de en medio no debe empujar el índice del segundo <p>: el
    // servidor resuelve con :nth-of-type, que es por etiqueta.
    const body = montar("<div><p>uno</p><span>x</span><p>dos</p></div>");
    const segundo = body.querySelectorAll("p")[1]!;
    expect(buildEditPath(segundo)).toBe("div:nth-of-type(1) > p:nth-of-type(2)");
  });

  /**
   * LA RAZÓN DE `:nth-of-type`. El editor inyecta su `<style>` y su `<script>`
   * al final del `<body>`. Si la cuenta fuera por posición, cada inyector
   * desplazaría los índices de todo lo que va detrás y las rutas apuntarían a
   * otra cosa en cuanto el documento se guardara.
   */
  it("los <style>/<script> del editor no desplazan a nadie", () => {
    const body = montar(
      "<section>a</section><style data-openlen-inline-edit>x{}</style><section>b</section>",
    );
    const segunda = body.querySelectorAll("section")[1]!;
    expect(buildEditPath(segunda)).toBe("section:nth-of-type(2)");
  });

  it("un elemento hijo directo del body es un solo segmento", () => {
    const body = montar("<h1>solo</h1>");
    expect(buildEditPath(body.querySelector("h1")!)).toBe("h1:nth-of-type(1)");
  });
});

describe("editChildTags — la firma que impide escribir en el sitio equivocado", () => {
  it("son las etiquetas de los hijos DIRECTOS, en orden", () => {
    const body = montar(
      "<section><h2>t</h2><p>a</p><ul><li>hondo</li></ul></section>",
    );
    expect(editChildTags(body.querySelector("section")!)).toEqual([
      "h2",
      "p",
      "ul",
    ]);
  });

  it("un elemento sin hijos da lista vacía", () => {
    const body = montar("<h1>solo texto</h1>");
    expect(editChildTags(body.querySelector("h1")!)).toEqual([]);
  });

  /**
   * LO NUESTRO NO CUENTA, y es lo que hace esta función usable.
   *
   * Los inyectores cuelgan nodos propios DENTRO de la página —asas de
   * arrastre, botones de reemplazo, la superposición de edición—. Están en el
   * DOM vivo y no en el documento guardado, así que si contaran, la firma no
   * coincidiría NUNCA y el servidor rechazaría todas las ediciones. La barrera
   * se convertiría en un muro.
   */
  it("los nodos del propio editor NO cuentan", () => {
    const body = montar(
      "<section><h2>t</h2><div data-openlen-reorder-handle>≡</div><p>a</p></section>",
    );
    expect(editChildTags(body.querySelector("section")!)).toEqual(["h2", "p"]);
  });

  it("y la firma cambia cuando la estructura cambia de verdad", () => {
    const a = montar("<section><h2>t</h2><p>a</p></section>");
    const firmaA = editChildTags(a.querySelector("section")!);
    const b = montar("<section><h2>t</h2><p>a</p><p>b</p></section>");
    const firmaB = editChildTags(b.querySelector("section")!);
    expect(firmaA).not.toEqual(firmaB);
  });
});

describe("isEditorNode", () => {
  it("reconoce cualquier atributo data-openlen-*", () => {
    const body = montar(
      '<div data-openlen-edit-overlay></div><div class="normal"></div>',
    );
    const [editor, normal] = [...body.children];
    expect(isEditorNode(editor!)).toBe(true);
    expect(isEditorNode(normal!)).toBe(false);
  });

  // `data-ol-*` es del NORMALIZADOR y sí vive en el documento guardado (los
  // carriers del selector de tema). Confundirlos con instrumentación del editor
  // haría que la firma se dejara fuera elementos que el servidor sí ve.
  it("pero NO confunde los carriers data-ol-* del normalizador", () => {
    const body = montar('<div data-ol-radius="lg"></div>');
    expect(isEditorNode(body.firstElementChild!)).toBe(false);
  });
});
