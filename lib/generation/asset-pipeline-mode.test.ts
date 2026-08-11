import { afterEach, describe, expect, it } from "vitest";

import { assetPipelineMode, parseAssetPipelineMode } from "./asset-pipeline-mode";

const previous = process.env.OPENLEN_VISUAL_ENGINE_ASSETS;

afterEach(() => {
  if (previous === undefined) delete process.env.OPENLEN_VISUAL_ENGINE_ASSETS;
  else process.env.OPENLEN_VISUAL_ENGINE_ASSETS = previous;
});

describe("asset pipeline mode", () => {
  it.each([
    [undefined, "off"],
    ["shadow", "shadow"],
    ["curated", "curated"],
    ["hybrid", "hybrid"],
    ["on", "off"],
  ] as const)("parses %s as %s", (value, expected) => {
    expect(parseAssetPipelineMode(value)).toBe(expected);
  });

  it("reads OPENLEN_VISUAL_ENGINE_ASSETS at call time", () => {
    process.env.OPENLEN_VISUAL_ENGINE_ASSETS = "hybrid";
    expect(assetPipelineMode()).toBe("hybrid");
  });
});
