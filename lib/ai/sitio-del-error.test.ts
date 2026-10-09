// @vitest-environment node
// Dónde nació un error del navegador (F3 de las apps web): el fichero y la línea
// del fuente, que es lo que Len puede abrir y arreglar.
import { TraceMap, originalPositionFor } from "@jridgewell/trace-mapping";
import { afterAll, describe, expect, it } from "vitest";
import { bundleApp, stopBundlerWorker } from "@/lib/apps/bundler/bundle-app";
import { esqueletoDeApp } from "@/lib/apps/esqueleto";
import { sitioDelTexto, sitioEnLaTraza, textoDelError, traductorDeMapas } from "./sitio-del-error";

const TRAZA = [
  "TypeError: Cannot read properties of undefined (reading 'precio')",
  "    at reduce (<anonymous>)",
  "    at Carrito (http://127.0.0.1:40123/src/Carrito.jsx:6:13)",
  "    at App (http://127.0.0.1:40123/src/App.jsx:20:5)",
].join("\n");

describe("dónde nació un error", () => {
  it("el primer marco con fichero (el de React se salta por el mapa del paquete: abajo)", () => {
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

describe("a través del paquete (plan 02, tarea 4)", () => {
  afterAll(() => stopBundlerWorker());

  async function paquete() {
    const carpeta = {
      ...esqueletoDeApp({ titulo: "Caja" }).ficheros,
      "/src/App.jsx": "export default function App() {\n  const datos = undefined;\n  return <p>{datos.precio}</p>;\n}\n",
    };
    const r = await bundleApp({ carpeta, app: { catalogo: "2026-11", entrada: "/src/main.jsx" }, modo: "desarrollo" });
    if (!r?.ok || !r.map) throw new Error("no empaquetó");
    const lineas = r.js.split("\n");
    const i = lineas.findIndex((l) => l.includes("datos.precio"));
    return { r, linea: i + 1, columna: lineas[i]!.indexOf("datos.precio") + 1 };
  }

  it("🔴 un marco en el paquete (/src/main.jsx:L) vuelve a /src/App.jsx:3", async () => {
    const { r, linea, columna } = await paquete();
    const traza = `TypeError: Cannot read properties of undefined (reading 'precio')\n    at App (https://x.test/src/main.jsx:${linea}:${columna})`;
    expect(sitioEnLaTraza(traza, traductorDeMapas({ "/src/main.jsx": r.map! }))).toMatchObject({ ruta: "/src/App.jsx", linea: 3 });
  }, 60_000);

  it("🔴 los marcos de React (del catálogo, DENTRO del paquete) se saltan: gana el primero de la app (Review Focus 1)", async () => {
    const { r, linea, columna } = await paquete();
    // El React del catálogo va minificado también en desarrollo (los nombres
    // cortos, los mensajes enteros): el marco «de React» se elige con el propio
    // mapa, una línea del paquete que viene de `vendor:`.
    const mapa = new TraceMap(r.map!);
    const lineas = r.js.split("\n");
    const deReact = lineas.findIndex((l, i) => l.length > 0 && originalPositionFor(mapa, { line: i + 1, column: 0 }).source?.startsWith("vendor:"));
    expect(deReact).toBeGreaterThan(-1);
    const traza = [
      "TypeError: x",
      `    at Zr (https://x.test/src/main.jsx:${deReact + 1}:1)`,
      `    at App (https://x.test/src/main.jsx:${linea}:${columna})`,
    ].join("\n");
    expect(sitioEnLaTraza(traza, traductorDeMapas({ "/src/main.jsx": r.map! }))?.ruta).toBe("/src/App.jsx");
  }, 60_000);

  it("textoDelError lo dice con el sitio traducido; sin mapas, como siempre", () => {
    const e = new Error("boom");
    e.stack = "Error: boom\n    at f (https://x.test/src/A.jsx:6:13)";
    expect(textoDelError(e, 100)).toBe("boom (at /src/A.jsx:6:13)");
    expect(traductorDeMapas(undefined)).toBeUndefined();
    expect(traductorDeMapas({})).toBeUndefined();
  });
});
