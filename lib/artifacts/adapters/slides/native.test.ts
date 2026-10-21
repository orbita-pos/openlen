// @vitest-environment node
import { expect, it } from "vitest";
import JSZip from "jszip";
import { exportNativeDeck, parseMeasuredDeck, validateNativeDeck } from "./native";

const PHOTO = "0b9f5c1e-8d1a-4b6f-9a51-1f2b3c4d5e6f@1/0";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const run = (text: string, extra: Record<string, unknown> = {}) => ({ text, font: "Liberation Sans", size: 64, bold: false, italic: false, underline: false, strike: false, color: "111111", alpha: 1, letterSpacing: 0, ...extra });
const base = { src: "plan:2:1", rotate: 0 };
const layout = {
  slides: [{
    id: "plan", background: "0F2A3D", gradient: { kind: "linear", angle: 180, at: { x: 50, y: 50 }, stops: [{ hex: "0F2A3D", alpha: 1, pos: 0 }, { hex: "2B7A78", alpha: 1, pos: 100 }] }, transition: "fade", shrunk: 1,
    elements: [
      { ...base, type: "shape", id: "plan-0", x: 128, y: 128, w: 400, h: 200, kind: "rect", radius: 16, opacity: 1, fill: null, gradient: { kind: "radial", angle: 180, at: { x: 30, y: 30 }, stops: [{ hex: "FFFFFF", alpha: 1, pos: 0 }, { hex: "EEEEEE", alpha: 0.5, pos: 100 }] }, stroke: { color: "E3E6E4", alpha: 1, width: 2, dash: "solid" }, shadows: [{ inset: false, x: 0, y: 4, blur: 24, spread: 0, hex: "000000", alpha: 0.25 }] },
      { ...base, type: "text", id: "plan-1-text", x: 128, y: 400, w: 800, h: 160, inset: [0, 0, 0, 0], valign: "top", wrap: true, opacity: 1, paragraphs: [{ align: "left", lineHeight: 70, runs: [run("Agenda "), run("de hoy", { bold: true, href: "https://openlen.app" }), { text: "", br: true }, run("en vivo", { color: "F59E0B", highlight: "FFF3C4" })] }] },
      { ...base, type: "text", id: "plan-2-list", x: 128, y: 600, w: 800, h: 100, inset: [0, 0, 0, 0], valign: "top", wrap: true, opacity: 1, paragraphs: [{ align: "left", lineHeight: null, bullet: "bullet", indent: 38, spaceAfter: 0, runs: [run("Uno", { size: 32 })] }, { align: "left", lineHeight: null, bullet: "number", indent: 38, spaceAfter: 0, runs: [run("Dos", { size: 32 })] }] },
      { ...base, type: "image", id: "plan-3", x: 1000, y: 128, w: 300, h: 300, assetId: PHOTO, crop: { l: 0.25, t: 0, r: 0.25, b: 0 }, radius: 24, round: false, stroke: { color: "FFFFFF", alpha: 1, width: 4, dash: "solid" }, shadows: [], opacity: 1 },
      { ...base, type: "image", id: "plan-4", x: 1400, y: 128, w: 200, h: 200, rasterId: "raster-plan-4", crop: null, radius: 0, round: false, stroke: null, shadows: [], opacity: 1 },
      { ...base, type: "table", id: "plan-5-table", x: 128, y: 760, w: 800, h: 120, colW: [480, 320], rowH: [60, 60], opacity: 1, rows: [
        [{ paragraph: { align: "left", lineHeight: null, runs: [run("Servicio", { size: 28, bold: true })] }, valign: "top", fill: "F4F4F2", borders: [{ width: 1, color: "D0D4D8", alpha: 1, dash: "solid" }, null, null, null], padding: [10, 17, 10, 17] }, { paragraph: { align: "right", lineHeight: null, runs: [run("Precio", { size: 28 })] }, valign: "top", fill: null, borders: [null, null, null, null], padding: [10, 17, 10, 17] }],
        [{ paragraph: { align: "left", lineHeight: null, runs: [run("Corte", { size: 28 })] }, valign: "middle", fill: null, borders: [null, null, null, null], padding: [10, 17, 10, 17] }, { paragraph: { align: "right", lineHeight: null, runs: [run("$180", { size: 28 })] }, valign: "top", fill: null, borders: [null, null, null, null], padding: [10, 17, 10, 17] }],
      ] },
    ],
  }],
  assets: [{ id: "raster-plan-4", mime: "image/png", base64: PNG.toString("base64") }],
};

