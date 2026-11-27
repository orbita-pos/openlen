// @vitest-environment node
// Fixtures: `__fixtures__/honu-lagoon.svg` and `night-reef.svg` are the output of the `honuLagoonSvg()` / `nightReefSvg()`
// scenes of Claude Code's `theme-examples` plugin (Anthropic, Apache-2.0), written to disk once and committed as they came.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { REDUCED_MOTION_RULE, SCENE_MAX_BYTES, checkScene, stillScene } from "./scene-check";

const honu = readFileSync(resolve(__dirname, "__fixtures__/honu-lagoon.svg"), "utf8");
const nightReef = readFileSync(resolve(__dirname, "__fixtures__/night-reef.svg"), "utf8");

const SLICE = `viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice"`;

/** A scene that passes, with `inner` inside it and `root` as the root's attributes. */
function scene(inner = "", root = SLICE): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" ${root}>${inner}<rect width="1600" height="1000"/></svg>`;
}

const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

function problemOf(svg: string, file = "/themes/a.svg") {
  const r = checkScene(svg, file);
  if (r.ok) throw new Error("expected the scene to be refused");
  return r.problem;
}

describe("checkScene — Claude Code's own scenes", () => {
  it("passes honu-lagoon and night-reef as generated", () => {
    for (const svg of [honu, nightReef]) {
      const r = checkScene(svg, "/themes/x.svg");
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.addedReducedMotion).toBe(false);
      expect(r.svg).toBe(svg);
    }
  });

  it("counts cost and calls night-reef heavy and honu-lagoon light", () => {
    const night = checkScene(nightReef, "/themes/night-reef.svg");
    const lagoon = checkScene(honu, "/themes/honu-lagoon.svg");
    if (!night.ok || !lagoon.ok) throw new Error("both scenes must pass");

    // The CSS rules that animate something reach the elements that carry those classes.
    expect(lagoon.cost.animated).toBeGreaterThan(0);
    expect(night.cost.animated).toBeGreaterThan(lagoon.cost.animated);
    expect(night.cost.elements).toBeGreaterThan(lagoon.cost.elements);

    expect(night.cost.heavy).toBe(true);
    expect(lagoon.cost.heavy).toBe(false);
  });

  it("counts as animated what a CSS rule with an animation reaches, and every <animate*>", () => {
    const css =
      `.a{animation:x 1s}.b{animation:none}.c{animation-delay:1s}.d{opacity:.5;animation-name:x}` +
      `@keyframes x{from{opacity:0}to{opacity:1}}` +
      `@media (prefers-reduced-motion: reduce){.h{animation:x 1s}}` +
      `@media (prefers-reduced-motion: no-preference){.g{animation:x 1s}}` +
      `#e,g.f{-webkit-animation:x 1s}.p circle{animation:x 1s}`;
    const reached =
      `<g class="a"/><g class="d"/><g id="e"/><g class="f"/><g class="g"/>` +
      `<g style="opacity:0; animation: x 2s"/>` +
      // A descendant rule is read by its last compound alone: this <circle> has no `.p` above it and is counted.
      `<circle/><animateTransform/>`;
    const notReached =
      // `animation:none`, a delay on its own, the reduced-motion media, a class on a tag the rule does not name,
      // a style that stops, and <set> (which is not an <animate*>)
      `<g class="b"/><g class="c"/><g class="h"/><rect class="f"/><g style="animation:none"/><set/>`;
    const r = checkScene(scene(`<style>${css}</style>${reached}${notReached}`), "/themes/a.svg");
    if (!r.ok) throw new Error("the scene must pass");
    expect(r.cost.animated).toBe(8);
    // the root, the <style>, the 8 that are reached, the 6 that are not, and the scene's own <rect>
    expect(r.cost.elements).toBe(1 + 1 + 8 + 6 + 1);
  });

  it("counts a scene with nothing animated as light however big it is", () => {
    const r = checkScene(scene(`<style>.a{fill:red}</style>` + `<g/>`.repeat(5000)), "/themes/a.svg");
    if (!r.ok) throw new Error("the scene must pass");
    expect(r.cost.elements).toBeGreaterThan(5000);
    expect(r.cost.animated).toBe(0);
    expect(r.cost.heavy).toBe(false);
  });

  it("counts a scene too tangled to count as animated throughout", () => {
    const selectors = Array.from({ length: 5000 }, (_, i) => `.c${i}{animation:x 1s}`).join("");
    const r = checkScene(scene(`<style>${selectors}</style>` + `<g class="z"/>`.repeat(5000)), "/themes/a.svg");
    if (!r.ok) throw new Error("the scene must pass");
    expect(r.cost.animated).toBe(r.cost.elements);
    expect(r.cost.heavy).toBe(true);
  });
});

