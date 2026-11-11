import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOOK,
  FIGURE_ACCESSORIES,
  FIGURE_COLORS,
  FIGURE_EYES,
  FIGURE_EYEWEAR,
  FIGURE_RETIRED,
  FIGURE_SHAPES,
  checkLook,
  eyeInk,
  lookOrDefault,
  offered,
  type FigureCategory,
} from "./look";

const CATEGORIES: FigureCategory[] = ["shape", "eyes", "eyewear", "accessory"];

describe("checkLook", () => {
  it("accepts the default look as it is", () => {
    expect(checkLook(DEFAULT_LOOK)).toEqual({ ok: true, value: DEFAULT_LOOK });
  });

  it("names the field that is wrong", () => {
    expect(checkLook({ ...DEFAULT_LOOK, shape: "sparrow" })).toEqual({ ok: false, field: "shape" });
    expect(checkLook({ ...DEFAULT_LOOK, eyes: "laser" })).toEqual({ ok: false, field: "eyes" });
    expect(checkLook({ ...DEFAULT_LOOK, eyewear: "monocle" })).toEqual({ ok: false, field: "eyewear" });
    expect(checkLook({ ...DEFAULT_LOOK, accessory: "cape" })).toEqual({ ok: false, field: "accessory" });
    expect(checkLook({ ...DEFAULT_LOOK, color: "pink" })).toEqual({ ok: false, field: "color" });
    expect(checkLook({ ...DEFAULT_LOOK, color: "#fff" })).toEqual({ ok: false, field: "color" });
    expect(checkLook({ ...DEFAULT_LOOK, v: 2 })).toEqual({ ok: false, field: "v" });
    expect(checkLook({ ...DEFAULT_LOOK, accessoryColor: "red" })).toEqual({ ok: false, field: "accessoryColor" });
    expect(checkLook(null)).toEqual({ ok: false, field: "v" });
    expect(checkLook("x")).toEqual({ ok: false, field: "v" });
  });

  it("drops keys it does not know", () => {
    const r = checkLook({ ...DEFAULT_LOOK, extra: 1 });
    expect(r.ok && "extra" in r.value).toBe(false);
  });

  it("stores colors in lower case", () => {
    const r = checkLook({ ...DEFAULT_LOOK, color: "#FF5FA8", accessoryColor: "#ABCDEF" });
    expect(r).toEqual({ ok: true, value: { ...DEFAULT_LOOK, color: "#ff5fa8", accessoryColor: "#abcdef" } });
  });

  it("leaves accessoryColor out when it was not given", () => {
    const r = checkLook(DEFAULT_LOOK);
    expect(r.ok && "accessoryColor" in r.value).toBe(false);
  });
});

describe("lookOrDefault", () => {
  it("falls back to the default look and never throws", () => {
    for (const raw of [{ shape: "sparrow" }, undefined, 42, [], null, "x"]) expect(lookOrDefault(raw)).toEqual(DEFAULT_LOOK);
  });

  it("keeps a valid look", () => {
    const look = { ...DEFAULT_LOOK, shape: "heart", accessory: "crown" };
    expect(lookOrDefault(look)).toEqual(look);
  });
});

describe("the catalog", () => {
  it("offers the catalog without what was retired", () => {
    expect(offered("shape")).toEqual(FIGURE_SHAPES);
    expect(offered("eyes")).toEqual(FIGURE_EYES);
    expect(offered("eyewear")).toEqual(FIGURE_EYEWEAR);
    expect(offered("accessory")).toEqual(FIGURE_ACCESSORIES);
  });

  it("still draws a retired id but no longer offers it", () => {
    for (const c of CATEGORIES)
      for (const id of FIGURE_RETIRED[c]) {
        expect(checkLook({ ...DEFAULT_LOOK, [c]: id }).ok).toBe(true);
        expect(offered(c)).not.toContain(id);
      }
  });

  it("suggests eight distinct colors", () => {
    expect(FIGURE_COLORS).toHaveLength(8);
    expect(new Set(FIGURE_COLORS).size).toBe(8);
    for (const c of FIGURE_COLORS) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("eyeInk", () => {
  it("turns light on a body too dark to show dark eyes", () => {
    expect(eyeInk("#000000")).toBe("#f4f4f5");
    expect(eyeInk("#1a1a2e")).toBe("#f4f4f5");
  });

  it("is the ink that contrasts more, also on bodies that are dark without being black", () => {
    for (const c of ["#800080", "#4a4a4a", "#006400", "#8b4513", "#555555"]) expect(eyeInk(c), c).toBe("#f4f4f5");
    for (const c of FIGURE_COLORS) expect(eyeInk(c), c).toBe("#1d1d1f");
  });

  it("stays dark everywhere else", () => {
    for (const c of ["#ff5fa8", "#ffffff", "#f2c35b"]) expect(eyeInk(c)).toBe("#1d1d1f");
  });
});
