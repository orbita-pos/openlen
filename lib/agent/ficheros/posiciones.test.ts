import { describe, expect, it } from "vitest";
import {
  etiquetarConPosiciones,
  posicionDeId,
  quitarPosiciones,
  seleccionDelTrozo,
} from "./posiciones";

const PAGINA = [
  "<!doctype html>",
  "<html lang=\"es\">",
  "<head><title>Taller <b>no</b></title>",
  "<style>.a > div { color: red }</style>",
  "</head>",
  "<body>",
  "  <!-- <section>comentado</section> -->",
  "  <section class=\"hero\"",
  "           id=\"inicio\">",
  "    <h1>Hola</h1>",
  "    <svg viewBox=\"0 0 1 1\"><path d=\"M0 0\"/></svg>",
  "  </section>",
  "  <script>if (a < b) { document.body.innerHTML = '<div>x</div>' }</script>",
  "  <p title=\"a > b\">Fin</p>",
  "</body>",
  "</html>",
].join("\n");

describe("etiquetarConPosiciones: el gemelo con la posición de cada etiqueta en el fichero", () => {
  const gemelo = etiquetarConPosiciones(PAGINA);

  it("sólo INSERTA atributos: quitándolos vuelve el fichero byte a byte", () => {
    // Lo que el etiquetador del motor no garantiza (lol_html reescribe `/>`
    // como ` />` y junta los atributos de varias líneas): medido sobre las
    // plantillas, 131 de 245 cambiaban.
    expect(quitarPosiciones(gemelo)).toBe(PAGINA);
  });

  it("cada id es la línea y la columna (desde 1) de su `<` en el fichero", () => {
    expect(gemelo).toContain('<section data-op-id="L8C3" class="hero"');
    expect(gemelo).toContain('<h1 data-op-id="L10C5">');
    expect(gemelo).toContain('<p data-op-id="L14C3" title="a > b">');
    expect(gemelo).toContain('<path data-op-id="L11C28" d="M0 0"/>');
  });

  it("no toca lo que no es marcado: comentarios, <script>, <style> ni <title>", () => {
    expect(gemelo).toContain("<!-- <section>comentado</section> -->");
    expect(gemelo).toContain("'<div>x</div>'");
    expect(gemelo).toContain("<title>Taller <b>no</b></title>");
    expect(gemelo).toContain(".a > div { color: red }");
  });

  it("deja sin id las mismas etiquetas que el motor (html, head, script…)", () => {
    expect(gemelo).toContain('<html lang="es">');
    expect(gemelo).toContain("<head>");
    expect(gemelo).toContain("  <script>");
  });

  it("un documento que ya trae ids ajenos NO se toca por partida doble", () => {
    const viejo = '<body><div data-op-id="k3">x</div></body>';
    expect(etiquetarConPosiciones(viejo)).toContain('data-op-id="k3"');
    expect(etiquetarConPosiciones(viejo).match(/data-op-id/g)).toHaveLength(2);
  });
});

describe("posicionDeId", () => {
  it("lee la línea y la columna de un id del gemelo", () => {
    expect(posicionDeId("L12C5")).toEqual({ linea: 12, columna: 5 });
  });
  it("un id del motor (base36) no es una posición", () => {
    expect(posicionDeId("b7")).toBeNull();
  });
});

describe("seleccionDelTrozo: del elemento señalado a las líneas del fichero", () => {
  const gemelo = etiquetarConPosiciones(PAGINA);

  it("da las líneas de principio a fin y el texto tal cual está en el fichero", () => {
    const inicio = gemelo.indexOf('<section data-op-id="L8C3"');
    const fin = gemelo.indexOf("</section>", inicio) + "</section>".length;
    const sel = seleccionDelTrozo(PAGINA, "L8C3", gemelo.slice(inicio, fin));
    expect(sel).toEqual({
      desde: 8,
      hasta: 12,
      contenido: PAGINA.split("\n").slice(7, 12).join("\n").slice(2),
    });
  });

  it("un trozo que no está donde dice su id no se ancla (null, no una línea inventada)", () => {
    expect(seleccionDelTrozo(PAGINA, "L10C5", "<h1>Adiós</h1>")).toBeNull();
    expect(seleccionDelTrozo(PAGINA, "b7", "<h1>Hola</h1>")).toBeNull();
  });
});
