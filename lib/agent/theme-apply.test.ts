import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyThemeTokensToHtml } from "./theme-apply";
import { compileSkeletonIdentity } from "../generation/creative-compiler";
import { CreativeDirectionSchema, SkeletonAdaptationPlanSchema } from "../generation/creative-contracts";
import { buildSkeletonInventory } from "../generation/skeleton-inventory";

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
  it("escapes inner double quotes when re-serializing a single-quoted style value with url(\"...\")", () => {
    const doc = `<!doctype html><html lang="es" style='background: url("x.png")'><head><title>x</title></head><body></body></html>`;
    const out = applyThemeTokensToHtml(doc, { "--ol-accent": "#e8743a" });
    const htmlTag = /<html\b[^>]*>/i.exec(out)![0];
    // Well-formed: exactly one double-quoted style attr, no unescaped inner ".
    assert.match(htmlTag, /^<html [^>]*style="[^"]*"[^>]*>$/);
    assert.ok(htmlTag.includes(`url('x.png')`));
    assert.ok(htmlTag.includes("--ol-accent: #e8743a"));
  });
  it("preserves a quoted font-family list as single-quoted when re-serializing", () => {
    const doc = `<!doctype html><html lang="es" style='font-family: "Inter", serif'><head><title>x</title></head><body></body></html>`;
    const out = applyThemeTokensToHtml(doc, { "--ol-accent": "#e8743a" });
    const htmlTag = /<html\b[^>]*>/i.exec(out)![0];
    assert.match(htmlTag, /^<html [^>]*style="[^"]*"[^>]*>$/);
    assert.ok(htmlTag.includes(`font-family: 'Inter', serif`));
    assert.ok(htmlTag.includes("--ol-accent: #e8743a"));
  });

  it("lets the bounded creative compiler reuse token application without changing data-ol-mode", () => {
    const doc = `<!doctype html><html lang="es" data-ol-mode="dark"><head><title>x</title></head><body><section><svg data-lucide="star" aria-hidden="true"></svg></section></body></html>`;
    const direction = CreativeDirectionSchema.parse({
      schemaVersion: "creative-direction/1.0",
      mode: "dark",
      visualArchetype: "technical",
      emotionalTone: [],
      palette: { background: "#111111", surface: "#191919", surfaceAlt: "#232323", foreground: "#F5F5F5", foregroundMuted: "#B8B8B8", accent: "#0057B8", accentInk: "#FFFFFF", border: "#3A3A3A" },
      typography: { display: "technical", body: "technical", mono: "ui_monospace", scale: "balanced" },
      geometry: { radius: "soft", radiusScale: 1, spacingScale: 1, density: "medium" },
      imagery: { strategy: "mixed", artDirection: "technical", subjects: [], avoid: [] },
      iconography: { style: "rounded_outline", strokeWeight: "medium", cornerStyle: "round" },
      componentTreatment: { cards: "bordered", buttons: "solid", navigation: "simple", sections: "compact" },
      requiredVisualSignals: [],
      forbiddenVisualSignals: [],
    });
    const plan = SkeletonAdaptationPlanSchema.parse({ schemaVersion: "skeleton-adaptation-plan/1.0", tokens: {}, cssOverride: [], assets: [] });
    const result = compileSkeletonIdentity({ html: doc, inventory: buildSkeletonInventory(doc, "dark"), direction, plan });
    assert.equal(result.ok, true);
    if (result.ok) assert.match(result.html, /<html[^>]*data-ol-mode="dark"/);
  });
});
