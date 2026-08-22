import { describe, expect, it, vi } from "vitest";

import type { ComputedStylesSweep, ElementSnapshot, ScrapeResult } from "./types";

const scrapeMock = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("./scrape/fetch-puppeteer", () => ({ fetchPuppeteer: scrapeMock.fn }));

const { referenceFromUrl } = await import("./reference");

function el(styles: Partial<ElementSnapshot["styles"]> = {}): ElementSnapshot {
  return {
    tag: "p",
    role: null,
    rect: { width: 200, height: 40, top: 0, left: 0 },
    zIndex: 0,
    styles: {
      color: "rgb(17, 17, 17)",
      backgroundColor: "rgb(255, 255, 255)",
      borderColor: "rgb(0, 0, 0)",
      fontFamily: "Söhne, sans-serif",
      fontSize: "16px",
      fontWeight: "400",
      lineHeight: "24px",
      letterSpacing: "normal",
      borderRadius: "8px",
      boxShadow: "none",
      padding: "16px",
      margin: "0px",
      gap: "8px",
      ...styles,
    },
  };
}

function okScrape(conCaptura = true): { ok: true; value: ScrapeResult } {
  const computedStyles: ComputedStylesSweep = {
    elements: Array.from({ length: 12 }, () => el()),
    documentHeight: 2000,
    documentWidth: 1440,
  };
  return {
    ok: true,
    value: {
      url: "https://ejemplo.test/",
      hostname: "ejemplo.test",
      finalUrl: "https://ejemplo.test/",
      html: "<html></html>",
      rendered: true,
      computedStyles,
      ...(conCaptura ? { screenshot: Buffer.from("jpegfalso") } : {}),
      fetchedAt: new Date(),
      tier: 2 as const,
      durationMs: 10,
      sizeBytes: 100,
    },
  };
}

const cliente = (impl: unknown) => ({ request: impl }) as never;

describe("la tubería completa", () => {
  it("de una URL sale una dirección con paleta MEDIDA", async () => {
    scrapeMock.fn.mockResolvedValueOnce(okScrape());
    const r = await referenceFromUrl("https://ejemplo.test/", {
      requestId: "r1",
      client: cliente(async () => ({
        ok: true,
        value: { character: "Respira mucho y el peso cae en la tipografía." },
      })),
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.direction.palette.length).toBeGreaterThan(0);
      expect(r.direction.character).toContain("tipografía");
    }
  });

  // La mitad cara es opcional POR DISEÑO. Sin cliente de visión (o con la
  // visión caída) la paleta medida sale igual — y es lo que más vale.
  it("sin cliente de visión, la dirección medida sale igual", async () => {
    scrapeMock.fn.mockResolvedValueOnce(okScrape());
    const r = await referenceFromUrl("https://ejemplo.test/", { requestId: "r1" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.direction.palette.length).toBeGreaterThan(0);
      expect(r.direction.character).toBeUndefined();
    }
  });

  it("si Qwen falla, la dirección sigue saliendo", async () => {
    scrapeMock.fn.mockResolvedValueOnce(okScrape());
    const r = await referenceFromUrl("https://ejemplo.test/", {
      requestId: "r1",
      client: cliente(async () => {
        throw new Error("caído");
      }),
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.direction.character).toBeUndefined();
  });

  it("sin captura no se llama a la visión — no se paga por nada", async () => {
    scrapeMock.fn.mockResolvedValueOnce(okScrape(false));
    const spy = vi.fn(async () => ({ ok: true, value: { character: "x".repeat(30) } }));
    const r = await referenceFromUrl("https://ejemplo.test/", {
      requestId: "r1",
      client: cliente(spy),
    });
    expect(r.ok).toBe(true);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("los fallos, y qué se le cuenta al cliente", () => {
  // NUNCA se detalla un bloqueo SSRF: decirle "resuelve a 10.0.0.5" le
  // confirma qué hay vivo en la red interna. El código es opaco a propósito.
  it.each([
    ["ssrf-blocked", "blocked"],
    ["invalid-url", "blocked"],
    ["timeout", "unreachable"],
    ["challenge", "unreachable"],
    ["network", "unreachable"],
  ])("%s se traduce a %s", async (kind, code) => {
    scrapeMock.fn.mockResolvedValueOnce({ ok: false, error: { kind, reason: "x", message: "x" } });
    const r = await referenceFromUrl("https://x.test/", { requestId: "r1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe(code);
  });

  it("el detalle del bloqueo NO viaja al cliente", async () => {
    scrapeMock.fn.mockResolvedValueOnce({
      ok: false,
      error: { kind: "ssrf-blocked", reason: "resolves to private IP 10.0.0.5" },
    });
    const r = await referenceFromUrl("https://x.test/", { requestId: "r1" });
    expect(JSON.stringify(r)).not.toContain("10.0.0.5");
  });

  // Sin estilos calculados no hay paleta, y dar una inventada sería peor que
  // no dar ninguna.
  it("un scrape sin estilos calculados se rechaza", async () => {
    const sin = okScrape();
    scrapeMock.fn.mockResolvedValueOnce({
      ok: true,
      value: { ...sin.value, computedStyles: undefined },
    });
    const r = await referenceFromUrl("https://x.test/", { requestId: "r1" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("not_rendered");
  });
});
