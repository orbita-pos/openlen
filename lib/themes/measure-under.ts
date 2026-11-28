// WHAT THE SCENE IS, UNDER THE CHAT PANEL (spec local 2026-11-27-temas-del-workspace, §4.5). The contrast gate needs one
// colour per scene — the scene where Len's panel sits — to know how far the glass has to go. It is measured, not guessed:
// the scene is painted in an <img> the size of the workspace's window in the eyes' Chromium, standing still (the same
// `?still` the workspace serves to a slow machine), and the strip of columns the panel covers is averaged from the PNG,
// decoded in Node (`lib/ai/png-crudo.ts`, as the contrast measure of `view_page` does). No model, no credit.
//
// ONE browser per install (R14): `openSceneMeter` launches it, `under` opens a page per scene and closes it, and `close`
// closes the browser. The installer owns the deadline for all of it and closes what it opened on every path.
//
// The server's Chromium paints by software (no GPU), so this says nothing about frame rate: that is `scene-check.ts`'s
// count and the client's guard. It says what colour is there once the scene has stopped.
import "server-only";

import type { Page } from "puppeteer";

import { decodificarPng } from "@/lib/ai/png-crudo";

import { stillScene } from "./scene-check";

/** The workspace's window, as the scene sees it (`preserveAspectRatio` slice fills it). */
export const MEASURE_VIEWPORT = { width: 1280, height: 800 } as const;
/** The columns Len's panel covers in that window: from the rail's right edge to the panel's. */
export const CHAT_STRIP = { from: 64, to: 444 } as const;

/** The most one scene's page waits for anything on its own; the installer's overall deadline is what bounds a whole install. */
const PAGE_TIMEOUT_MS = 15_000;

/** A browser that measures scenes. `under` is null when that scene would not paint or could not be read; it rejects when the browser is gone. */
export interface SceneMeter {
  /** The mean colour of the scene (a checked one) under the chat panel, as `#rrggbb`, or null. */
  under(svg: string): Promise<string | null>;
  close(): Promise<void>;
}

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

/** Nothing but data: and about: may load in the measuring page: a scene is data in an <img>, and the gate refused every reference that would fetch. */
async function closeToTheNetwork(page: Page): Promise<void> {
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    const url = request.url();
    const local = url.startsWith("data:") || url.startsWith("about:");
    void (local ? request.continue() : request.abort("blockedbyclient")).catch(() => undefined);
  });
}

async function measureOnePage(page: Page, svg: string): Promise<string | null> {
  page.setDefaultTimeout(PAGE_TIMEOUT_MS);
  await closeToTheNetwork(page);
  await page.setViewport({ ...MEASURE_VIEWPORT });
  const data = Buffer.from(stillScene(svg), "utf8").toString("base64");
  await page.setContent(
    `<!doctype html><html><body style="margin:0;background:#fff"><img alt="" style="position:fixed;inset:0;width:100vw;height:100vh;display:block" src="data:image/svg+xml;base64,${data}"></body></html>`,
    { waitUntil: "load", timeout: PAGE_TIMEOUT_MS },
  );
  // `decode()` of an image that never settles would wait for puppeteer's own protocol timeout (minutes): bounded here.
  const painted = await page.evaluate(
    `document.images[0] ? Promise.race([document.images[0].decode().then(() => true, () => false), new Promise((resolve) => setTimeout(() => resolve(false), ${PAGE_TIMEOUT_MS}))]) : false`,
  );
  if (painted !== true) return null;
  const bytes = (await page.screenshot({ type: "png", clip: { x: 0, y: 0, ...MEASURE_VIEWPORT } })) as Uint8Array;
  return stripMean(bytes);
}

/**
 * Launches the eyes' Chromium (`lanzarChromium`) for one install's measuring. It THROWS when the browser cannot launch —
 * it never returns null for that — and the installer treats a throw as «not measured» and installs anyway.
 */
export async function openSceneMeter(): Promise<SceneMeter> {
  const { lanzarChromium } = await import("@/lib/ai/visual-quality-renderer");
  const browser = await lanzarChromium();
  return {
    async under(svg) {
      const page = await browser.newPage();
      try {
        return await measureOnePage(page, svg);
      } catch (error) {
        // A browser that is gone says so; a page that would not load is only this scene unmeasured.
        if (!browser.connected) throw error;
        return null;
      } finally {
        await page.close().catch(() => undefined);
      }
    },
    close: () => browser.close().catch(() => undefined),
  };
}
