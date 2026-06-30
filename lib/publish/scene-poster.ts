import type { SceneSpec } from "../three3d/scene-spec";
import { buildSceneHostHtml, readRuntimeJs } from "./scene-host";
import { launchScreenshotBrowser } from "../templates/capture-screenshot";
import { processImage } from "../images";

export async function renderScenePoster(
  spec: SceneSpec,
  opts: { width?: number; height?: number } = {},
): Promise<Buffer> {
  const w = opts.width ?? 1600;
  const h = opts.height ?? 900;
  const html = buildSceneHostHtml(spec, readRuntimeJs(), { w, h });
  const browser = await launchScreenshotBrowser();
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: "load", timeout: 45_000 });
    await page.waitForFunction("window.__ol3dReady === true", { timeout: 15_000 });
    // one extra rAF settle so the first animated frame is composited
    await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
    const png = (await page.screenshot({ type: "png", clip: { x: 0, y: 0, width: w, height: h } })) as Buffer;
    const { variants } = await processImage({
      input: png,
      variants: [{ width: 0, format: "avif", quality: 62 }],
      autoOrient: false,
      withoutEnlargement: true,
    });
    return variants[0].bytes;
  } finally {
    await browser.close();
  }
}
