import { describe, it, expect } from "vitest";
import { pickModelPresentation, MODEL_PRESENTATION_KEYS } from "./presentation";
import { SAMPLE_SPEC, coerceSceneSpec, parseSceneSpecStrict } from "../three3d/scene-spec";

describe("pickModelPresentation", () => {
  it("strips foreign keys, keeping only whitelisted presentation fields", () => {
    expect(pickModelPresentation({ modelUrl: "x", background: "color" })).toEqual({ background: "color" });
  });

  it("returns {} for non-objects", () => {
    expect(pickModelPresentation(null)).toEqual({});
    expect(pickModelPresentation(undefined)).toEqual({});
    expect(pickModelPresentation("string")).toEqual({});
    expect(pickModelPresentation(42)).toEqual({});
    expect(pickModelPresentation([1, 2, 3])).toEqual({});
  });

  it("passes sub-objects through by reference, not deep-cloned", () => {
    const motion = { kind: "rotate", speed: 0.9 };
    const camera = { framing: "wide" };
    const result = pickModelPresentation({ motion, camera });
    expect(result.motion).toBe(motion);
    expect(result.camera).toBe(camera);
  });

  it("keeps all whitelisted keys when present, dropping everything else", () => {
    const raw = {
      background: "gradient",
      motion: { kind: "drift" },
      look: "studio",
      camera: { framing: "wide" },
      modelUrl: "should-not-survive",
      junk: 1,
    };
    const result = pickModelPresentation(raw);
    expect(Object.keys(result).sort()).toEqual([...MODEL_PRESENTATION_KEYS].sort());
  });
});

describe("pickModelPresentation — coerce round-trip", () => {
  it("panel-style merge survives strict parsing even when the catalog spec carries junk", () => {
    const catalogSceneSpec = {
      modelUrl: "https://evil.example/should-not-leak.glb",
      background: "color",
      motion: { kind: "rotate", speed: 0.9, amplitude: 0.2 },
      look: "studio",
      camera: { framing: "wide" },
      unknownField: "dropped before it ever reaches the spec",
    };

    const draft = {
      ...SAMPLE_SPEC,
      preset: "background",
      background: "gradient",
      look: "soft",
      ...pickModelPresentation(catalogSceneSpec),
      modelUrl: "https://cdn.openlen.com/models/real.glb",
    };

    expect(coerceSceneSpec(draft)).toBeTruthy();

    const strict = parseSceneSpecStrict(draft);
    expect(strict.ok).toBe(true);
    if (strict.ok) {
      expect(strict.value.background).toBe("color"); // catalog override wins over the gradient default
      expect(strict.value.look).toBe("studio");
      expect(strict.value.camera.framing).toBe("wide");
      expect(strict.value.modelUrl).toBe("https://cdn.openlen.com/models/real.glb"); // never repointed by the catalog
    }
  });
});
