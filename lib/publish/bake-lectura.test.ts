import { describe, expect, it } from "vitest";
import { horneaLectura } from "./bake-lectura";

const conMarca = (dentro = "") =>
  `<html lang="es"><body><div data-ol-datos="menu">${dentro}</div></body></html>`;

describe("horneaLectura", () => {
  it("mete las filas dentro del marcador", () => {
    const out = horneaLectura(conMarca(), {
      menu: [
        { id: "1", doc: { plato: "Tacos", precio: 45 } },
        { id: "2", doc: { plato: "Flan", precio: 30 } },
      ],
    });
    expect(out).toContain("Tacos");
    expect(out).toContain("45");
    expect(out).toContain("Flan");
  });

  // Lo que hace que esto valga la pena: el contenido está EN el documento, así
  // que un buscador lo ve sin ejecutar nada y la página no parpadea vacía.
  it("el texto queda en el documento, no en un script", () => {
    const out = horneaLectura(conMarca(), { menu: [{ id: "1", doc: { plato: "Tacos" } }] });
    const sinScripts = out.replace(/<script[\s\S]*?<\/script>/g, "");
    expect(sinScripts).toContain("Tacos");
  });

  it("escapa el HTML de los datos", () => {
    const out = horneaLectura(conMarca(), {
      menu: [{ id: "1", doc: { plato: "<img src=x onerror=alert(1)>" } }],
    });
    expect(out).not.toContain("<img src=x");
    expect(out).toContain("&lt;img");
  });

  it("una página sin marcador se devuelve igual", () => {
    const html = "<html lang='es'><body><h1>hola</h1></body></html>";
    expect(horneaLectura(html, { menu: [{ id: "1", doc: { plato: "x" } }] })).toBe(html);
  });

  // Sin datos, el marcador queda VACÍO — no con el placeholder que el modelo
  // dejó dentro mientras diseñaba. Publicar «aquí van tus platos» sería peor
  // que publicar un hueco.
  it("un marcador sin datos queda vacío, no roto", () => {
    const out = horneaLectura(conMarca("<p>placeholder del editor</p>"), { menu: [] });
    expect(out).not.toContain("placeholder del editor");
    expect(out).toContain('data-ol-datos="menu"');
  });

  it("no toca marcadores de almacenes que no le pasan", () => {
    const html = `<html lang="es"><body><div data-ol-datos="otro"><p>x</p></div></body></html>`;
    expect(horneaLectura(html, { menu: [] })).toBe(html);
  });

  it("hornea varios almacenes en la misma página", () => {
    const html = `<html lang="es"><body>
      <div data-ol-datos="menu"></div><ul data-ol-datos="precios"></ul></body></html>`;
    const out = horneaLectura(html, {
      menu: [{ id: "1", doc: { plato: "Tacos" } }],
      precios: [{ id: "2", doc: { nombre: "Básico" } }],
    });
    expect(out).toContain("Tacos");
    expect(out).toContain("Básico");
  });
});
