// LA RETENCIÓN DE RESULTADOS GRANDES, la `spill-policy` de DeepSeek: un
// resultado de más de 12.500 tokens estimados se queda con su principio y su
// final, y el texto entero va a un fichero que el modelo puede leer.
import { describe, expect, it } from "vitest";
import { SPILL_GAP, SPILL_MAX_INLINE_TOKENS, retainOversized } from "./spill";

const guardado = () => {
  const ficheros: Record<string, string> = {};
  return { ficheros, save: async (path: string, text: string) => ((ficheros[path] = text), true) };
};

describe("retainOversized", () => {
  it("el tope es el de DeepSeek (maxInlineTokens del bundle base)", () => {
    expect(SPILL_MAX_INLINE_TOKENS).toBe(12_500);
  });

  it("lo que cabe no se toca ni se guarda", async () => {
    const g = guardado();
    expect(await retainOversized("corto", { maxTokens: 100, path: "/tmp/spill/x.txt", save: g.save })).toBeNull();
    expect(g.ficheros).toEqual({});
  });

  it("🔴 lo que no cabe: principio, el hueco, el final y el aviso con la ruta; el texto entero, en el fichero", async () => {
    const g = guardado();
    const texto = "A".repeat(2000) + "B".repeat(2000) + "C".repeat(2000);
    const out = (await retainOversized(texto, { maxTokens: 400, path: "/tmp/spill/3-0-session_event_read.txt", save: g.save }))!;
    expect(g.ficheros["/tmp/spill/3-0-session_event_read.txt"]).toBe(texto);
    expect(out.startsWith("AAAA")).toBe(true);
    expect(out).toContain(SPILL_GAP);
    expect(out).toMatch(/C+\n\n\(Omitted \d+ bytes\. Full formatted result stored at: \/tmp\/spill\/3-0-session_event_read\.txt\. /);
    expect(out.endsWith(")")).toBe(true);
    // Dentro del presupuesto (3,5 caracteres por token, como el resto de la compactación).
    expect(Math.ceil(out.length / 3.5)).toBeLessThanOrEqual(400);
    // Los bytes omitidos son los del medio de verdad.
    const omitidos = Number(/Omitted (\d+) bytes/.exec(out)![1]);
    const [cabeza, resto] = out.split(SPILL_GAP);
    const cola = resto!.slice(0, resto!.indexOf("\n\n("));
    expect(omitidos).toBe(texto.length - cabeza!.length - cola.length);
  });

  it("si no se puede guardar, el resultado se queda ENTERO (como DeepSeek: el fallo no lo esconde)", async () => {
    const texto = "x".repeat(10_000);
    expect(await retainOversized(texto, { maxTokens: 100, path: "/tmp/spill/a.txt", save: async () => false })).toBeNull();
    expect(await retainOversized(texto, { maxTokens: 100, path: "/tmp/spill/a.txt", save: async () => { throw new Error("terminal caída"); } })).toBeNull();
  });

  it("no parte un emoji por la mitad", async () => {
    const g = guardado();
    const out = (await retainOversized("😀".repeat(3000), { maxTokens: 300, path: "/tmp/spill/e.txt", save: g.save }))!;
    expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });
});
