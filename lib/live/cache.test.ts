// @vitest-environment node
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCachedSheet, putCachedSheet } from "./cache";
import type { SheetData } from "./sheet-source";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ol-live-cache-test-"));
  vi.stubEnv("OPENLEN_LIVE_CACHE_DIR", dir);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

function sampleData(): SheetData {
  return {
    values: new Map([
      ["precio-taco", "$45"],
      ["stock-playeras", "12"],
    ]),
    rows: [
      { key: "precio-taco", value: "$45" },
      { key: "stock-playeras", value: "12" },
    ],
  };
}

describe("cache de datos vivos (FS, por URL de Sheet, con TTL)", () => {
  it("roundtrip put→get dentro del TTL: rows y el Map de values sobreviven intactos", async () => {
    const url = "https://docs.google.com/spreadsheets/d/ABC123/edit";
    await putCachedSheet(url, sampleData());

    const got = await getCachedSheet(url, 60_000);

    expect(got).not.toBeNull();
    expect(got!.rows).toEqual(sampleData().rows);
    expect(got!.values).toBeInstanceOf(Map);
    expect(got!.values.get("precio-taco")).toBe("$45");
    expect(got!.values.get("stock-playeras")).toBe("12");
    expect(got!.values.size).toBe(2);
  });

  it("pasado el TTL → null (dato expirado se trata como miss)", async () => {
    const url = "https://docs.google.com/spreadsheets/d/ABC123/edit";
    await putCachedSheet(url, sampleData());

    // ttlMs=0 con cualquier avance de reloj real, por mínimo que sea, ya expiró.
    await new Promise((r) => setTimeout(r, 5));
    expect(await getCachedSheet(url, 0)).toBeNull();
  });

  it("miss simple: nunca se puso nada para esa URL → null", async () => {
    expect(
      await getCachedSheet("https://docs.google.com/spreadsheets/d/NUNCA-PUESTO/edit", 60_000),
    ).toBeNull();
  });

  it("dos URLs distintas no colisionan (clave saneada por URL)", async () => {
    const urlA = "https://docs.google.com/spreadsheets/d/AAA111/edit";
    const urlB = "https://docs.google.com/spreadsheets/d/BBB222/edit";
    await putCachedSheet(urlA, { values: new Map([["a", "1"]]), rows: [{ a: "1" }] });
    await putCachedSheet(urlB, { values: new Map([["b", "2"]]), rows: [{ b: "2" }] });

    expect((await getCachedSheet(urlA, 60_000))!.values.get("a")).toBe("1");
    expect((await getCachedSheet(urlB, 60_000))!.values.get("b")).toBe("2");
  });

  it("respeta OPENLEN_LIVE_CACHE_DIR: el archivo aterriza dentro del dir de prueba", async () => {
    const url = "https://docs.google.com/spreadsheets/d/CCC333/edit";
    await putCachedSheet(url, sampleData());

    const { readdirSync } = await import("node:fs");
    expect(readdirSync(dir).length).toBeGreaterThan(0);
  });

  it("get falla en silencio y devuelve null si el archivo tiene JSON corrupto", async () => {
    const url = "https://docs.google.com/spreadsheets/d/DDD444/edit";
    await putCachedSheet(url, sampleData());

    const { readdirSync, writeFileSync } = await import("node:fs");
    const file = readdirSync(dir)[0];
    writeFileSync(join(dir, file), "{ esto no es JSON válido", "utf8");

    expect(await getCachedSheet(url, 60_000)).toBeNull();
  });

  it("put falla en silencio si el dir es inescribible (cache es mejora, no dependencia)", async () => {
    vi.stubEnv("OPENLEN_LIVE_CACHE_DIR", join(dir, "no\0valid"));
    const url = "https://docs.google.com/spreadsheets/d/EEE555/edit";
    await expect(putCachedSheet(url, sampleData())).resolves.toBeUndefined();
  });

  it("get falla en silencio si el dir de cache no existe en absoluto", async () => {
    vi.stubEnv("OPENLEN_LIVE_CACHE_DIR", join(dir, "jamas-creado"));
    const url = "https://docs.google.com/spreadsheets/d/FFF666/edit";
    expect(await getCachedSheet(url, 60_000)).toBeNull();
  });
});
