import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import { z } from "zod";
import { ArtifactError } from "../../types";

/**
 * A measured deck (tools/artifact-renderer/slide-layout.mjs) as native PowerPoint objects.
 *
 * The renderer's answer is untrusted data: it is parsed here, never evaluated. 1920×1080 px is the 13.33×7.5 in
 * 16:9 slide, so a point is two pixels. What PptxGenJS cannot write — gradients, a picture's crop, corners and
 * outline, slide transitions — is added to the slide XML afterwards, by each object's name.
 */
const hex = z.string().regex(/^[0-9A-F]{6}$/);
const alpha = z.number().min(0).max(1);
const num = z.number().finite();
const font = z.string().regex(/^[A-Za-z0-9 _-]{1,100}$/);
const shadow = z.object({ inset: z.boolean(), x: num, y: num, blur: num.min(0).max(2000), spread: num, hex, alpha }).strict();
const run = z.union([
  z.object({ text: z.literal(""), br: z.literal(true) }).strict(),
  z.object({ text: z.string().min(1).max(20_000), font, size: num.min(1).max(800), bold: z.boolean(), italic: z.boolean(), underline: z.boolean(), strike: z.boolean(), color: hex, alpha, letterSpacing: num.min(-200).max(400), href: z.string().max(2000).regex(/^(https:\/\/|mailto:)/i).optional(), highlight: hex.optional() }).strict(),
]);
const paragraph = z.object({
  align: z.enum(["left", "center", "right", "justify"]), lineHeight: num.positive().max(4000).nullable(), runs: z.array(run).max(4000),
  shadow: shadow.optional(), outline: z.object({ width: num.min(0).max(100), hex, alpha }).strict().optional(),
  bullet: z.enum(["bullet", "number"]).nullable().optional(), indent: num.min(0).max(1000).optional(), spaceAfter: num.min(0).max(2000).optional(),
}).strict();
const geometry = { id: z.string().min(1).max(200), src: z.string().max(200).nullable(), x: num.min(-4000).max(6000), y: num.min(-4000).max(6000), w: num.min(0).max(8000), h: num.min(0).max(8000), rotate: num.min(-360).max(360) };
const stroke = z.object({ color: hex, alpha, width: num.min(0).max(400), dash: z.enum(["solid", "dash", "sysDot"]) }).strict();
const gradient = z.object({ kind: z.enum(["linear", "radial"]), angle: num, at: z.object({ x: num, y: num }).strict(), stops: z.array(z.object({ hex, alpha, pos: num }).strict()).min(1).max(16) }).strict();
const four = <T extends z.ZodTypeAny>(t: T) => z.tuple([t, t, t, t]);
const element = z.discriminatedUnion("type", [
  z.object({ ...geometry, type: z.literal("text"), inset: four(num.min(0).max(2000)), valign: z.enum(["top", "middle", "bottom"]), wrap: z.boolean(), paragraphs: z.array(paragraph).min(1).max(400), opacity: alpha }).strict(),
  z.object({ ...geometry, type: z.literal("shape"), kind: z.enum(["rect", "ellipse"]), radius: num.min(0).max(4000), opacity: alpha, fill: z.object({ color: hex, alpha }).strict().nullable(), gradient: gradient.nullable(), stroke: stroke.nullable(), shadows: z.array(shadow).max(2) }).strict(),
  z.object({ ...geometry, type: z.literal("image"), assetId: z.string().max(200).nullable().optional(), rasterId: z.string().regex(/^raster-[A-Za-z0-9_-]{1,200}$/).optional(), crop: z.object({ l: alpha, t: alpha, r: alpha, b: alpha }).strict().nullable(), radius: num.min(0).max(4000), round: z.boolean(), stroke: stroke.nullable(), shadows: z.array(shadow).max(2), opacity: alpha }).strict(),
  z.object({ ...geometry, type: z.literal("table"), colW: z.array(num.positive()).min(1).max(24), rowH: z.array(num.positive()).min(1).max(100), opacity: alpha, rows: z.array(z.array(z.object({ paragraph, valign: z.enum(["top", "middle", "bottom"]), fill: hex.nullable(), borders: four(z.object({ width: num.min(0).max(100), color: hex, alpha, dash: z.enum(["solid", "dash", "sysDot"]) }).strict().nullable()), padding: four(num.min(0).max(500)) }).strict()).max(24)).min(1).max(100) }).strict(),
]);
const layoutSchema = z.object({
  slides: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/), background: hex, gradient: gradient.nullable(), transition: z.enum(["fade", "push"]).nullable(), shrunk: num.min(0.5).max(1), elements: z.array(element).max(3000) }).strict()).min(1).max(50),
  assets: z.array(z.object({ id: z.string().regex(/^raster-[A-Za-z0-9_-]{1,200}$/), mime: z.literal("image/png"), base64: z.string().min(4).max(12 * 1024 * 1024).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict()).max(200),
}).strict();
export type MeasuredDeck = z.infer<typeof layoutSchema>;
type Element = z.infer<typeof element>;
type Paragraph = z.infer<typeof paragraph>;

