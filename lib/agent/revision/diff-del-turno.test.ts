import { describe, expect, it } from "vitest";
import { diffDeFichero, diffDelTurno } from "./diff-del-turno";

const lineas = (n: number, prefijo = "l") => Array.from({ length: n }, (_, i) => `${prefijo}${i + 1}`).join("\n");

describe("el diff del turno", () => {
  it("sin cambios, nada", () => {
    expect(diffDeFichero({ ruta: "/index.html", antes: "a\nb", despues: "a\nb" })).toBe("");
  });

  it("un cambio en medio, con tres líneas de contexto y la numeración de los dos lados", () => {
    const antes = lineas(10);
    const despues = antes.replace("l5", "L5");
    expect(diffDeFichero({ ruta: "/index.html", antes, despues })).toBe(
      ["--- a/index.html", "+++ b/index.html", "@@ -2,7 +2,7 @@", " l2", " l3", " l4", "-l5", "+L5", " l6", " l7", " l8"].join("\n"),
    );
  });

  it("una línea añadida desplaza la numeración de después", () => {
    const antes = lineas(8);
    const despues = antes.replace("l2\n", "l2\nnueva\n");
    const d = diffDeFichero({ ruta: "/index.html", antes, despues });
    expect(d).toContain("@@ -1,5 +1,6 @@");
    expect(d).toContain("+nueva");
  });

  it("una página que el turno creó sale entera como añadida", () => {
    const d = diffDeFichero({ ruta: "/menu/index.html", antes: null, despues: "<h1>Menú</h1>\n<p>x</p>" });
    expect(d).toBe(["--- /dev/null", "+++ b/menu/index.html", "@@ -0,0 +1,2 @@", "+<h1>Menú</h1>", "+<p>x</p>"].join("\n"));
  });

  it("dos cambios lejos son dos trozos; cerca, uno", () => {
    const antes = lineas(30);
    const lejos = diffDeFichero({ ruta: "/i", antes, despues: antes.replace("l3\n", "X3\n").replace("l25\n", "X25\n") });
    expect(lejos.match(/^@@/gm)).toHaveLength(2);
    const cerca = diffDeFichero({ ruta: "/i", antes, despues: antes.replace("l3\n", "X3\n").replace("l7\n", "X7\n") });
    expect(cerca.match(/^@@/gm)).toHaveLength(1);
  });

  it("el del turno junta los ficheros que cambiaron y salta los que no", () => {
    const d = diffDelTurno([
      { ruta: "/index.html", antes: "a", despues: "b" },
      { ruta: "/otra/index.html", antes: "igual", despues: "igual" },
    ]);
    expect(d).toContain("+++ b/index.html");
    expect(d).not.toContain("otra");
  });
});
