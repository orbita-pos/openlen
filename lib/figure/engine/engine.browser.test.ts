// @vitest-environment node
//
// THE LIVE FIGURE, LOOKED AT (spec local 2026-11-10-figuras-del-asistente, §7): the engine in the eyes' Chromium,
// judged by what is on screen. The page's clock is fixed by the test (see test-page.ts), so a frame is a fact.
import { afterAll, describe, expect, it } from "vitest";
import { DEFAULT_LOOK, FIGURE_ACCESSORIES, FIGURE_EYES, FIGURE_EYEWEAR, FIGURE_SHAPES } from "../look";
import { BACKGROUND, advance, closeFigureBrowser, difference, frames, isBackground, openFigurePage, shot, show, type FigurePage, type Shot } from "./test-page";

const PINK = { ...DEFAULT_LOOK, shape: "round", color: "#ff5fa8" };
const T = 60_000;

afterAll(closeFigureBrowser);

async function withPage<R>(opts: Parameters<typeof openFigurePage>[0], run: (p: FigurePage) => Promise<R>): Promise<R> {
  const p = await openFigurePage(opts);
  const errors: string[] = [];
  p.page.on("pageerror", (e) => errors.push(String(e)));
  try {
    const r = await run(p);
    expect(errors, "the page threw").toEqual([]);
    return r;
  } finally {
    await p.close();
  }
}

/** The darkest pixel of a horizontal band, as the sum of its channels. */
function darkest(s: Shot, y0: number, y1: number): readonly [number, number, number] {
  let best: readonly [number, number, number] = [255, 255, 255];
  s.each((p, _x, y) => {
    if (y >= y0 * s.height && y < y1 * s.height && p[0] + p[1] + p[2] < best[0] + best[1] + best[2]) best = p;
  });
  return best;
}
function lightest(s: Shot, y0: number, y1: number): readonly [number, number, number] {
  let best: readonly [number, number, number] = [0, 0, 0];
  s.each((p, _x, y) => {
    if (y >= y0 * s.height && y < y1 * s.height && p[0] + p[1] + p[2] > best[0] + best[1] + best[2]) best = p;
  });
  return best;
}