export function parseMeasuredDeck(raw: unknown, slideIds: readonly string[]): MeasuredDeck {
  const parsed = layoutSchema.safeParse(raw);
  if (!parsed.success) throw new ArtifactError("invalid_slide_layout", `${parsed.error.issues[0]?.path.join(".")}: ${parsed.error.issues[0]?.message}`);
  const layout = parsed.data;
  if (layout.slides.length !== slideIds.length || layout.slides.some((s, i) => s.id !== slideIds[i])) throw new ArtifactError("invalid_slide_layout", "the measured slides are not the deck's");
  for (const s of layout.slides) if (new Set(s.elements.map((e) => e.id)).size !== s.elements.length) throw new ArtifactError("invalid_slide_layout", `${s.id}: two objects share an id`);
  const rasters = new Set(layout.assets.map((a) => a.id));
  for (const s of layout.slides) for (const e of s.elements) if (e.type === "image" && (e.rasterId ? !rasters.has(e.rasterId) : !e.assetId)) throw new ArtifactError("invalid_slide_layout", `${s.id}/${e.id}: a picture without its image`);
  return layout;
}

const IN = (px: number) => px / 144, PT = (px: number) => px / 2, EMU = (px: number) => Math.round(px * 6350);
/** The renderer's metric twins of the fonts an Office machine has. */
const OFFICE_FONT: Readonly<Record<string, string>> = { "Liberation Sans": "Arial", "Liberation Serif": "Times New Roman", "Liberation Mono": "Courier New", Carlito: "Calibri", Caladea: "Cambria" };
const office = (f: string) => OFFICE_FONT[f] ?? f;
const transparency = (a: number) => Math.round((1 - a) * 100);
const outerShadow = (shadows: readonly z.infer<typeof shadow>[], opacity: number, inset = false) => {
  const s = shadows.find((x) => x.inset === inset);
  if (!s) return undefined;
  return { type: inset ? "inner" as const : "outer" as const, blur: PT(s.blur + Math.max(0, s.spread)), offset: PT(Math.hypot(s.x, s.y)), angle: Math.round(((Math.atan2(s.y, s.x) * 180 / Math.PI) + 360) % 360), color: s.hex, opacity: s.alpha * opacity };
};

function runsOf(paragraphs: readonly Paragraph[], opacity: number): PptxGenJS.TextProps[] {
  const out: PptxGenJS.TextProps[] = [];
  paragraphs.forEach((p, index) => {
    const para: PptxGenJS.TextPropsOptions = {
      align: p.align, ...(p.lineHeight ? { lineSpacing: PT(p.lineHeight) } : {}), paraSpaceBefore: 0, paraSpaceAfter: PT(p.spaceAfter ?? 0),
      ...(p.bullet === "bullet" ? { bullet: { indent: PT(p.indent ?? 0) } } : p.bullet === "number" ? { bullet: { type: "number", indent: PT(p.indent ?? 0) } } : {}),
    };
    const runs = p.runs.length ? p.runs : [{ text: "", br: true as const }];
    let soft = false;
    const items: PptxGenJS.TextProps[] = [];
    for (const r of runs) {
      if ("br" in r) { soft = true; continue; }
      items.push({ text: r.text, options: {
        ...para, fontFace: office(r.font), fontSize: PT(r.size), bold: r.bold, italic: r.italic, color: r.color,
        ...(r.alpha * opacity < 1 ? { transparency: transparency(r.alpha * opacity) } : {}),
        ...(r.underline ? { underline: { style: "sng" } } : {}), ...(r.strike ? { strike: "sngStrike" } : {}),
        ...(r.letterSpacing ? { charSpacing: PT(r.letterSpacing) } : {}), ...(r.href ? { hyperlink: { url: r.href } } : {}), ...(r.highlight ? { highlight: r.highlight } : {}),
        ...(p.outline ? { outline: { color: p.outline.hex, size: PT(p.outline.width) } } : {}),
        ...(soft ? { softBreakBefore: true } : {}),
      } });
      soft = false;
    }
    if (!items.length) items.push({ text: "", options: { ...para } });
    if (index < paragraphs.length - 1) items[items.length - 1]!.options = { ...items[items.length - 1]!.options, breakLine: true };
    out.push(...items);
  });
  return out;
}