it("writes every measured object as a native PowerPoint object on a 13.33×7.5 in slide", async () => {
  const measured = parseMeasuredDeck(layout, ["plan"]);
  const bytes = await exportNativeDeck("Turnia", [{ id: "plan", notes: "Hola a todos." }], measured, { image: (id) => id === PHOTO ? { mime: "image/png", bytes: PNG } : undefined });
  await validateNativeDeck(bytes, measured);
  const zip = await JSZip.loadAsync(bytes);
  expect(await zip.file("ppt/presentation.xml")!.async("string")).toContain('<p:sldSz cx="12192000" cy="6858000"');
  const xml = await zip.file("ppt/slides/slide1.xml")!.async("string");
  // The slide's own gradient, top to bottom (CSS 180deg = DrawingML 90°), and its transition.
  expect(xml).toMatch(/<p:bg><p:bgPr><a:gradFill rotWithShape="1"><a:gsLst><a:gs pos="0"><a:srgbClr val="0F2A3D"><\/a:srgbClr><\/a:gs><a:gs pos="100000"><a:srgbClr val="2B7A78"><\/a:srgbClr><\/a:gs><\/a:gsLst><a:lin ang="5400000" scaled="0"\/><\/a:gradFill>/);
  expect(xml).toContain('<p:transition spd="med"><p:fade/></p:transition>');
  // The card: a rounded shape filled with a radial gradient, its outline and its soft shadow.
  const card = xml.slice(xml.indexOf('name="plan/plan-0"'), xml.indexOf("</p:sp>", xml.indexOf('name="plan/plan-0"')));
  expect(card).toContain('prst="roundRect"');
  expect(card).toMatch(/<a:gradFill rotWithShape="1">.*<a:alpha val="50000"\/>.*<a:path path="circle"><a:fillToRect l="30000" t="30000" r="70000" b="70000"\/><\/a:path>/s);
  expect(card).toMatch(/<a:outerShdw[^>]*blurRad="152400"[^>]*dist="25400"[^>]*dir="5400000"/);
  // Text: runs in one box, a soft line break, a link, a highlight, exact line spacing, Office's Arial.
  const text = xml.slice(xml.indexOf('name="plan/plan-1-text"'), xml.indexOf("</p:sp>", xml.indexOf('name="plan/plan-1-text"')));
  expect(text).toContain('<a:spcPts val="3500"/>');
  expect(text).toContain("<a:br/>");
  expect(text).toContain('latin typeface="Arial"');
  expect(text).toMatch(/b="1"[^>]*>.*<a:hlinkClick/s);
  expect(text).toContain("<a:highlight>");
  // A list keeps its bullets and numbers.
  const list = xml.slice(xml.indexOf('name="plan/plan-2-list"'), xml.indexOf("</p:sp>", xml.indexOf('name="plan/plan-2-list"')));
  expect(list).toContain("<a:buChar");
  expect(list).toContain("<a:buAutoNum");
  // The photo: cropped as object-fit:cover showed it, rounded corners and an outline.
  const photo = xml.slice(xml.indexOf('name="plan/plan-3"'), xml.indexOf("</p:pic>", xml.indexOf('name="plan/plan-3"')));
  expect(photo).toContain('<a:srcRect l="25000" t="0" r="25000" b="0"/>');
  expect(photo).toMatch(/<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 8000"\/><\/a:avLst><\/a:prstGeom><a:ln w="25400">/);
  expect(xml).toContain('name="plan/plan-4"');
  expect((xml.match(/<a:tbl>/g) ?? []).length).toBe(1);
  expect(await zip.file("ppt/notesSlides/notesSlide1.xml")!.async("string")).toContain("Hola a todos.");
});

it("parses the renderer's answer as data: a strange shape is refused, not trusted", () => {
  expect(() => parseMeasuredDeck({ ...layout, slides: [{ ...layout.slides[0], elements: [{ type: "script", id: "x" }] }] }, ["plan"])).toThrow(expect.objectContaining({ code: "invalid_slide_layout" }));
  expect(() => parseMeasuredDeck(layout, ["other"])).toThrow(expect.objectContaining({ code: "invalid_slide_layout" }));
  const unsafe = JSON.parse(JSON.stringify(layout));
  unsafe.slides[0].elements[1].paragraphs[0].runs[1].href = "javascript:alert(1)";
  expect(() => parseMeasuredDeck(unsafe, ["plan"])).toThrow(expect.objectContaining({ code: "invalid_slide_layout" }));
});
