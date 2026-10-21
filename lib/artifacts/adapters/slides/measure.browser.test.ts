// @vitest-environment node
// The slide measurer (tools/artifact-renderer/slide-layout.mjs) in a real Chromium, through the renderer's own
// page setup (browser.mjs): what each element of the slide format becomes in PowerPoint terms.
import { afterAll, beforeAll, expect, it } from "vitest";
import sharp from "sharp";
import puppeteer from "puppeteer";
import { compileSlideDeck, parseSlideDeckV3 } from "./deck";
import type { SealedArtifactInput } from "../../types";
import { renderSlideLayoutPacket } from "../../../../tools/artifact-renderer/browser.mjs";

const PHOTO = "0b9f5c1e-8d1a-4b6f-9a51-1f2b3c4d5e6f@1/0";
let executablePath: string, photo: Uint8Array;
beforeAll(async () => {
  executablePath = process.env.PUPPETEER_EXECUTABLE_PATH?.trim() || await Promise.resolve(puppeteer.executablePath());
  photo = new Uint8Array(await sharp({ create: { width: 400, height: 200, channels: 3, background: "#2b7a78" } }).png().toBuffer());
}, 30_000);
afterAll(() => undefined);

type Layout = { slides: { id: string; background: string; gradient: { kind: string; angle: number; stops: { hex: string; pos: number }[] } | null; transition: string | null; shrunk: number; elements: Record<string, unknown>[] }[]; assets: { id: string; mime: string; base64: string }[] };
async function measure(slides: Record<string, string>) {
  const files = Object.fromEntries(Object.entries(slides).map(([id, body]) => [`slides/${id}.html`, body]));
  const input = { artifact: { kind: "slides" }, revision: { files: { "deck.json": JSON.stringify({ version: 3, title: "Prueba", order: Object.keys(slides) }), ...files } }, assets: [{ id: PHOTO, mime: "image/png", bytes: photo }], datasets: [] } as unknown as SealedArtifactInput;
  const html = compileSlideDeck(parseSlideDeckV3(input), input);
  const result = await renderSlideLayoutPacket({ version: 1, kind: "slides-layout", html, width: 1920, height: 1080, pageCount: Object.keys(slides).length, probes: [] }, { executablePath });
  return { layout: result.layout as Layout, checks: result.checks as string[] };
}
const types = (els: Record<string, unknown>[]) => els.map((e) => e.type);
// Explicit opt-in, as the other artifact browser checks: this launches Chrome.
const run = process.env.ARTIFACT_BROWSER_TESTS === "1" ? it : it.skip;

run("turns blocks, cards, per-side borders, a photo, a drawing, a list and a table into PowerPoint objects", async () => {
  const { layout, checks } = await measure({ plan: `<section id="plan" data-transition="fade" style="background:linear-gradient(90deg,#0f2a3d,#2b7a78);color:#fbfbf8;padding:128px;display:flex;flex-direction:column;gap:32px">
<h2 style="font-size:72px;font-weight:400;line-height:1.1">Agenda <b>de hoy</b> <span style="color:#f59e0b">en vivo</span></h2>
<div style="display:flex;gap:32px">
<div style="width:400px;height:200px;background:#ffffff;border:2px solid #e3e6e4;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.25)"></div>
<div style="width:200px;height:200px;background:#fbfbf8;border-left:8px solid #f59e0b;border-top:1px solid #f59e0b"></div>
<img src="asset:${PHOTO}" alt="Foto" style="width:300px;height:300px;object-fit:cover;border-radius:24px">
<svg aria-label="Barras" width="200" height="200" viewBox="0 0 200 200"><rect x="20" y="40" width="40" height="160" fill="#f59e0b"/></svg>
</div>
<ul style="font-size:32px"><li>Uno</li><li>Dos</li></ul>
<table style="font-size:28px;color:#111111;background:#ffffff"><tr><th style="width:60%">Servicio</th><th>Precio</th></tr><tr><td>Corte</td><td style="text-align:right">$180</td></tr></table>
</section>` });
  const [slide] = layout.slides;
  expect(slide!.transition).toBe("fade");
  expect(slide!.gradient).toMatchObject({ kind: "linear", angle: 90, stops: [{ hex: "0F2A3D", pos: 0 }, { hex: "2B7A78", pos: 100 }] });
  const els = slide!.elements;
  expect(types(els)).toEqual(["text", "shape", "shape", "shape", "shape", "image", "image", "text", "shape", "table"]);
  const title = els[0] as { paragraphs: { runs: { text: string; bold: boolean; color: string }[] }[] };
  expect(title.paragraphs[0]!.runs.map((r) => [r.text, r.bold, r.color])).toEqual([["Agenda ", false, "FBFBF8"], ["de hoy", true, "FBFBF8"], [" ", false, "FBFBF8"], ["en vivo", false, "F59E0B"]]);
  expect(els[1]).toMatchObject({ type: "shape", w: 400, h: 200, radius: 16, fill: { color: "FFFFFF" }, stroke: { color: "E3E6E4", width: 2 }, shadows: [{ y: 4, blur: 24, inset: false }] });
  // Different widths, one color: the box, then one strip per side.
  expect(els.slice(2, 5)).toMatchObject([{ fill: { color: "FBFBF8" }, stroke: null }, { id: expect.stringMatching(/-top$/), h: 1, fill: { color: "F59E0B" } }, { id: expect.stringMatching(/-left$/), w: 8 }]);
  expect(els[5]).toMatchObject({ type: "image", assetId: PHOTO, w: 300, h: 300, radius: 24, crop: { l: 0.25, t: 0, r: 0.25, b: 0 } });
  expect(els[6]).toMatchObject({ type: "image", rasterId: expect.stringMatching(/^raster-/), w: 200, h: 200 });
  const png = layout.assets.find((a) => a.id === (els[6] as { rasterId: string }).rasterId)!;
  const meta = await sharp(Buffer.from(png.base64, "base64")).metadata();
  expect([meta.width, meta.height, meta.hasAlpha]).toEqual([400, 400, true]);
  expect(els[7]).toMatchObject({ type: "text", paragraphs: [{ bullet: "bullet", runs: [{ text: "Uno" }] }, { bullet: "bullet", runs: [{ text: "Dos" }] }] });
  expect(els[9]).toMatchObject({ type: "table", rows: [[{ paragraph: { runs: [{ text: "Servicio", bold: true }] } }, {}], [{}, { paragraph: { align: "right", runs: [{ text: "$180" }] } }]] });
  expect((els[9] as { colW: number[] }).colW).toHaveLength(2);
  expect(checks).toContain("slides:drawings-as-pictures:1");
}, 60_000);

