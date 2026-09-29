import { describe, expect, it } from "vitest";

import {
  aplicarEdiciones,
  type Edicion,
  type EdicionDeElemento,
} from "./aplicar-ediciones";

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

const edicion = (p: Partial<EdicionDeElemento> = {}): EdicionDeElemento => ({
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

// LO QUE NO ES UN ELEMENTO DEL CUERPO.
//
// El selector de tema, las tipografías y los metadatos de la página no tocan
// nada dentro del <body>: escriben en el <html> y en el <head>. No tienen ruta
// posicional, y sin estas dos operaciones el inspector tendría que seguir
// mandando el documento entero para cambiar un color de acento — que es
// justamente lo que obliga a congelar el JavaScript del modelo.
describe("los atributos del elemento raíz", () => {
  const CON_RAIZ = DOC.replace("<html>", '<html lang="es" data-ol-mode="light">');

  it("cambian el tema sin tocar el resto del documento", () => {
    const r = aplicarEdiciones(CON_RAIZ, [
      { op: "attrs_raiz", attrs: { "data-ol-mode": "dark", style: "--ol-accent:#c72e10" } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html).toContain('data-ol-mode="dark"');
    expect(r.html).toContain("--ol-accent:#c72e10");
    expect(r.html).toContain("Tinta que dura");
    expect(r.html).toContain("classList.add('lista')");
  });

  /** SÓLO LOS NOMBRADOS. Mandar el conjunto entero convertiría un cambio de
   *  acento en una reescritura de la raíz — y ahí vive el `lang`, que decide
   *  el idioma de la página. */
  it("y NO tocan los atributos que no vienen en la lista", () => {
    const r = aplicarEdiciones(CON_RAIZ, [{ op: "attrs_raiz", attrs: { style: "x" } }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html).toContain('lang="es"');
    expect(r.html).toContain('data-ol-mode="light"');
  });

  it("un valor nulo QUITA el atributo", () => {
    const r = aplicarEdiciones(CON_RAIZ, [
      { op: "attrs_raiz", attrs: { "data-ol-mode": null } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html).not.toContain("data-ol-mode");
    expect(r.html).toContain('lang="es"');
  });
});

describe("los nodos de la cabeza", () => {
  /** Dos títulos no son un añadido: son un documento roto del que el navegador
   *  elige uno y nadie sabe cuál. `applyHeadOp` ya lo resolvía para el modelo. */
  it("un <title> nuevo REEMPLAZA al que había", () => {
    const r = aplicarEdiciones(DOC, [
      { op: "cabeza", html: "<title>Aguja Negra — Tatuajes</title>" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html.split("<title").length - 1).toBe(1);
    expect(r.html).toContain("Aguja Negra — Tatuajes");
  });

  it("una hoja de fuentes se añade", () => {
    const r = aplicarEdiciones(DOC, [
      { op: "cabeza", html: '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">' },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html).toContain("fonts.googleapis.com");
  });

  /** También viene del navegador. Un `<script>` en la cabeza correría en la
   *  página publicada de todo el que la visite. */
  it("y también se sanea: un <script> no llega", () => {
    const r = aplicarEdiciones(DOC, [
      { op: "cabeza", html: '<script>fetch("/robar")</script>' },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html).not.toContain("/robar");
  });
});

describe("reemplazar en la cabeza por atributo", () => {
  const CON_FUENTE =
    DOC.replace(
      "<title>",
      '<link rel="stylesheet" data-ol-fonts href="https://fonts.googleapis.com/css2?family=Vieja"><title>',
    );

  /** `applyHeadOp` sólo reemplaza `<title>` y `<meta name>`. Un `<link>` cuyo
   *  href cambia se añadiría AL LADO del anterior, y la página acabaría
   *  cargando las dos tipografías y pintando la primera. */
  it("cambiar de tipografía deja UN solo <link>, no dos", () => {
    const r = aplicarEdiciones(CON_FUENTE, [
      {
        op: "cabeza",
        reemplazarPorAtributo: "data-ol-fonts",
        html: '<link rel="stylesheet" data-ol-fonts href="https://fonts.googleapis.com/css2?family=Nueva">',
      },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html).toContain("family=Nueva");
    expect(r.html).not.toContain("family=Vieja");
    expect(r.html.split("data-ol-fonts").length - 1).toBe(1);
  });

  /** Volver a la tipografía autorada: se quita y no se pone nada. */
  it("y sin nodos nuevos, sólo quita", () => {
    const r = aplicarEdiciones(CON_FUENTE, [
      { op: "cabeza", reemplazarPorAtributo: "data-ol-fonts", html: "" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html).not.toContain("data-ol-fonts");
    expect(r.html).toContain("<title>Aguja Negra</title>");
  });

  /** Un `<style>` tiene cierre; un `<link>` no. Los dos tienen que irse. */
  it("quita también los elementos CON cierre", () => {
    const conTematica = DOC.replace(
      "<title>",
      '<style data-ol-tematica="y2k">body{filter:hue-rotate(90deg)}</style><title>',
    );
    const r = aplicarEdiciones(conTematica, [
      { op: "cabeza", reemplazarPorAtributo: "data-ol-tematica", html: "" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html).not.toContain("hue-rotate");
    expect(r.html).not.toContain("data-ol-tematica");
  });
});

// LOS METADATOS DE LA PÁGINA. `applyHeadOp` reemplaza `<title>` y
// `<meta name>`, pero no `<meta property>` ni el favicon: para ésos hace falta
// acotar por nombre Y valor, o `property` se llevaría por delante todas las
// etiquetas Open Graph de la página.
describe("reemplazar en la cabeza acotando por valor", () => {
  const CON_META =
    DOC.replace(
      "<title>",
      '<meta property="og:image" content="vieja.jpg">' +
        '<meta property="og:title" content="Aguja Negra">' +
        '<meta name="description" content="Estudio">' +
        "<title>",
    );

  it("cambia la imagen social sin tocar las demás etiquetas og:", () => {
    const r = aplicarEdiciones(CON_META, [
      {
        op: "cabeza",
        reemplazarPorAtributo: "property=og:image",
        html: '<meta property="og:image" content="nueva.jpg">',
      },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html).toContain("nueva.jpg");
    expect(r.html).not.toContain("vieja.jpg");
    expect(r.html, "se llevó por delante el og:title").toContain("og:title");
  });

  /** Borrar la descripción es mandar la sustitución SIN nodo nuevo. */
  it("y con html vacío, borra sólo esa", () => {
    const r = aplicarEdiciones(CON_META, [
      { op: "cabeza", reemplazarPorAtributo: "name=description", html: "" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html).not.toContain("Estudio");
    expect(r.html).toContain("og:image");
    expect(r.html).toContain("<title>Aguja Negra</title>");
  });

  /** Un valor que no está no quita nada — ni siquiera el atributo suelto. */
  it("un valor que no existe deja el documento igual", () => {
    const r = aplicarEdiciones(CON_META, [
      { op: "cabeza", reemplazarPorAtributo: "property=og:video", html: "" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html).toBe(CON_META);
  });
});

// MOVER. Reordenar secciones no es ni un replace ni un delete: es las dos
// cosas, y hacerlas por separado tiene una trampa — en cuanto la primera mitad
// se aplica, los índices `nth-of-type` de la segunda ya no son los que el
// navegador calculó. Por eso el movimiento viaja entero.
describe("mover un elemento junto a otro", () => {
  const TRES =
    "<!doctype html><html><head><title>t</title></head><body>" +
    "<main>" +
    "<section id=a>Uno</section>" +
    "<section id=b>Dos</section>" +
    "<section id=c>Tres</section>" +
    "</main></body></html>";

  const enMain = (n: number) =>
    "main:nth-of-type(1) > section:nth-of-type(" + n + ")";

  it("sube una sección por encima de la anterior", () => {
    const r = aplicarEdiciones(TRES, [
      {
        op: "mover",
        path: enMain(3),
        tag: "section",
        hijos: [],
        destino: enMain(2),
        destinoTag: "section",
        destinoHijos: [],
        posicion: "antes",
      },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html.indexOf("Tres")).toBeLessThan(r.html.indexOf("Dos"));
    expect(r.html.indexOf("Uno")).toBeLessThan(r.html.indexOf("Tres"));
  });

  it("y la baja por debajo de la siguiente", () => {
    const r = aplicarEdiciones(TRES, [
      {
        op: "mover",
        path: enMain(1),
        tag: "section",
        hijos: [],
        destino: enMain(2),
        destinoTag: "section",
        destinoHijos: [],
        posicion: "despues",
      },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html.indexOf("Dos")).toBeLessThan(r.html.indexOf("Uno"));
    expect(r.html.indexOf("Uno")).toBeLessThan(r.html.indexOf("Tres"));
  });

  /** NI UNA COPIA NI UN HUECO. El fallo que este diseño evita es justo éste:
   *  media operación deja la sección duplicada o perdida. */
  it("la sección sigue existiendo UNA vez", () => {
    const r = aplicarEdiciones(TRES, [
      {
        op: "mover",
        path: enMain(1),
        tag: "section",
        hijos: [],
        destino: enMain(3),
        destinoTag: "section",
        destinoHijos: [],
        posicion: "despues",
      },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html.split("Uno").length - 1).toBe(1);
    expect(r.html.split("<section").length - 1).toBe(3);
  });

  /** Y las dos rutas pasan la MISMA barrera que las demás ediciones: si el
   *  destino ya no es lo que el navegador vio, no se mueve nada. */
  it("un destino que ya no encaja rechaza el movimiento entero", () => {
    const r = aplicarEdiciones(TRES, [
      {
        op: "mover",
        path: enMain(1),
        tag: "section",
        hijos: [],
        destino: enMain(2),
        destinoTag: "article",
        destinoHijos: [],
        posicion: "antes",
      },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe("otro_elemento");
  });

  it("y moverse sobre sí mismo se rechaza en vez de perder la sección", () => {
    const r = aplicarEdiciones(TRES, [
      {
        op: "mover",
        path: enMain(2),
        tag: "section",
        hijos: [],
        destino: enMain(2),
        destinoTag: "section",
        destinoHijos: [],
        posicion: "antes",
      },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe("otro_elemento");
  });
});

describe("unos atributos, sin que viaje el subarbol", () => {
  // Una tarjeta con hijos DENTRO. Lo que se mide es que los hijos sigan siendo
  // los del documento guardado por mucho que el navegador mande otra cosa.
  const TARJETA =
    "<!doctype html><html><head><title>t</title></head><body>" +
    '<main><section><article class="c" data-x="1">' +
    "<h3>Blackwork</h3><p>Lineas finas</p>" +
    "</article></section></main>" +
    "</body></html>";

  const ruta = "main:nth-of-type(1) > section:nth-of-type(1) > article:nth-of-type(1)";

  it("cambia el atributo nombrado y deja el resto de la apertura en paz", () => {
    const r = aplicarEdiciones(TARJETA, [
      {
        op: "atributos",
        path: ruta,
        tag: "article",
        hijos: ["h3", "p"],
        attrs: { style: "color: var(--ol-fg) !important" },
      },
    ]);
    expect(r.ok, r.ok ? "" : `${r.motivo}: ${r.detalle}`).toBe(true);
    if (!r.ok) return;
    expect(r.html).toContain("color: var(--ol-fg) !important");
    // La clase y el data- que ya tenia siguen ahi: no se manda el conjunto.
    expect(r.html).toContain('class="c"');
    expect(r.html).toContain('data-x="1"');
  });

  it("y los hijos salen del documento GUARDADO, no de la pantalla", () => {
    const r = aplicarEdiciones(TARJETA, [
      {
        op: "atributos",
        path: ruta,
        tag: "article",
        hijos: ["h3", "p"],
        attrs: { "data-ol-reink": "" },
      },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html).toContain("<h3>Blackwork</h3>");
    expect(r.html).toContain("<p>Lineas finas</p>");
  });

  /**
   * EL BRAZO DE CONTROL, y la razon de que esta op exista.
   *
   * Un `replace` manda el outerHTML leido del DOM VIVO. Si el script del modelo
   * le habia puesto un `hidden` a un hijo, eso entra y se persiste. Aqui se
   * simula exactamente eso: el mismo cambio de atributo, mandado de las dos
   * formas. Por `replace` la mentira del script aterriza; por `atributos` no
   * puede, porque el subarbol no viaja.
   */
  it("un replace SI se lleva lo que el script hizo en pantalla; atributos no", () => {
    const comoLoViOElNavegador =
      '<article class="c" data-x="1" style="color: red">' +
      '<h3 hidden>Blackwork</h3><p>Lineas finas</p>' +
      "</article>";

    const conReplace = aplicarEdiciones(TARJETA, [
      { op: "replace", path: ruta, tag: "article", hijos: ["h3", "p"], html: comoLoViOElNavegador },
    ]);
    expect(conReplace.ok).toBe(true);
    if (!conReplace.ok) return;
    expect(conReplace.html).toContain("hidden");

    const conAtributos = aplicarEdiciones(TARJETA, [
      {
        op: "atributos",
        path: ruta,
        tag: "article",
        hijos: ["h3", "p"],
        attrs: { style: "color: red" },
      },
    ]);
    expect(conAtributos.ok).toBe(true);
    if (!conAtributos.ok) return;
    expect(conAtributos.html).toContain("color: red");
    expect(conAtributos.html).not.toContain("hidden");
  });

  it("un valor vacio QUITA el atributo", () => {
    const r = aplicarEdiciones(TARJETA, [
      { op: "atributos", path: ruta, tag: "article", hijos: ["h3", "p"], attrs: { "data-x": null } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html).not.toContain("data-x");
    expect(r.html).toContain('class="c"');
  });

  it("y una ruta que lleva a otro elemento se rechaza como las demas", () => {
    const r = aplicarEdiciones(TARJETA, [
      { op: "atributos", path: ruta, tag: "div", hijos: ["h3", "p"], attrs: { style: "x" } },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe("otro_elemento");
  });

  // Decenas de elementos a la vez es EL caso de uso: la re-tinta de una
  // tematica toca todo el cuerpo. Se encadenan como cualquier otra edicion.
  it("muchas seguidas se encadenan", () => {
    const r = aplicarEdiciones(TARJETA, [
      {
        op: "atributos",
        path: ruta + " > h3:nth-of-type(1)",
        tag: "h3",
        hijos: [],
        attrs: { style: "color: a", "data-ol-reink": "" },
      },
      {
        op: "atributos",
        path: ruta + " > p:nth-of-type(1)",
        tag: "p",
        hijos: [],
        attrs: { style: "color: b", "data-ol-reink": "" },
      },
    ]);
    expect(r.ok, r.ok ? "" : `${r.motivo}: ${r.detalle}`).toBe(true);
    if (!r.ok) return;
    expect(r.html).toContain("color: a");
    expect(r.html).toContain("color: b");
    expect(r.html.match(/data-ol-reink/g)?.length).toBe(2);
  });
});

describe("la tanda de atributos pasa por el motor, no por un regex", () => {
  /**
   * EL BUG QUE MATABA LA TANDA ENTERA (medido el 2026-09-01).
   *
   * `reescribirAperturaPorOpId` buscaba la apertura con
   * `<[a-zA-Z][\w-]*\b[^>]*\sdata-op-id="…"[^>]*>`, y ese `[^>]*` no cruza un
   * `>`. Con un `alt="Antes > Despues"` en la pagina, devolvia null sobre ESE
   * elemento — y el taller convertia eso en `fragmento_rechazado`, que tumba la
   * tanda ENTERA. O sea: una re-tinta de tematica que toca decenas de elementos
   * se caia del todo porque un alt llevaba un `>` en el texto.
   */
  const CON_MAYOR =
    "<!doctype html><html><head><title>t</title></head><body>" +
    '<main><section><img alt="Antes > Despues" src="a.png">' +
    '<article class="c"><h3>Uno</h3><p>Dos</p></article>' +
    "</section></main></body></html>";

  const rutaImg = "main:nth-of-type(1) > section:nth-of-type(1) > img:nth-of-type(1)";
  const rutaArt = "main:nth-of-type(1) > section:nth-of-type(1) > article:nth-of-type(1)";

  it("un > dentro de un atributo ya no tumba la edicion de ese elemento", () => {
    const r = aplicarEdiciones(CON_MAYOR, [
      {
        op: "atributos",
        path: rutaImg,
        tag: "img",
        hijos: [],
        attrs: { style: "border-radius: 8px" },
      },
    ]);
    expect(r.ok, r.ok ? "" : `${r.motivo}: ${r.detalle}`).toBe(true);
    if (!r.ok) return;
    expect(r.html).toContain("border-radius: 8px");
    expect(r.html).toContain('alt="Antes > Despues"');
  });

  it("y tampoco tumba a los DEMAS elementos de la misma tanda", () => {
    const r = aplicarEdiciones(CON_MAYOR, [
      {
        op: "atributos",
        path: rutaImg,
        tag: "img",
        hijos: [],
        attrs: { style: "border-radius: 8px" },
      },
      {
        op: "atributos",
        path: rutaArt,
        tag: "article",
        hijos: ["h3", "p"],
        attrs: { style: "color: red", "data-ol-reink": "" },
      },
    ]);
    expect(r.ok, r.ok ? "" : `${r.motivo}: ${r.detalle}`).toBe(true);
    if (!r.ok) return;
    expect(r.html).toContain("border-radius: 8px");
    expect(r.html).toContain("color: red");
    expect(r.html).toContain('data-ol-reink=""');
    expect(r.html).toContain("<h3>Uno</h3>");
  });

  it("una tanda anidada no se pisa a si misma", () => {
    // section, article y h3 unos dentro de otros, los tres en la misma tanda.
    const r = aplicarEdiciones(CON_MAYOR, [
      {
        op: "atributos",
        path: "main:nth-of-type(1) > section:nth-of-type(1)",
        tag: "section",
        hijos: ["img", "article"],
        attrs: { style: "a: 1" },
      },
      {
        op: "atributos",
        path: rutaArt,
        tag: "article",
        hijos: ["h3", "p"],
        attrs: { style: "b: 2" },
      },
      {
        op: "atributos",
        path: `${rutaArt} > h3:nth-of-type(1)`,
        tag: "h3",
        hijos: [],
        attrs: { style: "c: 3" },
      },
    ]);
    expect(r.ok, r.ok ? "" : `${r.motivo}: ${r.detalle}`).toBe(true);
    if (!r.ok) return;
    expect(r.html).toContain("a: 1");
    expect(r.html).toContain("b: 2");
    expect(r.html).toContain("c: 3");
  });
});

// EL `Edit` DE CLAUDE CODE, en el taller (2026-09-29). Del navegador viajan el
// texto que había y el que va; el elemento sale del documento GUARDADO. Con el
// `replace`, cambiarle el texto a un botón le quitaba el `onclick` del modelo.
describe("el texto viaja solo, como old_string/new_string", () => {
  const TIENDA =
    "<!doctype html><html><head><title>t</title></head><body>" +
    '<main><section id="tienda"><h2>Tienda</h2>' +
    '<button class="btn" onclick="agregar(1)">Agregar</button>' +
    '<p>Envío <strong onclick="info()">gratis</strong> desde $500</p>' +
    '<iframe src="https://open.spotify.com/embed/track/x"></iframe>' +
    "<script>function agregar(n){}</script>" +
    "</section></main></body></html>";
  const seccion = "main:nth-of-type(1) > section:nth-of-type(1)";

  it("cambiar el texto de un botón le deja el onclick", () => {
    const r = aplicarEdiciones(TIENDA, [
      {
        op: "texto",
        modo: "elemento",
        path: `${seccion} > button:nth-of-type(1)`,
        tag: "button",
        hijos: [],
        antes: "Agregar",
        despues: "Añadir",
      },
    ]);
    expect(r.ok, r.ok ? "" : `${r.motivo}: ${r.detalle}`).toBe(true);
    if (!r.ok) return;
    expect(r.html).toContain('<button class="btn" onclick="agregar(1)">Añadir</button>');
  });

  it("un trozo de un párrafo con marcas: el resto, byte a byte", () => {
    const r = aplicarEdiciones(TIENDA, [
      {
        op: "texto",
        modo: "nodo",
        path: `${seccion} > p:nth-of-type(1)`,
        tag: "p",
        hijos: ["strong"],
        antes: " desde $500",
        despues: " desde $400",
      },
    ]);
    expect(r.ok, r.ok ? "" : `${r.motivo}: ${r.detalle}`).toBe(true);
    if (!r.ok) return;
    expect(r.html).toContain('<p>Envío <strong onclick="info()">gratis</strong> desde $400</p>');
    // Lo que el replace se llevaba por delante, aquí sigue:
    expect(r.html).toContain('<iframe src="https://open.spotify.com/embed/track/x"></iframe>');
    expect(r.html).toContain("<script>function agregar(n){}</script>");
  });

  it("si el texto guardado ya no es el que se editó, rechaza el lote", () => {
    const r = aplicarEdiciones(TIENDA, [
      {
        op: "texto",
        modo: "elemento",
        path: `${seccion} > button:nth-of-type(1)`,
        tag: "button",
        hijos: [],
        antes: "Agregado ✓",
        despues: "Añadir",
      },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe("texto_no_encontrado");
  });
});

describe("los atributos que cambia el inspector, sin que viaje el elemento", () => {
  const DOC_BOTON =
    "<!doctype html><html><head><title>t</title></head><body>" +
    '<main><section style="padding:2rem"><a class="btn" onclick="track()" href="/">Pedir</a>' +
    '<img src="/a.jpg" alt="vieja"></section></main></body></html>';
  const seccion = "main:nth-of-type(1) > section:nth-of-type(1)";

  it("el fondo de la sección cambia y el onclick de dentro sigue", () => {
    const r = aplicarEdiciones(DOC_BOTON, [
      { op: "atributos", path: seccion, tag: "section", hijos: ["a", "img"], attrs: { style: "padding:2rem; background-color: #111" } },
    ]);
    expect(r.ok, r.ok ? "" : `${r.motivo}: ${r.detalle}`).toBe(true);
    if (!r.ok) return;
    expect(r.html).toContain("background-color: #111");
    expect(r.html).toContain('onclick="track()"');
  });

  it("el enlace, el texto alternativo y la foto entran; el onclick de la apertura se queda", () => {
    const r = aplicarEdiciones(DOC_BOTON, [
      {
        op: "atributos",
        path: `${seccion} > a:nth-of-type(1)`,
        tag: "a",
        hijos: [],
        attrs: { href: "https://wa.me/5233?text=hola&x=1", target: "_blank", rel: "noopener noreferrer" },
      },
      { op: "atributos", path: `${seccion} > img:nth-of-type(1)`, tag: "img", hijos: [], attrs: { src: "/b.jpg", alt: "nueva" } },
    ]);
    expect(r.ok, r.ok ? "" : `${r.motivo}: ${r.detalle}`).toBe(true);
    if (!r.ok) return;
    // El `&` va escapado: el navegador lo vuelve a leer como `&`.
    expect(r.html).toContain('href="https://wa.me/5233?text=hola&amp;x=1"');
    expect(r.html).toContain('onclick="track()"');
    expect(r.html).toContain('src="/b.jpg"');
    expect(r.html).toContain('alt="nueva"');
  });

  it("un onclick sigue sin poder entrar por aquí", () => {
    const r = aplicarEdiciones(DOC_BOTON, [
      { op: "atributos", path: `${seccion} > a:nth-of-type(1)`, tag: "a", hijos: [], attrs: { onclick: "robar()" } },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe("fragmento_rechazado");
  });

  it.each([
    ["javascript:robar()"],
    ["  JaVaScRiPt:robar()"],
    // El saneador solo no lo ve; el navegador quita el tabulador y lo ejecuta.
    ["java\tscript:robar()"],
    ["vbscript:x"],
  ])("un href que ejecuta (%j) se rechaza", (href) => {
    const r = aplicarEdiciones(DOC_BOTON, [
      { op: "atributos", path: `${seccion} > a:nth-of-type(1)`, tag: "a", hijos: [], attrs: { href } },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.motivo).toBe("fragmento_rechazado");
  });

  it("una entidad que llega como texto literal se escribe escapada, no se decodifica", () => {
    // En el DOM el valor ES `jav&#x61;script:x`, con el `&` literal. Escrito
    // tal cual, el navegador lo decodificaría a `javascript:x`.
    const r = aplicarEdiciones(DOC_BOTON, [
      { op: "atributos", path: `${seccion} > a:nth-of-type(1)`, tag: "a", hijos: [], attrs: { href: "jav&#x61;script:x" } },
    ]);
    expect(r.ok, r.ok ? "" : `${r.motivo}: ${r.detalle}`).toBe(true);
    if (!r.ok) return;
    expect(r.html).toContain('href="jav&amp;#x61;script:x"');
  });
});

// LOS CAMBIOS DE FORMA: el marcado nuevo viene del navegador; lo que ya estaba
// dentro, del documento guardado (ver conservar-contenido.ts).
describe("lo que ya estaba dentro lo pone el servidor, también al cambiar la forma", () => {
  const CARRITO =
    "<!doctype html><html><head><title>t</title></head><body><main>" +
    '<section class="menu"><h2>Menú</h2><button onclick="agregar(1)">Agregar</button>' +
    '<iframe src="https://open.spotify.com/embed/x"></iframe><script>function agregar(n){}</script></section>' +
    "</main></body></html>";
  const seccion = "main:nth-of-type(1) > section:nth-of-type(1)";

  it("imagen junto al texto: la columna es nueva, el contenido sale guardado con su onclick", () => {
    const r = aplicarEdiciones(CARRITO, [
      {
        op: "replace",
        path: seccion,
        tag: "section",
        hijos: ["h2", "button", "iframe", "script"],
        html:
          '<section class="menu ol-split"><div><ol-conservar></ol-conservar></div>' +
          '<div class="ol-split-media"><img src="/foto.jpg" alt=""></div></section>',
      },
    ]);
    expect(r.ok, r.ok ? "" : `${r.motivo}: ${r.detalle}`).toBe(true);
    if (!r.ok) return;
    expect(r.html).toContain(
      '<section class="menu ol-split"><div><h2>Menú</h2><button onclick="agregar(1)">Agregar</button>' +
        '<iframe src="https://open.spotify.com/embed/x"></iframe><script>function agregar(n){}</script></div>' +
        '<div class="ol-split-media"><img src="/foto.jpg" alt=""></div></section>',
    );
  });

  it("quitarla: sale el contenido de la columna nº 0, guardado", () => {
    const PARTIDA = CARRITO.replace(
      '<section class="menu">',
      '<section class="menu ol-split"><div>',
    ).replace("</script></section>", '</script></div><div class="ol-split-media"><img src="/f.jpg"></div></section>');
    const r = aplicarEdiciones(PARTIDA, [
      {
        op: "replace",
        path: seccion,
        tag: "section",
        hijos: ["div", "div"],
        html: '<section class="menu"><ol-conservar data-hijo="0"></ol-conservar></section>',
      },
    ]);
    expect(r.ok, r.ok ? "" : `${r.motivo}: ${r.detalle}`).toBe(true);
    if (!r.ok) return;
    expect(r.html).toContain(CARRITO.slice(CARRITO.indexOf("<section"), CARRITO.indexOf("</main>")));
  });

  it("el marcado nuevo SÍ se sanea: un onclick nuevo no entra", () => {
    const r = aplicarEdiciones(CARRITO, [
      {
        op: "replace",
        path: seccion,
        tag: "section",
        hijos: ["h2", "button", "iframe", "script"],
        html: '<section class="menu" onclick="robar()"><ol-conservar></ol-conservar></section>',
      },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html).not.toContain("robar");
    expect(r.html).toContain('onclick="agregar(1)"');
  });

  it("un hijo que no existe rechaza el lote, y una marca en una inserción también", () => {
    const hijoMalo = aplicarEdiciones(CARRITO, [
      {
        op: "replace",
        path: seccion,
        tag: "section",
        hijos: ["h2", "button", "iframe", "script"],
        html: '<section><ol-conservar data-hijo="9"></ol-conservar></section>',
      },
    ]);
    expect(hijoMalo.ok).toBe(false);
    const enInsercion = aplicarEdiciones(CARRITO, [
      {
        op: "insert_after",
        path: seccion,
        tag: "section",
        hijos: ["h2", "button", "iframe", "script"],
        html: "<section><ol-conservar></ol-conservar></section>",
      },
    ]);
    expect(enInsercion.ok).toBe(false);
    if (enInsercion.ok) return;
    expect(enInsercion.motivo).toBe("fragmento_rechazado");
  });
});
