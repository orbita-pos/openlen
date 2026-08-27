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
  // El atributo es el REAL (`data-openlen-reorder`, el asa de arrastre). La
  // primera versión de esta prueba usaba un `data-openlen-reorder-handle`
  // inventado y pasaba igual, porque el reconocimiento era por prefijo: la
  // prueba sostenía una implementación equivocada en vez de vigilarla.
  it("los nodos del propio editor NO cuentan", () => {
    const body = montar(
      "<section><h2>t</h2><div data-openlen-reorder>≡</div><p>a</p></section>",
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
  it("reconoce un nodo que creó el editor", () => {
    const body = montar(
      '<div data-openlen-edit-overlay></div><div class="normal"></div>',
    );
    const [editor, normal] = [...body.children];
    expect(isEditorNode(editor!)).toBe(true);
    expect(isEditorNode(normal!)).toBe(false);
  });

  /**
   * ⚠️ LA TRAMPA QUE COSTÓ UNA PRUEBA DE NAVEGADOR.
   *
   * El editor pone atributos `data-openlen-*` de dos clases: sobre nodos SUYOS
   * y sobre elementos DE LA PÁGINA. `markEditableElements` marca como editable
   * casi todo lo que tiene texto — así que un test por PREFIJO se deja fuera de
   * la firma la mitad de los hijos reales, la firma no coincide nunca con la
   * del servidor, y TODA edición sale rechazada.
   *
   * Medido el 2026-08-26: con el prefijo, el contrato entre las dos orillas
   * veía 4 elementos de 15.
   */
  it("pero NO una marca temporal del editor sobre contenido del usuario", () => {
    const body = montar(
      "<h1 data-openlen-editable>Titular</h1>" +
        "<p data-openlen-edit-hidden>x</p>" +
        "<section data-openlen-inspect-selected>y</section>",
    );
    for (const el of [...body.children]) {
      expect(isEditorNode(el), el.outerHTML).toBe(false);
    }
  });

  /**
   * Y por eso la comparación es por NOMBRE EXACTO. `data-openlen-reorder-index`
   * y `data-openlen-replace-target` van sobre elementos de la página y empiezan
   * igual que dos marcadores de nodo — `data-openlen-reorder` y
   * `data-openlen-replace`. Es el mismo criterio del selector CSS que usa el
   * limpiador, que también casa por atributo exacto.
   */
  it("y distingue data-openlen-reorder de data-openlen-reorder-index", () => {
    const body = montar(
      "<div data-openlen-reorder></div>" +
        '<section data-openlen-reorder-index="2"></section>' +
        '<section data-openlen-replace-target="1"></section>',
    );
    const [nodo, conIndice, conTarget] = [...body.children];
    expect(isEditorNode(nodo!)).toBe(true);
    expect(isEditorNode(conIndice!)).toBe(false);
    expect(isEditorNode(conTarget!)).toBe(false);
  });

  // `data-ol-*` es del NORMALIZADOR y sí vive en el documento guardado (los
  // carriers del selector de tema). Confundirlos con instrumentación del editor
  // haría que la firma se dejara fuera elementos que el servidor sí ve.
  it("pero NO confunde los carriers data-ol-* del normalizador", () => {
    const body = montar('<div data-ol-radius="lg"></div>');
    expect(isEditorNode(body.firstElementChild!)).toBe(false);
  });
});
