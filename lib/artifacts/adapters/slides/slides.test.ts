// @vitest-environment node
import JSZip from "jszip";
import { expect, it } from "vitest";
import { parseSlideDeck } from "./manifest";
import { slideDeckHtml } from "./html";
import { exportSlideDeckPptx, validateSlideDeckPptx } from "./pptx";
import { renderSlides } from "./render";
import type { SealedArtifactInput } from "../../types";
const deck = { version: 1, width: 1280, height: 720, title: "Mi aplicación", fontFamily: "Arial", background: "101820", color: "F5F5F1", slides: [
  { id: "cover", elements: [{ id: "title", type: "text", x: 64, y: 70, w: 1100, h: 100, text: "Gestión de ventas", fontSize: 60, bold: true }, { id: "photo", type: "image", x: 64, y: 230, w: 300, h: 200, assetId: "promo-2" }] },
  { id: "data", elements: [{ id: "heading", type: "text", x: 64, y: 50, w: 1100, h: 70, text: "Así se vería el escenario", fontSize: 42 }, { id: "sales", type: "chart", x: 64, y: 160, w: 1100, h: 440, chartType: "bar", datasetId: "scenario", categoryColumn: "Zona", valueColumns: ["Ventas"] }] },
] };
const image = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jw1sAAAAASUVORK5CYII=", "base64"));
const input = { artifact: { kind: "slides" }, revision: { files: { "deck.json": JSON.stringify(deck) } }, datasets: [{ id: "scenario", mode: "scenario", environment: null, visibility: "project", columns: ["Zona", "Ventas"], rows: [["Norte", 120], ["Sur", 80]], query: null, source: "scenario", capturedAt: "2026-10-17T10:00:00Z", truncated: false }], assets: [{ id: "promo-2", mime: "image/png", bytes: image }] } as unknown as SealedArtifactInput;

it("keeps one deck descriptor editable, preserving ids and other slides after a title correction", () => {
  const before = parseSlideDeck(input);
  const updated = structuredClone(deck); updated.slides[0]!.elements[0]!.text = "Nueva presentación";
  const after = parseSlideDeck({ ...input, revision: { ...input.revision, files: { "deck.json": JSON.stringify(updated) } } });
  expect(after.slides[0]!.id).toBe("cover"); expect(after.slides[0]!.elements[0]!.id).toBe("title"); expect(after.slides[1]).toEqual(before.slides[1]);
  const html = slideDeckHtml(before, input);
  expect(html).toContain("Gestión de ventas"); expect(html).toContain("Escenario hipotético"); expect(html).toContain("data-slide-id=\"data\""); expect(html).toContain("data:image/png;base64,");
});

it("rejects an out-of-canvas object or unresolved image before any export", () => {
  const broken = structuredClone(deck); broken.slides[0]!.elements[0]!.x = 1200;
  expect(() => parseSlideDeck({ ...input, revision: { ...input.revision, files: { "deck.json": JSON.stringify(broken) } } })).toThrow();
  expect(() => parseSlideDeck({ ...input, assets: [] })).toThrow();
});

it("exports a real PPTX ZIP with native editable text/chart and an embedded reusable image", async () => {
  const descriptor = parseSlideDeck(input);
  const bytes = await exportSlideDeckPptx(descriptor, input);
  await validateSlideDeckPptx(bytes, descriptor);
  const zip = await JSZip.loadAsync(bytes);
  const cover = await zip.file("ppt/slides/slide1.xml")!.async("string");
  expect(cover).toContain("Gestión de ventas"); expect(cover).toContain("<p:sp>"); expect(cover).toContain("<p:pic>");
  const second = await zip.file("ppt/slides/slide2.xml")!.async("string");
  expect(second).toContain("<c:chart"); expect(second).toContain("Escenario hipotético");
  const charts = Object.keys(zip.files).filter((p) => /^ppt\/charts\/chart\d+\.xml$/.test(p));
  expect(charts).toHaveLength(1);
  const chart = await zip.file(charts[0]!)!.async("string"); expect(chart).toContain("120"); expect(chart).toContain("80");
  await expect(validateSlideDeckPptx(new Uint8Array([1,2]), descriptor)).rejects.toBeDefined();
});

it("does not report completion without PDF/native-render evidence", async () => {
  await expect(renderSlides(input, async () => ({ png: new Uint8Array([1]), checks: ["claimed done"] }), new AbortController().signal)).rejects.toMatchObject({ code: "invalid_slide_render" });
});

it("separates grouped value labels and identifies both series in the HTML chart", () => {
  const multi = structuredClone(deck);
  Object.assign(multi.slides[1]!.elements[1]!, { valueColumns: ["Ventas", "Costes"] });
  const enriched = { ...input, revision: { ...input.revision, files: { "deck.json": JSON.stringify(multi) } }, datasets: [{ ...input.datasets[0]!, columns: ["Zona", "Ventas", "Costes"], rows: [["Norte", 120, 40], ["Sur", 80, 30]] }] };
  const html = slideDeckHtml(parseSlideDeck(enriched), enriched);
  const positions = [...html.matchAll(/<text x="([^"]+)"[^>]*data-series-value=/g)].map((m) => m[1]);
  expect(positions).toHaveLength(4);
  expect(new Set(positions).size).toBe(4);
  expect(html).toContain('data-series-legend="Ventas"'); expect(html).toContain('data-series-legend="Costes"');
});
