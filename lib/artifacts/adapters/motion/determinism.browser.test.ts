// @vitest-environment node
// A video frame is a function of its time only. In trial G2 (21/10) a scale tween over an app capture failed the
// renderer's seek check 3 times out of 3: GSAP's default force3D "auto" writes translate3d while a tween runs and a
// 2D transform at rest, so Chromium painted the same instant differently depending on the frames before it. The
// seek check itself is verified in the Linux container (artifact-linux-acceptance "motion-mid-tween"): this
// machine's Chrome fails it for any animation, opacity included, with or without GPU (measured 21/10).
import { afterAll, beforeAll, expect, it } from "vitest";
import puppeteer from "puppeteer";
import { buildMotion } from "./runtime";
import { stopBundlerWorker } from "../../../apps/bundler/bundle-app";
import type { SealedArtifactInput } from "../../types";

// Explicit opt-in: this launches Chrome, unlike pure/SQL infrastructure tests.
const run = process.env.ARTIFACT_BROWSER_TESTS === "1" ? it : it.skip;
let executablePath: string;
beforeAll(async () => { executablePath = process.env.ARTIFACT_TEST_BROWSER_EXECUTABLE?.trim() || await Promise.resolve(puppeteer.executablePath()); });
afterAll(() => stopBundlerWorker());

const spec = { version: 1, entry: "index.html", runtime: "gsap-3.15.0", width: 1280, height: 720, fps: 30, durationSeconds: 2, datasetIds: [] };
const composition = `<!doctype html><html lang="es"><head><style>
  body { margin: 0; width: 1280px; height: 720px; overflow: hidden; background: #0b1220; }
  #shot { width: 1280px; height: 720px; background: linear-gradient(135deg, #f59e0b, #34d399 60%, #0ea5e9); }
</style></head><body><div id="shot"></div><script>
  const tl = gsap.timeline({ paused: true });
  tl.fromTo("#shot", { scale: 1.05 }, { scale: 1, duration: 2, ease: "power1.out", immediateRender: false }, 0);
  window.lenMotion = { durationSeconds: 2, ready: async () => {}, seek: async (t) => { tl.totalTime(t, true); } };
</script></body></html>`;
const input = { artifact: { kind: "motion" }, revision: { files: { "motion.json": JSON.stringify(spec), "index.html": composition } }, datasets: [], assets: [] } as unknown as SealedArtifactInput;

run("a tween still running is painted in 2D, as it is at rest", async () => {
  const { html } = await buildMotion(input);
  const browser = await puppeteer.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    const transformAt = (time: number) => page.evaluate(async (t) => {
      await (window as unknown as { lenMotion: { seek(t: number): Promise<void> } }).lenMotion.seek(t);
      return document.getElementById("shot")!.style.transform;
    }, time);
    expect(await transformAt(1)).not.toContain("3d");
    expect(await transformAt(2)).not.toContain("3d");
  } finally {
    await browser.close();
  }
}, 90_000);
