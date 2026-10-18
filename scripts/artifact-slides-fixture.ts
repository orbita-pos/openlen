import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { slidesFixture } from "../lib/artifacts/testing/slides";
import { parseSlideDeck } from "../lib/artifacts/adapters/slides/manifest";
import { slideDeckHtml } from "../lib/artifacts/adapters/slides/html";
import { exportSlideDeckPptx, validateSlideDeckPptx } from "../lib/artifacts/adapters/slides/pptx";
async function main() {
  const target = process.argv[2];
  if (!target) throw new Error("Pass an explicit output directory");
  const input = slidesFixture(new Uint8Array(await readFile("public/icon-512.png")));
  const deck = parseSlideDeck(input), html = slideDeckHtml(deck, input);
  const pptx = await exportSlideDeckPptx(deck, input); await validateSlideDeckPptx(pptx, deck);
  const dir = resolve(target); await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "deck.html"), html); await writeFile(join(dir, "deck.pptx"), pptx);
  await writeFile(join(dir, "deck.json"), input.revision.files["deck.json"]!);
  await writeFile(join(dir, "packet.json"), JSON.stringify({ version: 1, kind: "slides", html, width: deck.width, height: deck.height, pageCount: deck.slides.length, nativePptxBase64: Buffer.from(pptx).toString("base64"), probes: [] }));
  console.log("Synthetic deck exported and native PPTX objects verified; browser/LibreOffice checks are separate.");
}
main().catch(() => { console.error("Slide fixture failed"); process.exitCode = 1; });
