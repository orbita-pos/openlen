// @vitest-environment node
// Lo que contesta el origen de una app (lienzo y ojos de Len): las dependencias
// del catálogo y los fuentes compilados; un fuente roto, como un error legible.
import { describe, expect, it } from "vitest";
import { CATALOGO_ACTUAL, rutaDeVendor } from "./dependencias";
import { leerVendor, moduloDeError, servirRutaDeLaApp, vendorPorRuta } from "./servir";

const APP = { catalogo: CATALOGO_ACTUAL, entrada: "/src/main.jsx" };
const CARPETA = {
  "/src/main.jsx": 'import App from "./App";\nimport { createRoot } from "react-dom/client";\ncreateRoot(document.body).render(<App />);',
  "/src/App.tsx": "export default function App() { return <h1>Hola</h1>; }",
  "/src/Roto.jsx": "export default () => <div",
  "/js/app.js": 'import "./x";',
  "/data/menu.json": "[]",
};

describe("las dependencias del catálogo", () => {
  it("se sirven del disco, inmutables, en el modo pedido", () => {
    const dev = servirRutaDeLaApp(rutaDeVendor(CATALOGO_ACTUAL, "react-todo.js"), {}, { app: APP, modo: "desarrollo" });
    const prod = servirRutaDeLaApp(rutaDeVendor(CATALOGO_ACTUAL, "react-todo.js"), {}, { app: APP, modo: "produccion" });
    expect(dev?.inmutable).toBe(true);
    expect(dev?.tipo).toBe("text/javascript; charset=utf-8");
    // React de desarrollo trae sus mensajes enteros; el de producción, no.
    expect(dev!.cuerpo.length).toBeGreaterThan(prod!.cuerpo.length);
  });

  it("una ruta que no es de un catálogo real no se contesta", () => {
    expect(servirRutaDeLaApp(`/openlen/vendor/${CATALOGO_ACTUAL}/axios.js`, {}, { app: APP, modo: "desarrollo" })).toBeNull();
    expect(leerVendor(CATALOGO_ACTUAL, "../../package.json", "desarrollo")).toBeNull();
  });

  it("vendorPorRuta: el catálogo entero, para el navegador que mide", () => {
    const todo = vendorPorRuta(CATALOGO_ACTUAL, "desarrollo");
    expect(Object.keys(todo)).toContain(rutaDeVendor(CATALOGO_ACTUAL, "react.js"));
    expect(Object.keys(todo)).toContain(rutaDeVendor(CATALOGO_ACTUAL, "react-todo.js"));
  });
});

describe("los fuentes", () => {
  it("se sirven compilados, con los imports resueltos", () => {
    const r = servirRutaDeLaApp("/src/main.jsx", CARPETA, { app: APP, modo: "desarrollo" });
    expect(r?.inmutable).toBe(false);
    expect(r?.cuerpo).toContain('from "/src/App.tsx"');
    expect(r?.cuerpo).toContain('from "react-dom/client"');
  });

  it("🔴 uno que no compila se sirve como un módulo que LANZA su error con fichero y línea", () => {
    const r = servirRutaDeLaApp("/src/Roto.jsx", CARPETA, { app: APP, modo: "desarrollo" });
    expect(r?.cuerpo).toMatch(/^throw new SyntaxError\(/);
    expect(r?.cuerpo).toContain("/src/Roto.jsx:1:");
  });

  it("moduloDeError es JavaScript válido que lanza", () => {
    const m = moduloDeError("/src/A.jsx", [{ ruta: "/src/A.jsx", linea: 3, columna: 1, mensaje: 'Cannot find "./B"' }]);
    expect(() => new Function(m)()).toThrow(/\/src\/A\.jsx:3:1 — Cannot find "\.\/B"/);
  });

  it("en una PÁGINA, el /js/app.js de siempre no es cosa de la app (se sirve tal cual)", () => {
    expect(servirRutaDeLaApp("/js/app.js", CARPETA, { app: null, modo: "desarrollo" })).toBeNull();
  });

  it("un .jsx en una página sí se compila (el navegador no ejecuta JSX)", () => {
    expect(servirRutaDeLaApp("/src/App.tsx", CARPETA, { app: null, modo: "desarrollo" })?.cuerpo).not.toContain("<h1>");
  });

  it("lo que no es un fuente, o no existe, no se contesta aquí", () => {
    expect(servirRutaDeLaApp("/data/menu.json", CARPETA, { app: APP, modo: "desarrollo" })).toBeNull();
    expect(servirRutaDeLaApp("/src/NoExiste.jsx", CARPETA, { app: APP, modo: "desarrollo" })).toBeNull();
  });
});
