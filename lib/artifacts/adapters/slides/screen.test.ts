// @vitest-environment node
import { expect, it } from "vitest";
import { deckScreenCss, deckSlideWidth, withDeckScreenCss } from "./screen";
import { compileSlideDeck, parseSlideDeckV3, SLIDE_WIDTH } from "./deck";
import type { SealedArtifactInput } from "../../types";

it("zooms each slide to the page's width on a narrower screen, and only there", () => {
  expect(deckScreenCss(1920)).toBe("@media screen and (max-width:1919.98px){body{container-type:inline-size}.slide{zoom:min(1,tan(atan2(100cqw,1920px)))}}");
});

it("adds the rule at the end of the head of a deck, or at the end when there is none", () => {
  expect(withDeckScreenCss("<html><head><title>x</title></head><body></body></html>", 1280))
    .toBe(`<html><head><title>x</title><style>${deckScreenCss(1280)}</style></head><body></body></html>`);
  expect(withDeckScreenCss("<p>x</p>", 1920)).toBe(`<p>x</p><style>${deckScreenCss(1920)}</style>`);
});

it("reads the slide width from deck.json: the Claude-style width for version 3, the deck's own for v1", () => {
  expect(deckSlideWidth({ "deck.json": JSON.stringify({ version: 3, title: "x", order: [] }) }, SLIDE_WIDTH)).toBe(1920);
  expect(deckSlideWidth({ "deck.json": JSON.stringify({ version: 1, width: 1280, height: 720, slides: [] }) }, SLIDE_WIDTH)).toBe(1280);
  expect(deckSlideWidth({ "deck.json": "{broken" }, SLIDE_WIDTH)).toBe(1920);
  expect(deckSlideWidth({}, SLIDE_WIDTH)).toBe(1920);
});

it("new decks carry the rule in their own HTML, so a downloaded deck.html fits too", () => {
  const input = {
    artifact: { kind: "slides" },
    revision: { files: { "deck.json": JSON.stringify({ version: 3, title: "Ventas", order: ["cover"] }), "slides/cover.html": '<section id="cover" style="padding:128px">\n<h1>Ventas</h1>\n</section>\n' } },
    assets: [],
    datasets: [],
  } as unknown as SealedArtifactInput;
  expect(compileSlideDeck(parseSlideDeckV3(input), input)).toContain(deckScreenCss(1920));
});
