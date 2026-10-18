import type { SealedArtifactInput } from "../types";
export function slidesFixture(image: Uint8Array): SealedArtifactInput {
  const deck = { version: 1, width: 1280, height: 720, title: "Gestión de ventas", fontFamily: "Arial", background: "101820", color: "F5F5F1", slides: [
    { id: "cover", elements: [
      { id: "title", type: "text", x: 64, y: 70, w: 1100, h: 100, text: "Gestión de ventas", fontSize: 60, bold: true },
      { id: "caption", type: "text", x: 64, y: 190, w: 750, h: 90, text: "Una presentación editable del proyecto", fontSize: 30, color: "A3B4BC" },
      { id: "photo", type: "image", x: 900, y: 340, w: 240, h: 240, assetId: "promo-2", fit: "contain" },
    ] },
    { id: "data", elements: [
      { id: "heading", type: "text", x: 64, y: 50, w: 1100, h: 70, text: "Así se vería el escenario", fontSize: 42 },
      { id: "sales", type: "chart", x: 64, y: 160, w: 1100, h: 440, chartType: "bar", datasetId: "scenario", categoryColumn: "Zona", valueColumns: ["Ventas"] },
    ] },
  ] };
  return { artifact: { kind: "slides" }, revision: { files: { "deck.json": JSON.stringify(deck) } }, datasets: [{ id: "scenario", mode: "scenario", environment: null, visibility: "project", columns: ["Zona", "Ventas"], rows: [["Norte", 120], ["Sur", 80]], query: null, source: "scenario", capturedAt: "2026-10-17T10:00:00Z", truncated: false }], assets: [{ id: "promo-2", mime: "image/png", bytes: image }] } as unknown as SealedArtifactInput;
}
