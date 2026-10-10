// @vitest-environment node
// Lo que se sirve de una app (lienzo, ojos de Len y publicación) y de los
// fuentes de una página; un fuente roto, como un error legible.
import { describe, expect, it } from "vitest";
import { CATALOGO_ACTUAL } from "./dependencias";
import { BUNDLER_DID_NOT_ANSWER, entradaServida, ficherosDeLaApp, moduloDeError, servirFuenteDePagina } from "./servir";

const APP = { catalogo: CATALOGO_ACTUAL, entrada: "/src/main.jsx" };
const CARPETA = {
  "/src/main.jsx": 'import App from "./App";\nimport { createRoot } from "react-dom/client";\ncreateRoot(document.body).render(<App />);',
  "/src/App.tsx": "export default function App() { return <h1>Hola</h1>; }",
  "/src/Roto.jsx": "export default () => <div",
  "/src/index.css": "body{}",
  "/js/app.js": 'import "./x";',
  "/data/menu.json": "[]",
  "/tests/a.spec.ts": "x",
};

describe("una app: la entrada y lo que no es un fuente", () => {
  it("🔴 ficherosDeLaApp: la entrada con su cuerpo, y lo publicable que no es fuente tal cual; ni fuentes sueltos ni /tests", () => {
    expect(ficherosDeLaApp(CARPETA, APP, "PAQUETE")).toEqual({
      "/src/main.jsx": "PAQUETE",
      "/src/index.css": "body{}",
      "/data/menu.json": "[]",
    });
  });

  it("entradaServida: el paquete; si no compila, un módulo que lanza sus errores; si no contestó, el aviso", () => {
    expect(entradaServida("/src/main.jsx", { ok: true, js: "JS", map: null, bytes: 2, gzipBytes: 1, ms: 1 })).toBe("JS");
    const roto = entradaServida("/src/main.jsx", { ok: false, errores: [{ ruta: "/src/A.jsx", linea: 3, columna: 1, mensaje: "x" }] });
    expect(roto).toMatch(/^throw new SyntaxError\(/);
    expect(roto).toContain("/src/A.jsx:3:1");
    expect(entradaServida("/src/main.jsx", null)).toContain(BUNDLER_DID_NOT_ANSWER.slice(0, 30));
  });
});

describe("los fuentes de una página", () => {
  it("un .jsx/.tsx se compila (el navegador no ejecuta JSX)", () => {
    expect(servirFuenteDePagina("/src/App.tsx", CARPETA)).not.toContain("<h1>");
  });

  it("🔴 uno que no compila se sirve como un módulo que LANZA su error con fichero y línea", () => {
    const r = servirFuenteDePagina("/src/Roto.jsx", CARPETA);
    expect(r).toMatch(/^throw new SyntaxError\(/);
    expect(r).toContain("/src/Roto.jsx:1:");
  });

  it("el /js/app.js de siempre, lo que no es un fuente o lo que no existe: no se contesta aquí", () => {
    expect(servirFuenteDePagina("/js/app.js", CARPETA)).toBeNull();
    expect(servirFuenteDePagina("/data/menu.json", CARPETA)).toBeNull();
    expect(servirFuenteDePagina("/src/NoExiste.jsx", CARPETA)).toBeNull();
  });

  it("moduloDeError es JavaScript válido que lanza", () => {
    const m = moduloDeError("/src/A.jsx", [{ ruta: "/src/A.jsx", linea: 3, columna: 1, mensaje: 'Cannot find "./B"' }]);
    expect(() => new Function(m)()).toThrow(/\/src\/A\.jsx:3:1 — Cannot find "\.\/B"/);
  });
});
