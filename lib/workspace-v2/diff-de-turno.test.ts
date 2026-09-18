import { describe, expect, it } from "vitest";
import { seccionesCambiadas, tipoDeOp, agruparCambios } from "./diff-de-turno";

const doc = (...secciones: string[]) =>
  `<!doctype html><html><body>${secciones.join("")}</body></html>`;

const HERO = '<header id="hero"><h1>Taller El Norte</h1></header>';
const PRECIOS = '<section id="precios"><h2>Precios</h2><p>Desde 40€</p></section>';
const PIE = "<footer><p>Calle Mayor 3</p></footer>";

describe("seccionesCambiadas", () => {
  it("un turno que no tocó nada no dice nada", () => {
    expect(seccionesCambiadas(doc(HERO, PRECIOS), doc(HERO, PRECIOS))).toEqual([]);
  });

  it("una sección editada sale como cambiada, con su encabezado por etiqueta", () => {
    const despues = doc(HERO, PRECIOS.replace("Desde 40€", "Desde 45€"));
    expect(seccionesCambiadas(doc(HERO, PRECIOS), despues)).toEqual([
      { tipo: "cambiada", etiqueta: "Precios", indice: 1 },
    ]);
  });

  it("una sección nueva trae el índice al que ir en el documento de DESPUÉS", () => {
    const r = seccionesCambiadas(doc(HERO, PIE), doc(HERO, PRECIOS, PIE));
    expect(r).toEqual([{ tipo: "anadida", etiqueta: "Precios", indice: 1 }]);
  });

  it("una sección borrada sale sin índice: ya no está, no hay a dónde ir", () => {
    const r = seccionesCambiadas(doc(HERO, PRECIOS, PIE), doc(HERO, PIE));
    expect(r).toEqual([{ tipo: "quitada", etiqueta: "Precios", indice: -1 }]);
  });

  it("MOVER una sección sin tocarla no produce nada — el usuario no perdió ni ganó", () => {
    expect(seccionesCambiadas(doc(HERO, PRECIOS, PIE), doc(HERO, PIE, PRECIOS))).toEqual([]);
  });

  it("reformatear no es cambiar: los espacios se colapsan", () => {
    const espaciado = '<section id="precios">\n  <h2>Precios</h2>\n  <p>Desde 40€</p>\n</section>';
    expect(seccionesCambiadas(doc(PRECIOS), doc(espaciado))).toEqual([]);
  });

  it("sin id ni encabezado, la etiqueta cae a la etiqueta HTML y se emparejan por orden", () => {
    const a = doc("<section><p>uno</p></section>", "<section><p>dos</p></section>");
    const b = doc("<section><p>uno</p></section>", "<section><p>DOS</p></section>");
    expect(seccionesCambiadas(a, b)).toEqual([
      { tipo: "cambiada", etiqueta: "section", indice: 1 },
    ]);
  });

  it("un id sirve de etiqueta cuando no hay encabezado", () => {
    const a = doc('<section id="mapa"><p>a</p></section>');
    const b = doc('<section id="mapa"><p>b</p></section>');
    expect(seccionesCambiadas(a, b)[0]).toMatchObject({ etiqueta: "#mapa", tipo: "cambiada" });
  });

  it("una etiqueta larga se recorta a una línea", () => {
    const largo = "<section><h2>" + "Muy ".repeat(30) + "largo</h2></section>";
    const r = seccionesCambiadas(doc("<section><h2>x</h2></section>"), doc(largo));
    expect(r[0].etiqueta.length).toBeLessThanOrEqual(42);
    expect(r[0].etiqueta).not.toContain("\n");
  });

  it("renombrar una sección sale como quitada + añadida, y eso es HONESTO: el diff adivina", () => {
    const a = doc('<section id="precios"><h2>Precios</h2></section>');
    const b = doc('<section id="tarifas"><h2>Tarifas</h2></section>');
    const r = seccionesCambiadas(a, b);
    expect(r.map((x) => x.tipo).sort()).toEqual(["anadida", "quitada"]);
  });

  it("un documento vacío o ilegible no rompe nada: no se sabe, y punto", () => {
    expect(seccionesCambiadas("", "")).toEqual([]);
    expect(seccionesCambiadas("", doc(HERO))).toEqual([
      { tipo: "anadida", etiqueta: "Taller El Norte", indice: 0 },
    ]);
  });

  it("un rediseño entero se cuenta entero — recortarlo es cosa de quien lo pinta", () => {
    const a = doc(HERO, PRECIOS, PIE);
    const b = doc(
      '<header id="hero"><h1>Otro</h1></header>',
      '<section id="precios"><h2>Precios</h2><p>Otro</p></section>',
      "<footer><p>Otra</p></footer>",
    );
    // TRES, no cuatro: el hero conserva su `id`, así que se EMPAREJA y sale
    // «cambiada» aunque su titular sea otro. Es justo lo que se quiere — un id
    // estable es la mejor identidad que hay, mejor que el texto.
    expect(seccionesCambiadas(a, b).length).toBe(3);
  });
});

