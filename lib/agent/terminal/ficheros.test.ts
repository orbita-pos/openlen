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

describe("salidaDeLaTerminal", () => {
  it("la salida, los errores y la línea del código de salida, como la terminal de DeepSeek", () => {
    expect(salidaDeLaTerminal({ stdout: "1:<h1>Marejada</h1>\n", stderr: "", exitCode: 0 }).texto).toBe(
      "1:<h1>Marejada</h1>\n[Command finished with exit code 0]",
    );
    expect(salidaDeLaTerminal({ stdout: "", stderr: "bash: curl: command not found\n", exitCode: 127 })).toEqual({
      texto: "bash: curl: command not found\n[Command finished with exit code 127]",
      exitCode: 127,
    });
  });
  it("🔴 lo que pasa de 30.000 caracteres: el bloque de Claude Code con la ruta donde se guardó", () => {
    const texto = "x\n".repeat(20_000);
    const r = salidaDeLaTerminal({ stdout: texto, stderr: "", exitCode: 0, persistida: "/tmp/tool-results/1.txt" });
    expect(r.texto.startsWith("<persisted-output>\nOutput too large (39.1KB). Full output saved to: /tmp/tool-results/1.txt\n")).toBe(true);
    expect(r.texto).toMatch(/<\/persisted-output>\n\[Command finished with exit code 0\]$/);
    expect(MAX_SALIDA).toBe(30_000);
  });

  it("si no se pudo guardar, lo que cabe y el aviso de Claude Code", () => {
    const largo = "a".repeat(MAX_SALIDA + 500);
    const { texto } = salidaDeLaTerminal({ stdout: largo, stderr: "", exitCode: 0 });
    expect(texto.startsWith("a".repeat(MAX_SALIDA))).toBe(true);
    expect(texto).toContain("Output too large (29.8KB). It could not be saved, so only the first 29.3KB are shown; the rest was dropped. If the tool can page or filter its results, call it again for the part you need.");
    expect(texto.endsWith("[Command finished with exit code 0]")).toBe(true);
  });
  it("un guardado rechazado deja el código distinto de 0 aunque el comando terminara bien", () => {
    const r = salidaDeLaTerminal({
      stdout: "",
      stderr: "",
      exitCode: 0,
      guardado: ["/AGENTS.md: not saved — it is read-only. The file is back as it was."],
      rechazado: true,
    });
    expect(r.exitCode).toBe(1);
    expect(r.texto).toBe("/AGENTS.md: not saved — it is read-only. The file is back as it was.\n[Command finished with exit code 1]");
  });
  it("si la terminal se reinició, lo dice antes del código", () => {
    const r = salidaDeLaTerminal({ stdout: "", stderr: "", exitCode: 124, reiniciada: "The terminal was reset: the next command starts fresh." });
    expect(r.texto).toBe("The terminal was reset: the next command starts fresh.\n[Command finished with exit code 124]");
  });
});
