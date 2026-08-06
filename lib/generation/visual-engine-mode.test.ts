import { describe, expect, it } from "vitest";

import { shouldRunLegacySafeShadow, visualEngineMode } from "./visual-engine-mode";

describe("visualEngineMode", () => {
  it.each([undefined, "", "off", "on", "true", "SKELETON"])("maps %s to off", (raw) => {
    expect(visualEngineMode(raw)).toBe("off");
  });

  it("accepts only shadow and skeleton", () => {
    expect(visualEngineMode("shadow")).toBe("shadow");
    expect(visualEngineMode("skeleton")).toBe("skeleton");
  });

  it("suppresses the legacy shadow when Visual Engine owns selection", () => {
    expect(shouldRunLegacySafeShadow("off", "shadow")).toBe(true);
    expect(shouldRunLegacySafeShadow("shadow", "shadow")).toBe(false);
    expect(shouldRunLegacySafeShadow("skeleton", "shadow")).toBe(false);
  });
});
