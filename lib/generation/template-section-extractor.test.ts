import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { extractTemplateBands } from "./template-section-extractor";
import type { TemplateCorpusRow } from "./template-section-corpus";

function row(html: string): TemplateCorpusRow {
  return {
    templateId: "arcana",
    templateContentHash: createHash("sha256").update(html).digest("hex").slice(0, 12),
    storageKey: "templates/arcana-000000000000.html",
    storageUrl: "https://templates.invalid/arcana.html",
    mode: "dark",
    visualMetadata: null,
    html,
  };
}

describe("extractTemplateBands", () => {
  it("extracts only ordered top-level page bands while preserving exact bytes", () => {
    const header = `<header id="nav"><nav>Menu</nav></header>`;
    const hero = `<section id="hero" data-label="a > b"><section>Nested card</section></section>`;
    const footer = `<footer id="end">End</footer>`;
    const result = extractTemplateBands(row(`<!doctype html><html><head><style>.hero{color:red}</style></head><body>
      ${header}\n${hero}\n${footer}
    </body></html>`));

    expect(result).toMatchObject({
      ok: true,
      bands: [
        { ordinal: 0, rootTag: "header", sourceHtml: header, sourceIds: ["nav"] },
        { ordinal: 1, rootTag: "section", sourceHtml: hero, sourceIds: ["hero"] },
        { ordinal: 2, rootTag: "footer", sourceHtml: footer, sourceIds: ["end"] },
      ],
    });
  });

  it("does not interpret comments or raw-text contents as markup", () => {
    const content = `<section id="story"><!-- <html><section id="fake"> -->
      <script>const sample = "</section><html>";</script>
      <style>.x::after{content:"<footer>"}</style>
      <textarea><section id="fake-two"></textarea>
      <svg><title><section id="foreign"></section></title></svg>
    </section>`;
    const result = extractTemplateBands(row(`<html><body>${content}</body></html>`));
    expect(result).toMatchObject({ ok: true, bands: [{ sourceHtml: content, sourceIds: ["story", "foreign"] }] });
  });

  it("extracts page bands from one neutral body wrapper", () => {
    const result = extractTemplateBands(row(`<html><body><div id="app">
      <nav id="nav">Menu</nav><main><section id="one">One</section><section id="two">Two</section></main><footer>End</footer>
    </div></body></html>`));
    expect(result).toMatchObject({
      ok: true,
      bands: [
        { ordinal: 0, rootTag: "nav", sourceIds: ["nav"] },
        { ordinal: 1, rootTag: "section", sourceIds: ["one"] },
        { ordinal: 2, rootTag: "section", sourceIds: ["two"] },
        { ordinal: 3, rootTag: "footer" },
      ],
    });
  });

  it.each([
    ["unbalanced markup", `<html><body><section><div>broken</section></body></html>`, "invalid_template_document"],
    ["nested full page", `<html><body><section><html><body>bad</body></html></section></body></html>`, "invalid_template_document"],
    ["duplicate source ids", `<html><body><section id="same">A</section><section id="same">B</section></body></html>`, "invalid_template_document"],
    ["text between bands", `<html><body><section>A</section>leaked text<footer>B</footer></body></html>`, "invalid_template_document"],
    ["no bands", `<html><head></head><body><div>Only wrapper</div></body></html>`, "no_extractable_bands"],
    ["empty document", ``, "invalid_template_document"],
  ] as const)("rejects %s", (_label, html, code) => {
    expect(extractTemplateBands(row(html))).toEqual({ ok: false, code });
  });

  it("produces stable source hashes tied to template provenance and ordinal", () => {
    const html = `<html><body><section id="a">A</section><section id="b">B</section></body></html>`;
    const first = extractTemplateBands(row(html));
    const second = extractTemplateBands(row(html));
    expect(first).toEqual(second);
    expect(first.ok && first.bands.map((band) => band.sourceHash)).toEqual([
      expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
      expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
    ]);
  });
});
