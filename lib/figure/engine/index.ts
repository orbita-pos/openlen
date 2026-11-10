// THE LIVE FIGURE (spec local 2026-11-10-figuras-del-asistente, §5.2): our own engine. A <canvas> and a look in,
// a furry figure that breathes out. No dependencies, no React, no Node: the same file runs in the workspace, in
// the published page's bubble and in the phone's WebView.
//
// Two promises to whoever hosts it:
//   · `createFigure` returns null where there is no WebGL2, and NOTHING it returns ever throws. A failure inside
//     — a lost context, a driver that gives up — reaches the host once, through `onLost`, and the host goes back
//     to the flat figure (../flat.ts).
//   · the canvas is transparent. Its background is the host's.
import { createRenderer, rotation, type Frame, type Renderer } from "./gl";
import { partsFor, type Part } from "./parts";
import { NEUTRAL_POSE, blinkAt, stepPose, targetPose, type FigureActivity, type Pose } from "./pose";

export type { FigureActivity } from "./pose";

export interface FigureOptions {
  activity?: FigureActivity;
  /** Defaults to what `prefers-reduced-motion` says. */
  reducedMotion?: boolean;
  /** Backing pixels per CSS pixel, at most. Defaults to 2. */
  maxPixelRatio?: number;
  /** Seconds. The engine reads time ONLY here, so a test can fix it. Defaults to performance.now() / 1000. */
  clock?: () => number;
  /** Sets when this figure blinks, so two on a page do not blink together. Defaults to a random one. */
  seed?: number;
  /** Once, after the first painted frame: the moment to swap the flat figure for the live one. */
  onFirstFrame?: () => void;
  /** Once, if the context is lost or the engine fails: the host goes back to the flat figure. */
  onLost?: () => void;
}

export interface Figure {
  setLook(look: unknown): void;
  setActivity(activity: FigureActivity): void;
  /** Look at a point of the canvas, 0..1 from its top left corner. */
  lookAt(x: number, y: number): void;
  clearLookAt(): void;
  /** false pauses the loop; true resumes it. */
  setActive(active: boolean): void;
  setReducedMotion(reduced: boolean): void;
  /** The neutral pose at `size`×`size` pixels, straight (not premultiplied) RGBA. null once the context is gone. */
  capture(size: number): ImageData | null;
  destroy(): void;
}

/** The backing store never grows past this, whatever the screen says. */
const MAX_PIXELS = 1024;
const LAYERS = 40;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** A pose as the renderer wants it. `lag` is which way the fur trails. */
function frameOf(pose: Pose, lag: readonly [number, number, number]): Omit<Frame, "layers" | "density" | "time"> {
  const wide = 1 / Math.sqrt(pose.stretch); // taller means thinner: the volume stays
  return {
    rotation: rotation(pose.yaw + pose.gaze[0] * 0.28, pose.pitch - pose.gaze[1] * 0.12, pose.roll),
    offset: [0, pose.lift, 0],
    lag,
    stretch: [wide, pose.stretch, wide],
    eyeOpen: pose.eyeOpen,
    gaze: pose.gaze,
  };
}

const NEUTRAL = frameOf(NEUTRAL_POSE, [0, 0, 0]);

/** Strands per unit, from how many pixels the figure really gets: fine detail in a small figure is only noise. */
const densityFor = (pixels: number): number => Math.min(95, Math.max(26, pixels * 0.42));

