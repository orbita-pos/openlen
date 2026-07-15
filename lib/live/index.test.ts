// @vitest-environment node
import { describe, it, expect, vi, afterEach } from "vitest";
import { applyLiveData } from "./index";
import type { SheetData } from "./sheet-source";

const PAGE = `<!doctype html><html><body><span data-ol-live="precio-taco">$40</span></body></html>`;
const URL = "https://docs.google.com/spreadsheets/d/ABC123/edit";

function sheetData(): SheetData {
  return { values: new Map([["precio-taco", "$45"]]), rows: [{ key: "precio-taco", value: "$45" }] };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("applyLiveData — orquestador never-throw", () => {
  it("kill-switch apagado → html intacto, fallback='disabled', nada se llama", async () => {
    vi.stubEnv("OPENLEN_LIVE_DATA", "0");
    const fetchSheet = vi.fn(async () => sheetData());
    const getCachedSheet = vi.fn(async () => null);
    const putCachedSheet = vi.fn(async () => {});

    const out = await applyLiveData(PAGE, URL, { deps: { fetchSheet, getCachedSheet, putCachedSheet } });

    expect(out.html).toBe(PAGE);
    expect(out.report).toEqual({ baked: 0, fallback: "disabled" });
    expect(fetchSheet).not.toHaveBeenCalled();
    expect(getCachedSheet).not.toHaveBeenCalled();
  });

  it("flujo feliz: cache en miss → fetchSheet + putCachedSheet + bake escribe", async () => {
    const fetchSheet = vi.fn(async () => sheetData());
    const getCachedSheet = vi.fn(async () => null);
    const putCachedSheet = vi.fn(async () => {});

    const out = await applyLiveData(PAGE, URL, { deps: { fetchSheet, getCachedSheet, putCachedSheet } });

    expect(out.html).toContain("$45");
    expect(out.report).toEqual({ baked: 1 });
    expect(fetchSheet).toHaveBeenCalledWith(URL, expect.any(Number));
    expect(putCachedSheet).toHaveBeenCalledWith(URL, sheetData());
  });

  it("fetch LANZA → html ORIGINAL intacto y fallback con el motivo (never-throw)", async () => {
    const fetchSheet = vi.fn(async () => {
      throw new Error("Sheet fetch falló: HTTP 404");
    });
    const getCachedSheet = vi.fn(async () => null);
    const putCachedSheet = vi.fn(async () => {});

    const out = await applyLiveData(PAGE, URL, { deps: { fetchSheet, getCachedSheet, putCachedSheet } });

    expect(out.html).toBe(PAGE);
    expect(out.report.baked).toBe(0);
    expect(out.report.fallback).toContain("HTTP 404");
    expect(putCachedSheet).not.toHaveBeenCalled();
  });

  it("sheetUrl null → html intacto, SIN fallback (la página no usa datos vivos, no es un error)", async () => {
    const fetchSheet = vi.fn(async () => sheetData());
    const getCachedSheet = vi.fn(async () => null);
    const putCachedSheet = vi.fn(async () => {});

    const out = await applyLiveData(PAGE, null, { deps: { fetchSheet, getCachedSheet, putCachedSheet } });

    expect(out.html).toBe(PAGE);
    expect(out.report).toEqual({ baked: 0 });
    expect(out.report.fallback).toBeUndefined();
    expect(fetchSheet).not.toHaveBeenCalled();
    expect(getCachedSheet).not.toHaveBeenCalled();
  });

  it("cache hit → fetchSheet NO se vuelve a llamar (spy)", async () => {
    const fetchSheet = vi.fn(async () => sheetData());
    const getCachedSheet = vi.fn(async () => sheetData());
    const putCachedSheet = vi.fn(async () => {});

    const out = await applyLiveData(PAGE, URL, { deps: { fetchSheet, getCachedSheet, putCachedSheet } });

    expect(out.html).toContain("$45");
    expect(out.report).toEqual({ baked: 1 });
    expect(fetchSheet).not.toHaveBeenCalled();
    expect(putCachedSheet).not.toHaveBeenCalled();
    expect(getCachedSheet).toHaveBeenCalledWith(URL, expect.any(Number));
  });

  it("bake LANZA (parser roto) → html ORIGINAL intacto, never-throw también aguas abajo", async () => {
    const fetchSheet = vi.fn(async () => sheetData());
    const getCachedSheet = vi.fn(async () => null);
    const putCachedSheet = vi.fn(async () => {
      throw new Error("disco lleno");
    });

    const out = await applyLiveData(PAGE, URL, { deps: { fetchSheet, getCachedSheet, putCachedSheet } });

    // putCachedSheet real nunca lanza (silencia internamente), pero si un
    // deps inyectado SÍ lanza, el orquestador igual no debe reventar.
    expect(out.html).toBe(PAGE);
    expect(out.report.fallback).toContain("disco lleno");
  });
});
