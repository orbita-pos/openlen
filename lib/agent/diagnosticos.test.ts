import { describe, expect, it } from "vitest";
import {
  claveDeDiagnostico,
  NuevosDiagnosticos,
  posicionDe,
  posicionEnIndice,
  redactarDiagnosticos,
  type Diagnostico,
} from "./diagnosticos";

const d = (over: Partial<Diagnostico> = {}): Diagnostico => ({
  ruta: "/index.html",
  linea: 12,
  columna: 5,
  gravedad: "Error",
  mensaje: "algo falla",
  ...over,
});

describe("redactarDiagnosticos: el sobre `<new-diagnostics>`, carácter a carácter", () => {
  it("un fichero, una línea: el texto exacto", () => {
    expect(redactarDiagnosticos([d({ codigo: "js", fuente: "navegador" })])).toBe(
      "<new-diagnostics>Problems that appeared with this change:\n\n" +
        "/index.html:\n  ✘ [Line 12:5] algo falla [js] (navegador)</new-diagnostics>",
    );
  });

  it("gravedad con los símbolos de `figures` y sin código ni fuente cuando no los hay", () => {
    const out = redactarDiagnosticos([
      d({ gravedad: "Hint", mensaje: "h" }),
      d({ gravedad: "Warning", mensaje: "w" }),
      d({ gravedad: "Info", mensaje: "i" }),
      d({ gravedad: "Error", mensaje: "e" }),
    ]);
    // Ordenados por gravedad, como en Claude Code.
    expect(out).toContain("  ✘ [Line 12:5] e\n  ⚠ [Line 12:5] w\n  ℹ [Line 12:5] i\n  ★ [Line 12:5] h</new-diagnostics>");
  });

  it("varios ficheros, separados por una línea en blanco y con su ruta ENTERA (decisión B4)", () => {
    const out = redactarDiagnosticos([d(), d({ ruta: "/menu/index.html", linea: 3, columna: 1 })])!;
    expect(out).toContain("/index.html:\n  ✘ [Line 12:5] algo falla\n\n/menu/index.html:\n  ✘ [Line 3:1] algo falla");
  });

  it("topes como los de Claude Code: 10 por fichero y 30 en total", () => {
    const muchos = Array.from({ length: 50 }, (_, i) => d({ mensaje: `m${i}` }));
    const otros = Array.from({ length: 50 }, (_, i) => d({ ruta: `/p${Math.floor(i / 10)}/index.html`, mensaje: `n${i}` }));
    const uno = redactarDiagnosticos(muchos)!;
    expect((uno.match(/✘/g) ?? []).length).toBe(10);
    const varios = redactarDiagnosticos(otros)!;
    expect((varios.match(/✘/g) ?? []).length).toBe(30);
  });

  it("más de 4.000 caracteres se corta con «…[truncated]»", () => {
    const largo = Array.from({ length: 10 }, (_, i) => d({ mensaje: `${i}`.padEnd(600, "x") }));
    const out = redactarDiagnosticos(largo)!;
    const cuerpo = out.slice(out.indexOf("\n\n") + 2, out.indexOf("</new-diagnostics>"));
    expect(cuerpo.length).toBe(4000 - 12 + "…[truncated]".length);
    expect(cuerpo.endsWith("…[truncated]")).toBe(true);
  });

  it("nada que decir ⇒ null: una página sana no cuesta un token", () => {
    expect(redactarDiagnosticos([])).toBeNull();
  });
});

describe("claveDeDiagnostico: la identidad de un diagnóstico, sin el rango", () => {
  it("mensaje, gravedad, fuente y código — y el fichero, porque aquí hay un solo registro", () => {
    expect(claveDeDiagnostico(d())).toBe(claveDeDiagnostico(d()));
    expect(claveDeDiagnostico(d({ ruta: "/a/index.html" }))).not.toBe(claveDeDiagnostico(d()));
    expect(claveDeDiagnostico(d({ codigo: "x" }))).not.toBe(claveDeDiagnostico(d()));
    expect(claveDeDiagnostico(d({ gravedad: "Warning" }))).not.toBe(claveDeDiagnostico(d()));
  });

  // Decisión nuestra, dicha en `diagnosticos.ts`: un Edit que mete una línea
  // arriba no vuelve «nuevo» lo que ya estaba debajo.
  it("el mismo problema, corrido de línea por una edición, es el mismo", () => {
    expect(claveDeDiagnostico(d({ linea: 13, columna: 9 }))).toBe(claveDeDiagnostico(d()));
  });
});

describe("NuevosDiagnosticos: sólo lo nuevo, y nunca dos veces", () => {
  it("resta la línea base del fichero y lo ya entregado", () => {
    const n = new NuevosDiagnosticos();
    const viejo = d({ mensaje: "venía roto" });
    const nuevo = d({ mensaje: "lo rompiste tú", linea: 20 });
    expect(n.nuevos([viejo, nuevo], [viejo])).toEqual([nuevo]);
    // Entregado una vez, no se repite aunque siga ahí.
    expect(n.nuevos([viejo, nuevo], [viejo])).toEqual([]);
  });
});

describe("posiciones en el fichero", () => {
  const html = "<html>\n<body>\n  <a href=\"tel:5512345678\">Llama</a>\n</body>";
  it("posicionEnIndice cuenta líneas y columnas desde 1", () => {
    expect(posicionEnIndice(html, html.indexOf("<a"))).toEqual({ linea: 3, columna: 3 });
    expect(posicionEnIndice(html, 0)).toEqual({ linea: 1, columna: 1 });
  });
  it("posicionDe busca el primer sitio donde aparece; si no está, null", () => {
    expect(posicionDe(html, "tel:5512345678")).toEqual({ linea: 3, columna: 12 });
    expect(posicionDe(html, "no está")).toBeNull();
  });
});
