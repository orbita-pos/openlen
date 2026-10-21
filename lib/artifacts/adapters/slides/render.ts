import { ArtifactError, type AdapterResult, type SealedArtifactInput } from "../../types";
import type { ArtifactRender } from "../../render-protocol";
import { validateRenderPng } from "../dashboard/validate";
import { parseSlideDeck } from "./manifest";
import { slideDeckHtml } from "./html";
import { exportSlideDeckPptx, validateSlideDeckPptx } from "./pptx";
import { compileSlideDeck, isSlideDeckV3, parseSlideDeckV3, SLIDE_HEIGHT, SLIDE_WIDTH } from "./deck";
import { exportNativeDeck, parseMeasuredDeck, validateNativeDeck } from "./native";
import { validateArtifactImage } from "../image/validate";
import { imageSize } from "image-size";

const PPTX_MIME = "application/vnd.openxmlformats-officedocument.presentationml.presentation";

export async function renderSlides(input: SealedArtifactInput, render: ArtifactRender, signal: AbortSignal): Promise<AdapterResult> {
  let html: string, pptx: Uint8Array, width: number, height: number, pageCount: number;
  const checks: string[] = [];
  if (isSlideDeckV3(input)) {
    // The slide format (deck.ts): measured in the isolated browser, then every element as a PowerPoint object.
    const deck = parseSlideDeckV3(input);
    html = compileSlideDeck(deck, input); width = SLIDE_WIDTH; height = SLIDE_HEIGHT; pageCount = deck.slides.length;
    const layout = await render({ version: 1, kind: "slides-layout", html, width, height, pageCount, probes: [] }, signal);
    if (!["slides:html-layout-measured", "slides:native-objects", "runtime:no-errors", "resources:complete"].every((c) => layout.checks.includes(c))) throw new ArtifactError("invalid_slide_layout");
    const measured = parseMeasuredDeck(layout.layout, deck.slides.map((s) => s.id));
    for (const asset of measured.assets) {
      const bytes = Buffer.from(asset.base64, "base64"), dimensions = imageSize(bytes);
      if (!dimensions.width || !dimensions.height || dimensions.width > 3840 * 2 || dimensions.height > 2160 * 2) throw new ArtifactError("invalid_slide_layout");
      await validateArtifactImage(new Uint8Array(bytes), "png", dimensions.width, dimensions.height);
    }
    pptx = await exportNativeDeck(deck.title, deck.slides, measured, { image: (id) => input.assets.find((a) => a.id === id) });
    await validateNativeDeck(pptx, measured);
    checks.push("deck:format-checked", ...layout.checks);
  } else {
    const deck = parseSlideDeck(input);
    html = slideDeckHtml(deck, input); width = deck.width; height = deck.height; pageCount = deck.slides.length;
    pptx = await exportSlideDeckPptx(deck, input);
    await validateSlideDeckPptx(pptx, deck);
  }
  signal.throwIfAborted();
  const rendered = await render({ version: 1, kind: "slides", html, width, height, pageCount, nativePptxBase64: Buffer.from(pptx).toString("base64"), probes: [] }, signal);
  if (!rendered.pdf || Buffer.from(rendered.pdf).subarray(0, 5).toString() !== "%PDF-" || !Buffer.from(rendered.pdf).subarray(-1024).includes(Buffer.from("%%EOF"))
    || rendered.pages?.length !== pageCount || !["runtime:no-errors", "resources:complete", "text:no-overflow", "pptx:libreoffice-opened", "pdf:page-count-checked"].every((c) => rendered.checks.includes(c))) throw new ArtifactError("invalid_slide_render");
  for (const page of rendered.pages) validateRenderPng(page, width, height);
  return {
    outputs: [{ name: "deck.html", format: "html", mime: "text/html", bytes: new TextEncoder().encode(html) }, { name: "deck.pptx", format: "pptx", mime: PPTX_MIME, bytes: pptx }, { name: "deck.pdf", format: "pdf", mime: "application/pdf", bytes: rendered.pdf },
      ...rendered.pages.map((bytes, i) => ({ name: `slide-${String(i + 1).padStart(3, "0")}.png`, format: "png", mime: "image/png", bytes }))],
    evidence: { valid: true, checkedAt: new Date().toISOString(), checks: ["deck:stable-ids", "pptx:native-objects-checked", ...checks, ...rendered.checks] },
  };
}
