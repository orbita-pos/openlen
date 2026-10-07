// @vitest-environment jsdom
// LOS COLORES DEL EDITOR, los de VS Code: a cada trozo, UN color (los estilos
// por lenguaje no se pisan), y las llaves por nivel.
import { afterEach, describe, expect, it } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { ensureSyntaxTree } from "@codemirror/language";

import { coloresDelEditor } from "./colores-del-editor";
import { lenguajeDeRuta } from "./editor-codigo";

const vistas: EditorView[] = [];
afterEach(() => {
  vistas.splice(0).forEach((v) => v.destroy());
  document.body.innerHTML = "";
});

/** Los trozos pintados: su texto y sus clases de color (las de CodeMirror empiezan por «ͼ»). */
function pintar(ruta: string, doc: string) {
  const state = EditorState.create({ doc, extensions: [lenguajeDeRuta(ruta), coloresDelEditor] });
  ensureSyntaxTree(state, doc.length, 5000);
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  const v = new EditorView({ state, parent });
  vistas.push(v);
  return [...v.contentDOM.querySelectorAll("span")].map((s) => ({
    texto: s.textContent ?? "",
    colores: [...s.classList].filter((c) => c.startsWith("ͼ")),
    llave: [...s.classList].find((c) => c.startsWith("cm-llave-")) ?? null,
  }));
}

const colorDe = (trozos: ReturnType<typeof pintar>, texto: string) => trozos.find((x) => x.texto === texto)?.colores ?? [];

describe("los colores del editor", () => {
  it("🔴 a cada trozo le toca UN color, en HTML con su <style> y su <script>, en JSX, en CSS y en JSON", () => {
    const casos: [string, string][] = [
      [
        "/index.html",
        '<div class="hero"><style>.hero { color: red; }</style><script>const x = fetch("/a"); document.getElementById("b");</script></div>',
      ],
      ["/src/App.jsx", 'import App from "./App";\nexport default function Inicio() { return <main><App titulo="hola" /></main>; }'],
      ["/estilos.css", "a:hover, .boton #id { margin: 0 4px; color: #fff; }"],
      ["/datos.json", '{"nombre": "Ana", "edad": 3, "activo": true, "nada": null}'],
      ["/src/x.ts", "class A extends B { constructor() { super(); this.x = new Map<string, number>(); } }"],
      ["/consulta.sql", "SELECT nombre FROM reservas WHERE id = 3 AND activo = TRUE;"],
      ["/LEEME.md", "# Título\n\nTexto con `código` y **negrita**, y <b class=\"x\">html</b>."],
    ];
    for (const [ruta, doc] of casos) {
      for (const t of pintar(ruta, doc)) expect(t.colores.length, `${ruta}: «${t.texto}»`).toBeLessThanOrEqual(1);
    }
  });

  it("lo que VS Code distingue, aquí también se distingue", () => {
    const jsx = pintar("/src/App.jsx", 'import App from "./App";\nexport default function Inicio() { return <main><App /></main>; }');
    // `import` (control) no es `function` (definición); un componente no es una etiqueta.
    expect(colorDe(jsx, "import")).not.toEqual(colorDe(jsx, "function"));
    expect(colorDe(jsx, "main")).not.toEqual([]);
    expect(colorDe(jsx, "Inicio")).not.toEqual([]);
    const css = pintar("/estilos.css", ".boton { margin: 0; }");
    expect(colorDe(css, "margin")).not.toEqual([]);
    expect(colorDe(css, ".boton").length + colorDe(css, "boton").length).toBeGreaterThan(0);
    // Un valor CSS no tiene el color de una palabra clave.
    const valor = pintar("/estilos.css", "a { display: flex; } @media screen { }");
    expect(colorDe(valor, "flex")).not.toEqual([]);
    expect(colorDe(valor, "flex")).not.toEqual(colorDe(valor, "@media"));
    const sql = pintar("/consulta.sql", "SELECT nombre FROM reservas;");
    expect(colorDe(sql, "SELECT")).not.toEqual([]);
  });

  it("las llaves se turnan tres colores por nivel", () => {
    const trozos = pintar("/a.js", "f({ a: [1] });");
    const llaves = trozos.filter((x) => x.llave).map((x) => `${x.texto}${x.llave!.slice(-1)}`);
    expect(llaves).toEqual(["(1", "{2", "[3", "]3", "}2", ")1"]);
  });
});