// 🔴 EL MAPEO DE LOS SEIS VERBOS. Sin esto, `attrs` y `text` -- las dos que el
// modelo usa para cambiar un `href` o el texto de un nodo, o sea el caso mas
// comun -- se pintaban «anadida». Visto en produccion el 2026-09-17: cambiar un
// numero de WhatsApp salia como seis altas y ninguna mencionaba el telefono.
//
// La lista es la de `OpType` en lib/html-ops.ts. Si alguien anade un verbo alli
// y no lo piensa aqui, cae en el defecto -- y el defecto es «cambiada», que es
// el lado seguro: decir «cambie» de mas molesta; decir «anadi» manda al usuario
// a buscar contenido nuevo que no existe.
describe("tipoDeOp", () => {
  it("solo los dos insert_* son altas de verdad", () => {
    expect(tipoDeOp("insert_before")).toBe("anadida");
    expect(tipoDeOp("insert_after")).toBe("anadida");
  });

  it("delete es baja", () => {
    expect(tipoDeOp("delete")).toBe("quitada");
  });

  it("replace, attrs y text son MODIFICACIONES, no altas", () => {
    expect(tipoDeOp("replace")).toBe("cambiada");
    expect(tipoDeOp("attrs")).toBe("cambiada");
    expect(tipoDeOp("text")).toBe("cambiada");
  });

  it("un verbo que nadie penso cae del lado seguro", () => {
    expect(tipoDeOp("loquesea" as never)).toBe("cambiada");
  });
});

// UNA FILA POR SECCION, NO POR OPERACION. Cambiar un telefono son tres ops en
// la misma seccion -- el `tel:`, el `wa.me` y el texto -- y la lista pintaba el
// nombre de la seccion tres veces seguidas. Se lee como si algo se hubiera
// duplicado, y lo unico duplicado era la fila.
describe("agruparCambios", () => {
  const c = (tipo: "anadida" | "quitada" | "cambiada", etiqueta: string, indice = 0) =>
    ({ tipo, etiqueta, indice });

  it("tres ops en la misma seccion son UNA fila que dice tres", () => {
    expect(agruparCambios([c("cambiada", "Donde estamos"), c("cambiada", "Donde estamos"), c("cambiada", "Donde estamos")]))
      .toEqual([{ tipo: "cambiada", etiqueta: "Donde estamos", indice: 0, veces: 3 }]);
  });

  it("secciones distintas no se juntan, y el orden es el del turno", () => {
    const r = agruparCambios([c("cambiada", "Pie"), c("cambiada", "Hero"), c("cambiada", "Pie")]);
    expect(r.map((x) => x.etiqueta)).toEqual(["Pie", "Hero"]);
    expect(r[0].veces).toBe(2);
    expect(r[1].veces).toBe(1);
  });

  it("el MISMO nombre con verbo distinto NO se junta: son cosas distintas", () => {
    const r = agruparCambios([c("cambiada", "Precios"), c("quitada", "Precios", -1)]);
    expect(r).toHaveLength(2);
  });

  it("se queda con el primer indice QUE SIRVE, para que «ver» no muera", () => {
    // El primero es un delete (-1, no hay a donde ir) y el segundo si tiene sitio.
    const r = agruparCambios([c("cambiada", "Pie", -1), c("cambiada", "Pie", 4)]);
    expect(r[0]).toEqual({ tipo: "cambiada", etiqueta: "Pie", indice: 4, veces: 2 });
  });

  it("sin nombre tampoco se juntan dos secciones distintas por casualidad", () => {
    const r = agruparCambios([c("cambiada", "", 1), c("cambiada", "", 2)]);
    expect(r).toHaveLength(2);
  });

  it("una lista vacia no inventa filas", () => {
    expect(agruparCambios([])).toEqual([]);
  });
});