describe("the live figure", () => {
  it(
    "paints a body of the look's color",
    () =>
      withPage({}, async (p) => {
        await show(p, PINK);
        const [r, g, b] = (await shot(p)).at(0.5, 0.7);
        expect(r).toBeGreaterThan(g + 40);
        expect(r).toBeGreaterThan(b + 20);
      }),
    T,
  );

  it(
    "leaves the canvas transparent around it",
    () =>
      withPage({}, async (p) => {
        await show(p, PINK);
        expect(isBackground((await shot(p)).at(0.03, 0.03))).toBe(true);
      }),
    T,
  );

  it(
    "has dark eyes",
    () =>
      withPage({}, async (p) => {
        await show(p, PINK);
        for (const c of darkest(await shot(p), 0.4, 0.6)) expect(c).toBeLessThan(60);
      }),
    T,
  );

  it(
    "returns null where there is no WebGL2, without throwing",
    () =>
      withPage(
        { before: `{ const get = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (kind, ...rest) { return kind === "webgl2" ? null : get.call(this, kind, ...rest); }; }` },
        async (p) => {
          expect(await p.page.evaluate("window.make({ v: 1 })")).toBe(false);
          expect(await p.page.evaluate("window.fig")).toBeNull();
        },
      ),
    T,
  );

  it(
    "tells its host once when the context is lost, and goes quiet",
    () =>
      withPage({}, async (p) => {
        await show(p, PINK);
        const after = await p.page.evaluate(async () => {
          const w = window as never as { fig: Record<string, (...a: unknown[]) => unknown>; __lost: number; frames: (n: number) => Promise<boolean> };
          const gl = (document.getElementById("c") as HTMLCanvasElement).getContext("webgl2")!;
          gl.getExtension("WEBGL_lose_context")!.loseContext();
          await new Promise((r) => setTimeout(r, 200));
          await w.frames(3);
          w.fig.setLook!({ v: 1 });
          w.fig.setActivity!("thinking");
          w.fig.lookAt!(0.2, 0.2);
          w.fig.clearLookAt!();
          w.fig.setActive!(true);
          w.fig.setReducedMotion!(true);
          const captured = w.fig.capture!(64);
          w.fig.destroy!();
          return { lost: w.__lost, captured };
        });
        expect(after).toEqual({ lost: 1, captured: null });
      }),
    T,
  );

  it(
    "waits for a canvas with no size, then paints when it gets one",
    () =>
      withPage({}, async (p) => {
        for (const hide of ["width:0;height:0", "display:none"]) {
          await p.page.evaluate((style) => {
            const c = document.getElementById("c") as HTMLCanvasElement;
            const d = document.createElement("canvas");
            d.id = "d";
            d.style.cssText = style;
            c.style.display = "none";
            document.body.append(d);
            (window as never as { make: (l: unknown, o: unknown, id: string) => boolean }).make({ v: 1, shape: "round", color: "#ff5fa8", eyes: "oval", eyewear: "none", accessory: "none" }, {}, "d");
          }, hide);
          await frames(p, 4);
          expect(await p.page.evaluate("[window.__first, window.__lost]"), hide).toEqual([0, 0]);
          await p.page.evaluate(`document.getElementById("d").style.cssText = "display:block;width:120px;height:120px"`);
          await p.page.waitForFunction("window.__first > 0", { timeout: 30_000 });
          await frames(p, 2);
          const png = await p.page.screenshot({ type: "png", clip: { x: 0, y: 0, width: 120, height: 120 } });
          expect(png.length).toBeGreaterThan(0);
          const [r, g] = (await shot({ ...p, css: 120 })).at(0.5, 0.7);
          expect(r, hide).toBeGreaterThan(g + 40);
          await p.page.evaluate(`window.fig.destroy(); document.getElementById("d").remove()`);
        }
      }),
    T,
  );

  it(
    "caps its resolution at twice the CSS size",
    () =>
      withPage({ css: 400, dpr: 3 }, async (p) => {
        await show(p, PINK);
        const width = await p.page.evaluate(`document.getElementById("c").width`);
        expect(width).toBeLessThanOrEqual(800);
        expect(width).toBeGreaterThanOrEqual(400);
      }),
    T,
  );

  it(
    "can be created and destroyed thirty times and leaves no loop behind",
    () =>
      withPage({ css: 96 }, async (p) => {
        const result = await p.page.evaluate(async () => {
          const w = window as never as { make: (l: unknown, o: unknown, id: string) => boolean; fig: { destroy(): void }; __first: number; __raf: number; frames: (n: number) => Promise<boolean> };
          const look = { v: 1, shape: "round", color: "#ff5fa8", eyes: "oval", eyewear: "none", accessory: "none" };
          let made = 0;
          for (let i = 0; i < 30; i++) {
            const c = document.createElement("canvas");
            c.id = "n" + i;
            c.style.cssText = "display:block;width:96px;height:96px;position:absolute;left:0;top:0";
            document.body.append(c);
            if (w.make(look, {}, c.id)) made++;
            if (i < 29) {
              await w.frames(1);
              w.fig.destroy();
              c.remove();
            }
          }
          for (let i = 0; i < 200 && w.__first === 0; i++) await new Promise((r) => setTimeout(r, 50));
          const painted = w.__first;
          w.fig.destroy();
          await new Promise((r) => setTimeout(r, 100));
          const before = w.__raf;
          await new Promise((r) => setTimeout(r, 300));
          return { made, painted, asked: w.__raf - before };
        });
        expect(result).toEqual({ made: 30, painted: 1, asked: 0 });
      }),
    T,
  );

  it(
    "stays readable in black and in white",
    () =>
      withPage({}, async (p) => {
        await show(p, { ...PINK, color: "#000000" });
        const black = await shot(p);
        expect(isBackground(black.at(0.5, 0.7), 30), "a black body must stand out from the gray page").toBe(false);
        for (const c of lightest(black, 0.4, 0.6)) expect(c, "light eyes on black").toBeGreaterThan(180);
        await p.page.evaluate(`window.fig.setLook({ v: 1, shape: "round", color: "#ffffff", eyes: "oval", eyewear: "none", accessory: "none" })`);
        await frames(p, 3);
        const white = await shot(p);
        for (const c of darkest(white, 0.4, 0.6)) expect(c, "dark eyes on white").toBeLessThan(60);
        expect(white.at(0.5, 0.7)[0]).toBeGreaterThan(BACKGROUND[0] + 60);
      }),
    T,
  );
});

