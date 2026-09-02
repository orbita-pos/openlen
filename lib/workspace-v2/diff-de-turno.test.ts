import { describe, expect, it } from "vitest";
import { seccionesCambiadas } from "./diff-de-turno";

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
