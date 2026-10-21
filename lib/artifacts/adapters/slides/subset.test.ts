// @vitest-environment node
import { expect, it } from "vitest";
import { checkSlideSource } from "./subset";

const IMAGE = "asset:0b9f5c1e-8d1a-4b6f-9a51-1f2b3c4d5e6f@1/0";
const slide = (body: string, attrs = 'style="background:#fbfbf8;padding:128px;display:flex;flex-direction:column;gap:48px"') => `<section id="plan" ${attrs}>\n${body}\n</section>\n`;

it("accepts a slide written in the format: blocks, cards, an image, a pinned footer and notes", () => {
  const result = checkSlideSource("plan", slide(`<h2 style="font-size:72px;font-weight:400;line-height:1.1">Cambios</h2>
<div style="display:flex;gap:32px">
<div style="flex:1;background:#ffffff;padding:40px;border:1px solid #e3e6e4;border-radius:16px;box-shadow:0 4px 24px rgba(0,0,0,.06)">
<h3 style="font-size:32px">Un <b>solo</b> camino</h3><p style="font-size:28px;color:var(--muted)">Menos <span style="color:#d97706">pasos</span>.</p>
</div>
<img src="${IMAGE}" alt="Agenda" style="width:480px;height:360px;object-fit:cover;border-radius:16px">
</div>
<ul style="font-size:28px"><li>Uno</li><li>Dos</li></ul>
<p style="position:absolute;left:128px;bottom:64px;font-size:24px;color:#6a7179">Fuente: encuesta</p>
<aside>Saluda.</aside>`));
  expect(result.errors).toEqual([]);
  expect(result.notes).toEqual([]);
  expect(result.notesText).toBe("Saluda.");
  expect(result.assets).toEqual([IMAGE.slice(6)]);
});

it("lays out freely: margin, z-index, em, calc and CSS variables are the browser's to resolve", () => {
  const result = checkSlideSource("plan", slide(`<div style="--accent:#f59e0b;margin:0 auto;width:calc(100% - 2em);z-index:2;display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));grid-template-areas:'a b'"><p style="color:var(--accent);margin-top:1.5rem">Hola</p></div>`));
  expect(result.errors).toEqual([]);
});

it("needs exactly one <section> named like its file, and nothing around it", () => {
  expect(checkSlideSource("cover", slide("<h1>Hola</h1>")).errors).toEqual([expect.stringMatching(/^slides\/cover\.html 1:1 <section>: its id is "plan" but the file is cover\.html/)]);
  expect(checkSlideSource("plan", `<p>antes</p>${slide("<h1>Hola</h1>")}`).errors[0]).toMatch(/exactly one <section id="plan">/);
  expect(checkSlideSource("plan", `<html><body>${slide("<h1>Hola</h1>")}</body></html>`).errors[0]).toMatch(/exactly one <section id="plan">.*no <html>, <head> or <body>/);
});

it("names the slide, line:col, the element and the closest supported change", () => {
  const { errors } = checkSlideSource("plan", slide(`<h2>Título</h2>\n  <button style="padding:12px">Reservar</button>`));
  expect(errors).toEqual(['slides/plan.html 3:3 <button>: not in the slide format — a <p> with background, padding and border-radius is a pill']);
});

