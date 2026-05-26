// Ad-hoc perf comparison: Rust napi engine vs the current cheerio-based
// implementation. Not a formal benchmark (no warmup/statistics) — just a
// sanity-check that the F1 target (chat-turn overhead p95 < 30 ms vs the
// ~150 ms baseline) is in reach before we sink Sem 5+ work into it.
//
// Run with: node __test__/perf-vs-cheerio.mjs

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import {
  applyOps,
  parseOps,
  stripOpIds,
  tagWithOpIds,
} from "../index.js";
import * as cheerio from "cheerio";

const here = dirname(fileURLToPath(import.meta.url));
const starter = (name) =>
  readFileSync(resolve(here, "../../../templates/starter", name), "utf8");

const MIRROR = starter("mirror.html");
const COUNTER = starter("counter.html");

const OP_ID_ATTR = "data-op-id";
const SKIP = new Set([
  "html",
  "head",
  "meta",
  "title",
  "link",
  "script",
  "style",
  "noscript",
  "br",
  "hr",
]);

function cheerioTag(html) {
  const $ = cheerio.load(html, { xmlMode: false });
  let counter = 0;
  $("*").each((_, el) => {
    if (el.type !== "tag") return;
    if (SKIP.has(el.name.toLowerCase())) return;
    if ($(el).attr(OP_ID_ATTR)) return;
    $(el).attr(OP_ID_ATTR, counter.toString(36));
    counter += 1;
  });
  return { taggedHtml: $.html(), taggedCount: counter };
}

function bench(label, fn, iters = 50) {
  // warm up
  for (let i = 0; i < 5; i++) fn();
  const samples = [];
  for (let i = 0; i < iters; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  samples.sort((a, b) => a - b);
  const p50 = samples[Math.floor(iters / 2)];
  const p95 = samples[Math.floor(iters * 0.95)];
  const mean = samples.reduce((a, b) => a + b, 0) / iters;
  console.log(
    `${label.padEnd(40)}  p50=${p50.toFixed(2).padStart(7)}ms  p95=${p95
      .toFixed(2)
      .padStart(7)}ms  mean=${mean.toFixed(2).padStart(7)}ms`,
  );
  return { p50, p95, mean };
}

console.log(`mirror.html: ${MIRROR.length} bytes`);
console.log(`counter.html: ${COUNTER.length} bytes`);
console.log();

console.log("=== tagWithOpIds ===");
const rustTag = bench("rust  (lol-html)", () => tagWithOpIds(MIRROR));
const cheerioTagPerf = bench("node  (cheerio)", () => cheerioTag(MIRROR));
console.log(
  `speedup p95: ${(cheerioTagPerf.p95 / rustTag.p95).toFixed(1)}x faster\n`,
);

console.log("=== stripOpIds (after tag) ===");
const tagged = tagWithOpIds(MIRROR).taggedHtml;
bench("rust  (regex)", () => stripOpIds(tagged));
bench("node  (regex)", () => tagged.replace(/\s*data-op-id="[a-z0-9]+"/gi, ""));
console.log();

console.log("=== parseOps (canned <edits> with 20 ops) ===");
let opsBlob = "<edits>";
for (let i = 0; i < 20; i++) {
  opsBlob += `<edit op="replace" target="${i.toString(36)}"><h1>x${i}</h1></edit>`;
}
opsBlob += "</edits>";
bench("rust  (regex)", () => parseOps(opsBlob));
console.log();

console.log("=== applyOps (10 replaces on tagged mirror) ===");
const taggedMirror = tagWithOpIds(MIRROR).taggedHtml;
const opsList = Array.from({ length: 10 }, (_, i) => ({
  type: "replace",
  target: i.toString(36),
  newHtml: `<span>v${i}</span>`,
}));
bench("rust  (lol-html)", () => applyOps(taggedMirror, opsList));
