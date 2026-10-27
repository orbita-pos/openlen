import { describe, expect, it } from "vitest";

import { parseMentions, resolveMentions } from "./resolve";
import type { MentionRef } from "./types";

const HOME = ["<!doctype html>", "<html>", "<body>", "<h1>Pan de verdad</h1>", '<a href="#">Ver el mostrador</a>', "</body>", "</html>"].join("\n");
const CONTACT = ["<!doctype html>", "<html>", "<body>", "<h2>Contacto</h2>", "</body>", "</html>"].join("\n");
const pages: Record<string, string> = { "": HOME, contacto: CONTACT };
const pageHtml = (p: string | null) => pages[p ?? ""] ?? null;

const el = (label: string, page: string | null, path: string, tag: string, text: string): MentionRef => ({
  type: "element",
  label,
  text,
  target: { type: "page", page, path, tag, text },
});

const APP = [
  "export default function App() {", // 1
  "  return (", // 2
  "    <ul>", // 3
  '      <li className="fila">Pedido uno</li>', // 4
  "    </ul>", // 5
  "  );", // 6
  "}", // 7
].join("\n");

describe("resolveMentions", () => {
  it("anchors two page mentions on different pages, in message order", async () => {
    const r = await resolveMentions(
      [el("@Título · Contacto", "contacto", "h2:nth-of-type(1)", "h2", "Contacto"), el("@Enlace · Ver el mostrador", null, "a:nth-of-type(1)", "a", "Ver el mostrador")],
      { pageHtml, files: async () => ({}) },
    );
    expect(r.selecciones).toEqual([
      { ruta: "/contacto/index.html", desde: 4, hasta: 4, contenido: "<h2>Contacto</h2>" },
      { ruta: "/index.html", desde: 5, hasta: 5, contenido: '<a href="#">Ver el mostrador</a>' },
    ]);
  });

  it("follows an element the file moved down after the pick", async () => {
    const moved = HOME.replace("<body>", "<body>\n<p>uno</p>\n<p>dos</p>\n<p>tres</p>");
    const r = await resolveMentions([el("@Enlace · Ver el mostrador", null, "a:nth-of-type(1)", "a", "Ver el mostrador")], {
      pageHtml: () => moved,
      files: async () => ({}),
    });
    expect(r.selecciones[0]).toMatchObject({ desde: 8, hasta: 8 });
  });

  it("gives no lines when the path now lands on another element, or on nothing", async () => {
    const neighbour = HOME.replace("<h1>Pan de verdad</h1>", '<a href="#">Otro</a>\n<h1>Pan de verdad</h1>');
    const r = await resolveMentions(
      [el("@Enlace · Ver el mostrador", null, "a:nth-of-type(1)", "a", "Ver el mostrador"), el("@Sección · x", null, "section:nth-of-type(4)", "section", "")],
      { pageHtml: () => neighbour, files: async () => ({}) },
    );
    expect(r.selecciones).toEqual([
      { ruta: "/index.html", pista: "@Enlace · Ver el mostrador" },
      { ruta: "/index.html", pista: "@Sección · x" },
    ]);
  });

  it("recognises the element by its text even with inline tags and entities in between", async () => {
    const html = ["<body>", "<h1 class=x>", "  Pan <em>de</em> verdad &amp; café", "</h1>", "</body>"].join("\n");
    const r = await resolveMentions([el("@Título · Pan verdad & café", null, "h1:nth-of-type(1)", "h1", "Pan verdad & café")], {
      pageHtml: () => html,
      files: async () => ({}),
    });
    expect(r.selecciones[0]).toMatchObject({ desde: 2, hasta: 4 });
  });

  it("decodes every named entity, not only the common five", async () => {
    const html = ["<body>", "<h3>Mama&rsquo;s Garden &ndash; Guimar&atilde;es</h3>", "</body>"].join("\n");
    const r = await resolveMentions([el("@Título · x", null, "h3:nth-of-type(1)", "h3", "Mama’s Garden – Guimarães")], { pageHtml: () => html, files: async () => ({}) });
    expect(r.selecciones[0]).toMatchObject({ desde: 2, hasta: 2 });
  });

  it("does not judge an element by own text that is only punctuation", async () => {
    const html = ["<body>", "<div><span>email</span>,<span>joined</span>,<span>source</span></div>", "</body>"].join("\n");
    const r = await resolveMentions([el("@Elemento · div", null, "div:nth-of-type(1)", "div", ",,")], { pageHtml: () => html, files: async () => ({}) });
    expect(r.selecciones[0]).toMatchObject({ desde: 2, hasta: 2 });
  });

  it("gives no lines when a same-tag, textless neighbour now sits at the path", async () => {
    const html = ["<body>", '<section class="nuevo"><div>x</div></section>', '<section class="hero"><h2>A</h2><p>b</p></section>', "</body>"].join("\n");
    const ref: MentionRef = { type: "element", label: "@Sección · A", text: "", target: { type: "page", page: null, path: "section:nth-of-type(1)", tag: "section", sig: { cls: "hero", kids: "h2,p" } } };
    const r = await resolveMentions([ref], { pageHtml: () => html, files: async () => ({}) });
    expect(r.selecciones).toEqual([{ ruta: "/index.html", pista: "@Sección · A" }]);
  });

  it("lets the last word be cut, as the 40-character text cuts it", async () => {
    const html = ["<body>", "<h2>Every guardrail your safety team would have</h2>", "</body>"].join("\n");
    const r = await resolveMentions([el("@Título · x", null, "h2:nth-of-type(1)", "h2", "Every guardrail your safety team would h")], { pageHtml: () => html, files: async () => ({}) });
    expect(r.selecciones[0]).toMatchObject({ desde: 2 });
  });

  it("matches whole words: «Pro» is not «Professional»", async () => {
    const html = ["<body>", "<span>Professional</span>", "</body>"].join("\n");
    const r = await resolveMentions([el("@Texto · Pro", null, "span:nth-of-type(1)", "span", "Pro")], { pageHtml: () => html, files: async () => ({}) });
    expect(r.selecciones).toEqual([{ ruta: "/index.html", pista: "@Texto · Pro" }]);
  });

  it("does not take a textless same-tag element on the old line for a mention that had text", async () => {
    const moved = APP.replace("    <ul>", "    <ul>\n      <li></li>\n      {/* x */}").replace("    <ul>\n", "    <ul>\n");
    // Line 4 is now an empty <li>; the real one moved to line 6.
    const ref: MentionRef = { type: "element", label: "@Lista · Pedido uno", text: "Pedido uno", target: { type: "app", path: "/src/App.tsx", line: 4, tag: "li", text: "Pedido uno" } };
    const r = await resolveMentions([ref], { pageHtml, files: async () => ({ "/src/App.tsx": moved }) });
    expect(r.selecciones[0]).toMatchObject({ desde: 6 });
  });

  it("re-anchors an app element by its tag and text when lines were inserted above it", async () => {
    const shifted = APP.replace("    <ul>", "    {/* a */}\n    {/* b */}\n    <ul>");
    const ref: MentionRef = { type: "element", label: "@Lista · Pedido uno", text: "Pedido uno", target: { type: "app", path: "/src/App.tsx", line: 4, tag: "li", text: "Pedido uno" } };
    const r = await resolveMentions([ref], { pageHtml, files: async () => ({ "/src/App.tsx": shifted }) });
    expect(r.selecciones).toEqual([{ ruta: "/src/App.tsx", desde: 6, hasta: 6, contenido: '      <li className="fila">Pedido uno</li>' }]);
    const gone = await resolveMentions([ref], { pageHtml, files: async () => ({ "/src/App.tsx": "export default () => null;\n" }) });
    expect(gone.selecciones).toEqual([{ ruta: "/src/App.tsx", pista: "@Lista · Pedido uno" }]);
  });

  it("brings a mentioned file and drops one that does not exist", async () => {
    const r = await resolveMentions(
      [
        { type: "file", label: "@/LEN.md", ruta: "/LEN.md" },
        { type: "file", label: "@/nada.md", ruta: "/nada.md" },
      ],
      { pageHtml, files: async () => ({ "/LEN.md": "Tono cercano." }) },
    );
    expect(r.ficheros).toEqual([{ ruta: "/LEN.md", contenido: "Tono cercano." }]);
    expect(r.selecciones).toEqual([]);
  });
});

