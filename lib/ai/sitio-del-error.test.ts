// @vitest-environment node
// Dónde nació un error del navegador (F3 de las apps web): el fichero y la línea
// del fuente, que es lo que Len puede abrir y arreglar.
import { describe, expect, it } from "vitest";
import { sitioDelTexto, sitioEnLaTraza, textoDelError } from "./sitio-del-error";

const TRAZA = [
  "TypeError: Cannot read properties of undefined (reading 'precio')",
  "    at reduce (<anonymous>)",
  "    at Ti (http://127.0.0.1:40123/openlen/vendor/2026-10/react-todo.js:1:3456)",
  "    at Carrito (http://127.0.0.1:40123/src/Carrito.jsx:6:13)",
  "    at App (http://127.0.0.1:40123/src/App.jsx:20:5)",
].join("\n");

describe("dónde nació un error", () => {
  it("el primer marco que es del proyecto, saltando React por dentro", () => {
    expect(sitioEnLaTraza(TRAZA)).toEqual({ ruta: "/src/Carrito.jsx", linea: 6, columna: 13 });
  });

  it("lo relativo al documento medido llega con su id delante: se le quita", () => {
    const t = "Error: x\n    at f (http://127.0.0.1:1/0b1c2d3e-aaaa-4bbb-8ccc-0123456789ab/js/app.js:2:9)";
    expect(sitioEnLaTraza(t)).toEqual({ ruta: "/js/app.js", linea: 2, columna: 9 });
  });

  it("CONTRA-PRUEBA: el JavaScript DENTRO del documento no tiene fichero propio (y sin traza, nada)", () => {
    expect(sitioEnLaTraza("Error: x\n    at http://127.0.0.1:1/0b1c2d3e-aaaa-4bbb-8ccc-0123456789ab/:12:3")).toBeNull();
    expect(sitioEnLaTraza(undefined)).toBeNull();
  });

  it("el texto lleva el sitio al final, y se puede leer de vuelta", () => {
    const e = new TypeError("Cannot read properties of undefined (reading 'precio')");
    e.stack = TRAZA;
    const texto = textoDelError(e, 300);
    expect(texto).toBe("Cannot read properties of undefined (reading 'precio') (at /src/Carrito.jsx:6:13)");
    expect(sitioDelTexto(texto)).toEqual({
      mensaje: "Cannot read properties of undefined (reading 'precio')",
      sitio: { ruta: "/src/Carrito.jsx", linea: 6, columna: 13 },
    });
    expect(sitioDelTexto("sin sitio")).toEqual({ mensaje: "sin sitio", sitio: null });
  });
});
