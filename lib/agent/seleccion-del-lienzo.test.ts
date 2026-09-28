// Lo que el dueño señala en el lienzo, anclado a líneas del fichero con el
// resolvedor de verdad (binding nativo): por eso vive en `test:node`.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { seleccionDelLienzo } from "@/lib/agent/seleccion-del-lienzo";

const PAGINA = [
  "<!doctype html>",
  "<html lang=\"es\">",
  "<head><title>Tacos</title></head>",
  "<body>",
  "  <header><h1>Tacos Don Beto</h1></header>",
  "  <section",
  "    class=\"menu\">",
  "    <h2>Menú</h2>",
  "    <p>Pastor $25</p>",
  "  </section>",
  "  <section><h2>Visítanos</h2></section>",
  "</body>",
  "</html>",
].join("\n");

describe("seleccionDelLienzo", () => {
  it("la ruta del lienzo se vuelve fichero + líneas + el texto tal cual", () => {
    const sel = seleccionDelLienzo({
      html: PAGINA,
      page: null,
      path: "section:nth-of-type(1)",
      hint: "section — 'Menú'",
    });
    assert.deepEqual(sel, {
      ruta: "/index.html",
      desde: 6,
      hasta: 10,
      contenido: '<section\n    class="menu">\n    <h2>Menú</h2>\n    <p>Pastor $25</p>\n  </section>',
    });
  });

  it("en una subpágina, el fichero es el de la subpágina", () => {
    const sel = seleccionDelLienzo({ html: PAGINA, page: "menu", path: "header:nth-of-type(1) > h1:nth-of-type(1)", hint: "h1" });
    assert.equal(sel?.ruta, "/menu/index.html");
    assert.ok(sel && "desde" in sel && sel.desde === 5 && sel.hasta === 5);
  });

  it("los ids viejos horneados no corren las líneas: se cuentan sobre lo que ve Read", () => {
    const conIds = PAGINA.replace("<header>", '<header data-op-id="k1">');
    const sel = seleccionDelLienzo({ html: conIds, page: null, path: "section:nth-of-type(2)", hint: "x" });
    assert.ok(sel && "desde" in sel);
    assert.equal(sel.desde, 11);
    assert.equal(sel.contenido, "<section><h2>Visítanos</h2></section>");
  });

  it("si la ruta no resuelve, va la pista sin líneas; sin pista, nada", () => {
    assert.deepEqual(
      seleccionDelLienzo({ html: PAGINA, page: null, path: "section:nth-of-type(9)", hint: "h2 — 'Menú'" }),
      { ruta: "/index.html", pista: "h2 — 'Menú'" },
    );
    assert.equal(seleccionDelLienzo({ html: PAGINA, page: null, path: "section:nth-of-type(9)", hint: null }), null);
    assert.equal(seleccionDelLienzo({ html: PAGINA, page: null, path: null, hint: null }), null);
  });
});
