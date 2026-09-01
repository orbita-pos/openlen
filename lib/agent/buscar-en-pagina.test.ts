import { describe, expect, it } from "vitest";

import { buscarEnDocumento, TOPE_COINCIDENCIAS } from "./buscar-en-pagina";

/**
 * El documento llega YA ETIQUETADO — el etiquetador es el binding nativo y
 * estas pruebas corren en vitest. Se escriben los `data-op-id` a mano, que es
 * además lo que deja fijar exactamente qué id se espera en cada caso.
 */
const DOC = `<!doctype html>
<html lang="es">
<head>
  <title>Taller Bernal — chapa y pintura</title>
  <meta name="description" content="Taller Bernal en Madrid. Llama al 600 11 22 33.">
  <style>.bg-azul { background: #2244ff; }</style>
</head>
<body data-op-id="a">
  <header data-op-id="b" class="bg-azul">
    <h1 data-op-id="c">Taller Bernal</h1>
    <a data-op-id="d" href="/nosotros">Quiénes somos</a>
  </header>
  <section data-op-id="e">
    <p data-op-id="f">Teléfono: 600 11 22 33. Llámanos y te atendemos hoy mismo, sin cita previa.</p>
    <p data-op-id="g">Escríbenos a <strong data-op-id="h">hola@taller.es</strong> si lo prefieres.</p>
    <img data-op-id="i" src="/coche.webp" alt="Un coche azul en el taller">
  </section>
  <script>const tel = "600 11 22 33";</script>
</body>
</html>`;

const buscar = (texto: string, tope?: number) =>
  buscarEnDocumento(DOC, texto, { pagina: "principal", tope });

