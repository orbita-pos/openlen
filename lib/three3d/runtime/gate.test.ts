import { describe, it, expect } from "vitest";
import { shouldEnable3D, type Capabilities } from "./gate";

const ok: Capabilities = { reducedMotion: false, saveData: false, deviceMemory: 8, webgl: true };

describe("shouldEnable3D", () => {
  it("allows a capable, motion-OK device", () => {
    expect(shouldEnable3D(ok)).toBe(true);
  });
  it("blocks reduced motion", () => {
    expect(shouldEnable3D({ ...ok, reducedMotion: true })).toBe(false);
  });
  it("blocks Save-Data", () => {
    expect(shouldEnable3D({ ...ok, saveData: true })).toBe(false);
  });
  it("blocks low memory (<4GB)", () => {
    expect(shouldEnable3D({ ...ok, deviceMemory: 2 })).toBe(false);
  });
  it("blocks no-WebGL", () => {
    expect(shouldEnable3D({ ...ok, webgl: false })).toBe(false);
  });
});
