import { describe, expect, it } from "vitest";
import { fingerprintStructure, StructuralFingerprintError, structureIsPreserved } from "@/lib/generation/structural-fingerprint";

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

  it("protects ordinary stylesheets and does not exempt duplicate visual-engine styles", () => {
    const ordinaryStyle = HTML.replace("<body>", "<body><style>.button { color: red; }</style>");
    const changedOrdinaryStyle = ordinaryStyle.replace("color: red", "color: blue");
    const oneVisualEngineStyle = addVisualEngineStyle(HTML);
    const duplicateVisualEngineStyles = oneVisualEngineStyle.replace("</style>", "</style><style data-openlen-visual-engine>body { color: blue }</style>");

    expect(fingerprintStructure(changedOrdinaryStyle)).not.toBe(fingerprintStructure(ordinaryStyle));
    expect(fingerprintStructure(duplicateVisualEngineStyles)).not.toBe(fingerprintStructure(oneVisualEngineStyle));
  });

  it("fails closed for malformed or structurally incomplete generated HTML", () => {
    const malformedAfter = "<html><body><main><section>";
    const incompleteAfter = "<main><section></section></main>";

    expect(() => fingerprintStructure(malformedAfter)).toThrow(StructuralFingerprintError);
    expect(() => fingerprintStructure(incompleteAfter)).toThrow(StructuralFingerprintError);
    expect(structureIsPreserved(HTML, malformedAfter)).toBe(false);
    expect(structureIsPreserved(HTML, incompleteAfter)).toBe(false);
  });

  it("ignores approved root tokens across whitespace, order, additions, and removals only", () => {
    const withoutTokens = HTML.replace(' style="--ol-bg: #fff; --ol-accent: #f00"', "");
    const reorderedTokens = HTML.replace("--ol-bg: #fff; --ol-accent: #f00", "  --ol-font-body : Inter ; --ol-accent:#0f0; --ol-bg : #111 ");
    const redRootStyle = HTML.replace("--ol-bg: #fff; --ol-accent: #f00", "--ol-bg: #fff; color: red");
    const blueRootStyle = HTML.replace("--ol-bg: #fff; --ol-accent: #f00", "--ol-bg: #fff; color: blue");
    const before = fingerprintStructure(HTML);

    expect(fingerprintStructure(withoutTokens)).toBe(before);
    expect(fingerprintStructure(reorderedTokens)).toBe(before);
    expect(fingerprintStructure(redRootStyle)).not.toBe(fingerprintStructure(blueRootStyle));
  });

  it("ignores only the deterministic accent RGB derivative among non-creative root tokens", () => {
    const withoutDerivative = HTML;
    const withDerivative = HTML.replace("--ol-accent: #f00", "--ol-accent: #f00; --ol-accent-r: 255,0,0");
    const changedDerivative = withDerivative.replace("255,0,0", "0,255,0");
    const caseVariantDerivative = withDerivative.replace("--ol-accent-r", "--OL-accent-r");
    const unknownOpenLenToken = withDerivative.replace("--ol-accent-r", "--ol-accent-r-extra");
    const ordinaryCss = withDerivative.replace("--ol-accent-r: 255,0,0", "color: red");

    const expected = fingerprintStructure(withoutDerivative);
    expect(fingerprintStructure(withDerivative)).toBe(expected);
    expect(fingerprintStructure(changedDerivative)).toBe(expected);
    expect(fingerprintStructure(caseVariantDerivative)).not.toBe(expected);
    expect(fingerprintStructure(unknownOpenLenToken)).not.toBe(expected);
    expect(fingerprintStructure(ordinaryCss)).not.toBe(expected);
  });
});
