import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import { ArtifactError, type SealedArtifactInput } from "../../types";
import { datasetLabel } from "../dashboard/compile";
import { chartData, type SlideDeck } from "./manifest";
const inch = (px: number) => px / 96;
export async function exportSlideDeckPptx(deck: SlideDeck, input: SealedArtifactInput): Promise<Uint8Array> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "LEN", width: inch(deck.width), height: inch(deck.height) }); pptx.layout = "LEN";
  pptx.title = deck.title; pptx.subject = "OpenLen project presentation"; pptx.author = "OpenLen"; pptx.company = "OpenLen";
  pptx.theme = { headFontFace: deck.fontFamily, bodyFontFace: deck.fontFamily };
  for (const s of deck.slides) {
    const slide = pptx.addSlide(); slide.background = { color: s.background ?? deck.background };
    if (s.notes) slide.addNotes(s.notes);
    const labels = new Set<string>();
    for (const e of s.elements) {
      const box = { x: inch(e.x), y: inch(e.y), w: inch(e.w), h: inch(e.h), objectName: `${s.id}/${e.id}` };
      if (e.type === "text") slide.addText(e.text, { ...box, fontFace: deck.fontFamily, fontSize: e.fontSize * .75, color: e.color ?? deck.color, bold: e.bold, align: e.align, valign: "top", margin: 0, breakLine: false, fit: "none", lineSpacingMultiple: 1.15, paraSpaceAfter: 0 });
      else if (e.type === "shape") slide.addShape(e.shape === "ellipse" ? pptx.ShapeType.ellipse : e.shape === "line" ? pptx.ShapeType.line : pptx.ShapeType.rect, { ...box, ...(e.shape === "line" ? { h: 0 } : {}), line: { color: e.stroke ?? deck.color, width: e.strokeWidth * .75, transparency: e.stroke ? 0 : 100 }, fill: { color: e.fill ?? deck.background, transparency: e.fill ? 0 : 100 } });
      else if (e.type === "image") {
        const a = input.assets.find((a) => a.id === e.assetId)!;
        const data = `data:${a.mime};base64,${Buffer.from(a.bytes).toString("base64")}`;
        slide.addImage({ ...box, sizing: { type: e.fit, w: box.w, h: box.h }, data });
      } else {
        const d = chartData(e, input); labels.add(datasetLabel(d.dataset));
        slide.addChart(e.chartType === "bar" ? pptx.ChartType.bar : pptx.ChartType.line, d.series.map((s) => ({ name: s.name, labels: d.labels, values: s.values })), {
          ...box, showLegend: d.series.length > 1, barDir: "col",
          chartArea: { fill: { color: s.background ?? deck.background }, border: { color: s.background ?? deck.background, pt: 0 } },
          plotArea: { fill: { color: s.background ?? deck.background }, border: { color: s.background ?? deck.background, pt: 0 } },
          catAxisLabelFontFace: deck.fontFamily, catAxisLabelFontSize: 12, catAxisLabelColor: deck.color,
          valAxisLabelColor: deck.color, valAxisLabelFontSize: 12, dataLabelColor: deck.color,
          legendColor: deck.color, legendFontFace: deck.fontFamily,
          showTitle: false, showValue: true, lineDataSymbol: e.chartType === "line" ? "circle" : "none",
          chartColors: e.colors ?? ["75BDA0", "5C8DA6", "F0B66E"], catAxisLineColor: deck.color, valAxisLineColor: deck.color,
        });
      }
    }
    if (labels.size) slide.addText([...labels].join(" · "), { x: inch(32), y: inch(deck.height - 30), w: inch(deck.width - 64), h: inch(24), margin: 0, fontFace: deck.fontFamily, fontSize: 10.5, color: deck.color, objectName: `${s.id}/data-provenance` });
  }
  const bytes = await pptx.write({ outputType: "uint8array", compression: true });
  return new Uint8Array(bytes as Uint8Array);
}

export async function validateSlideDeckPptx(bytes: Uint8Array, deck: SlideDeck): Promise<void> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes, { checkCRC32: true }); } catch { throw new ArtifactError("invalid_pptx"); }
  const slides = Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p));
  if (slides.length !== deck.slides.length || !zip.file("[Content_Types].xml") || !zip.file("ppt/presentation.xml")) throw new ArtifactError("invalid_pptx");
  for (const [index, slide] of deck.slides.entries()) {
    const xml = await zip.file(`ppt/slides/slide${index + 1}.xml`)!.async("string");
    for (const e of slide.elements) if (!xml.includes(`${slide.id}/${e.id}`)) throw new ArtifactError("pptx_object_missing");
    const rel = zip.file(`ppt/slides/_rels/slide${index + 1}.xml.rels`);
    if (rel && /TargetMode="External"/.test(await rel.async("string"))) throw new ArtifactError("pptx_external_reference");
  }
}