run("keeps a line on one line: a one-line block does not wrap in PowerPoint, a longer one keeps room to", async () => {
  const { layout } = await measure({ s: `<section id="s" style="background:#ffffff;padding:128px"><p style="position:absolute;left:128px;bottom:64px;font-size:24px">Presentación para dueños de barberías · 2026</p><p style="width:600px;font-size:32px">Tus clientes reservan en 30 segundos desde el celular y tú confirmas por WhatsApp.</p></section>` });
  const [multi, single] = layout.slides[0]!.elements as { wrap: boolean; w: number; paragraphs: unknown[] }[];
  expect(single).toMatchObject({ wrap: false });
  expect(multi).toMatchObject({ wrap: true });
  expect(multi!.w).toBeGreaterThanOrEqual(602);
}, 60_000);

run("counts the lines of a tight title right: overlapping letter boxes are still two lines", async () => {
  const { layout } = await measure({ s: `<section id="s" style="background:#ffffff;padding:128px"><h1 style="font-size:112px;line-height:1.02;letter-spacing:-3px;width:1400px">La cita de tu barbería, reservada en 30 segundos</h1></section>` });
  expect(layout.slides[0]!.elements[0]).toMatchObject({ type: "text", wrap: true });
}, 60_000);

run("paints in CSS order: a pinned element paints over the flow, whatever its place in the file", async () => {
  const { layout } = await measure({ s: `<section id="s" style="background:#ffffff"><img src="asset:${PHOTO}" alt="" style="position:absolute;left:0;top:0;width:1920px;height:1080px;object-fit:cover"><p style="font-size:40px">Encima</p></section>` });
  expect(types(layout.slides[0]!.elements)).toEqual(["text", "image"]);
  const { layout: fixed } = await measure({ s: `<section id="s" style="background:#ffffff"><img src="asset:${PHOTO}" alt="" style="position:absolute;left:0;top:0;width:1920px;height:1080px;object-fit:cover"><p style="position:relative;font-size:40px">Encima</p></section>` });
  expect(types(fixed.slides[0]!.elements)).toEqual(["image", "text"]);
}, 60_000);

run("shrinks text that does not fit, down to 60 %, and says so", async () => {
  const words = "Reserva tu cita en treinta segundos desde el celular sin llamar a nadie. ".repeat(6);
  const { layout, checks } = await measure({ s: `<section id="s" style="background:#ffffff;padding:128px"><p style="width:800px;height:300px;font-size:40px;line-height:1.3">${words}</p></section>` });
  expect(layout.slides[0]!.shrunk).toBeLessThan(1);
  expect(layout.slides[0]!.shrunk).toBeGreaterThanOrEqual(0.6);
  expect(checks.some((c) => c.startsWith("slides:text-shrunk:s:"))).toBe(true);
  await expect(measure({ s: `<section id="s" style="background:#ffffff"><p style="width:400px;height:60px;font-size:40px">${words.repeat(3)}</p></section>` })).rejects.toThrow(/slide_text_overflow: s:1:\d+ <p>: its text does not fit its box even at 60 %/);
}, 60_000);

run("refuses a clip PowerPoint cannot make, naming the element and the fix", async () => {
  await expect(measure({ s: `<section id="s" style="background:#ffffff"><div style="width:300px;height:200px;overflow:hidden;border-radius:24px"><img src="asset:${PHOTO}" alt="" style="width:600px;height:300px"></div></section>` })).rejects.toThrow(/slide_layout_unsupported: s:1:\d+ <img>: overflow:hidden on s:1:\d+ <div> clips it — PowerPoint cannot clip; keep it inside, or give an <img> its own border-radius/);
}, 60_000);
