// @vitest-environment node
import { describe, expect, it } from "vitest";

import { contentTypeOf } from "./content-types";

describe("contentTypeOf", () => {
  // THE GAME MODE (spec local 2026-11-05-modo-juego-design, §8.6): a game's models and sounds on the canvas and on
  // custom domains, with the same types Caddy gives them on the published site.
  it("knows a game's models and sounds", () => {
    expect(contentTypeOf("/models/ship.glb")).toBe("model/gltf-binary");
    expect(contentTypeOf("/models/ship.gltf")).toBe("model/gltf+json");
    expect(contentTypeOf("/models/ship.bin")).toBe("application/octet-stream");
    expect(contentTypeOf("/textures/sky.hdr")).toBe("image/vnd.radiance");
    expect(contentTypeOf("/sounds/jump.opus")).toBe("audio/ogg");
    expect(contentTypeOf("/sounds/theme.flac")).toBe("audio/flac");
  });

  it("is case-blind and falls back to bytes", () => {
    expect(contentTypeOf("/MODELS/SHIP.GLB")).toBe("model/gltf-binary");
    expect(contentTypeOf("/models/ship")).toBe("application/octet-stream");
  });
});