export function createFigure(canvas: HTMLCanvasElement, look: unknown, options: FigureOptions = {}): Figure | null {
  let gl: WebGL2RenderingContext | null = null;
  let renderer: Renderer;
  try {
    gl = canvas.getContext("webgl2", { alpha: true, premultipliedAlpha: true, antialias: true }) as WebGL2RenderingContext | null;
    if (!gl) return null;
    renderer = createRenderer(gl);
  } catch {
    return null;
  }
  const context = gl;
  const clock = options.clock ?? (() => performance.now() / 1000);
  const maxRatio = options.maxPixelRatio ?? 2;

  const seed = options.seed ?? Math.random() * 1000;

  let parts: Part[] = partsFor(look);
  let activity: FigureActivity = options.activity ?? "ready";
  let since = clock();
  let gaze: readonly [number, number] | null = null;
  let pose: Pose = NEUTRAL_POSE;
  let last = since;
  let lag: [number, number, number] = [0, 0, 0];
  let active = true;
  let reduced = options.reducedMotion ?? (typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  let dead = false;
  let painted = false;
  let dirty = true;
  let raf = 0;
  let width = 0;
  let height = 0;

  function measure(): boolean {
    const ratio = Math.min(typeof devicePixelRatio === "number" ? devicePixelRatio : 1, maxRatio);
    const w = Math.min(MAX_PIXELS, Math.round(canvas.clientWidth * ratio));
    const h = Math.min(MAX_PIXELS, Math.round(canvas.clientHeight * ratio));
    if (w !== width || h !== height) {
      width = w;
      height = h;
      if (w > 0 && h > 0) {
        canvas.width = w;
        canvas.height = h;
      }
      dirty = true;
    }
    return w > 0 && h > 0;
  }

  function paint(): void {
    if (!measure()) return;
    const now = clock();
    const dt = clamp(now - last, 0, 0.1);
    last = now;
    const target = targetPose(activity, now - since, gaze);
    let frame: Omit<Frame, "layers" | "density" | "time">;
    if (reduced) {
      // One still pose: the body does not move, but the eyes still say what it is doing (closed when asleep).
      pose = { ...NEUTRAL_POSE, eyeOpen: target.eyeOpen, gaze: target.gaze };
      lag = [0, 0, 0];
      frame = frameOf(pose, lag);
    } else {
      const next = stepPose(pose, target, dt);
      if (dt > 0) {
        // The fur stays behind when the body moves: against the lift's and the turn's speed.
        const k = 1 - Math.exp(-dt * 7);
        lag[1] += (clamp(((pose.lift - next.lift) / dt) * 0.25, -1.5, 1.5) - lag[1]) * k;
        lag[0] += (clamp(((pose.yaw - next.yaw) / dt) * 0.35, -1.5, 1.5) - lag[0]) * k;
      }
      pose = next;
      frame = frameOf({ ...pose, eyeOpen: pose.eyeOpen * (1 - 0.95 * blinkAt(now, seed)) }, lag);
    }
    renderer.render(parts, { ...frame, time: reduced ? 0 : now, layers: LAYERS, density: densityFor(Math.min(width, height)) }, width, height);
    dirty = false;
    if (!painted) {
      painted = true;
      try {
        options.onFirstFrame?.();
      } catch {
        // The host's callback is the host's problem; the figure keeps drawing.
      }
    }
  }

  function schedule(): void {
    if (raf || dead || !active) return;
    if (reduced && !dirty) return;
    raf = requestAnimationFrame(tick);
  }

  function tick(): void {
    raf = 0;
    if (dead || !active) return;
    try {
      paint();
    } catch {
      fail();
      return;
    }
    // Without a size there is nothing to draw: the resize observer wakes the loop when the canvas gets one.
    if (width > 0 && height > 0) schedule();
  }

  function stop(): void {
    dead = true;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    observer?.disconnect();
    canvas.removeEventListener("webglcontextlost", onContextLost);
  }

  function fail(): void {
    if (dead) return;
    stop();
    try {
      options.onLost?.();
    } catch {
      // Same as above.
    }
  }

  function onContextLost(): void {
    fail();
  }

  /** Every public method goes through here: after death it does nothing, and an error inside is a `fail()`. */
  function guarded<R>(run: () => R, otherwise: R): R {
    if (dead) return otherwise;
    try {
      return run();
    } catch {
      fail();
      return otherwise;
    }
  }

  function invalidate(): void {
    dirty = true;
    schedule();
  }

  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(() => guarded(invalidate, undefined)) : null;
  observer?.observe(canvas);
  canvas.addEventListener("webglcontextlost", onContextLost);
  schedule();

  return {
    setLook: (next) =>
      guarded(() => {
        parts = partsFor(next);
        invalidate();
      }, undefined),
    setActivity: (next) =>
      guarded(() => {
        if (next !== activity) {
          activity = next;
          since = clock();
        }
        invalidate();
      }, undefined),
    lookAt: (x, y) =>
      guarded(() => {
        if (Number.isFinite(x) && Number.isFinite(y)) gaze = [clamp(x * 2 - 1, -1, 1), clamp(1 - y * 2, -1, 1)];
        invalidate();
      }, undefined),
    clearLookAt: () =>
      guarded(() => {
        gaze = null;
        invalidate();
      }, undefined),
    setActive: (next) =>
      guarded(() => {
        active = next;
        // Coming back from a pause is not a jump in time.
        last = clock();
        if (!active && raf) {
          cancelAnimationFrame(raf);
          raf = 0;
        }
        schedule();
      }, undefined),
    setReducedMotion: (next) =>
      guarded(() => {
        reduced = next;
        invalidate();
      }, undefined),
    capture: (size) =>
      guarded(() => {
        const side = Math.min(MAX_PIXELS, Math.max(1, Math.round(Number.isFinite(size) ? size : 1)));
        const framebuffer = context.createFramebuffer();
        const color = context.createRenderbuffer();
        const depth = context.createRenderbuffer();
        context.bindFramebuffer(context.FRAMEBUFFER, framebuffer);
        context.bindRenderbuffer(context.RENDERBUFFER, color);
        context.renderbufferStorage(context.RENDERBUFFER, context.RGBA8, side, side);
        context.framebufferRenderbuffer(context.FRAMEBUFFER, context.COLOR_ATTACHMENT0, context.RENDERBUFFER, color);
        context.bindRenderbuffer(context.RENDERBUFFER, depth);
        context.renderbufferStorage(context.RENDERBUFFER, context.DEPTH_COMPONENT16, side, side);
        context.framebufferRenderbuffer(context.FRAMEBUFFER, context.DEPTH_ATTACHMENT, context.RENDERBUFFER, depth);
        renderer.render(parts, { ...NEUTRAL, time: 0, layers: LAYERS, density: densityFor(side) }, side, side);
        const raw = new Uint8Array(side * side * 4);
        context.readPixels(0, 0, side, side, context.RGBA, context.UNSIGNED_BYTE, raw);
        context.bindFramebuffer(context.FRAMEBUFFER, null);
        context.deleteFramebuffer(framebuffer);
        context.deleteRenderbuffer(color);
        context.deleteRenderbuffer(depth);
        if (context.isContextLost()) return null;
        // WebGL reads bottom row first and premultiplied; ImageData is top row first and straight.
        const out = new Uint8ClampedArray(side * side * 4);
        for (let y = 0; y < side; y++)
          for (let x = 0; x < side; x++) {
            const from = ((side - 1 - y) * side + x) * 4, to = (y * side + x) * 4;
            const a = raw[from + 3]!;
            for (let c = 0; c < 3; c++) out[to + c] = a ? Math.round((raw[from + c]! * 255) / a) : 0;
            out[to + 3] = a;
          }
        invalidate();
        return new ImageData(out, side, side);
      }, null),
    destroy: () => {
      if (dead) return;
      stop();
      // Give the browser its context back: it only lends a handful per page.
      try {
        context.getExtension("WEBGL_lose_context")?.loseContext();
      } catch {
        // Nothing left to release.
      }
    },
  };
}
