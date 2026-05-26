// Compare the Rust normalize chain (released napi binding) vs the TS regex
// chain (lib/normalize.ts) on each starter template. Not a formal benchmark
// — Criterion's normalize bench is. This script captures the TS-side number
// so we can compute speedup on the same machine + run.
//
// Run with: node --import tsx __test__/perf-normalize-vs-ts.mjs

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { normalizeBornCanonical as rustNorm } from "../index.js";
import { normalizeBornCanonical as tsNorm } from "../../../lib/normalize";

const here = dirname(fileURLToPath(import.meta.url));
const starter = (name) =>
  readFileSync(resolve(here, "../../../templates/starter", name), "utf8");

const TEMPLATES = ["mirror.html", "counter.html", "manuscript.html"];

function bench(label, fn, iters = 200) {
  for (let i = 0; i < 10; i++) fn();
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

for (const name of TEMPLATES) {
  const html = starter(name);
  console.log(`\n=== ${name} (${html.length} bytes) ===`);
  const rust = bench("rust normalize_born_canonical", () => rustNorm(html));
  const ts = bench("ts  normalizeBornCanonical    ", () => tsNorm(html));
  console.log(
    `speedup p95: ${(ts.p95 / rust.p95).toFixed(1)}x   p50: ${(ts.p50 / rust.p50).toFixed(1)}x`,
  );
}