describe("the catalog, live", () => {
  it(
    "draws every entry of a category differently from the others",
    () =>
      withPage({ css: 96 }, async (p) => {
        await show(p, DEFAULT_LOOK);
        const captures = await p.page.evaluate(
          (catalog: Record<string, string[]>, base: Record<string, unknown>) => {
            const w = window as never as { fig: { setLook(l: unknown): void; capture(n: number): ImageData | null } };
            const out: Record<string, number[][]> = {};
            for (const [category, ids] of Object.entries(catalog)) {
              out[category] = ids.map((id) => {
                w.fig.setLook({ ...base, [category]: id });
                return Array.from(w.fig.capture(96)!.data);
              });
            }
            return out;
          },
          { shape: [...FIGURE_SHAPES], eyes: [...FIGURE_EYES], eyewear: [...FIGURE_EYEWEAR], accessory: [...FIGURE_ACCESSORIES] },
          { ...DEFAULT_LOOK },
        );
        for (const [category, images] of Object.entries(captures))
          for (let i = 0; i < images.length; i++)
            for (let j = i + 1; j < images.length; j++) {
              const a = images[i]!, b = images[j]!;
              let differing = 0;
              for (let k = 0; k < a.length; k += 4) if (Math.abs(a[k]! - b[k]!) + Math.abs(a[k + 1]! - b[k + 1]!) + Math.abs(a[k + 2]! - b[k + 2]!) + Math.abs(a[k + 3]! - b[k + 3]!) > 40) differing++;
              // An eye is small at 96 px: a different pair of eyes is still a few dozen pixels.
              expect(differing / (a.length / 4), `${category} ${i} vs ${j}`).toBeGreaterThan(category === "eyes" ? 0.002 : 0.01);
            }
      }),
    180_000,
  );

  it(
    "draws the default figure for a look that does not check, without throwing",
    () =>
      withPage({ css: 96 }, async (p) => {
        await show(p, { shape: "sparrow" });
        const same = await p.page.evaluate((fallback) => {
          const w = window as never as { fig: { setLook(l: unknown): void; capture(n: number): ImageData | null } };
          const first = Array.from(w.fig.capture(64)!.data);
          w.fig.setLook(fallback);
          const second = Array.from(w.fig.capture(64)!.data);
          w.fig.setLook(42);
          const third = Array.from(w.fig.capture(64)!.data);
          return first.every((v, i) => v === second[i]) && first.every((v, i) => v === third[i]);
        }, DEFAULT_LOOK as never);
        expect(same).toBe(true);
      }),
    T,
  );
});

