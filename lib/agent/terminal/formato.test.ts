// @vitest-environment node
// Los formatos del Bash de Claude Code (leídos en su binario 2.1.293).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatDuration, formatFileSize, persistedOutput } from "./formato";

describe("como Claude Code", () => {
  it("formatDuration: su Zt", () => {
    expect([0, 1000, 30_000, 59_999, 90_500, 120_000, 600_000].map(formatDuration)).toEqual(["0s", "1s", "30s", "59s", "1m 31s", "2m 0s", "10m 0s"]);
  });

  it("la copia del trabajador (`duracion`, en el .mjs) dice lo mismo que formatDuration", () => {
    // El trabajador no se puede importar (arranca con `parentPort`): se lee su función.
    const fuente = readFileSync(path.join(__dirname, "trabajador.mjs"), "utf8");
    const cuerpo = /function duracion\(ms\) \{[\s\S]*?\n\}/.exec(fuente)?.[0];
    expect(cuerpo).toBeDefined();
    const duracion = new Function(`${cuerpo}; return duracion;`)() as (ms: number) => string;
    for (const ms of [1, 999, 1000, 30_000, 59_999, 60_000, 90_500, 119_600, 120_000, 600_000, 3_599_999, 3_600_000]) {
      expect(duracion(ms), String(ms)).toBe(formatDuration(ms));
    }
  });

  it("formatFileSize: bytes, KB y MB sin el .0", () => {
    expect([1023, 2000, 46_285, 2 * 1024 * 1024].map(formatFileSize)).toEqual(["1023 bytes", "2KB", "45.2KB", "2MB"]);
  });

  it("🔴 persistedOutput: el bloque, con la vista previa cortada en un salto de línea", () => {
    const text = Array.from({ length: 5000 }, (_, i) => `linea ${i}`).join("\n");
    const b = persistedOutput({ path: "/tmp/tool-results/1.txt", text });
    expect(b.startsWith(`<persisted-output>\nOutput too large (${formatFileSize(text.length)}). Full output saved to: /tmp/tool-results/1.txt\n\nPreview (first 2KB):\nlinea 0\n`)).toBe(true);
    expect(b.endsWith("\n...\n</persisted-output>")).toBe(true);
    const vista = b.split("Preview (first 2KB):\n")[1]!.split("\n...\n")[0]!;
    expect(vista.length).toBeLessThanOrEqual(2000);
    expect(text.startsWith(vista + "\n")).toBe(true);
  });
});