describe("checkScene — the reduced-motion rule", () => {
  it("adds the rule once when it is missing, and leaves the scene's own CSS as it was", () => {
    const input = scene("<style>@keyframes a{}</style>");
    const r = checkScene(input, "/themes/a.svg");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.addedReducedMotion).toBe(true);
    expect(occurrences(r.svg, REDUCED_MOTION_RULE)).toBe(1);
    expect(r.svg).toContain("<style>@keyframes a{}</style>");
    expect(r.svg).toContain(`<style>${REDUCED_MOTION_RULE}</style>`);
  });

  it("puts the rule where the scene's own CSS cannot swallow it", () => {
    // A brace left open and a comment never closed: written after them, the rule would be part of them.
    const broken = scene("<style>.a{animation:x 1s /* never closed</style>");
    const r = checkScene(broken, "/themes/a.svg");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.svg.indexOf(`<style>${REDUCED_MOTION_RULE}</style>`)).toBeLessThan(r.svg.indexOf("<style>.a{"));
  });

  it("does not take the rule for there when it only sits in a comment", () => {
    const r = checkScene(scene(`<style>/* ${REDUCED_MOTION_RULE} */</style>`), "/themes/a.svg");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.addedReducedMotion).toBe(true);
  });

  it("adds a <style> when the scene has none", () => {
    const r = checkScene(scene(), "/themes/a.svg");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.addedReducedMotion).toBe(true);
    expect(occurrences(r.svg, "<style")).toBe(1);
    expect(occurrences(r.svg, REDUCED_MOTION_RULE)).toBe(1);
    // It sits inside the root, so the file is still one well-formed document.
    expect(r.svg.indexOf("<style")).toBeGreaterThan(r.svg.indexOf("<svg"));
    expect(r.svg.indexOf("</style>")).toBeLessThan(r.svg.lastIndexOf("</svg>"));
  });

  it("opens a self-closing root to put the <style> inside it", () => {
    const r = checkScene(`<svg xmlns="http://www.w3.org/2000/svg" ${SLICE}/>`, "/themes/a.svg");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.svg).toBe(
      `<svg xmlns="http://www.w3.org/2000/svg" ${SLICE}><style>${REDUCED_MOTION_RULE}</style></svg>`,
    );
  });

  it("takes the same rule written with other spacing as already there", () => {
    const spaced = "@media (prefers-reduced-motion:reduce){ * { animation: none !important; } }";
    const r = checkScene(scene(`<style>.a{animation:x 1s}${spaced}</style>`), "/themes/a.svg");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.addedReducedMotion).toBe(false);
    expect(occurrences(r.svg, "prefers-reduced-motion")).toBe(1);
  });

  it("does not take a reduced-motion rule that stops something else as the one it needs", () => {
    const other = "@media (prefers-reduced-motion: reduce){.a{animation:none}}";
    const r = checkScene(scene(`<style>${other}</style>`), "/themes/a.svg");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.addedReducedMotion).toBe(true);
    expect(occurrences(r.svg, REDUCED_MOTION_RULE)).toBe(1);
  });
});