describe("what it is doing, live", () => {
  /** How many pixels of the eyes' band are dark, and where their center of mass is (0..1). */
  function darkArea(s: Shot): { count: number; x: number } {
    let count = 0, sum = 0;
    s.each((p, x, y) => {
      if (y > s.height * 0.3 && y < s.height * 0.7 && p[0] < 60 && p[1] < 60 && p[2] < 60) {
        count++;
        sum += x;
      }
    });
    return { count, x: count ? sum / count / s.width : 0.5 };
  }
  const run = (p: FigurePage, code: string) => p.page.evaluate(code);

  it(
    "closes its eyes when asleep",
    () =>
      withPage({}, async (p) => {
        await show(p, PINK);
        await advance(p, 0.4);
        const open = darkArea(await shot(p)).count;
        await run(p, `window.fig.setActivity("asleep")`);
        await advance(p, 1);
        expect(open).toBeGreaterThan(40);
        expect(darkArea(await shot(p)).count).toBeLessThan(open * 0.3);
      }),
    T,
  );

  it(
    "moves its eyes toward where it looks",
    () =>
      withPage({}, async (p) => {
        await show(p, PINK);
        await run(p, `window.fig.lookAt(0, 0.5)`);
        await advance(p, 0.8);
        const left = darkArea(await shot(p)).x;
        await run(p, `window.fig.lookAt(1, 0.5)`);
        await advance(p, 0.8);
        expect(darkArea(await shot(p)).x).toBeGreaterThan(left + 0.01);
      }),
    T,
  );

  it(
    "holds one still pose under reduced motion, and moves without it",
    () =>
      withPage({}, async (p) => {
        await show(p, PINK, { reducedMotion: true });
        await run(p, `window.__t = 1`);
        await frames(p, 3);
        const first = await shot(p);
        await run(p, `window.__t = 7.3; window.fig.setActivity("talking")`);
        await frames(p, 3);
        expect(difference(first, await shot(p), 0)).toBe(0);
        await run(p, `window.fig.setReducedMotion(false)`);
        await advance(p, 0.9);
        expect(difference(first, await shot(p))).toBeGreaterThan(0.01);
      }),
    T,
  );

  it(
    "looks different from one activity to another",
    () =>
      withPage({}, async (p) => {
        await show(p, PINK);
        await advance(p, 0.6);
        const ready = await shot(p);
        await run(p, `window.fig.setActivity("listening")`);
        await advance(p, 1);
        expect(difference(ready, await shot(p))).toBeGreaterThan(0.01);
      }),
    T,
  );

  it(
    "asks for no frames while paused, and resumes",
    () =>
      withPage({}, async (p) => {
        await show(p, PINK);
        const asked = await p.page.evaluate(async () => {
          const w = window as never as { fig: { setActive(a: boolean): void }; __raf: number };
          w.fig.setActive(false);
          await new Promise((r) => setTimeout(r, 100));
          const before = w.__raf;
          await new Promise((r) => setTimeout(r, 300));
          const paused = w.__raf - before;
          w.fig.setActive(true);
          await new Promise((r) => setTimeout(r, 300));
          return { paused, resumed: w.__raf - before - paused };
        });
        expect(asked.paused).toBe(0);
        expect(asked.resumed).toBeGreaterThan(0);
      }),
    T,
  );

  it(
    "captures the neutral pose whatever it is doing, without disturbing the canvas",
    () =>
      withPage({ css: 120 }, async (p) => {
        await show(p, PINK);
        await advance(p, 1);
        const same = await p.page.evaluate(async () => {
          const w = window as never as { fig: { setActivity(a: string): void; capture(n: number): ImageData }; __t: number; frames: (n: number) => Promise<boolean> };
          const ready = Array.from(w.fig.capture(64).data);
          w.fig.setActivity("talking");
          for (let i = 0; i < 20; i++) {
            w.__t += 1 / 50;
            await w.frames(1);
          }
          const talking = Array.from(w.fig.capture(64).data);
          return ready.every((v, i) => v === talking[i]);
        });
        expect(same).toBe(true);
        await frames(p, 2);
        const [r, g] = (await shot(p)).at(0.5, 0.7);
        expect(r).toBeGreaterThan(g + 40);
      }),
    T,
  );
});

