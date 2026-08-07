import { describe, expect, it } from "vitest";
import { fingerprintStructure, structureIsPreserved } from "@/lib/generation/structural-fingerprint";

const HTML = `<!doctype html><html style="--ol-bg: #fff; --ol-accent: #f00"><body>
<main><section id="hero"><img src="/classroom.jpg" srcset="/classroom-2x.jpg 2x" alt="Classroom"><a href="/learn">Learn</a></section>
<section><form action="/subscribe" method="post"><input name="email"></form><button aria-label="Subscribe" data-ol-click="subscribe">Join</button></section></main>
<script>window.initialized = true;</script></body></html>`;

const changeOnlyRootTokens = (html: string) => html.replace("--ol-bg: #fff; --ol-accent: #f00", "--ol-bg: #111; --ol-accent: #0f0");
const addVisualEngineStyle = (html: string) => html.replace("<body>", "<body><style data-openlen-visual-engine>body { color: red }</style>");
const changeAuthorizedImage = (html: string) => html.replace("/classroom.jpg", "/library.jpg").replace("Classroom", "Library");
const changeHref = (html: string) => html.replace('href="/learn"', 'href="/changed"');
const changeFormAction = (html: string) => html.replace('action="/subscribe"', 'action="/changed"');
const changeDataOl = (html: string) => html.replace('data-ol-click="subscribe"', 'data-ol-click="changed"');
const changeScript = (html: string) => html.replace("initialized = true", "initialized = false");
const reorderSections = (html: string) => html.replace('<section id="hero"><img src="/classroom.jpg" srcset="/classroom-2x.jpg 2x" alt="Classroom"><a href="/learn">Learn</a></section>\n<section><form action="/subscribe" method="post"><input name="email"></form><button aria-label="Subscribe" data-ol-click="subscribe">Join</button></section>', '<section><form action="/subscribe" method="post"><input name="email"></form><button aria-label="Subscribe" data-ol-click="subscribe">Join</button></section>\n<section id="hero"><img src="/classroom.jpg" srcset="/classroom-2x.jpg 2x" alt="Classroom"><a href="/learn">Learn</a></section>');

describe("fingerprintStructure", () => {
  it("ignores only authorized visual-engine changes", () => {
    const before = fingerprintStructure(HTML, { allowedAssetSlots: [0, 1] });

    expect(fingerprintStructure(changeOnlyRootTokens(HTML), { allowedAssetSlots: [0, 1] })).toBe(before);
    expect(fingerprintStructure(addVisualEngineStyle(HTML), { allowedAssetSlots: [0, 1] })).toBe(before);
    expect(fingerprintStructure(changeAuthorizedImage(HTML), { allowedAssetSlots: [0, 1] })).toBe(before);
  });

  it("detects semantic structure and behavior changes", () => {
    const before = fingerprintStructure(HTML, { allowedAssetSlots: [0, 1] });

    expect(fingerprintStructure(changeHref(HTML), { allowedAssetSlots: [0, 1] })).not.toBe(before);
    expect(fingerprintStructure(changeFormAction(HTML), { allowedAssetSlots: [0, 1] })).not.toBe(before);
    expect(fingerprintStructure(changeDataOl(HTML), { allowedAssetSlots: [0, 1] })).not.toBe(before);
    expect(fingerprintStructure(changeScript(HTML), { allowedAssetSlots: [0, 1] })).not.toBe(before);
    expect(fingerprintStructure(reorderSections(HTML), { allowedAssetSlots: [0, 1] })).not.toBe(before);
    expect(structureIsPreserved(HTML, changeAuthorizedImage(HTML), { allowedAssetSlots: [0, 1] })).toBe(true);
    expect(structureIsPreserved(HTML, changeHref(HTML), { allowedAssetSlots: [0, 1] })).toBe(false);
  });
});
