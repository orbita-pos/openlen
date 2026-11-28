// WHEN THE SCENE STOPS MOVING (spec local 2026-11-27-temas-del-workspace, §10.1; Review Focus 3). Measured on Jesús's
// laptop: what costs frames is the SCENE, not the blur — night-reef painted 44–46 fps with or without glass, honu-lagoon
// 56–58. So the guard looks at the frames the person's machine actually paints in the two seconds after the scene has
// decoded, plus Claude Code's own rule of stopping a scene without GPU acceleration (WebGL drawn by software). Reduced
// motion is already the scene's own rule (it works inside an `<img>`, measured); the layer still starts on the still
// picture then, so nothing is animated to be measured.
//
// Client-only, no React: the layer (`theme-backdrop.tsx`) calls these.

/** Below this, the scene is swapped for its still picture. */
export const MIN_FPS = 50;

/** How long the frames are counted after the scene decodes. */
export const MEASURE_MS = 2000;

const SOFTWARE_RENDERER = /SwiftShader|llvmpipe|Software/i;

/**
 * Whether the layer should show the still scene. `true` with reduced motion, under `MIN_FPS`, or with WebGL drawn by
 * software. `heavy` only counts when nothing could be measured: a costly scene with no frame count starts still.
 */
export function shouldStayStill(o: { reducedMotion: boolean; fps: number | null; renderer: string | null; heavy: boolean }): boolean {
  if (o.reducedMotion) return true;
  if (o.renderer !== null && SOFTWARE_RENDERER.test(o.renderer)) return true;
  if (o.fps !== null) return o.fps < MIN_FPS;
  return o.heavy && o.renderer === null;
}

export function prefersReducedMotion(): boolean {
  try {
    return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

let rendererOfThisTab: string | null | undefined;

/**
 * WebGL's unmasked renderer string (`WEBGL_debug_renderer_info`), or null when the browser gives none. Asked ONCE per
 * tab: the GPU does not change under a page, and every ask opens a WebGL context.
 */
export function detectRenderer(): string | null {
  if (rendererOfThisTab === undefined) rendererOfThisTab = askRenderer();
  return rendererOfThisTab;
}

/** For tests: forget what the tab was told. */
export function forgetRenderer(): void {
  rendererOfThisTab = undefined;
}

function askRenderer(): string | null {
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl") ?? canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (!gl) return null;
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null;
    // One context was opened only to ask: give it back, browsers cap how many a page holds.
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return typeof renderer === "string" && renderer !== "" ? renderer : null;
  } catch {
    return null;
  }
}

interface Clock {
  raf: ((cb: FrameRequestCallback) => number) | null;
}

const realClock = (): Clock => ({
  raf: typeof window.requestAnimationFrame === "function" ? window.requestAnimationFrame.bind(window) : null,
});

/**
 * Frames per second painted over `ms`, counted with `requestAnimationFrame`. Null without it. A hidden tab paints no
 * frames, so a count that never reaches the end of its window is null too (unknown, not slow).
 */
export function measureFps(ms: number = MEASURE_MS, clock: Clock = realClock()): Promise<number | null> {
  const { raf } = clock;
  if (!raf) return Promise.resolve(null);
  return new Promise((resolve) => {
    let start: number | null = null;
    let frames = 0;
    // A hidden tab never calls back: give up a little after the window so the promise does not hang.
    const giveUp = setTimeout(() => resolve(null), ms * 3);
    const tick = (t: number) => {
      if (start === null) {
        start = t;
        raf(tick);
        return;
      }
      frames += 1;
      const elapsed = t - start;
      if (elapsed >= ms) {
        clearTimeout(giveUp);
        resolve((frames * 1000) / elapsed);
        return;
      }
      raf(tick);
    };
    raf(tick);
  });
}