describe("the look", () => {
  const away = (p: readonly [number, number, number]): number => Math.max(Math.abs(p[0] - 128), Math.abs(p[1] - 128), Math.abs(p[2] - 128));
  const luminance = (p: readonly [number, number, number]): number => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
  const saturation = (p: readonly [number, number, number]): number => (Math.max(...p) === 0 ? 0 : (Math.max(...p) - Math.min(...p)) / Math.max(...p));
  /** World (body units) → 0..1 of the canvas. The camera sees ±1.5 around y = 0.2. */
  const at = (x: number, y: number): [number, number] => [0.5 + x / 3, 0.5 - (y - 0.2) / 3];
  const mean = (s: Shot, cx: number, cy: number, r = 3): [number, number, number] => {
    const sum = [0, 0, 0];
    let n = 0;
    for (let dy = -r; dy <= r; dy++)
      for (let dx = -r; dx <= r; dx++) {
        const p = s.at(cx + dx / s.width, cy + dy / s.height);
        sum[0]! += p[0];
        sum[1]! += p[1];
        sum[2]! += p[2];
        n++;
      }
    return [sum[0]! / n, sum[1]! / n, sum[2]! / n];
  };

  it(
    "casts a soft shadow on the ground, only under itself",
    () =>
      withPage({ css: 240 }, async (p) => {
        await show(p, PINK);
        const s = await shot(p);
        const under = s.at(...at(0, -1.12));
        expect(under[0] + under[1] + under[2]).toBeLessThanOrEqual(128 * 3 - 12);
        expect(isBackground(s.at(...at(-1.4, -1.12)))).toBe(true);
        expect(isBackground(s.at(...at(1.4, -1.12)))).toBe(true);
      }),
    T,
  );

  it(
    "darkens the fur under a beret",
    () =>
      withPage({ css: 240 }, async (p) => {
        await show(p, PINK);
        const bare = luminance(mean(await shot(p), ...at(0.1, 0.6)));
        await p.page.evaluate(`window.fig.setLook({ v: 1, shape: "round", color: "#ff5fa8", eyes: "oval", eyewear: "none", accessory: "beret" })`);
        await frames(p, 3);
        expect(luminance(mean(await shot(p), ...at(0.1, 0.6)))).toBeLessThan(bare * 0.92);
      }),
    T,
  );

  it(
    "lets no strand of fur cross an eye",
    () =>
      withPage({ css: 240 }, async (p) => {
        for (const [eyes, rx, ry] of [["oval", 0.1, 0.145], ["round", 0.13, 0.13]] as const) {
          await show(p, { ...PINK, eyes });
          const s = await shot(p);
          let furry = 0, seen = 0;
          for (const side of [-1, 1])
            for (let dy = -1; dy <= 1; dy += 0.1)
              for (let dx = -1; dx <= 1; dx += 0.1) {
                // Well inside the eye's own outline: its edge is antialiased against the fur.
                if (dx * dx + dy * dy > 0.72 * 0.72) continue;
                const [r, g] = s.at(...at(side * 0.32 + dx * rx, 0.1 + dy * ry));
                seen++;
                // The eye is ink and a white glint; anything this pink is the body showing through or over it.
                if (r - g > 50) furry++;
              }
          expect(furry, `${eyes}: ${furry} of ${seen} points inside the eyes are fur`).toBe(0);
        }
      }),
    T,
  );

  it(
    "keeps its shadows in the body's own hue, and stays luminous",
    () =>
      withPage({ css: 240 }, async (p) => {
        await show(p, PINK);
        const s = await shot(p);
        expect(saturation(mean(s, ...at(0.25, -0.78)))).toBeGreaterThanOrEqual(0.5);
        let sum = 0, n = 0;
        s.each((px, _x, y) => {
          // The body, without its eyes, its shadow or its feathered edge.
          if (y < s.height * 0.86 && away(px) > 90 && px[0] > 120) {
            sum += luminance(px);
            n++;
          }
        });
        expect(n).toBeGreaterThan(5000);
        expect(sum / n).toBeGreaterThanOrEqual(0.7 * luminance([255, 95, 168]));
      }),
    T,
  );

  it(
    "has a soft edge that never shows its layers",
    () =>
      withPage({ css: 240 }, async (p) => {
        await show(p, PINK);
        const s = await shot(p);
        const walks: Record<string, number[]> = { left: [], bottom: [] };
        const row = Math.round(at(0, 0.45)[1] * s.height) / s.height;
        for (let x = 0; x < s.width / 2; x++) walks.left!.push(away(s.at((x + 0.5) / s.width, row)));
        const column = at(-0.45, 0)[0];
        for (let y = s.height - 1; y > s.height / 2; y--) walks.bottom!.push(away(s.at(column, (y + 0.5) / s.height)));
        for (const [name, walk] of Object.entries(walks)) {
          const solid = walk.findIndex((d) => d > 100);
          expect(solid, `${name}: reaches the body`).toBeGreaterThan(0);
          const edge = walk.slice(0, solid);
          const half = edge.findIndex((d) => d > 60);
          // Soft: several pixels between the page and the body, not one hard step.
          expect(edge.filter((d) => d > 8 && d <= 100).length, `${name}: a feathered edge`).toBeGreaterThanOrEqual(3);
          // No layers: once it is mostly fur it does not fall back to the page before the body.
          if (half >= 0) expect(Math.min(...edge.slice(half)), `${name}: no gap between layers`).toBeGreaterThan(15);
        }
      }),
    T,
  );

  it(
    "reads at 72 px: it fits its canvas, and its eyes are still there",
    () =>
      withPage({ css: 72 }, async (p) => {
        for (const shape of ["round", "drop", "heart", "capsule"]) {
          await show(p, { ...PINK, shape, accessory: shape === "capsule" ? "hat" : "none" });
          const s = await shot(p);
          let left = s.width, right = 0, eyes = 0;
          s.each((px, x, y) => {
            if (away(px) > 40 && y < s.height * 0.84) {
              left = Math.min(left, x);
              right = Math.max(right, x);
            }
            if (px[0] < 70 && px[1] < 70 && px[2] < 70 && y > s.height * 0.3 && y < s.height * 0.7) eyes++;
          });
          const width = (right - left + 1) / s.width;
          expect(width, `${shape}: width`).toBeGreaterThanOrEqual(0.45);
          expect(width, `${shape}: width`).toBeLessThanOrEqual(0.85);
          expect(eyes, `${shape}: eyes`).toBeGreaterThanOrEqual(12);
          for (let i = 0; i < s.width; i++) {
            expect(isBackground(s.at((i + 0.5) / s.width, 0.001), 6), `${shape}: clipped at the top`).toBe(true);
            expect(isBackground(s.at(0.001, (i + 0.5) / s.height), 6), `${shape}: clipped at the left`).toBe(true);
            expect(isBackground(s.at(0.999, (i + 0.5) / s.height), 6), `${shape}: clipped at the right`).toBe(true);
          }
          // A destroyed figure gave its context back: its canvas is spent, the next figure gets a new one.
          await p.page.evaluate(`window.fig.destroy(); { const c = document.getElementById("c"); c.replaceWith(c.cloneNode()); }`);
        }
      }),
    120_000,
  );

  it(
    "does not shimmer: two frames in a row are the same picture",
    () =>
      withPage({ css: 120 }, async (p) => {
        await show(p, PINK, { reducedMotion: true });
        const first = await shot(p);
        await p.page.evaluate(`window.fig.setLook({ v: 1, shape: "round", color: "#ff5fa8", eyes: "oval", eyewear: "none", accessory: "none" })`);
        await frames(p, 3);
        expect(difference(first, await shot(p), 0)).toBe(0);
      }),
    T,
  );
});

