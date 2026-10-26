// A PDF's pages, drawn by pdf.js inside the eyes' Chromium (26/10), the way
// Claude Code's Read hands pages to the model as images. The PDFs are made by
// Chromium itself (`page.pdf()`), so each test knows exactly what is on each
// page; the control arm is a black page against a white one, so "it drew
// something" can't pass on a blank render.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "puppeteer";
import { imageSize } from "image-size";

import { lanzarChromium } from "@/lib/ai/visual-quality-renderer";

import { PDF_PAGE_WIDTH, renderPdfPages } from "./pdf-pages";

let browser: Browser;
beforeAll(async () => {
  browser = await lanzarChromium();
}, 60_000);
afterAll(async () => {
  await browser?.close();
});

/** A PDF whose pages have these background colors, one page each. */
async function pdfOf(colors: readonly string[]): Promise<Uint8Array> {
  const page = await browser.newPage();
  try {
    const pages = colors
      .map((c, i) => `<section style="background:${c};height:100vh;break-after:page;color:#888;font:48px Arial">Page ${i + 1}</section>`)
      .join("");
    await page.setContent(`<!doctype html><html><head><style>@page{size:A4;margin:0}body{margin:0}</style></head><body>${pages}</body></html>`);
    return await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
  } finally {
    await page.close();
  }
}

/** Mean brightness (0–255) of a JPEG, decoded by the browser. */
async function brightness(dataBase64: string): Promise<number> {
  const page = await browser.newPage();
  try {
    return (await page.evaluate(`(async () => {
      const img = new Image();
      img.src = "data:image/jpeg;base64,${dataBase64}";
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      const g = c.getContext("2d");
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 4) sum += (d[i] + d[i + 1] + d[i + 2]) / 3;
      return sum / (d.length / 4);
    })()`)) as number;
  } finally {
    await page.close();
  }
}

describe("renderPdfPages — a PDF's pages as images", () => {
  it("🔴 a short PDF comes back whole, one JPEG per page, and each page is the one drawn (black is dark, white is light)", async () => {
    const r = await renderPdfPages(await pdfOf(["#000", "#fff", "#000"]), null, { lanzar: async () => browser, keepBrowser: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([r.pageCount, r.first, r.last, r.images.length]).toEqual([3, 1, 3, 3]);
    for (const im of r.images) {
      expect(im.mimeType).toBe("image/jpeg");
      expect(imageSize(Buffer.from(im.dataBase64, "base64")).width).toBe(PDF_PAGE_WIDTH);
    }
    const [b1, b2, b3] = await Promise.all(r.images.map((im) => brightness(im.dataBase64)));
    expect(b1).toBeLessThan(60);
    expect(b2).toBeGreaterThan(200);
    expect(b3).toBeLessThan(60);
  }, 120_000);

  it("more than 10 pages without a range is refused with the count, as Claude Code does", async () => {
    const r = await renderPdfPages(await pdfOf(Array.from({ length: 12 }, () => "#fff")), null, { lanzar: async () => browser, keepBrowser: true });
    expect(r).toEqual({ ok: false, reason: "too_many_pages", pageCount: 12 });
  }, 120_000);

  it("a range is drawn as asked and cut at the last page; one past the end is out of range", async () => {
    const pdf = await pdfOf(Array.from({ length: 12 }, (_, i) => (i === 10 ? "#000" : "#fff")));
    const r = await renderPdfPages(pdf, { first: 11, last: 15 }, { lanzar: async () => browser, keepBrowser: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect([r.pageCount, r.first, r.last, r.images.length]).toEqual([12, 11, 12, 2]);
    expect(await brightness(r.images[0]!.dataBase64)).toBeLessThan(60);
    expect(await renderPdfPages(pdf, { first: 13, last: 14 }, { lanzar: async () => browser, keepBrowser: true })).toEqual({
      ok: false,
      reason: "page_out_of_range",
      pageCount: 12,
    });
  }, 120_000);

  it("bytes that aren't a PDF are corrupted", async () => {
    const r = await renderPdfPages(new TextEncoder().encode("%PDF-1.7\nthis is not a pdf at all\n%%EOF"), null, { lanzar: async () => browser, keepBrowser: true });
    expect(r).toEqual({ ok: false, reason: "corrupted" });
  }, 120_000);
});
