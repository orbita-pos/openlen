import { ArtifactError, type AdapterResult, type SealedArtifactInput } from "../../types";
import type { ArtifactRender } from "../../render-protocol";
import { validateRenderPng } from "../dashboard/validate";
import { parseSlideDeck } from "./manifest";
import { slideDeckHtml } from "./html";
import { exportSlideDeckPptx, validateSlideDeckPptx } from "./pptx";
export async function renderSlides(input: SealedArtifactInput, render: ArtifactRender, signal: AbortSignal): Promise<AdapterResult> {
  const deck = parseSlideDeck(input);
  const html = slideDeckHtml(deck, input), pptx = await exportSlideDeckPptx(deck, input);
  await validateSlideDeckPptx(pptx, deck); signal.throwIfAborted();
  const rendered = await render({ version: 1, kind: "slides", html, width: deck.width, height: deck.height, pageCount: deck.slides.length, nativePptxBase64: Buffer.from(pptx).toString("base64"), probes: [] }, signal);
  if (!rendered.pdf || Buffer.from(rendered.pdf).subarray(0, 5).toString() !== "%PDF-" || !Buffer.from(rendered.pdf).subarray(-1024).includes(Buffer.from("%%EOF"))
    || rendered.pages?.length !== deck.slides.length || !["runtime:no-errors", "resources:complete", "text:no-overflow", "pptx:libreoffice-opened", "pdf:page-count-checked"].every((c) => rendered.checks.includes(c))) throw new ArtifactError("invalid_slide_render");
  for (const page of rendered.pages) validateRenderPng(page, deck.width, deck.height);
  return { outputs: [{ name: "deck.html", format: "html", mime: "text/html", bytes: new TextEncoder().encode(html) }, { name: "deck.pptx", format: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", bytes: pptx }, { name: "deck.pdf", format: "pdf", mime: "application/pdf", bytes: rendered.pdf }, ...rendered.pages.map((bytes, i) => ({ name: `slide-${String(i + 1).padStart(3, "0")}.png`, format: "png", mime: "image/png", bytes }))], evidence: { valid: true, checkedAt: new Date().toISOString(), checks: ["deck:stable-ids", "pptx:native-objects-checked", ...rendered.checks] } };
}
