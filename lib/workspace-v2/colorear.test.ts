import { describe, expect, it } from "vitest";

import { colorear, colorearLineas, lenguajeDe, MAX_COLOREABLE, type Lenguaje, type Trozo } from "./colorear";

const PAGINA = `<!doctype html>
<html lang="es">
<head>
  <!-- el estilo
       en dos líneas -->
  <style>
    :root { --acento: #FF5A36; }
    a:hover { color: var(--acento); margin: 0 1.5rem; }
    @media (max-width: 600px) { h1 { font-size: 2em } }
  </style>
</head>
<body class='oscuro' data-x=1>
  <h1>Menú &amp; precios</h1>
  <img src="/foto.webp" alt="Una ola" />
  <script>
    // contar
    const total = 0x1F + 2.5; if (total > 3) { alert("listo"); }
  </script>
</body>
</html>`;

const DE = (trozos: readonly Trozo[], tipo: Trozo["tipo"]) => trozos.filter((t) => t.tipo === tipo).map((t) => t.texto);

describe("colorear — nunca cambia el texto", () => {
  const muestras: [Lenguaje, string][] = [
    ["html", PAGINA],
    ["css", "a{color:red}/* sin cerrar"],
    ["js", 'const s = "sin cerrar\nlet x = `a${1}b`; /* x */ y = 1e3;'],
    ["json", '{"a": [1, -2.5e3, true, null, "x"], "b": {"c": "d"}}\n{"otra": "línea"}'],
    ["markdown", "# Título\n- uno `código`\n> cita [enlace](https://x.y)\n1. dos"],
    ["html", "<<a <b <!-- sin cerrar"],
  ];
  it.each(muestras)("%s: juntar los trozos da la entrada", (lenguaje, texto) => {
    expect(colorear(texto, lenguaje).map((t) => t.texto).join("")).toBe(texto);
  });
});

describe("colorear — HTML, con su estilo y su script", () => {
  const trozos = colorear(PAGINA, "html");

  it("etiquetas, atributos y valores", () => {
    expect(colorear('<a href="/x">', "html")).toEqual([
      { texto: "<", tipo: "pun" },
      { texto: "a", tipo: "etq" },
      { texto: " ", tipo: null },
      { texto: "href", tipo: "atr" },
      { texto: "=", tipo: "pun" },
      { texto: '"/x"', tipo: "val" },
      { texto: ">", tipo: "pun" },
    ]);
    expect(DE(trozos, "atr")).toEqual(["lang", "class", "data-x", "src", "alt"]);
    expect(DE(trozos, "val")).toContain("'oscuro'");
    expect(DE(trozos, "val")).toContain("1");
  });

  it("el doctype y los comentarios", () => {
    expect(DE(trozos, "pal")[0]).toBe("<!doctype html>");
    expect(DE(trozos, "com")).toContain("<!-- el estilo\n       en dos líneas -->");
  });

  it("dentro de <style>, CSS: propiedades sí, selectores con dos puntos no", () => {
    expect(DE(trozos, "pro")).toEqual(["--acento", "color", "margin", "max-width", "font-size"]);
    expect(DE(trozos, "num")).toEqual(expect.arrayContaining(["#FF5A36", "0", "1.5rem", "600px", "2em"]));
    expect(DE(trozos, "pal")).toContain("@media");
  });

  it("dentro de <script>, JavaScript", () => {
    expect(DE(trozos, "com")).toContain("// contar");
    expect(DE(trozos, "pal")).toEqual(expect.arrayContaining(["const", "if"]));
    expect(DE(trozos, "num")).toEqual(expect.arrayContaining(["0x1F", "2.5", "3"]));
    expect(DE(trozos, "val")).toContain('"listo"');
  });

  it("el texto de la página va sin color", () => {
    expect(trozos.some((t) => t.tipo === null && t.texto.includes("Menú &amp; precios"))).toBe(true);
  });
});

describe("colorear — JSON y Markdown", () => {
  it("JSON: claves, valores, números y literales", () => {
    const t = colorear('{"nombre": "Ana", "edad": 31, "socia": true, "nota": null}', "json");
    expect(DE(t, "pro")).toEqual(['"nombre"', '"edad"', '"socia"', '"nota"']);
    expect(DE(t, "val")).toEqual(['"Ana"']);
    expect(DE(t, "num")).toEqual(["31"]);
    expect(DE(t, "pal")).toEqual(["true", "null"]);
  });

  it("Markdown: títulos, marcas de lista, código y enlaces", () => {
    const t = colorear("# Escuela\n- clases `2 h`\nVer [aquí](https://x.y).", "markdown");
    expect(DE(t, "tit")).toEqual(["# Escuela"]);
    expect(DE(t, "pun")).toEqual(["-", "](", ")"]);
    expect(DE(t, "val")).toEqual(["`2 h`"]);
    expect(DE(t, "atr")).toEqual(["https://x.y"]);
  });
});

describe("colorearLineas", () => {
  it("parte por líneas sin perder el color: un comentario de dos líneas es comentario en las dos", () => {
    const lineas = colorearLineas("a <!-- uno\ndos --> b", "html");
    expect(lineas).toEqual([
      [
        { texto: "a ", tipo: null },
        { texto: "<!-- uno", tipo: "com" },
      ],
      [
        { texto: "dos -->", tipo: "com" },
        { texto: " b", tipo: null },
      ],
    ]);
  });

  it("sin lenguaje o demasiado grande, sin color, y una entrada por línea", () => {
    expect(colorearLineas("uno\n\ntres", null)).toEqual([[{ texto: "uno", tipo: null }], [], [{ texto: "tres", tipo: null }]]);
    const grande = `<p>${"x".repeat(MAX_COLOREABLE)}</p>`;
    expect(colorearLineas(grande, "html")).toEqual([[{ texto: grande, tipo: null }]]);
  });
});

describe("lenguajeDe", () => {
  it("por la extensión", () => {
    expect(lenguajeDe("/menu/index.html")).toBe("html");
    expect(lenguajeDe("/datos/reservas.json")).toBe("json");
    expect(lenguajeDe("/bandeja/mensajes.jsonl")).toBe("json");
    expect(lenguajeDe("/memoria/proyecto.md")).toBe("markdown");
    expect(lenguajeDe("/robots.txt")).toBeNull();
    // La carpeta (pieza 9 de Len 2.5): el manifiesto de la app instalable es JSON.
    expect(lenguajeDe("/app.webmanifest")).toBe("json");
    expect(lenguajeDe("/js/app.mjs")).toBe("js");
  });
});