it("refuses what has no PowerPoint object, saying what to use instead", () => {
  const cases: [string, RegExp][] = [
    ['<div style="filter:blur(4px)"></div>', /filter: .* opacity or a painted overlay <div>/],
    ['<div style="mix-blend-mode:multiply"></div>', /mix-blend-mode: .* opacity or a painted overlay <div>/],
    ['<div style="clip-path:circle(50%)"></div>', /clip-path: .*border-radius/],
    ['<div style="background:url(foto.jpg) center/cover"></div>', /url\(\): .*a pinned <img> listed first/],
    ['<div style="background-size:cover"></div>', /background-size: .*a pinned <img> listed first/],
    ['<p style="transform:scale(1.2)">x</p>', /transform: scale.*width\/height or font-size \(translate and rotate are supported\)/],
    ['<p style="background-clip:text">x</p>', /background-clip: .*color/],
    ['<div style="border:2px solid #000;border-left:6px dashed #f00"></div>', /border-left: .*one style and color for every side.*a painted 4px <div>/],
    ['<div style="border-radius:24px 0 0 24px"></div>', /border-radius: .*one radius for every corner/],
    ['<canvas></canvas>', /<canvas>: .*<svg>/],
    ['<script>alert(1)</script>', /<script>: .*no scripts in a slide/],
    ['<style>p{color:red}</style>', /<style>: .*inline style=""/],
    ['<p class="text-xl">x</p>', /class: .*no stylesheet.*style=""/],
    ['<p onclick="x()">x</p>', /onclick: .*no scripts in a slide/],
    ['<img src="https://example.com/a.png" alt="">', /src: .*asset:<artifactId>@<revision>\/<output>/],
    ['<img src="data:image/png;base64,AAAA" alt="">', /src: .*asset:/],
    ['<a href="javascript:x()">x</a>', /href: .*https:\/\//],
    ['<svg><script>x()</script></svg>', /<svg>: .*no <script>, on\*=, <foreignObject> or URLs/],
    ['<svg><image href="https://example.com/a.png"/></svg>', /<svg>: .*no <script>, on\*=, <foreignObject> or URLs/],
  ];
  for (const [body, expected] of cases) {
    const { errors } = checkSlideSource("plan", slide(body));
    expect(errors, body).toHaveLength(1);
    expect(errors[0], body).toMatch(expected);
  }
});

it("keeps different border widths: one style and color is what PowerPoint needs", () => {
  expect(checkSlideSource("plan", slide('<div style="border:1px solid #e3e6e4;border-top:6px solid #e3e6e4;border-bottom:none"></div>')).errors).toEqual([]);
});

it("takes a gradient under either name, since the browser resolves both", () => {
  expect(checkSlideSource("plan", slide('<div style="background-image:linear-gradient(135deg,#0f2a3d,#2b7a78)"></div><p style="background:radial-gradient(circle at 30% 30%,#fff,#eee)">x</p>')).errors).toEqual([]);
});

it("heals the usual HTML names into the format and says so", () => {
  const { errors, notes } = checkSlideSource("plan", slide("<header><h4>Hola</h4><p><strong>fuerte</strong> y <em>suave</em></p></header><figure><figcaption>Pie</figcaption></figure>"));
  expect(errors).toEqual([]);
  expect(notes).toEqual([
    "slides/plan.html 2:1 <header>: read as <div>",
    "slides/plan.html 2:9 <h4>: read as <h3>",
    "slides/plan.html 2:25 <strong>: read as <b>",
    "slides/plan.html 2:51 <em>: read as <i>",
    "slides/plan.html 2:78 <figure>: read as <div>",
    "slides/plan.html 2:86 <figcaption>: read as <p>",
  ]);
});

it("keeps speaker notes last, as plain text", () => {
  expect(checkSlideSource("plan", slide("<aside>Nota</aside><p>Después</p>")).errors[0]).toMatch(/<aside>: .*the section's last child/);
  expect(checkSlideSource("plan", slide("<aside><b>Nota</b></aside>")).errors[0]).toMatch(/<aside>: .*plain text/);
  expect(checkSlideSource("plan", slide(`<aside>${"a".repeat(4001)}</aside>`)).errors[0]).toMatch(/<aside>: .*4000 characters/);
});

it("wants text in a text block, not loose in the section", () => {
  expect(checkSlideSource("plan", slide("Hola suelto")).errors[0]).toMatch(/^slides\/plan\.html 2:1 text directly in <section>: .*<p>/);
});

it("caps an inline <svg> at 52 KB", () => {
  expect(checkSlideSource("plan", slide(`<svg aria-label="x" viewBox="0 0 10 10"><path d="${"M0 0 ".repeat(11000)}"/></svg>`)).errors[0]).toMatch(/<svg>: .*52 KB/);
});

it("gives the same findings as diagnostics anchored to line:col, for the save that wrote them", () => {
  const { diagnostics } = checkSlideSource("plan", slide("<button>x</button>\n<strong>y</strong>"));
  expect(diagnostics).toEqual([
    { line: 2, column: 1, severity: "Error", message: "<button>: not in the slide format — a <p> with background, padding and border-radius is a pill" },
    { line: 3, column: 1, severity: "Info", message: "<strong>: read as <b>" },
  ]);
});
