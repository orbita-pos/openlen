// @vitest-environment node
// What the card thumbnail and the Flight Check do since 14/10, in a real
// Chromium: the eyes' launcher (filtering proxy, WebGL in software) opens a
// release served the way Caddy serves it, the app's module bundle loads, and
// its WebGL scene is painted. Control arm: the bare shell set as content (how
// the thumbnail rendered before) paints nothing.
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { lanzarChromium } from "@/lib/ai/visual-quality-renderer";
import { allowEgressOrigin } from "@/lib/security/egress-proxy";
import { installSubresourceSsrfGuard } from "@/lib/security/render-ssrf-guard";
import { serveRelease } from "./serve-release";

const SHELL = '<!doctype html><html><body style="margin:0;background:#fff"><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>';
const BUNDLE = `const c = document.createElement("canvas"); c.width = 400; c.height = 300;
c.style.cssText = "position:fixed;inset:0;width:100vw;height:100vh";
document.getElementById("root").append(c);
const gl = c.getContext("webgl2"); gl.clearColor(1, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);`;

let subDir: string;
beforeAll(async () => {
  subDir = await mkdtemp(path.join(tmpdir(), "served-release-"));
  await mkdir(path.join(subDir, "releases", "r1", "src"), { recursive: true });
  await writeFile(path.join(subDir, "releases", "r1", "index.html"), SHELL);
  await writeFile(path.join(subDir, "releases", "r1", "src", "main.tsx"), BUNDLE);
});
afterAll(async () => {
  await rm(subDir, { recursive: true, force: true });
});

async function centerPixel(png: Buffer) {
  const sharp = (await import("sharp")).default;
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });
  const i = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
  return { r: data[i]!, g: data[i + 1]! };
}

describe("a published app as the thumbnail and the Flight Check see it", () => {
  it("🔴 the served release loads its bundle and paints its WebGL; CONTROL: the bare shell paints nothing", async () => {
    const served = await serveRelease(subDir, "r1");
    const releaseEgress = allowEgressOrigin(served.origin);
    const browser = await lanzarChromium();
    try {
      const page = await browser.newPage();
      await installSubresourceSsrfGuard(page, { allowOrigins: [served.origin] });
      await page.setViewport({ width: 400, height: 300 });
      await page.goto(served.url, { waitUntil: "load", timeout: 20_000 });
      await page.waitForSelector("canvas", { timeout: 10_000 });
      const red = await centerPixel((await page.screenshot({ type: "png" })) as Buffer);
      expect(red.r).toBeGreaterThan(200);
      expect(red.g).toBeLessThan(60);

      const bare = await browser.newPage();
      await bare.setViewport({ width: 400, height: 300 });
      await bare.setContent(SHELL, { waitUntil: "load" });
      const white = await centerPixel((await bare.screenshot({ type: "png" })) as Buffer);
      expect(white.g).toBeGreaterThan(200);
    } finally {
      releaseEgress();
      served.server.close();
      await browser.close();
    }
  }, 60_000);
});
