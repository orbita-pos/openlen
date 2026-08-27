import { describe, expect, it } from "vitest";

import { aplicarEdiciones, type Edicion } from "./aplicar-ediciones";

// El documento GUARDADO — con el `<script>` del modelo dentro, que es como el
// modelo lo escribe. Todo lo que se mide aquí es contra ESTE, nunca contra una
// foto del DOM vivo.
const DOC =
  "<!doctype html><html><head><title>Aguja Negra</title></head><body>" +
  '<header><h1 id="t">Tinta que dura</h1></header>' +
  '<main><section class="rejilla"><article>Uno</article><article>Dos</article></section></main>' +
  "<footer><p>Contacto</p></footer>" +
  "<script>document.querySelector('.rejilla').classList.add('lista')</script>" +
  "</body></html>";

const edicion = (p: Partial<Edicion> = {}): Edicion => ({
  op: "replace",
  path: "header:nth-of-type(1) > h1:nth-of-type(1)",
  tag: "h1",
  hijos: [],
  html: '<h1 id="t">Tinta que dura lo que tú</h1>',
  ...p,
});

describe("aplicar ediciones contra el documento guardado", () => {
  it("una edición de texto cae donde el usuario la hizo", () => {
    const r = aplicarEdiciones(DOC, [edicion()]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html).toContain("Tinta que dura lo que tú");
    expect(r.html).not.toContain(">Tinta que dura<");
  });

  /**
   * LA PRUEBA QUE JUSTIFICA TODO ESTO. El script del modelo no pasa por el
   * navegador ni una vez, así que no hay forma de perderlo ni de duplicarlo —
   * a diferencia del guardado por foto del DOM, donde el documento entero
   * hacía el viaje de ida y vuelta en cada edición.
   */
  it("el <script> del modelo sale intacto y UNA sola vez", () => {
    const r = aplicarEdiciones(DOC, [edicion()]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const codigo = "document.querySelector('.rejilla').classList.add('lista')";
    expect(r.html).toContain(codigo);
    expect(r.html.split(codigo).length - 1).toBe(1);
  });

  /**
   * Y NADA MÁS SE MUEVE. Es la otra mitad: el guardado viejo reescribía el
   * documento entero en cada edición, así que cualquier diferencia del
   * serializador del navegador se colaba en la página del usuario sin que
   * nadie la pidiera.
   */
  it("y el resto del documento no se toca", () => {
    const r = aplicarEdiciones(DOC, [edicion()]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html).toContain("<article>Uno</article><article>Dos</article>");
    expect(r.html).toContain("<footer><p>Contacto</p></footer>");
    expect(r.html).toContain("<title>Aguja Negra</title>");
  });

  it("insertar una sección la pone junto a su ancla", () => {
    const r = aplicarEdiciones(DOC, [
      edicion({
        op: "insert_after",
        path: "main:nth-of-type(1) > section:nth-of-type(1)",
        tag: "section",
        hijos: ["article", "article"],
        html: "<section id=nueva>Nueva</section>",
      }),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html.indexOf("Dos")).toBeLessThan(r.html.indexOf("Nueva"));
  });

  it("borrar no necesita fragmento", () => {
    const r = aplicarEdiciones(DOC, [
      edicion({
        op: "delete",
        path: "footer:nth-of-type(1)",
        tag: "footer",
        hijos: ["p"],
        html: undefined,
      }),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html).not.toContain("Contacto");
  });
});

describe("lo que se RECHAZA en vez de aplicar a ciegas", () => {
  it("una ruta que no encuentra nada rechaza el lote", () => {
    const r = aplicarEdiciones(DOC, [
      edicion({ path: "aside:nth-of-type(9) > h1:nth-of-type(1)" }),
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe("ruta_no_resuelve");
    expect(r.indice).toBe(0);
  });

  /**
   * LA BARRERA QUE IMPORTA, y la razón por la que existe `hijos`.
   *
   * La ruta es POSICIONAL. Si el script del modelo insertó un hermano del
   * mismo tipo, los índices `nth-of-type` del DOM vivo dejan de casar con los
   * del documento guardado y la ruta resuelve a un VECINO. Sin esta
   * comprobación, la edición aterriza callada en el elemento equivocado — que
   * es la peor forma de fallar, porque el usuario ve otra cosa cambiada y no
   * sabe por qué.
   */
  it("si la ruta lleva a otro elemento, se rechaza — no se escribe encima", () => {
    const r = aplicarEdiciones(DOC, [
      edicion({
        // La ruta resuelve, pero el iframe dice haber visto un elemento con
        // hijos distintos: la estructura se movió debajo.
        path: "main:nth-of-type(1) > section:nth-of-type(1)",
        tag: "section",
        hijos: ["article", "article", "article"],
        html: "<section>otra cosa</section>",
      }),
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe("otro_elemento");
  });

  it("y tampoco si el tipo de elemento no es el que se tocó", () => {
    const r = aplicarEdiciones(DOC, [
      edicion({ path: "main:nth-of-type(1) > section:nth-of-type(1)", tag: "h1" }),
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe("otro_elemento");
  });

  /**
   * EL FRAGMENTO VIENE DEL NAVEGADOR. Se sanea sin excepción: un `<script>`
   * colado aquí sería código que alguien mete en una página publicada bajo un
   * subdominio nuestro. Es la misma regla que la ruta de guardado de siempre.
   */
  it("un <script> dentro del fragmento NO llega al documento", () => {
    const r = aplicarEdiciones(DOC, [
      edicion({ html: '<h1 id="t">Hola<script>fetch("/robar")</script></h1>' }),
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html).not.toContain("/robar");
    // Y el del MODELO, que ya estaba en el documento, sigue.
    expect(r.html).toContain("classList.add('lista')");
  });

  it("el marcador de modo-editor rechaza el lote entero", () => {
    const r = aplicarEdiciones(DOC, [
      edicion({ html: '<h1 id="t" data-slot-path="a">Hola</h1>' }),
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe("fragmento_rechazado");
  });

  /** TODO O NADA. Media edición aplicada es peor que ninguna: el usuario ve
   *  parte de su trabajo guardado y no tiene forma de saber qué falta. */
  it("si la segunda falla, la PRIMERA tampoco se guarda", () => {
    const r = aplicarEdiciones(DOC, [
      edicion(),
      edicion({ path: "aside:nth-of-type(9)" }),
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.indice).toBe(1);
  });
});

describe("el orden importa", () => {
  /**
   * Una edición se resuelve contra el documento que dejó la anterior, no
   * contra el original. Si la primera borra una sección, los índices
   * `nth-of-type` de la segunda son los de DESPUÉS de ese borrado — que es lo
   * que el usuario tenía delante cuando la hizo.
   */
  it("la segunda se resuelve contra el documento que dejó la primera", () => {
    const r = aplicarEdiciones(DOC, [
      // Borra el primer <article>…
      {
        op: "delete",
        path: "main:nth-of-type(1) > section:nth-of-type(1) > article:nth-of-type(1)",
        tag: "article",
        hijos: [],
      },
      // …y ahora "Dos" es el article nº1.
      {
        op: "replace",
        path: "main:nth-of-type(1) > section:nth-of-type(1) > article:nth-of-type(1)",
        tag: "article",
        hijos: [],
        html: "<article>Dos editado</article>",
      },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html).not.toContain("Uno");
    expect(r.html).toContain("Dos editado");
  });
});
