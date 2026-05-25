// Screenshot an HTML file or a running URL to PNG.
// Usage: node brand/shot.mjs [input.html | http://url] [output.png] [x,y,w,h]
// With a clip rect, captures just that region; otherwise full page.

import puppeteer from "puppeteer";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

const arg = process.argv[2] ?? "brand/concepts.html";
const url = /^https?:\/\//.test(arg) ? arg : pathToFileURL(resolve(arg)).href;
const output = resolve(process.argv[3] ?? "brand/concepts.png");

// Puppeteer's bundled Chromium isn't installed — fall back to a system
// Chromium-family browser (Edge ships on every Windows 11).
const CANDIDATES = [
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];
const executablePath = CANDIDATES.find((p) => existsSync(p));

const browser = await puppeteer.launch(
  executablePath ? { executablePath } : {},
);
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 2 });
  await page.goto(url, { waitUntil: "networkidle0", timeout: 90000 });
  await page.evaluate(() => document.fonts.ready);
  const clipArg = process.argv[4];
  if (clipArg) {
    const [x, y, width, height] = clipArg.split(",").map(Number);
    await page.screenshot({ path: output, clip: { x, y, width, height } });
  } else {
    await page.screenshot({ path: output, fullPage: true });
  }
  console.log(`Wrote ${output}`);
} finally {
  await browser.close();
}
