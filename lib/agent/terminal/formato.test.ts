// @vitest-environment node
// Los formatos del Bash de Claude Code.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatDuration, formatFileSize, headAndTail, persistedOutput } from "./formato";

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

  // C4 of the Ruta 98 review: the two cuts of the preview.
  const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
  const previewBody = (b: string) => b.split("):\n")[1]!.slice(0, -"\n</persisted-output>".length);

  it("🔴 persistedOutput: the head's cut never splits a surrogate pair", () => {
    // No newline in the first 1.200 characters, and the emoji (2 units) straddles index 1.200.
    const text = "a".repeat(1199) + "\u{1F600}" + "b".repeat(3000);
    const b = persistedOutput({ path: "/tmp/tool-results/1.txt", text });
    expect(LONE_SURROGATE.test(b)).toBe(false);
    const [head] = previewBody(b).split("\n...\n");
    expect(head).toBe("a".repeat(1199));
  });

  it("🔴 persistedOutput: the tail's cut never splits a surrogate pair", () => {
    // No newline anywhere, and the emoji straddles index len - 1.200, where the tail starts.
    const text = "a".repeat(3000) + "\u{1F600}" + "b".repeat(1199);
    expect(text.length - 1200).toBe(3001);
    const b = persistedOutput({ path: "/tmp/tool-results/1.txt", text });
    expect(LONE_SURROGATE.test(b)).toBe(false);
    const [, tail] = previewBody(b).split("\n...\n");
    expect(tail).toBe("b".repeat(1199));
  });

  it("🔴 persistedOutput: a tail cut that lands exactly on a line start keeps that line", () => {
    const tailBlock = "IMPORTANT FIRST LINE OF THE TAIL".padEnd(600, "x") + "\n" + "z".repeat(599);
    expect(tailBlock.length).toBe(1200);
    const text = "m".repeat(2000) + "\n" + tailBlock;
    expect(text.length - 1200).toBe(2001);
    const b = persistedOutput({ path: "/tmp/tool-results/1.txt", text });
    const [, tail] = previewBody(b).split("\n...\n");
    expect(tail).toBe(tailBlock);
  });

  it("headAndTail: cuts at line breaks inside its budgets, and the two halves never overlap", () => {
    const text = Array.from({ length: 400 }, (_, i) => `line ${i}`).join("\n");
    const { head, tail } = headAndTail(text, 300, 300);
    expect(head.length).toBeLessThanOrEqual(300);
    expect(tail.length).toBeLessThanOrEqual(300);
    expect(head.endsWith("\n")).toBe(false);
    expect(text.startsWith(`${head}\n`)).toBe(true);
    expect(text.endsWith(tail)).toBe(true);
    expect(tail.startsWith("line ")).toBe(true);
    expect(text.indexOf(tail)).toBeGreaterThanOrEqual(head.length);
  });
});
