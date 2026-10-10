// lib/agent/terminal/ficheros.test.ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { cambiosDeLaTerminal, esDelProyecto, MAX_SALIDA, salidaDeLaTerminal } from "./ficheros";

describe("cambiosDeLaTerminal", () => {
  const antes = { "/index.html": "<h1>Marejada</h1>", "/surf/index.html": "<h1>Surf</h1>", "/AGENTS.md": "manual" };
  it("lo reescrito, lo creado y lo borrado, en orden de ruta", () => {
    const despues = { "/index.html": "<h1>Casa Oleaje</h1>", "/AGENTS.md": "manual", "/clases/index.html": "<h1>Clases</h1>" };
    expect(cambiosDeLaTerminal(antes, despues)).toEqual([
      { tipo: "escrito", ruta: "/clases/index.html", contenido: "<h1>Clases</h1>", crea: true },
      { tipo: "escrito", ruta: "/index.html", contenido: "<h1>Casa Oleaje</h1>", crea: false },
      { tipo: "borrado", ruta: "/surf/index.html" },
    ]);
  });
  it("lo de /tmp y las carpetas del sistema no es del proyecto: no se guarda", () => {
    const despues = { ...antes, "/tmp/notas.txt": "x", "/bin/ls": "stub", "/usr/bin/x": "y" };
    expect(cambiosDeLaTerminal(antes, despues)).toEqual([]);
    expect(esDelProyecto("/tmp")).toBe(false);
    expect(esDelProyecto("/tmpfoo/index.html")).toBe(true);
    expect(esDelProyecto("/datos/menu.json")).toBe(true);
  });
  it("sin cambios, nada que guardar (un `cat` no escribe)", () => {
    expect(cambiosDeLaTerminal(antes, { ...antes })).toEqual([]);
  });
});

describe("salidaDeLaTerminal — como el Bash de Claude Code (binario 2.1.293)", () => {
  it("🔴 bien: sólo la salida, sin líneas en blanco delante ni espacio detrás; sin código", () => {
    expect(salidaDeLaTerminal({ stdout: "\n\n1:<h1>Marejada</h1>\n\n", stderr: "", exitCode: 0 })).toEqual({ texto: "1:<h1>Marejada</h1>", exitCode: 0 });
  });

  it("🔴 sin salida: «(bash completed with no output)», el texto de Claude Code para un resultado vacío", () => {
    expect(salidaDeLaTerminal({ stdout: "", stderr: "", exitCode: 0 }).texto).toBe("(bash completed with no output)");
  });

  it("🔴 un fallo empieza por «Exit code N» y sigue la salida (MKr: el código, luego lo impreso)", () => {
    expect(salidaDeLaTerminal({ stdout: "", stderr: "bash: curl: command not found\n", exitCode: 127, fallo: true })).toEqual({
      texto: "Exit code 127\nbash: curl: command not found",
      exitCode: 127,
    });
    expect(salidaDeLaTerminal({ stdout: "", stderr: "", exitCode: 2, fallo: true }).texto).toBe("Exit code 2");
  });

  it("🔴 un código que no es fallo (grep sin coincidencias: 1) no lleva línea de código, como allí", () => {
    expect(salidaDeLaTerminal({ stdout: "", stderr: "", exitCode: 1, fallo: false }).texto).toBe("(bash completed with no output)");
  });

  it("🔴 un fallo largo se recorta por el medio a 10.000 (cu: 5.000 + 5.000 y el aviso), sin fichero", () => {
    const largo = "a".repeat(6_000) + "b".repeat(6_000);
    const { texto } = salidaDeLaTerminal({ stdout: largo, stderr: "", exitCode: 1, fallo: true });
    const entero = "Exit code 1\n" + largo;
    expect(texto).toBe(`${entero.slice(0, 5_000)}\n\n... [${entero.length - 10_000} characters truncated] ...\n\n${entero.slice(-5_000)}`);
  });

  it("🔴 lo que pasa de 30.000 caracteres (y no falla): el bloque de Claude Code con la ruta donde se guardó", () => {
    const texto = "x\n".repeat(20_000);
    const r = salidaDeLaTerminal({ stdout: texto, stderr: "", exitCode: 0, persistida: "/tmp/tool-results/1.txt" });
    expect(r.texto.startsWith("<persisted-output>\nOutput too large (39.1KB). Full output saved to: /tmp/tool-results/1.txt\n")).toBe(true);
    expect(r.texto.endsWith("</persisted-output>")).toBe(true);
    expect(MAX_SALIDA).toBe(30_000);
  });

  it("si no se pudo guardar, lo que cabe y el aviso de Claude Code", () => {
    const largo = "a".repeat(MAX_SALIDA + 500);
    const { texto } = salidaDeLaTerminal({ stdout: largo, stderr: "", exitCode: 0 });
    expect(texto.startsWith("a".repeat(MAX_SALIDA))).toBe(true);
    expect(texto.endsWith("Output too large (29.8KB). It could not be saved, so only the first 29.3KB are shown; the rest was dropped. If the tool can page or filter its results, call it again for the part you need.")).toBe(true);
  });

  it("un guardado rechazado es un fallo con código 1 aunque el comando terminara bien; las notas van tras la salida", () => {
    const r = salidaDeLaTerminal({
      stdout: "",
      stderr: "",
      exitCode: 0,
      guardado: ["/AGENTS.md: not saved — it is read-only. The file is back as it was."],
      rechazado: true,
    });
    expect(r).toEqual({ texto: "Exit code 1\n/AGENTS.md: not saved — it is read-only. The file is back as it was.", exitCode: 1 });
    const bien = salidaDeLaTerminal({ stdout: "hecho\n", stderr: "", exitCode: 0, guardado: ["index.html: saved."] });
    expect(bien.texto).toBe("hecho\nindex.html: saved.");
  });

  it("el corte por tiempo con la terminal reiniciada: el código, el aviso y el reinicio", () => {
    const r = salidaDeLaTerminal({ stdout: "Command timed out after 2m 0s", stderr: "", exitCode: 143, fallo: true, reiniciada: "The terminal was reset: the next command starts fresh." });
    expect(r.texto).toBe("Exit code 143\nCommand timed out after 2m 0s\nThe terminal was reset: the next command starts fresh.");
  });
});
