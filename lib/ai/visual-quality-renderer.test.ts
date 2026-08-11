import { describe, expect, it, vi } from "vitest";

import { renderVisualQualityViewports } from "./visual-quality-renderer";

const HTML = "<!doctype html><html><body>hello</body></html>";

describe("renderVisualQualityViewports", () => {
  it("captures desktop then mobile with the exact calibrated viewports", async () => {
    const calls: Array<{ width: number; height: number }> = [];
    const result = await renderVisualQualityViewports(HTML, {
      capture: async (_html, viewport) => {
        calls.push(viewport);
        return {
          mimeType: "image/jpeg",
          dataBase64: Buffer.from(String(viewport.width)).toString("base64"),
        };
      },
    });

    expect(calls).toEqual([{ width: 1280, height: 720 }, { width: 390, height: 844 }]);
    expect(result).toMatchObject({
      desktop: { mimeType: "image/jpeg" },
      mobile: { mimeType: "image/jpeg" },
    });
  });

  it("returns null when either capture is missing or exceeds one MiB", async () => {
    expect(await renderVisualQualityViewports(HTML, {
      capture: async (_html, viewport) => viewport.width === 1280
        ? { mimeType: "image/jpeg", dataBase64: "" }
        : null,
    })).toBeNull();

    const oversized = Buffer.alloc(1024 * 1024 + 1).toString("base64");
    expect(await renderVisualQualityViewports(HTML, {
      capture: async () => ({ mimeType: "image/jpeg", dataBase64: oversized }),
    })).toBeNull();
  });

  it("uses one browser lifecycle and installs the SSRF guard before loading HTML", async () => {
    const order: string[] = [];
    let evaluations = 0;
    const page = {
      setViewport: vi.fn(async ({ width }: { width: number }) => { order.push(`viewport:${width}`); }),
      setContent: vi.fn(async () => { order.push("content"); }),
      evaluate: vi.fn(async () => { evaluations += 1; order.push(evaluations === 3 ? "overflow" : "fonts"); return false; }),
      screenshot: vi.fn(async () => Buffer.from("jpeg")),
    };
    const close = vi.fn(async () => { order.push("close"); });

    const result = await renderVisualQualityViewports(HTML, {
      launchBrowser: async () => ({
        newPage: async () => page,
        close,
      }),
      installGuard: async () => { order.push("guard"); },
      settle: async () => undefined,
    });

    expect(result).not.toBeNull();
    expect(order).toEqual([
      "guard", "viewport:1280", "content", "fonts", "viewport:390", "fonts", "overflow", "close",
    ]);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("reports document-level horizontal overflow measured at the mobile viewport", async () => {
    const page = {
      setViewport: vi.fn(async () => undefined),
      setContent: vi.fn(async () => undefined),
      evaluate: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rootScrollWidth: 392, bodyScrollWidth: 390, clientWidth: 390 }),
      screenshot: vi.fn(async () => Buffer.from("jpeg")),
    };

    const result = await renderVisualQualityViewports(HTML, {
      launchBrowser: async () => ({ newPage: async () => page, close: async () => undefined }),
      installGuard: async () => undefined,
      settle: async () => undefined,
    });

    expect(result).toMatchObject({ mobileOverflow: true });
    expect(page.evaluate).toHaveBeenCalledTimes(3);
  });

  it("tolerates one pixel of mobile layout rounding", async () => {
    const page = {
      setViewport: vi.fn(async () => undefined),
      setContent: vi.fn(async () => undefined),
      evaluate: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({ rootScrollWidth: 391, bodyScrollWidth: 390, clientWidth: 390 }),
      screenshot: vi.fn(async () => Buffer.from("jpeg")),
    };

    const result = await renderVisualQualityViewports(HTML, {
      launchBrowser: async () => ({ newPage: async () => page, close: async () => undefined }),
      installGuard: async () => undefined,
      settle: async () => undefined,
    });

    expect(result).toMatchObject({ mobileOverflow: false });
  });

  it("reports materially weak mobile typography hierarchy from computed styles", async () => {
    const page = {
      setViewport: vi.fn(async () => undefined),
      setContent: vi.fn(async () => undefined),
      evaluate: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({
          rootScrollWidth: 390, bodyScrollWidth: 390, clientWidth: 390,
          h1FontPx: 9, heroBodyFontPx: 4,
          componentCount: 4, roundedComponentCount: 4,
        }),
      screenshot: vi.fn(async () => Buffer.from("jpeg")),
    };

    const result = await renderVisualQualityViewports(HTML, {
      launchBrowser: async () => ({ newPage: async () => page, close: async () => undefined }),
      installGuard: async () => undefined,
      settle: async () => undefined,
    });

    expect(result).toMatchObject({ weakTypographyHierarchy: true, squareComponentTreatment: false });
  });

  it("reports an essentially square set of visible components", async () => {
    const page = {
      setViewport: vi.fn(async () => undefined),
      setContent: vi.fn(async () => undefined),
      evaluate: vi.fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce({
          rootScrollWidth: 390, bodyScrollWidth: 390, clientWidth: 390,
          h1FontPx: 48, heroBodyFontPx: 17,
          componentCount: 4, roundedComponentCount: 0,
        }),
      screenshot: vi.fn(async () => Buffer.from("jpeg")),
    };

    const result = await renderVisualQualityViewports(HTML, {
      launchBrowser: async () => ({ newPage: async () => page, close: async () => undefined }),
      installGuard: async () => undefined,
      settle: async () => undefined,
    });

    expect(result).toMatchObject({ weakTypographyHierarchy: false, squareComponentTreatment: true });
  });

  it("keeps image-only capture seams geometry-neutral", async () => {
    const result = await renderVisualQualityViewports(HTML, {
      capture: async () => ({ mimeType: "image/jpeg", dataBase64: Buffer.from("jpeg").toString("base64") }),
    });

    expect(result).not.toHaveProperty("mobileOverflow");
    expect(result).not.toHaveProperty("weakTypographyHierarchy");
    expect(result).not.toHaveProperty("squareComponentTreatment");
  });

  it("closes the browser and returns null when production capture throws", async () => {
    const close = vi.fn(async () => undefined);
    const result = await renderVisualQualityViewports(HTML, {
      launchBrowser: async () => ({
        newPage: async () => ({
          setViewport: async () => undefined,
          setContent: async () => { throw new Error("render failed"); },
          evaluate: async () => undefined,
          screenshot: async () => Buffer.from("jpeg"),
        }),
        close,
      }),
      installGuard: async () => undefined,
      settle: async () => undefined,
    });

    expect(result).toBeNull();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
