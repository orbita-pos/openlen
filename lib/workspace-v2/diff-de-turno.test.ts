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

  it("un <br> del encabezado separa palabras en la etiqueta", () => {
    const antes = "<body><header>x</header><section><h1>Bernal<br>Reformas<br>Integrales</h1><a>Ver servicios</a></section></body>";
    const despues = "<body><header>x</header><section><h1>Bernal<br>Reformas<br>Integrales</h1><a>Pide presupuesto</a></section></body>";
    expect(seccionesCambiadas(antes, despues)).toEqual([
      { tipo: "cambiada", etiqueta: "Bernal Reformas Integrales", indice: 1 },
    ]);
  });

  it("un trozo del encabezado que se pinta en su línea también separa palabras", () => {
    // Visto en la base de desarrollo (N28): AETHERBORN<span class="block">…</span>
    // sale en dos líneas y la etiqueta decía «AETHERBORNLeyendas del Aetherium».
    const h1 = '<h1>AETHERBORN<span class="block">Leyendas</span><span class="hidden md:block">del</span><div>Aetherium</div></h1>';
    const antes = `<body><section>${h1}<a>Jugar</a></section></body>`;
    const despues = `<body><section>${h1}<a>Jugar gratis</a></section></body>`;
    expect(seccionesCambiadas(antes, despues)[0].etiqueta).toBe("AETHERBORN Leyendas del Aetherium");
  });

  it("dos trozos EN LÍNEA sin espacio siguen pegados: así se pintan", () => {
    const h1 = '<h1>Solstice<span class="text-[color:var(--ol-accent)]">.</span> Tour<em class="inline-block">s</em></h1>';
    const antes = `<body><section>${h1}<a>a</a></section></body>`;
    const despues = `<body><section>${h1}<a>b</a></section></body>`;
    expect(seccionesCambiadas(antes, despues)[0].etiqueta).toBe("Solstice. Tours");
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

// LAS SECCIONES DENTRO DE UN CONTENEDOR. Medido en un turno real el 05/10: la
// página era `<main>` con sus `<section>` dentro, Len cambió «Dónde» y la
// tarjeta dijo «Cambió Horario» — el primer encabezado del `<main>`, que era lo
// único que este diff miraba. Ahora baja al contenedor y nombra la sección de
// verdad; `ruta` lleva al lienzo hasta ella (los de primer nivel no la traen).
describe("seccionesCambiadas dentro de un contenedor de secciones", () => {
  const HORARIO = "<section><h2>Horario</h2><p>Lunes a sábado</p></section>";
  const DONDE = "<section><h2>Dónde</h2><p>Av. Chapultepec 120</p></section>";
  const CARTA = "<section><h2>Carta de cafés</h2><p>Espresso $35</p></section>";
  const CABECERA = "<header><h1>Café Brío</h1></header>";
  const main = (...s: string[]) => `<main>${s.join("")}</main>`;

  it("🔴 el caso medido: cambiar «Dónde» dice «Dónde», no el primer encabezado del <main>", () => {
    const despues = doc(CABECERA, main(HORARIO, DONDE.replace("Av. Chapultepec 120", "Av. Chapultepec 122")));
    expect(seccionesCambiadas(doc(CABECERA, main(HORARIO, DONDE)), despues)).toEqual([
      { tipo: "cambiada", etiqueta: "Dónde", indice: 1, ruta: [1, 1] },
    ]);
  });

  it("una sección nueva dentro del <main> es una sección añadida, con su ruta", () => {
    expect(seccionesCambiadas(doc(CABECERA, main(HORARIO, DONDE)), doc(CABECERA, main(HORARIO, DONDE, CARTA)))).toEqual([
      { tipo: "anadida", etiqueta: "Carta de cafés", indice: 1, ruta: [1, 2] },
    ]);
  });

  it("también cuando el <main> tenía UNA sola sección y pasa a tener dos", () => {
    expect(seccionesCambiadas(doc(main(HORARIO)), doc(main(HORARIO, CARTA)))).toEqual([
      { tipo: "anadida", etiqueta: "Carta de cafés", indice: 0, ruta: [0, 1] },
    ]);
  });

  it("renombrar la PRIMERA sección no se lleva el <main> entero por delante", () => {
    const r = seccionesCambiadas(doc(main(HORARIO, DONDE)), doc(main(HORARIO.replace("Horario", "Horas"), DONDE)));
    expect(r.map((x) => `${x.tipo} ${x.etiqueta}`).sort()).toEqual(["anadida Horas", "quitada Horario"]);
    // La añadida es la SECCIÓN (dentro del <main>), no el <main> con otro nombre:
    // antes salía igual por casualidad, quitando y añadiendo el <main> entero.
    expect(r.find((x) => x.tipo === "anadida")).toEqual({ tipo: "anadida", etiqueta: "Horas", indice: 0, ruta: [0, 0] });
  });

  it("una sección quitada de dentro sale sin índice ni ruta", () => {
    expect(seccionesCambiadas(doc(main(HORARIO, DONDE, CARTA)), doc(main(HORARIO, CARTA)))).toEqual([
      { tipo: "quitada", etiqueta: "Dónde", indice: -1 },
    ]);
  });

  it("baja más de un nivel: <div id=app> → <main> → la sección", () => {
    const app = (...s: string[]) => `<div id="app">${CABECERA}${main(...s)}</div>`;
    expect(seccionesCambiadas(doc(app(HORARIO, DONDE)), doc(app(HORARIO, DONDE.replace("120", "122"))))).toEqual([
      { tipo: "cambiada", etiqueta: "Dónde", indice: 0, ruta: [0, 1, 1] },
    ]);
  });

  it("MOVER una sección dentro del <main> sin tocarla tampoco produce nada", () => {
    expect(seccionesCambiadas(doc(main(HORARIO, DONDE, CARTA)), doc(main(HORARIO, CARTA, DONDE)))).toEqual([]);
  });

  it("si lo que cambió es el contenedor mismo, se dice sin inventar un nombre", () => {
    const r = seccionesCambiadas(doc(main(HORARIO, DONDE)), doc(main(HORARIO, DONDE).replace("<main>", '<main class="bg-stone-50">')));
    expect(r).toEqual([{ tipo: "cambiada", etiqueta: "", indice: 0 }]);
  });

  it("BRAZO DE CONTROL: una sección con su encabezado y tarjetas dentro NO es un contenedor", () => {
    const rasgos = (c: string) =>
      `<section><h2>Por qué Brío</h2><div class="grid"><article><h3>Tostado</h3><p>${c}</p></article><article><h3>Origen</h3><p>Huatusco</p></article></div></section>`;
    expect(seccionesCambiadas(doc(CABECERA, rasgos("martes")), doc(CABECERA, rasgos("jueves")))).toEqual([
      { tipo: "cambiada", etiqueta: "Por qué Brío", indice: 1 },
    ]);
  });

  it("BRAZO DE CONTROL: la cabecera con su menú es UNA parte, no un contenedor", () => {
    const cab = (enlace: string) => `<header><nav><a>${enlace}</a></nav><div><h1>Café Brío</h1></div></header>`;
    expect(seccionesCambiadas(doc(cab("Carta")), doc(cab("Menú")))).toEqual([
      { tipo: "cambiada", etiqueta: "Café Brío", indice: 0 },
    ]);
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
