// Dress an HTML file with a temática kit — exactly what the editor's apply
// does, baked at authoring time: kit tokens inline on <html>, the
// data-ol-tematica[-bg] attrs, the tagged <style> + font <link> in <head>.
// Used to author showcase templates that ship wearing a world (the cloned
// project reads as "kit active" in the inspector — switchable/removable).
//
//   npx tsx --tsconfig tsconfig.eval.json scripts/tematicas-dress.ts \
//     <in.html> <kit-id> [backdrop-id] [out.html]
//
// Defaults: backdrop = the kit's hero scene; out = overwrite <in.html>.

import { readFileSync, writeFileSync } from "node:fs";
import {
  getTematica,
  resolveBackdrop,
  tematicaCss,
} from "../lib/tematicas/presets";

const [, , inPath, kitId, backdropId, outPath] = process.argv;
if (!inPath || !kitId) {
  console.error("usage: tematicas-dress.ts <in.html> <kit-id> [backdrop-id] [out.html]");
  process.exit(1);
}
const kit = getTematica(kitId);
if (!kit) {
  console.error(`unknown kit "${kitId}"`);
  process.exit(1);
}

const bg = backdropId ? resolveBackdrop(kit, backdropId).id : undefined;
const css = tematicaCss(kit, bg);
const tokens = Object.entries(kit.tokens)
  .map(([k, v]) => `${k}: ${v}`)
  .join("; ");

let html = readFileSync(inPath, "utf8");

// Strip any prior dressing (idempotent re-dress).
html = html
  .replace(/<style data-ol-tematica>[\s\S]*?<\/style>/gi, "")
  .replace(/<link[^>]*data-ol-tematica[^>]*>/gi, "")
  .replace(/ data-ol-tematica(-bg)?="[^"]*"/gi, "");

html = html.replace(/<html\b([^>]*)>/i, (full, attrs: string) => {
  let a = attrs;
  a = / style="/.test(a)
    ? a.replace(/ style="([^"]*)"/, (m, s: string) => ` style="${s}; ${tokens}"`)
    : `${a} style="${tokens}"`;
  const bgAttr = bg && bg !== kit.backdrops[0].id ? ` data-ol-tematica-bg="${bg}"` : "";
  return `<html${a} data-ol-tematica="${kit.id}"${bgAttr}>`;
});

const inject =
  (kit.fontHref
    ? `<link rel="stylesheet" data-ol-tematica href="${kit.fontHref}">`
    : "") + `<style data-ol-tematica>${css}</style>`;
html = html.replace(/<\/head>/i, `${inject}</head>`);

writeFileSync(outPath || inPath, html, "utf8");
console.log(`dressed ${inPath} with ${kit.id}${bg ? `/${bg}` : ""} → ${outPath || inPath}`);
