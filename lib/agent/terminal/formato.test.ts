// @vitest-environment node
// Los formatos del Bash de Claude Code.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatDuration, formatFileSize, persistedOutput } from "./formato";

describe("como Claude Code", () => {
  it("formatDuration: como el de Claude Code", () => {
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

  it("🔴 persistedOutput: preserva principio y final (head + tail) cortados en saltos de línea", () => {
    const text = Array.from({ length: 5000 }, (_, i) => `linea ${i}`).join("\n") + "\nERROR TS2345: Type 'string' is not assignable to type 'number'.";
    const b = persistedOutput({ path: "/tmp/tool-results/1.txt", text });
    expect(b.startsWith(`<persisted-output>\nOutput too large (${formatFileSize(text.length)}). Full output saved to: /tmp/tool-results/1.txt\n\nPreview (head + tail, omitted `)).toBe(true);
    expect(b).toContain("linea 0\n");
    expect(b).toContain("\n...\n");
    expect(b).toContain("ERROR TS2345: Type 'string' is not assignable to type 'number'.");
    expect(b.endsWith("\n</persisted-output>")).toBe(true);
    const body = b.split("):\n")[1]!.slice(0, -"\n</persisted-output>".length);
    const [head, tail] = body.split("\n...\n");
    expect(head!.length).toBeLessThanOrEqual(1200);
    expect(tail!.length).toBeLessThanOrEqual(1200);
    expect(text.startsWith(head! + "\n")).toBe(true);
    expect(text.endsWith(tail!)).toBe(true);
  });
});