export interface NativeSlide { readonly id: string; readonly notes: string | null }
export interface NativeAssets { image(id: string): { mime: string; bytes: Uint8Array } | undefined }
interface Fix { readonly name: string; readonly kind: "gradient" | "picture"; readonly element: Element }

export async function exportNativeDeck(title: string, deck: readonly NativeSlide[], layout: MeasuredDeck, assets: NativeAssets): Promise<Uint8Array> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "LEN", width: IN(1920), height: IN(1080) }); pptx.layout = "LEN";
  pptx.title = title; pptx.subject = "OpenLen presentation"; pptx.author = "OpenLen"; pptx.company = "OpenLen";
  const rasters = new Map(layout.assets.map((a) => [a.id, a]));
  const fixes: Fix[][] = [];
  layout.slides.forEach((measured, index) => {
    const slide = pptx.addSlide(), fix: Fix[] = [];
    slide.background = { color: measured.background };
    const notes = deck[index]?.notes;
    if (notes) slide.addNotes(notes);
    for (const e of measured.elements) {
      const name = `${measured.id}/${e.id}`, at = { x: IN(e.x), y: IN(e.y), w: IN(Math.max(e.w, 0.5)), h: IN(Math.max(e.h, 0.5)), ...(e.rotate ? { rotate: (e.rotate + 360) % 360 } : {}), objectName: name };
      if (e.type === "shape") {
        const shape = e.kind === "ellipse" ? pptx.ShapeType.ellipse : e.radius > 0 ? pptx.ShapeType.roundRect : pptx.ShapeType.rect;
        const fill = e.fill ? { color: e.fill.color, transparency: transparency(e.fill.alpha * e.opacity) } : e.gradient ? { color: e.gradient.stops[0]!.hex } : { color: "FFFFFF", transparency: 100 };
        const line = e.stroke ? { color: e.stroke.color, width: PT(e.stroke.width), dashType: e.stroke.dash, transparency: transparency(e.stroke.alpha * e.opacity) } : { color: "FFFFFF", width: 0, transparency: 100 };
        const shadowOptions = outerShadow(e.shadows, e.opacity) ?? outerShadow(e.shadows, e.opacity, true);
        slide.addShape(shape, { ...at, fill, line, ...(e.radius > 0 && e.kind === "rect" ? { rectRadius: IN(Math.min(e.radius, Math.min(e.w, e.h) / 2)) } : {}), ...(shadowOptions ? { shadow: shadowOptions } : {}) });
        if (e.gradient && !e.fill) fix.push({ name, kind: "gradient", element: e });
      } else if (e.type === "text") {
        // A text box without fill casts its shadow from the letters: that is CSS's text-shadow.
        const textShadow = outerShadow(e.paragraphs.flatMap((p) => p.shadow ? [p.shadow] : []), e.opacity);
        slide.addText(runsOf(e.paragraphs, e.opacity), { ...at, margin: [PT(e.inset[3]), PT(e.inset[1]), PT(e.inset[2]), PT(e.inset[0])], valign: e.valign, wrap: e.wrap, fit: "none", paraSpaceBefore: 0, ...(textShadow ? { shadow: textShadow } : {}) });
      } else if (e.type === "image") {
        const source = e.rasterId ? (() => { const r = rasters.get(e.rasterId!)!; return { mime: r.mime, bytes: Buffer.from(r.base64, "base64") }; })() : assets.image(e.assetId!);
        if (!source) throw new ArtifactError("slide_image_missing", `${name}: asset:${e.assetId} is not in this revision`);
        const shadowOptions = outerShadow(e.shadows, e.opacity);
        slide.addImage({ ...at, data: `data:${source.mime};base64,${Buffer.from(source.bytes).toString("base64")}`, ...(e.round ? { rounding: true } : {}), ...(e.opacity < 1 ? { transparency: transparency(e.opacity) } : {}), ...(shadowOptions ? { shadow: shadowOptions } : {}) });
        if (e.crop || (e.radius > 0 && !e.round) || e.stroke) fix.push({ name, kind: "picture", element: e });
      } else {
        const rows: PptxGenJS.TableRow[] = e.rows.map((row) => row.map((cell) => ({
          text: runsOf([cell.paragraph], e.opacity),
          options: { valign: cell.valign, align: cell.paragraph.align === "justify" ? "left" : cell.paragraph.align, ...(cell.fill ? { fill: { color: cell.fill } } : {}), margin: [PT(cell.padding[0]), PT(cell.padding[1]), PT(cell.padding[2]), PT(cell.padding[3])],
            border: cell.borders.map((b) => b ? { type: b.dash === "solid" ? "solid" : "dash", pt: PT(b.width), color: b.color } : { type: "none" }) as [PptxGenJS.BorderProps, PptxGenJS.BorderProps, PptxGenJS.BorderProps, PptxGenJS.BorderProps] },
        })));
        slide.addTable(rows, { x: IN(e.x), y: IN(e.y), w: IN(e.colW.reduce((a, b) => a + b, 0)), colW: e.colW.map(IN), rowH: e.rowH.map(IN), autoPage: false });
      }
    }
    fixes.push(fix);
  });
  const written = new Uint8Array(await pptx.write({ outputType: "uint8array", compression: true }) as Uint8Array);
  return finishSlideXml(written, layout, fixes);
}

