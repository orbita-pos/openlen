// TEST-ONLY: a page with the engine in it, in the one Chromium the eyes use (`lanzarChromium`, WebGL in software).
// Nothing of the product imports this file.
//
// The page's clock is `window.__t` (seconds): the engine never sees real time here, so a frame is the same frame
// every run. `window.__raf` counts the animation frames anything on the page asked for.
import { build } from "esbuild";
import path from "node:path";
import type { Browser, Page } from "puppeteer";
import { lanzarChromium } from "@/lib/ai/visual-quality-renderer";
import { decodificarPng, leerPixel } from "@/lib/ai/png-crudo";

let bundle: Promise<string> | undefined;
let browser: Promise<Browser> | undefined;

/** The engine as the published page would get it: one IIFE, here under `window.figure`. */
export function engineBundle(): Promise<string> {
  bundle ??= build({
    entryPoints: [path.join(process.cwd(), "lib/figure/engine/index.ts")],
    bundle: true,
    format: "iife",
    globalName: "figure",
    target: "es2020",
    write: false,
  }).then((r) => r.outputFiles[0]!.text);
  return bundle;
}

const HELPERS = `
window.__t = 0; window.__raf = 0; window.__first = 0; window.__lost = 0;
{ const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (f) => { window.__raf++; return raf(f); }; }
window.make = (look, opts, id) => {
  window.__first = 0; window.__lost = 0;
  window.fig = figure.createFigure(document.getElementById(id || "c"), look, Object.assign({
    clock: () => window.__t, seed: 1, onFirstFrame: () => { window.__first++; }, onLost: () => { window.__lost++; },
  }, opts || {}));
  return !!window.fig;
};
window.frames = (n) => new Promise((done) => { const step = () => (n-- > 0 ? requestAnimationFrame(step) : done(true)); step(); });
`;

export interface FigurePage {
  page: Page;
  css: number;
  close(): Promise<void>;
}

export async function openFigurePage(opts: { css?: number; dpr?: number; before?: string } = {}): Promise<FigurePage> {
  const css = opts.css ?? 200;
  browser ??= lanzarChromium();
  const page = await (await browser).newPage();
  await page.setViewport({ width: Math.max(css, 320), height: Math.max(css, 320), deviceScaleFactor: opts.dpr ?? 1 });
  const html = `<!doctype html><html><body style="margin:0;background:#808080">
<canvas id="c" style="display:block;width:${css}px;height:${css}px"></canvas>
<script>${opts.before ?? ""}</script><script>${await engineBundle()}</script><script>${HELPERS}</script></body></html>`;
  await page.setContent(html, { waitUntil: "load" });
  return { page, css, close: () => page.close() };
}

export async function closeFigureBrowser(): Promise<void> {
  if (browser) await (await browser).close();
  browser = undefined;
}

/** Creates the figure on #c and waits for its first painted frame. */
export async function show(p: FigurePage, look: unknown, opts: Record<string, unknown> = {}): Promise<void> {
  await p.page.evaluate((l, o) => (window as never as { make: (l: unknown, o: unknown) => boolean }).make(l, o), look as never, opts as never);
  await p.page.waitForFunction("window.__first > 0", { timeout: 30_000 });
  await frames(p, 2);
}

export async function frames(p: FigurePage, n: number): Promise<void> {
  await p.page.evaluate((k) => (window as never as { frames: (n: number) => Promise<boolean> }).frames(k), n);
}

/** Moves the page's clock forward in 1/30 s steps, one painted frame per step. */
export async function advance(p: FigurePage, seconds: number): Promise<void> {
  await p.page.evaluate(async (s) => {
    const w = window as never as { __t: number; frames: (n: number) => Promise<boolean> };
    const steps = Math.max(1, Math.round(s * 30));
    for (let i = 0; i < steps; i++) {
      w.__t += s / steps;
      await w.frames(1);
    }
    await w.frames(1);
  }, seconds);
}

export interface Shot {
  width: number;
  height: number;
  /** A pixel of what is ON SCREEN (composited over the page's gray), at 0..1 of the canvas. */
  at(x: number, y: number): readonly [number, number, number];
  /** Every pixel, row by row. */
  each(fn: (rgb: readonly [number, number, number], x: number, y: number) => void): void;
}

export async function shot(p: FigurePage): Promise<Shot> {
  const png = decodificarPng(new Uint8Array(await p.page.screenshot({ type: "png", clip: { x: 0, y: 0, width: p.css, height: p.css } })));
  const read = (px: number, py: number) => leerPixel(png, Math.min(png.ancho - 1, Math.max(0, px)), Math.min(png.alto - 1, Math.max(0, py))) ?? ([0, 0, 0] as const);
  return {
    width: png.ancho,
    height: png.alto,
    at: (x, y) => read(Math.floor(x * png.ancho), Math.floor(y * png.alto)),
    each: (fn) => {
      for (let y = 0; y < png.alto; y++) for (let x = 0; x < png.ancho; x++) fn(read(x, y), x, y);
    },
  };
}

export async function pixelAt(p: FigurePage, x: number, y: number): Promise<readonly [number, number, number]> {
  return (await shot(p)).at(x, y);
}

/** The share of pixels that differ by more than `tolerance` in any channel. */
export function difference(a: Shot, b: Shot, tolerance = 12): number {
  let n = 0;
  a.each((p, x, y) => {
    const q = b.at((x + 0.5) / a.width, (y + 0.5) / a.height);
    if (Math.abs(p[0] - q[0]) > tolerance || Math.abs(p[1] - q[1]) > tolerance || Math.abs(p[2] - q[2]) > tolerance) n++;
  });
  return n / (a.width * a.height);
}

export const BACKGROUND = [128, 128, 128] as const;
export const isBackground = (p: readonly [number, number, number], tolerance = 3): boolean =>
  p.every((c, i) => Math.abs(c - BACKGROUND[i]!) <= tolerance);
