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
        await advance(p, 1);
        const open = darkArea(await shot(p)).count;
        await run(p, `window.fig.setActivity("asleep")`);
        await advance(p, 2);
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
        await advance(p, 1.5);
        const left = darkArea(await shot(p)).x;
        await run(p, `window.fig.lookAt(1, 0.5)`);
        await advance(p, 1.5);
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
        await advance(p, 1.3);
        expect(difference(first, await shot(p))).toBeGreaterThan(0.01);
      }),
    T,
  );

  it(
    "looks different from one activity to another",
    () =>
      withPage({}, async (p) => {
        await show(p, PINK);
        await advance(p, 2);
        const ready = await shot(p);
        await run(p, `window.fig.setActivity("listening")`);
        await advance(p, 2);
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
            w.__t += 1 / 30;
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