describe("parseMentions", () => {
  it("keeps at most 20 well-formed mentions and drops the rest", () => {
    const ok = (i: number) => ({ type: "file", label: `@/f${i}`, ruta: `/f${i}` });
    const raw = [{ type: "element", label: "x" }, "nope", null, ...Array.from({ length: 25 }, (_, i) => ok(i))];
    const parsed = parseMentions(raw);
    expect(parsed).toHaveLength(20);
    expect(parsed[0]).toEqual(ok(0));
  });

  it("caps the label and the path", () => {
    const [m] = parseMentions([{ type: "element", label: "@".padEnd(500, "x"), text: "t", target: { type: "page", page: null, path: "a".repeat(3000), tag: "a" } }]);
    expect(m!.label).toHaveLength(200);
    expect(m!.type === "element" && m!.target.path).toHaveLength(2000);
  });

  it("rejects a tag that is not a tag name, so nothing built from it can throw or hang", async () => {
    const bad = ["(", "(.*)*(.*)*(.*)*!", "a b", "<a>", ""].map((tag) => ({ type: "element", label: "@x", text: "", target: { type: "page", page: null, path: "a:nth-of-type(1)", tag } }));
    expect(parseMentions(bad)).toEqual([]);
    expect(parseMentions([{ type: "element", label: "@x", text: "", target: { type: "app", path: "/src/A.tsx", line: 1, tag: "motion.div(" } }])).toEqual([]);
    expect(parseMentions([{ type: "element", label: "@x", text: "", target: { type: "app", path: "/src/A.tsx", line: 1, tag: "motion.div" } }])).toHaveLength(1);
  });

  it("gives nothing for something that is not a list", () => {
    expect(parseMentions(undefined)).toEqual([]);
    expect(parseMentions({ type: "file" })).toEqual([]);
  });
});