describe("what it costs", () => {
  /** The frames the page asked for over 300 ms, after letting things settle. */
  const asked = (p: FigurePage) =>
    p.page.evaluate(async () => {
      const w = window as never as { __raf: number };
      await new Promise((r) => setTimeout(r, 150));
      const before = w.__raf;
      await new Promise((r) => setTimeout(r, 300));
      return w.__raf - before;
    });

  it(
    "does not draw while it is off screen, and draws again when it comes back",
    () =>
      withPage({}, async (p) => {
        await show(p, PINK);
        expect(await asked(p)).toBeGreaterThan(0);
        await p.page.evaluate(`document.getElementById("c").style.marginTop = "3000px"`);
        expect(await asked(p)).toBe(0);
        await p.page.evaluate(`document.getElementById("c").style.marginTop = "0"`);
        expect(await asked(p)).toBeGreaterThan(0);
      }),
    T,
  );

  it(
    "does not draw while the tab is hidden",
    () =>
      withPage({}, async (p) => {
        await show(p, PINK);
        const hide = (hidden: boolean) =>
          p.page.evaluate((h) => {
            Object.defineProperty(document, "hidden", { configurable: true, get: () => h });
            Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (h ? "hidden" : "visible") });
            document.dispatchEvent(new Event("visibilitychange"));
          }, hidden);
        await hide(true);
        expect(await asked(p)).toBe(0);
        await hide(false);
        expect(await asked(p)).toBeGreaterThan(0);
      }),
    T,
  );

  /** A figure on its own canvas whose clock says each frame took what `steps` says (ms), the last one repeating. */
  const paced = (p: FigurePage, name: string, steps: number[], frames = 200) =>
    p.page.evaluate(
      async (id, pace, count) => {
        const w = window as never as { make: (l: unknown, o: unknown, id: string) => boolean; fig: { quality: number; destroy(): void }; __lost: number };
        const c = document.createElement("canvas");
        c.id = id;
        c.style.cssText = "display:block;width:96px;height:96px;position:absolute;left:0;top:0";
        document.body.append(c);
        let t = 0, read = 0;
        w.make({ v: 1, shape: "round", color: "#ff5fa8", eyes: "oval", eyewear: "none", accessory: "none" }, { clock: () => (t += pace[Math.min(read++, pace.length - 1)]! / 1000) }, id);
        const seen = [w.fig.quality];
        for (let i = 0; i < count && w.__lost === 0; i++) {
          await new Promise((r) => requestAnimationFrame(r));
          if (seen[seen.length - 1] !== w.fig.quality) seen.push(w.fig.quality);
        }
        const lost = w.__lost;
        await new Promise((r) => setTimeout(r, 50));
        const released = c.getContext("webgl2")!.isContextLost();
        w.fig.destroy();
        c.remove();
        return { seen, lost, released };
      },
      name,
      steps,
      frames,
    );

  it(
    "steps down when it draws slower than the screen refreshes, hands over to the flat figure, and gives its context back",
    () =>
      withPage({ css: 96 }, async (p) => {
        // The screen is seen to refresh every 16 ms; then every frame takes 40.
        const fast = Array.from({ length: 12 }, () => 16);
        expect(await paced(p, "slow", [...fast, 40])).toEqual({ seen: [2, 1, 0], lost: 1, released: true });
      }),
    120_000,
  );

  it(
    "keeps its full quality on a screen that refreshes 30 times a second, and on a fast one",
    () =>
      withPage({ css: 96 }, async (p) => {
        expect(await paced(p, "thirty", [33.3], 100)).toEqual({ seen: [2], lost: 0, released: false });
        expect(await paced(p, "fast", [8], 100)).toEqual({ seen: [2], lost: 0, released: false });
      }),
    120_000,
  );

  it(
    "survives one long hiccup without lowering its quality",
    () =>
      withPage({ css: 96 }, async (p) => {
        const pace = Array.from({ length: 200 }, (_, i) => (i % 30 === 20 ? 240 : 16));
        expect(await paced(p, "hiccup", pace, 130)).toEqual({ seen: [2], lost: 0, released: false });
      }),
    120_000,
  );
});


