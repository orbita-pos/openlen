// @vitest-environment jsdom
// When the scene behind the workspace stops moving (spec local 2026-11-27-temas-del-workspace, §10.1; Review Focus 3):
// reduced motion, a machine that paints under 50 frames a second in the two seconds after the scene loads, or WebGL
// drawn by software. Measured on Jesús's laptop: what costs frames is the scene, not the blur.
import { describe, expect, it } from "vitest";

import { measureFps, shouldStayStill } from "./motion-guard";

const base = { reducedMotion: false, fps: 60, renderer: "ANGLE (Intel, Intel(R) UHD Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)", heavy: false };

describe("shouldStayStill", () => {
  it("reduced motion: still, whatever the machine", () => {
    expect(shouldStayStill({ ...base, reducedMotion: true })).toBe(true);
  });

  it("under 50 frames a second: still; 50 and over: moving", () => {
    expect(shouldStayStill({ ...base, fps: 44 })).toBe(true);
    expect(shouldStayStill({ ...base, fps: 49.9 })).toBe(true);
    expect(shouldStayStill({ ...base, fps: 50 })).toBe(false);
    expect(shouldStayStill({ ...base, fps: 58 })).toBe(false);
  });

  it("WebGL drawn by software (SwiftShader, llvmpipe, Software): still", () => {
    for (const renderer of [
      "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)",
      "llvmpipe (LLVM 15.0.7, 256 bits)",
      "Microsoft Basic Render Driver (Software)",
    ]) {
      expect(shouldStayStill({ ...base, renderer }), renderer).toBe(true);
    }
  });

  it("a real GPU at 60 frames: moving — heavy or not", () => {
    expect(shouldStayStill(base)).toBe(false);
    expect(shouldStayStill({ ...base, heavy: true })).toBe(false);
  });

  it("nothing measured and no renderer known: a light scene moves, a heavy one starts still", () => {
    expect(shouldStayStill({ ...base, fps: null, renderer: null })).toBe(false);
    expect(shouldStayStill({ ...base, fps: null, renderer: null, heavy: true })).toBe(true);
  });
});

describe("measureFps", () => {
  it("counts the frames requestAnimationFrame paints over the window it is given", async () => {
    let t = 0;
    const raf = (cb: FrameRequestCallback) => {
      // 40 frames a second: one every 25 ms.
      t += 25;
      queueMicrotask(() => cb(t));
      return 1;
    };
    const fps = await measureFps(2000, { raf });
    expect(fps).toBeGreaterThan(38);
    expect(fps).toBeLessThan(42);
  });

  it("is null without requestAnimationFrame", async () => {
    expect(await measureFps(2000, { raf: null })).toBeNull();
  });
});
