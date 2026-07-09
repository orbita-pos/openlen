import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderOverlayHtml } from "./render";

const PROJECT_HTML = `<!doctype html><html style="--ol-accent: #7c3aed"><head><title>Sally</title></head><body></body></html>`;
const base = {
  goal: { label: "Meta de subs", current: 340, target: 500 },
  screen: null,
  projectHtml: PROJECT_HTML,
  stateUrl: "/api/ov/p1/state?t=tok",
  title: "Sally",
};

describe("renderOverlayHtml", () => {
  it("emits a transparent full document with the goal and the project accent", () => {
    const html = renderOverlayHtml(base);
    assert.match(html, /^<!doctype html>/i);
    assert.ok(html.includes("background:transparent") || html.includes("background: transparent"));
    assert.ok(html.includes("Meta de subs"));
    assert.ok(html.includes("340"));
    assert.ok(html.includes("500"));
    assert.ok(html.includes("#7c3aed"));
    assert.ok(html.includes('name="robots" content="noindex"'));
    assert.ok(html.includes(base.stateUrl));
  });
  it("screen wins over goal and shows the brand screen", () => {
    const html = renderOverlayHtml({ ...base, screen: "brb" });
    assert.ok(!html.includes("Meta de subs"));
    assert.ok(/volvemos/i.test(html));
  });
  it("no goal + no screen renders an empty-but-valid transparent doc", () => {
    const html = renderOverlayHtml({ ...base, goal: null });
    assert.match(html, /^<!doctype html>/i);
  });
  it("escapes the goal label (no HTML injection from settings)", () => {
    const html = renderOverlayHtml({ ...base, goal: { label: `<img src=x onerror=1>`, current: 1, target: 2 } });
    assert.ok(!html.includes("<img src=x"));
    assert.ok(html.includes("&lt;img"));
  });
  it("missing accent falls back to the default", () => {
    const html = renderOverlayHtml({ ...base, projectHtml: "<!doctype html><html><body></body></html>" });
    assert.ok(html.includes("#e8743a"));
  });
});
