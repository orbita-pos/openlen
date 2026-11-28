// WHAT THE SCENE IS, UNDER THE CHAT PANEL (spec local 2026-11-27-temas-del-workspace, §4.5). The contrast gate needs one
// colour — the scene where Len's panel sits — to know how far the glass has to go. It is measured, not guessed: the scene
// is painted in an <img> the size of the workspace's window in the eyes' Chromium, standing still (the same `?still` the
// workspace serves to a slow machine), and the strip of columns the panel covers is averaged from the PNG, decoded in
// Node (`lib/ai/png-crudo.ts`, as the contrast measure of `view_page` does). No model, no credit.
//
// The server's Chromium paints by software (no GPU), so this says nothing about frame rate: that is `scene-check.ts`'s
// count and the client's guard. It says what colour is there once the scene has stopped.
import "server-only";

import { decodificarPng } from "@/lib/ai/png-crudo";

import { stillScene } from "./scene-check";

/** The workspace's window, as the scene sees it (`preserveAspectRatio` slice fills it). */
export const MEASURE_VIEWPORT = { width: 1280, height: 800 } as const;
/** The columns Len's panel covers in that window: from the rail's right edge to the panel's. */
export const CHAT_STRIP = { from: 64, to: 444 } as const;

const MEASURE_TIMEOUT_MS = 20_000;

/** The mean colour of the columns `from` to `to` of a PNG, as `#rrggbb`; null if the picture is not one we can read or does not reach `to`. */
export function stripMean(png: Uint8Array, from: number = CHAT_STRIP.from, to: number = CHAT_STRIP.to): string | null {
  try {
    const image = decodificarPng(png);
    if (image.ancho < to || image.alto < 1) return null;
    const sum = [0, 0, 0];
    for (let y = 0; y < image.alto; y++) {
      for (let x = from; x < to; x++) {
        const at = (y * image.ancho + x) * image.canales;
        sum[0]! += image.datos[at]!;
        sum[1]! += image.datos[at + 1]!;
        sum[2]! += image.datos[at + 2]!;
      }
    }
    const count = (to - from) * image.alto;
    return `#${sum.map((c) => Math.round(c / count).toString(16).padStart(2, "0")).join("")}`;
  } catch {
    return null;
  }
}

/**
 * The colour of the scene under the chat panel, or null when it could not be measured (no Chromium, a scene the browser
 * would not paint, the timeout). `svg` is a scene that already passed `checkScene`; this paints it standing still.
 */
export async function measureUnder(svg: string): Promise<string | null> {
  const { lanzarChromium } = await import("@/lib/ai/visual-quality-renderer");
  const { installSubresourceSsrfGuard } = await import("@/lib/security/render-ssrf-guard");
  const browser = await lanzarChromium();
  try {
    const page = await browser.newPage();
    // A scene is data in an <img>: it fetches nothing, and the gate refused every reference that would. The guard is
    // here anyway, so a mistake in the gate never turns the measuring page into a way to reach the server's network.
    await installSubresourceSsrfGuard(page, { allowOrigins: [] });
    await page.setViewport({ ...MEASURE_VIEWPORT });
    const data = Buffer.from(stillScene(svg), "utf8").toString("base64");
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:#fff"><img alt="" style="position:fixed;inset:0;width:100vw;height:100vh;display:block" src="data:image/svg+xml;base64,${data}"></body></html>`,
      { waitUntil: "load", timeout: MEASURE_TIMEOUT_MS },
    );
    const painted = await page.evaluate(`document.images[0] && document.images[0].decode().then(() => true, () => false)`);
    if (painted !== true) return null;
    const bytes = (await page.screenshot({ type: "png", clip: { x: 0, y: 0, ...MEASURE_VIEWPORT } })) as Uint8Array;
    return stripMean(bytes);
  } catch {
    return null;
  } finally {
    await browser.close().catch(() => undefined);
  }
}
