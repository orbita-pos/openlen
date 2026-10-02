import { describe, expect, it } from "vitest";

import {
  CARACTERES_POR_LINEA,
  cambiosDelComando,
  DIFF_DEMASIADO_GRANDE,
  LINEAS_POR_FICHERO,
  leerCambiosDelComando,
  MAX_FICHEROS,
} from "./cambios-del-comando";

const lineas = (n: number, p = "l") => Array.from({ length: n }, (_, i) => `${p}${i + 1}`).join("\n") + "\n";
const cuantas = (c: ReturnType<typeof cambiosDelComando>, i = 0) =>
  c!.ficheros[i]!.trozos.reduce((n, t) => n + t.lineas.length, 0);

describe("cambiosDelComando — lo que cambió un `bash`, por fichero (la #10)", () => {
  it("sin cambios en el proyecto, nada: lo de /tmp no cuenta", () => {
    expect(cambiosDelComando({ "/index.html": "a\n" }, { "/index.html": "a\n", "/tmp/x": "y" })).toBeNull();
  });

  it("creado, actualizado y borrado, con su +N −M y las líneas de los dos lados", () => {
    const c = cambiosDelComando(
      { "/index.html": "<h1>Hola</h1>\n<p>Calle Marea 12</p>\n", "/notas.txt": "x\n" },
      { "/index.html": "<h1>Hola</h1>\n<p>Calle Gaviotas 7</p>\n", "/clases/index.html": "<p>nueva</p>\n" },
    )!;
    expect(c.masFicheros).toBe(0);
    expect(c.ficheros.map((f) => [f.ruta, f.tipo, f.anadidas, f.quitadas])).toEqual([
      ["/clases/index.html", "creado", 1, 0],
      ["/index.html", "actualizado", 1, 1],
      ["/notas.txt", "borrado", 0, 1],
    ]);
    const lin = c.ficheros[1]!.trozos[0]!.lineas;
    expect(lin.find((l) => l.tipo === "quitada")).toMatchObject({ texto: "<p>Calle Marea 12</p>", antes: 2, despues: null });
    expect(lin.find((l) => l.tipo === "anadida")).toMatchObject({ texto: "<p>Calle Gaviotas 7</p>", antes: null, despues: 2 });
  });

  it("40 líneas por fichero, como Claude Code; el resto se cuenta", () => {
    const c = cambiosDelComando({}, { "/datos/largo.txt": lineas(100) });
    expect(cuantas(c)).toBe(LINEAS_POR_FICHERO);
    expect(c!.ficheros[0]!.ocultas).toBe(100 - LINEAS_POR_FICHERO);
    expect(c!.ficheros[0]!.anadidas).toBe(100);
  });

  it("el tope de 40 se reparte entre los trozos del fichero, no por trozo", () => {
    // Dos cambios lejos el uno del otro: dos trozos de 7 líneas (3 de contexto a cada lado).
    const antes = lineas(60);
    const despues = antes.replace("l5\n", "X5\n").replace("l50\n", "X50\n");
    const c = cambiosDelComando({ "/a.txt": antes }, { "/a.txt": despues })!;
    expect(c.ficheros[0]!.trozos).toHaveLength(2);
    expect(cuantas(c)).toBe(c.ficheros[0]!.trozos[0]!.lineas.length + c.ficheros[0]!.trozos[1]!.lineas.length);
    expect(c.ficheros[0]!.ocultas).toBe(0);
  });

  it("como mucho cinco ficheros; los demás, en «N archivos más»", () => {
    const despues = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`/p${i}.txt`, "x\n"]));
    const c = cambiosDelComando({}, despues)!;
    expect(c.ficheros).toHaveLength(MAX_FICHEROS);
    expect(c.masFicheros).toBe(3);
  });

  it("un diff de 400 líneas o más no se enseña: cuenta como uno más", () => {
    const c = cambiosDelComando({}, { "/grande.txt": lineas(DIFF_DEMASIADO_GRANDE), "/chico.txt": "a\n" })!;
    expect(c.ficheros.map((f) => f.ruta)).toEqual(["/chico.txt"]);
    expect(c.masFicheros).toBe(1);
  });

  it("una línea enorme (HTML de una sola línea) se corta: esto se guarda en la fila", () => {
    const c = cambiosDelComando({}, { "/index.html": "a".repeat(50_000) })!;
    const texto = c.ficheros[0]!.trozos[0]!.lineas[0]!.texto;
    expect(texto).toHaveLength(CARACTERES_POR_LINEA + 1);
    expect(texto.endsWith("…")).toBe(true);
  });
});

describe("leerCambiosDelComando — lo que pinta el navegador, comprobado", () => {
  it("lo que escribe el servidor vuelve igual", () => {
    const c = cambiosDelComando({ "/a.txt": "a\n" }, { "/a.txt": "b\n" });
    expect(leerCambiosDelComando(JSON.parse(JSON.stringify(c)))).toEqual(c);
  });

  it("lo que no tiene la forma, null", () => {
    expect(leerCambiosDelComando(undefined)).toBeNull();
    expect(leerCambiosDelComando({ ficheros: "x", masFicheros: 0 })).toBeNull();
    expect(leerCambiosDelComando({ ficheros: [{ ruta: "/a", tipo: "otro" }], masFicheros: 0 })).toBeNull();
    expect(
      leerCambiosDelComando({
        ficheros: [{ ruta: "/a", tipo: "creado", anadidas: 1, quitadas: 0, ocultas: 0, trozos: [{ saltadas: 0, lineas: [{ tipo: "anadida", texto: 1 }] }] }],
        masFicheros: 0,
      }),
    ).toBeNull();
  });
});
