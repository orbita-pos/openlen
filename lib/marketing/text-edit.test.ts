import { describe, expect, it } from "vitest";
import { applyTextEdits, tagEditableText } from "./text-edit";

const doc = `<!doctype html><html><head><style>.x{color:#fff}</style></head>
<body>
<div class="name">ORBITAPOS</div>
<div class="meta"><span class="badge">24/7</span><span>Presupuesto sin costo</span></div>
<svg><path d="M1 2"/></svg>
</body></html>`;

describe("tagEditableText", () => {
  it("tags leaf text elements in document order, never style/script/svg", () => {
    const out = tagEditableText(doc);
    expect(out).toContain(`<div class="name" data-ol-tid="0">ORBITAPOS</div>`);
    expect(out).toContain(`<span class="badge" data-ol-tid="1">24/7</span>`);
    expect(out).toContain(`data-ol-tid="2">Presupuesto sin costo</span>`);
    // the outer .meta div has child tags → not a leaf → not tagged
    expect(out).toMatch(/<div class="meta">/);
    // style + svg content untouched
    expect(out).toContain(`<style>.x{color:#fff}</style>`);
    expect(out).toContain(`<path d="M1 2"/>`);
  });
  it("is idempotent", () => {
    const once = tagEditableText(doc);
    expect(tagEditableText(once)).toBe(once);
  });
});

describe("applyTextEdits", () => {
  const tagged = tagEditableText(doc);
  it("replaces only the edited tids, escaping the new text", () => {
    const out = applyTextEdits(tagged, { "0": "Mi Taller", "1": "Abierto <hoy>" });
    expect(out).toContain(`data-ol-tid="0">Mi Taller</div>`);
    expect(out).toContain(`data-ol-tid="1">Abierto &lt;hoy&gt;</span>`);
    expect(out).toContain(`data-ol-tid="2">Presupuesto sin costo</span>`); // untouched
  });
  it("no-ops on an empty edit map", () => {
    expect(applyTextEdits(tagged, {})).toBe(tagged);
  });
  it("cannot inject markup via the edit value", () => {
    const out = applyTextEdits(tagged, { "0": `</div><script>alert(1)</script>` });
    expect(out).not.toContain("<script>alert(1)");
    expect(out).toContain("&lt;script&gt;");
  });
});