describe("buscarEnDocumento", () => {
  it("devuelve el op-id del elemento MÁS PROFUNDO que contiene el texto", () => {
    const { coincidencias } = buscar("hola@taller.es");
    expect(coincidencias).toHaveLength(1);
    // `h`, el <strong> — no `g` (su <p>) ni `a` (el <body>). Ése es el punto de
    // mirar los nodos de texto propios y no `el.text`, que incluye los hijos.
    expect(coincidencias[0]).toMatchObject({
      pagina: "principal",
      donde: "cuerpo",
      op_id: "h",
    });
  });

  it("busca sin tildes y sin mayúsculas", () => {
    // El usuario escribe «telefono», la página dice «Teléfono». Una búsqueda
    // que no encuentre eso no sirve para el idioma en el que se usa.
    const { coincidencias } = buscar("telefono");
    expect(coincidencias.map((c) => c.op_id)).toEqual(["f"]);
  });

  it("el fragmento lleva el texto de alrededor y colapsa los espacios", () => {
    const { coincidencias } = buscar("Llámanos");
    const f = coincidencias[0]!.fragmento;
    // Lo de alrededor entra: es lo que deja distinguir dos «Contacto» de la
    // misma página sin mandar el párrafo entero.
    expect(f).toContain("Teléfono: 600 11 22 33. Llámanos y te atendemos");
    expect(f).not.toMatch(/\s{2,}/);
    expect(f).not.toContain("\n");
    // Este nodo cabe entero en la ventana, así que no se recorta por ningún
    // lado — los puntos suspensivos sólo aparecen cuando de verdad falta algo.
    expect(f.startsWith("…")).toBe(false);
    expect(f.endsWith("…")).toBe(false);
  });

  it("y recorta con … cuando el texto no cabe en la ventana", () => {
    const relleno = "palabra ".repeat(30);
    const doc = `<body data-op-id="a"><p data-op-id="b">${relleno}diana${relleno}</p></body>`;
    const { coincidencias } = buscarEnDocumento(doc, "diana", { pagina: "principal" });
    const f = coincidencias[0]!.fragmento;
    expect(f).toContain("diana");
    expect(f.startsWith("…")).toBe(true);
    expect(f.endsWith("…")).toBe(true);
    // Y no manda el párrafo entero: la ventana es lo que lo mantiene barato.
    expect(f.length).toBeLessThan(relleno.length);
  });

  it("encuentra dentro de href y lo dice", () => {
    const { coincidencias } = buscar("/nosotros");
    expect(coincidencias).toHaveLength(1);
    expect(coincidencias[0]).toMatchObject({ op_id: "d", atributo: "href" });
  });

  it("encuentra dentro de alt, que es texto que alguien LEE", () => {
    const { coincidencias } = buscar("coche azul");
    expect(coincidencias).toHaveLength(1);
    expect(coincidencias[0]).toMatchObject({ op_id: "i", atributo: "alt" });
  });

  it("NO casa dentro de class — «azul» vive en bg-azul y ahí no hay nada que cambiar", () => {
    const { coincidencias } = buscar("azul");
    // Sólo el `alt` de la imagen. El `class="bg-azul"` del <header> y la regla
    // `.bg-azul` del <style> son exactamente los falsos positivos que un grep
    // sobre el HTML devolvería.
    expect(coincidencias.map((c) => c.op_id)).toEqual(["i"]);
  });

  it("NO mira dentro de <style>: ahí no hay op-id que ofrecer", () => {
    const { coincidencias } = buscar("#2244ff");
    expect(coincidencias).toEqual([]);
  });

  it("la meta description casa como CABECERA, sin op-id y con su nombre", () => {
    const { coincidencias } = buscar("600 11 22 33");
    const meta = coincidencias.find((c) => c.donde === "cabecera");
    expect(meta).toMatchObject({ op_id: null, atributo: "meta[description]" });
    expect(meta!.fragmento).toContain("600 11 22 33");
  });

  it("el <title> casa como cabecera", () => {
    const { coincidencias } = buscar("chapa y pintura");
    expect(coincidencias).toHaveLength(1);
    expect(coincidencias[0]).toMatchObject({ donde: "cabecera", op_id: null });
  });

  it("el <script> casa como script — se arregla por otra puerta", () => {
    const { coincidencias } = buscar("const tel");
    expect(coincidencias).toHaveLength(1);
    expect(coincidencias[0]).toMatchObject({ donde: "script", op_id: null });
  });

  it("el mismo teléfono en cuerpo, cabecera y script sale UNA vez por sitio", () => {
    const { coincidencias } = buscar("600 11 22 33");
    expect(coincidencias.map((c) => c.donde).sort()).toEqual(["cabecera", "cuerpo", "script"]);
  });

  it("un texto repetido dentro del MISMO elemento no se repite", () => {
    const doc = `<body data-op-id="a"><p data-op-id="b">rojo rojo rojo</p></body>`;
    const { coincidencias } = buscarEnDocumento(doc, "rojo", { pagina: "principal" });
    expect(coincidencias).toHaveLength(1);
  });

  it("un texto de una letra no busca nada — casaría con media página", () => {
    expect(buscar("a").coincidencias).toEqual([]);
    expect(buscar("  ").coincidencias).toEqual([]);
  });

  it("corta en el tope y DICE cuántas dejó fuera", () => {
    const filas = Array.from(
      { length: 40 },
      (_, i) => `<li data-op-id="x${i}">Producto ${i}</li>`,
    ).join("");
    const { coincidencias, omitidas } = buscarEnDocumento(
      `<body data-op-id="a"><ul data-op-id="b">${filas}</ul></body>`,
      "Producto",
      { pagina: "principal" },
    );
    expect(coincidencias).toHaveLength(TOPE_COINCIDENCIAS);
    expect(omitidas).toBe(40 - TOPE_COINCIDENCIAS);
  });

  it("un documento vacío no revienta", () => {
    expect(buscarEnDocumento("", "hola", { pagina: "principal" })).toEqual({
      coincidencias: [],
      omitidas: 0,
    });
  });
});