const gradFill = (g: z.infer<typeof gradient>, opacity: number) => {
  const stops = [...g.stops].sort((a, b) => a.pos - b.pos).map((s) => `<a:gs pos="${Math.round(Math.min(100, Math.max(0, s.pos)) * 1000)}"><a:srgbClr val="${s.hex}">${s.alpha * opacity < 1 ? `<a:alpha val="${Math.round(s.alpha * opacity * 100000)}"/>` : ""}</a:srgbClr></a:gs>`).join("");
  // CSS measures a linear gradient from "to top" clockwise; DrawingML from "to the right".
  const shade = g.kind === "linear" ? `<a:lin ang="${Math.round((((g.angle - 90) % 360) + 360) % 360 * 60000)}" scaled="0"/>` : `<a:path path="circle"><a:fillToRect l="${Math.round(g.at.x * 1000)}" t="${Math.round(g.at.y * 1000)}" r="${Math.round((100 - g.at.x) * 1000)}" b="${Math.round((100 - g.at.y) * 1000)}"/></a:path>`;
  return `<a:gradFill rotWithShape="1"><a:gsLst>${stops}</a:gsLst>${shade}</a:gradFill>`;
};
const escapeXml = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** The `<p:sp>`/`<p:pic>` whose name is `name`: [start, end) in the slide XML. */
function objectRange(xml: string, name: string): [number, number] {
  const at = xml.indexOf(`name="${escapeXml(name)}"`);
  if (at < 0) throw new ArtifactError("pptx_object_missing", name);
  const sp = xml.lastIndexOf("<p:sp>", at), pic = xml.lastIndexOf("<p:pic>", at), start = Math.max(sp, pic), close = start === pic ? "</p:pic>" : "</p:sp>";
  return [start, xml.indexOf(close, at) + close.length];
}