describe("what its host can count on", () => {
  it(
    "never writes a color brighter than its alpha: no bright fringe on a dark host",
    () =>
      withPage({ css: 160 }, async (p) => {
        for (const color of ["#ffffff", "#ffc21a", "#ff5fa8"]) {
          await show(p, { ...PINK, color });
          const { over, drawn } = (await p.page.evaluate("window.overflow()")) as { over: number; drawn: number };
          expect(drawn, color).toBeGreaterThan(2000);
          expect(over, color).toBe(0);
          await p.page.evaluate(`window.fig.destroy(); { const c = document.getElementById("c"); c.replaceWith(c.cloneNode()); }`);
        }
      }),
    T,
  );

  it(
    "can be destroyed and created again at once on the same canvas, as React's strict mode does",
    () =>
      withPage({}, async (p) => {
        await show(p, PINK);
        // In the same turn of the event loop, as an effect that is torn down and run again.
        const again = await p.page.evaluate((look) => {
          const w = window as never as { fig: { destroy(): void }; make: (l: unknown, o: unknown) => boolean };
          w.fig.destroy();
          return w.make(look, {});
        }, PINK as never);
        expect(again).toBe(true);
        await p.page.waitForFunction("window.__first > 0", { timeout: 30_000 });
        await frames(p, 2);
        const [r, g] = (await shot(p)).at(0.5, 0.7);
        expect(r).toBeGreaterThan(g + 40);
        // And a figure destroyed for good does give its context back.
        const lost = await p.page.evaluate(async () => {
          (window as never as { fig: { destroy(): void } }).fig.destroy();
          await new Promise((r) => setTimeout(r, 300));
          return (document.getElementById("c") as HTMLCanvasElement).getContext("webgl2")!.isContextLost();
        });
        expect(lost).toBe(true);
      }),
    T,
  );

  it(
    "does not grow a canvas that was sized by its attributes alone",
    () =>
      withPage({ dpr: 2 }, async (p) => {
        const size = await p.page.evaluate(async () => {
          const w = window as never as { make: (l: unknown, o: unknown, id: string) => boolean; frames: (n: number) => Promise<boolean> };
          const c = document.createElement("canvas");
          c.id = "attr";
          c.width = 96;
          c.height = 96;
          document.body.prepend(c);
          w.make({ v: 1, shape: "round", color: "#ff5fa8", eyes: "oval", eyewear: "none", accessory: "none" }, {}, "attr");
          await w.frames(8);
          return [c.clientWidth, c.clientHeight, c.width];
        });
        expect(size).toEqual([96, 96, 192]);
      }),
    T,
  );

  it(
    "keeps a tall hat inside the canvas while it talks",
    () =>
      withPage({ css: 96 }, async (p) => {
        await show(p, { ...PINK, shape: "capsule", accessory: "beanie", color: "#2f8bff" });
        await p.page.evaluate(`window.fig.setActivity("talking")`);
        for (let i = 0; i < 6; i++) {
          await advance(p, 0.12);
          const s = await shot(p);
          for (let x = 0; x < s.width; x++) expect(isBackground(s.at((x + 0.5) / s.width, 0.001), 6), `clipped at the top, frame ${i}`).toBe(true);
        }
      }),
    T,
  );
});
