import { describe, expect, it } from "vitest";

import { VERTEX } from "./shaders";

// Jesús's Galaxy A07 (Mali-G57), 17/11: every piece drawn with one layer — the eyes, the glasses, what she wears, the
// shadow on the ground — was missing, and the fur alone was left. Its compiler works out BOTH sides of a `?:` and
// blends them, so `uLayers > 1.0 ? x / (uLayers - 1.0) : 0.0` with one layer still divided by zero, and the NaN
// took the vertex away. No desktop GPU does that, so no browser test here can see it: the shader itself must not
// hold that division, taken or not. (Seen on the phone: with the guarded division, the eyes and the shadow are back.)
describe("the figure's shaders on every GPU", () => {
  it("🔴 the layer's height never divides by zero, even on a side of a ?: that is not taken", () => {
    expect(VERTEX).not.toMatch(/\/\s*\(\s*uLayers\s*-\s*1\.0\s*\)/);
    expect(VERTEX).toMatch(/float\(gl_InstanceID\)\s*\/\s*max\(uLayers\s*-\s*1\.0,\s*1\.0\)/);
  });
});