async function finishSlideXml(bytes: Uint8Array, layout: MeasuredDeck, fixes: readonly Fix[][]): Promise<Uint8Array> {
  const zip = await JSZip.loadAsync(bytes);
  for (const [index, measured] of layout.slides.entries()) {
    const path = `ppt/slides/slide${index + 1}.xml`;
    let xml = await zip.file(path)!.async("string");
    for (const f of fixes[index] ?? []) {
      const [start, end] = objectRange(xml, f.name);
      let part = xml.slice(start, end);
      const e = f.element;
      if (f.kind === "gradient" && e.type === "shape" && e.gradient) part = part.replace(/<a:solidFill>[\s\S]*?<\/a:solidFill>/, gradFill(e.gradient, e.opacity));
      if (f.kind === "picture" && e.type === "image") {
        if (e.crop) part = part.replace(/<a:stretch>\s*<a:fillRect\/>\s*<\/a:stretch>/, `<a:srcRect l="${Math.round(e.crop.l * 100000)}" t="${Math.round(e.crop.t * 100000)}" r="${Math.round(e.crop.r * 100000)}" b="${Math.round(e.crop.b * 100000)}"/><a:stretch><a:fillRect/></a:stretch>`);
        if (e.radius > 0 && !e.round) part = part.replace(/<a:prstGeom prst="rect"><a:avLst\/><\/a:prstGeom>/, `<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val ${Math.min(50000, Math.round(e.radius / Math.max(1, Math.min(e.w, e.h)) * 100000))}"/></a:avLst></a:prstGeom>`);
        if (e.stroke) part = part.replace(/(<a:prstGeom[\s\S]*?<\/a:prstGeom>)/, `$1<a:ln w="${EMU(e.stroke.width)}"><a:solidFill><a:srgbClr val="${e.stroke.color}">${e.stroke.alpha * e.opacity < 1 ? `<a:alpha val="${Math.round(e.stroke.alpha * e.opacity * 100000)}"/>` : ""}</a:srgbClr></a:solidFill>${e.stroke.dash !== "solid" ? `<a:prstDash val="${e.stroke.dash}"/>` : ""}</a:ln>`);
      }
      xml = xml.slice(0, start) + part + xml.slice(end);
    }
    if (measured.gradient) xml = xml.replace(/<p:bg>[\s\S]*?<\/p:bg>/, `<p:bg><p:bgPr>${gradFill(measured.gradient, 1)}<a:effectLst/></p:bgPr></p:bg>`);
    if (measured.transition) xml = xml.replace("</p:clrMapOvr>", `</p:clrMapOvr><p:transition spd="med">${measured.transition === "fade" ? "<p:fade/>" : '<p:push dir="u"/>'}</p:transition>`);
    zip.file(path, xml);
  }
  return new Uint8Array(await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" }));
}

/** Every measured object is in its slide, and nothing reaches outside the file but links the deck shows. */
export async function validateNativeDeck(bytes: Uint8Array, layout: MeasuredDeck): Promise<void> {
  let zip: JSZip;
  try { zip = await JSZip.loadAsync(bytes, { checkCRC32: true }); } catch { throw new ArtifactError("invalid_pptx"); }
  const slides = Object.keys(zip.files).filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p));
  if (slides.length !== layout.slides.length || !zip.file("[Content_Types].xml") || !zip.file("ppt/presentation.xml")) throw new ArtifactError("invalid_pptx");
  for (const [index, slide] of layout.slides.entries()) {
    const xml = await zip.file(`ppt/slides/slide${index + 1}.xml`)!.async("string");
    for (const e of slide.elements) if (e.type !== "table" && !xml.includes(`name="${escapeXml(`${slide.id}/${e.id}`)}"`)) throw new ArtifactError("pptx_object_missing", `${slide.id}/${e.id}`);
    if ((xml.match(/<a:tbl>/g) ?? []).length !== slide.elements.filter((e) => e.type === "table").length) throw new ArtifactError("pptx_object_missing", `${slide.id}: a table`);
    const rel = zip.file(`ppt/slides/_rels/slide${index + 1}.xml.rels`);
    if (rel) for (const m of (await rel.async("string")).matchAll(/<Relationship [^>]*TargetMode="External"[^>]*>/g)) {
      if (!/Type="[^"]*\/hyperlink"/.test(m[0]) || !/Target="(https:\/\/|mailto:)/i.test(m[0])) throw new ArtifactError("pptx_external_reference");
    }
  }
}
