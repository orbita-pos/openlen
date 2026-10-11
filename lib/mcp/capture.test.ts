// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/origen-de-medida", () => ({
  origenDeMedida: vi.fn(async () => ({ origin: "http://127.0.0.1:9", publicar: () => ({ url: "http://127.0.0.1:9/doc" }) })),
  esperarALaRed: vi.fn(async () => undefined),
}));
vi.mock("@/lib/security/render-ssrf-guard", () => ({ installSubresourceSsrfGuard: vi.fn(async () => undefined) }));
vi.mock("@/lib/lienzo/documento", () => ({ carpetaDeLaVista: vi.fn(async () => null), documentoMedible: (html: string) => html }));
vi.mock("@/lib/agent/verify", () => ({ describeMeasurements: () => "Nothing overflows." }));

import { captureProjectView } from "./capture";

const vista = { projectId: "p1", title: null, sub: null, pagina: null, settings: undefined, logoUrl: null };

function fakeBrowser(screenshot = vi.fn(async () => "BASE64")) {
  const page = {
    setViewport: vi.fn(async () => undefined),
    goto: vi.fn(async () => undefined),
    evaluate: vi.fn(async () => 1200),
    screenshot,
    close: vi.fn(async () => undefined),
  };
  return { browser: { newPage: async () => page, close: vi.fn(async () => undefined) }, page };
}

describe("captureProjectView", () => {
  it("devuelve la captura JPEG del viewport y las medidas", async () => {
    const { browser, page } = fakeBrowser();
    const r = await captureProjectView(
      { html: "<p>", vista, viewport: "mobile", fullPage: false },
      { lanzar: async () => browser as never, medir: async () => ({}) as never },
    );
    expect(r.image).toEqual({ mimeType: "image/jpeg", dataBase64: "BASE64" });
    expect(r.measurements).toBe("Nothing overflows.");
    expect(page.setViewport).toHaveBeenCalledWith(expect.objectContaining({ width: 390 }));
    expect(page.screenshot).toHaveBeenCalledWith(expect.objectContaining({ type: "jpeg" }));
    expect(page.screenshot).toHaveBeenCalledWith(expect.not.objectContaining({ clip: expect.anything() }));
  });

  it("página entera: recorta a lo que mide la página, con un tope de 4096", async () => {
    const { browser, page } = fakeBrowser();
    await captureProjectView(
      { html: "<p>", vista, viewport: "desktop", fullPage: true },
      { lanzar: async () => browser as never, medir: async () => ({}) as never },
    );
    expect(page.screenshot).toHaveBeenCalledWith(expect.objectContaining({ clip: { x: 0, y: 0, width: 1280, height: 1200 } }));
  });

  it("si Chromium cuelga, vuelve a tiempo con lo que tenga (nunca cuelga la llamada)", async () => {
    const r = await captureProjectView(
      { html: "<p>", vista, viewport: "desktop", fullPage: false },
      { lanzar: () => new Promise(() => {}), medir: () => new Promise(() => {}), plazoMs: 50 },
    );
    expect(r).toEqual({ image: null, measurements: null });
  });

  it("si la captura falla pero la medida sale, devuelve la medida", async () => {
    const { browser } = fakeBrowser(vi.fn(async () => { throw new Error("crash"); }));
    const r = await captureProjectView(
      { html: "<p>", vista, viewport: "desktop", fullPage: false },
      { lanzar: async () => browser as never, medir: async () => ({}) as never },
    );
    expect(r).toEqual({ image: null, measurements: "Nothing overflows." });
  });
});