describe("checkScene — what it refuses", () => {
  const refused: [string, string, string][] = [
    ["a <script>", scene("<script>alert(1)</script>"), "script"],
    ["a <script> with a namespace prefix", scene(`<svg:script xmlns:svg="http://www.w3.org/2000/svg"/>`), "script"],
    ["an onload attribute", scene("", `${SLICE} onload="x"`), "event_handler"],
    ["an onclick on a child", scene(`<g onclick="x"/>`), "event_handler"],
    ["an event handler in other case, glued to a quote", scene(`<g id="a"ONCLICK='x'/>`), "event_handler"],
    ["<foreignObject>", scene("<foreignObject><div/></foreignObject>"), "foreign_object"],
    ["an https href", scene(`<use href="https://a"/>`), "external_ref"],
    ["a protocol-relative xlink:href", scene(`<use xlink:href="//a"/>`), "external_ref"],
    ["a data: href", scene(`<image href="data:image/png;base64,AAAA"/>`), "external_ref"],
    ["an href in single quotes", scene(`<use href='https://a'/>`), "external_ref"],
    ["an href that only looks like a fragment", scene(`<use href=" #a"/>`), "external_ref"],
    ["a url() to the network in an attribute", scene(`<rect fill="url(https://a)"/>`), "external_ref"],
    ["a url() to the network in a style", scene(`<style>.a{fill:URL( 'https://a' )}</style>`), "external_ref"],
    ["an @import", scene(`<style>@import "x.css";</style>`), "external_ref"],
    ["an xml-stylesheet instruction", `<?xml-stylesheet href="https://a/x.css"?>` + scene(), "external_ref"],
    ["an <!ENTITY", scene().replace("<svg", `<!ENTITY a "b"><svg`), "doctype"],
    ["a <!DOCTYPE", `<!DOCTYPE svg SYSTEM "x.dtd">` + scene(), "doctype"],
    ["a root without viewBox", scene("", `preserveAspectRatio="xMidYMid slice"`), "no_viewbox"],
    ["a viewBox that is not four numbers", scene("", `viewBox="0 0 1600" preserveAspectRatio="slice"`), "no_viewbox"],
    ["a viewBox with no area", scene("", `viewBox="0 0 0 1000" preserveAspectRatio="slice"`), "no_viewbox"],
    ["a meet preserveAspectRatio", scene("", `viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid meet"`), "not_slice"],
    ["no preserveAspectRatio at all", scene("", `viewBox="0 0 1600 1000"`), "not_slice"],
    ["a root that is not an <svg>", `<html xmlns="http://www.w3.org/1999/xhtml"><body/></html>`, "not_svg"],
    ["text that is not a document", "hello", "not_svg"],
  ];

  it.each(refused)("refuses %s", (_name, svg, code) => {
    const problem = problemOf(svg, "/themes/hostile.svg");
    expect(problem.code).toBe(code);
    expect(problem.file).toBe("/themes/hostile.svg");
  });

  it("names what it found when that helps", () => {
    expect(problemOf(scene("", `${SLICE} onload="x"`)).detail).toBe("onload");
    expect(problemOf(scene(`<use href="https://a"/>`)).detail).toBe(`href="https://a"`);
    expect(problemOf(scene(`<rect fill="url(https://a)"/>`)).detail).toBe("url(https://a)");
  });

  it("refuses a scene one byte over the limit, and takes one exactly at it", () => {
    const padded = (bytes: number) => {
      const base = scene("<!---->");
      const fill = bytes - new TextEncoder().encode(base).length;
      return scene(`<!--${"x".repeat(fill)}-->`);
    };
    const atLimit = padded(SCENE_MAX_BYTES);
    expect(new TextEncoder().encode(atLimit).length).toBe(SCENE_MAX_BYTES);
    expect(checkScene(atLimit, "/themes/a.svg").ok).toBe(true);

    const over = padded(SCENE_MAX_BYTES + 1);
    expect(new TextEncoder().encode(over).length).toBe(1_048_577);
    expect(problemOf(over).code).toBe("too_big");
  });

  it("counts bytes, not characters", () => {
    // 'é' is two bytes: this is under the limit in characters and over it in bytes.
    const svg = scene(`<!--${"é".repeat(SCENE_MAX_BYTES / 2)}-->`);
    expect(svg.length).toBeLessThan(SCENE_MAX_BYTES);
    expect(problemOf(svg).code).toBe("too_big");
  });

  it("takes what points inside the document", () => {
    const svg = scene(
      `<defs><linearGradient id="g"/><path id="p" d="M0 0"/></defs>` +
        `<use href="#p"/><use xlink:href='#p'/><rect fill="url(#g)"/><rect fill="url('#g')" stroke='url( "#g" )'/>` +
        `<style>.a{fill:url(#g)}</style>`,
    );
    expect(checkScene(svg, "/themes/a.svg").ok).toBe(true);
  });

  it("does not take prose in a <text> for markup", () => {
    const svg = scene(`<text>once = 1, on x=2, a word like href, or script</text>`);
    expect(checkScene(svg, "/themes/a.svg").ok).toBe(true);
  });
});

describe("stillScene", () => {
  it("stops animation without a media query", () => {
    const r = checkScene(scene("<style>.a{animation:x 1s infinite}</style>"), "/themes/a.svg");
    if (!r.ok) throw new Error("the scene must pass");
    const still = stillScene(r.svg);
    expect(still).toContain("*{animation:none!important}");
    // The unconditional rule is outside any @media: take the media rule away and it is still there.
    expect(still.split(REDUCED_MOTION_RULE).join("")).toContain("*{animation:none!important}");
  });

  it("works on a scene that has no <style>, and on Claude Code's own", () => {
    expect(stillScene(scene())).toContain("<style>*{animation:none!important}</style>");
    for (const svg of [honu, nightReef]) {
      const still = stillScene(svg);
      expect(still.length).toBeGreaterThan(svg.length);
      expect(still.split(REDUCED_MOTION_RULE).join("")).toContain("*{animation:none!important}");
    }
  });

  it("is the same scene otherwise, and stays one document", () => {
    const still = stillScene(honu);
    expect(still.replace("<style>*{animation:none!important}</style>", "")).toBe(honu);
    expect(checkScene(still, "/themes/a.svg").ok).toBe(true);
  });

  it("opens a self-closing root, and leaves what is not a scene alone", () => {
    expect(stillScene(`<svg xmlns="http://www.w3.org/2000/svg" ${SLICE}/>`)).toBe(
      `<svg xmlns="http://www.w3.org/2000/svg" ${SLICE}><style>*{animation:none!important}</style></svg>`,
    );
    expect(stillScene("hello")).toBe("hello");
  });

  it("does not stack the rule when asked twice", () => {
    const once = stillScene(scene());
    expect(stillScene(once)).toBe(once);
  });
});
