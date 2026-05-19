// Smoke-test the publish-time HTML optimizer on a curated template.
// Compares input/output size, asserts CDN script is gone, and writes the
// optimized HTML to a tmp file so you can `open` it and verify visually.
//
// Usage: node scripts/smoke-optimize.mjs [template-id]
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const id = process.argv[2] || "anchor";
const input = resolve(`public/templates/curated/${id}.html`);
const output = resolve(`.optimize-out/${id}.optimized.html`);

const html = await readFile(input, "utf8");
const t0 = performance.now();

const { optimizeHtmlForProduction } = await import(
  "../lib/publish/optimize-html.ts"
);
const result = await optimizeHtmlForProduction(html);

const elapsed = (performance.now() - t0).toFixed(0);

await writeFile(output, result.html);

const inSize = Buffer.byteLength(html, "utf8");
const outSize = Buffer.byteLength(result.html, "utf8");
const delta = outSize - inSize;
const cdnGone = !result.html.includes("cdn.tailwindcss.com");

console.log(`Template: ${id}`);
console.log(`  Elapsed: ${elapsed}ms`);
console.log(`  Baked:   ${result.baked}`);
console.log(`  CSS:     ${result.cssBytes} bytes`);
console.log(`  Input:   ${inSize} bytes`);
console.log(`  Output:  ${outSize} bytes (${delta >= 0 ? "+" : ""}${delta})`);
console.log(`  CDN gone: ${cdnGone}`);
console.log(`  Wrote:   ${output}`);
