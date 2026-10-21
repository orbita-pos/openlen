// @vitest-environment node
import { expect, it } from "vitest";
import { compileSlideDeck, parseSlideDeckV3 } from "./deck";
import type { SealedArtifactInput } from "../../types";

const IMAGE = "0b9f5c1e-8d1a-4b6f-9a51-1f2b3c4d5e6f@1/0";
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const section = (id: string, body: string) => `<section id="${id}" style="background:#0f2a3d;color:#fbfbf8;padding:128px">\n${body}\n</section>\n`;
function input(files: Record<string, string>, deck: unknown = { version: 3, title: "Turnia <beta>", order: ["cover", "plan"] }): SealedArtifactInput {
  return { artifact: { kind: "slides" }, revision: { files: { "deck.json": JSON.stringify(deck), ...files } }, assets: [{ id: IMAGE, mime: "image/png", bytes: PNG }], datasets: [] } as unknown as SealedArtifactInput;
}
const files = { "slides/cover.html": section("cover", "<h1>Turnia</h1>\n<aside>Hola a todos.</aside>"), "slides/plan.html": section("plan", `<h2>Plan</h2><img src="asset:${IMAGE}" alt="Agenda" style="width:480px;height:360px">`) };

it("reads the index and one file per slide, in order, with the notes from each <aside>", () => {
  const deck = parseSlideDeckV3(input(files));
  expect(deck.title).toBe("Turnia <beta>");
  expect(deck.slides.map((s) => [s.id, s.notes])).toEqual([["cover", "Hola a todos."], ["plan", null]]);
  expect(deck.assets).toEqual([IMAGE]);
});

it("shows a slide file the order leaves out last, as Claude's decks do, and says so", () => {
  const deck = parseSlideDeckV3(input({ ...files, "slides/extra.html": section("extra", "<p>Extra</p>") }));
  expect(deck.slides.map((s) => s.id)).toEqual(["cover", "plan", "extra"]);
  expect(deck.notes).toContain('slides/extra.html: not in deck.json "order"; shown last');
});

it("reports every format problem of every slide at once", () => {
  const broken = { ...files, "slides/plan.html": section("plan", '<button>x</button><p class="a">y</p>') };
  expect(() => parseSlideDeckV3(input(broken))).toThrow(expect.objectContaining({ code: "slide_format_invalid", message: expect.stringMatching(/plan\.html 2:1 <button>[^\n]*\n.*plan\.html 2:19 <p>: class/s) }));
});

it("names a slide the order lists without a file, and a broken index", () => {
  expect(() => parseSlideDeckV3(input({ "slides/cover.html": files["slides/cover.html"] }))).toThrow(expect.objectContaining({ code: "invalid_slide_deck", message: expect.stringContaining('"plan" is in order but slides/plan.html does not exist') }));
  for (const deck of [{ version: 3, title: "x", order: ["a", "a"] }, { version: 3, title: "", order: ["cover"] }, { version: 3, title: "x", order: ["../x"] }]) {
    expect(() => parseSlideDeckV3(input(files, deck)), JSON.stringify(deck)).toThrow(expect.objectContaining({ code: "invalid_slide_deck" }));
  }
});

it("compiles one static document: no scripts, each element stamped with its line:col, images from saved outputs", () => {
  const html = compileSlideDeck(parseSlideDeckV3(input(files)), input(files));
  expect(html).toContain("<title>Turnia &lt;beta&gt;</title>");
  expect(html).toMatch(/Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"/);
  expect(html.indexOf('data-slide-id="cover"')).toBeLessThan(html.indexOf('data-slide-id="plan"'));
  expect(html).toContain('<h1 data-len-src="cover:2:1">Turnia</h1>');
  expect(html).toMatch(/<img src="data:image\/png;base64,iVBORw0KGgo=" alt="Agenda" style="width:480px;height:360px" data-len-src="plan:2:14" data-len-asset="0b9f5c1e-8d1a-4b6f-9a51-1f2b3c4d5e6f@1\/0">/);
  expect(html).not.toContain("<script");
});

it("refuses an image the revision does not have, naming it", () => {
  const missing = { ...input(files), assets: [] } as SealedArtifactInput;
  expect(() => compileSlideDeck(parseSlideDeckV3(missing), missing)).toThrow(expect.objectContaining({ code: "slide_image_missing", message: expect.stringContaining(IMAGE) }));
});
