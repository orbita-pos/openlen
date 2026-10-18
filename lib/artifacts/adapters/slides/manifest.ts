import { z } from "zod";
import { ArtifactError, type ArtifactDataset, type SealedArtifactInput } from "../../types";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/);
const color = z.string().regex(/^#?[a-fA-F0-9]{6}$/).transform((v) => v.replace(/^#/, "").toUpperCase());
const box = { id, x: z.number().finite().min(0), y: z.number().finite().min(0), w: z.number().finite().positive(), h: z.number().finite().positive() };
const element = z.discriminatedUnion("type", [
  z.object({ ...box, type: z.literal("text"), text: z.string().max(10_000), fontSize: z.number().min(12).max(160), bold: z.boolean().default(false), color: color.optional(), align: z.enum(["left", "center", "right"]).default("left") }).strict(),
  z.object({ ...box, type: z.literal("shape"), shape: z.enum(["rect", "ellipse", "line"]), fill: color.optional(), stroke: color.optional(), strokeWidth: z.number().min(0).max(20).default(1) }).strict(),
  z.object({ ...box, type: z.literal("image"), assetId: z.string().min(1).max(200), fit: z.enum(["contain", "cover"]).default("contain") }).strict(),
  z.object({ ...box, type: z.literal("chart"), chartType: z.enum(["bar", "line"]), datasetId: z.string().min(1).max(200), categoryColumn: z.string().min(1), valueColumns: z.array(z.string().min(1)).min(1).max(6), colors: z.array(color).min(1).max(6).optional() }).strict(),
]);
const schema = z.object({ version: z.literal(1), width: z.number().int().min(640).max(1920), height: z.number().int().min(360).max(1080), title: z.string().min(1).max(200), fontFamily: z.enum(["Arial", "Liberation Sans", "DejaVu Sans"]).default("Arial"), background: color.default("FFFFFF"), color: color.default("111111"), slides: z.array(z.object({ id, background: color.optional(), notes: z.string().max(10_000).optional(), elements: z.array(element).min(1).max(100) }).strict()).min(1).max(50) }).strict();
export type SlideDeck = z.infer<typeof schema>;
export type SlideElement = SlideDeck["slides"][number]["elements"][number];
export type SlideChart = Extract<SlideElement, { type: "chart" }>;
export function chartData(chart: SlideChart, input: SealedArtifactInput): { dataset: ArtifactDataset; labels: string[]; series: { name: string; values: number[] }[] } {
  const d = input.datasets.find((data) => data.id === chart.datasetId);
  if (!d || d.rows.length < 1 || d.rows.length > 40) throw new ArtifactError("slide_chart_dataset_invalid");
  const category = d.columns.indexOf(chart.categoryColumn);
  const values = chart.valueColumns.map((name) => d.columns.indexOf(name));
  if (category < 0 || values.includes(-1)) throw new ArtifactError("slide_chart_column_missing");
  const labels = d.rows.map((r) => { const v = r[category]; if (typeof v !== "string" && typeof v !== "number") throw new ArtifactError("slide_chart_dataset_invalid"); return String(v); });
  const series = chart.valueColumns.map((name, i) => ({ name, values: d.rows.map((row) => { const v = row[values[i]!]; if (typeof v !== "number" || !Number.isFinite(v)) throw new ArtifactError("slide_chart_dataset_invalid"); return v; }) }));
  return { dataset: d, labels, series };
}
export function parseSlideDeck(input: SealedArtifactInput): SlideDeck {
  let deck: SlideDeck;
  try { deck = schema.parse(JSON.parse(input.revision.files["deck.json"] ?? "")); }
  catch { throw new ArtifactError("invalid_slide_deck"); }
  const slides = new Set<string>();
  for (const slide of deck.slides) {
    if (slides.has(slide.id)) throw new ArtifactError("duplicate_slide_id"); slides.add(slide.id);
    const elements = new Set<string>();
    for (const el of slide.elements) {
      if (elements.has(el.id)) throw new ArtifactError("duplicate_slide_element_id"); elements.add(el.id);
      if (el.x + el.w > deck.width || el.y + el.h > deck.height) throw new ArtifactError("slide_element_outside_canvas", `${slide.id}/${el.id}: element extends beyond ${deck.width}x${deck.height}`);
      if (el.type === "image") {
        const asset = input.assets.find((a) => a.id === el.assetId);
        if (!asset || !["image/png", "image/jpeg"].includes(asset.mime) || !asset.bytes.length) throw new ArtifactError("slide_image_missing");
      }
      if (el.type === "chart") {
        chartData(el, input);
        if (el.y + el.h > deck.height - 36) throw new ArtifactError("slide_provenance_space_required");
      }
    }
  }
  return deck;
}
