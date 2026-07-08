import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyThemeTokensToHtml } from "./theme-apply";

const DOC = `<!doctype html><html lang="es"><head><title>x</title></head><body></body></html>`;
const DOC_STYLED = `<!doctype html><html lang="es" style="--ol-accent: #ff0000; color: red"><head><title>x</title></head><body></body></html>`;

describe("applyThemeTokensToHtml", () => {
  it("creates the style attribute when missing", () => {
    const out = applyThemeTokensToHtml(DOC, { "--ol-accent": "#e8743a" });
    assert.match(out, /<html[^>]*style="[^"]*--ol-accent:\s*#e8743a/);
  });
  it("replaces an existing token, keeps unrelated declarations", () => {
    const out = applyThemeTokensToHtml(DOC_STYLED, { "--ol-accent": "#00ff00" });
    assert.ok(out.includes("--ol-accent: #00ff00") || out.includes("--ol-accent:#00ff00"));
    assert.ok(!out.includes("#ff0000"));
    assert.ok(out.includes("color: red"));
  });
  it("derives --ol-accent-r as RGB triplet from --ol-accent", () => {
    const out = applyThemeTokensToHtml(DOC, { "--ol-accent": "#ff8000" });
    assert.match(out, /--ol-accent-r:\s*255,\s*128,\s*0/);
  });
  it("only touches the root <html> tag", () => {
    const doc = DOC.replace("<body></body>", `<body><div style="--ol-accent: #111"></div></body>`);
    const out = applyThemeTokensToHtml(doc, { "--ol-accent": "#222" });
    assert.ok(out.includes(`<div style="--ol-accent: #111">`));
  });
  it("data-ol-mode is written as an attribute (empty removes it), never inline style", () => {
    const on = applyThemeTokensToHtml(DOC, { "data-ol-mode": "dark", "--ol-accent": "#222222" });
    assert.match(on, /<html[^>]*\sdata-ol-mode="dark"/);
    assert.ok(!/style="[^"]*data-ol-mode/.test(on));
    const off = applyThemeTokensToHtml(on, { "data-ol-mode": "" });
    assert.ok(!off.includes("data-ol-mode"));
    assert.ok(off.includes("--ol-accent: #222222"));
  });
  it("reads and rewrites a SINGLE-quoted style attr as double-quoted, without duplicating it", () => {
    const doc = `<!doctype html><html lang="es" style='--ol-accent: #111'><head><title>x</title></head><body></body></html>`;
    const out = applyThemeTokensToHtml(doc, { "--ol-font-display": "serif" });
    // Exactly one style attribute on <html> — the single-quoted original must
    // not survive alongside a second, newly-created double-quoted one.
    const htmlTag = /<html\b[^>]*>/i.exec(out)![0];
    assert.equal((htmlTag.match(/\sstyle=/g) ?? []).length, 1);
    assert.match(htmlTag, /\sstyle="[^"]*"/);
    assert.ok(!htmlTag.includes("style='"));
    // Old token preserved, new token merged in.
    assert.ok(out.includes("--ol-accent: #111"));
    assert.ok(out.includes("--ol-font-display: serif"));
  });
  it("a root style value containing url(data:...;base64,...) survives a token merge byte-intact", () => {
    const dataUrl = "data:image/png;base64,abc123==";
    const doc = `<!doctype html><html lang="es" style="background: url(${dataUrl}); color: red"><head><title>x</title></head><body></body></html>`;
    const out = applyThemeTokensToHtml(doc, { "--ol-accent": "#e8743a" });
    assert.ok(out.includes(`url(${dataUrl})`));
    assert.ok(out.includes("color: red"));
    assert.ok(out.includes("--ol-accent: #e8743a"));
  });
});
