import { describe, expect, it } from "vitest";
import { DEFAULT_LOOK, FIGURE_ACCESSORIES, FIGURE_EYES, FIGURE_EYEWEAR, FIGURE_SHAPES, type FigureLook } from "../look";
import { anchorsFor, partsFor, shadowOf, surfaceZ, type Part } from "./parts";

const look = (over: Partial<FigureLook> = {}): FigureLook => ({ ...DEFAULT_LOOK, ...over });
const of = (parts: Part[], role: Part["role"]) => parts.filter((p) => p.role === role);
const json = (parts: Part[]) => JSON.stringify(parts);

describe("partsFor", () => {
  it("always has one furry body and two eyes", () => {
    for (const shape of FIGURE_SHAPES)
      for (const eyes of FIGURE_EYES) {
        const parts = partsFor(look({ shape, eyes }));
        expect(of(parts, "body")).toHaveLength(1);
        expect(of(parts, "body")[0]!.kind).toBe("fur");
        expect(of(parts, "eye"), `${shape}/${eyes}`).toHaveLength(2);
      }
  });

  it("gives closed eyes no highlight", () => {
    expect(of(partsFor(look({ eyes: "smile" })), "eyeHighlight")).toHaveLength(0);
    expect(of(partsFor(look({ eyes: "sleepy" })), "eyeHighlight")).toHaveLength(0);
    expect(of(partsFor(look({ eyes: "oval" })), "eyeHighlight")).toHaveLength(2);
  });

  it("draws the five eyes differently", () => {
    expect(new Set(FIGURE_EYES.map((eyes) => json(of(partsFor(look({ eyes })), "eye")))).size).toBe(5);
  });

  it("gives only the eared shape two furry ears, mirrored", () => {
    for (const shape of FIGURE_SHAPES) {
      const ears = of(partsFor(look({ shape })), "ear");
      if (shape !== "ears") expect(ears, shape).toHaveLength(0);
      else {
        expect(ears).toHaveLength(2);
        expect(ears.every((e) => e.kind === "fur")).toBe(true);
        expect(ears[0]!.position[0]).toBeCloseTo(-ears[1]!.position[0]);
        expect(ears[0]!.position[1]).toBeCloseTo(ears[1]!.position[1]);
      }
    }
  });

  it("gives every shape its own body", () => {
    const bodies = FIGURE_SHAPES.map((shape) => json([...of(partsFor(look({ shape })), "body"), ...of(partsFor(look({ shape })), "ear")]));
    expect(new Set(bodies).size).toBe(FIGURE_SHAPES.length);
  });

  it("builds glasses from rims and a bridge, and shades that cover the eyes", () => {
    expect(of(partsFor(look({ eyewear: "none" })), "eyewear")).toHaveLength(0);
    const round = of(partsFor(look({ eyewear: "round" })), "eyewear");
    expect(round.filter((p) => p.mesh === "torus")).toHaveLength(2);
    expect(round.length).toBeGreaterThanOrEqual(3);
    const parts = partsFor(look({ eyewear: "shades" }));
    const lenses = of(parts, "eyewear").filter((p) => p.kind === "gloss");
    expect(lenses).toHaveLength(2);
    const eyeZ = Math.max(...of(parts, "eye").map((e) => e.position[2]));
    for (const lens of lenses) {
      expect(lens.position[2]).toBeGreaterThan(eyeZ);
      expect(Math.max(...lens.color)).toBeLessThan(0.2);
    }
  });

  it("gives every accessory its own pieces, colored only by accessoryColor", () => {
    expect(of(partsFor(look({ accessory: "none" })), "accessory")).toHaveLength(0);
    const sets = FIGURE_ACCESSORIES.filter((a) => a !== "none").map((accessory) => {
      const pieces = of(partsFor(look({ accessory })), "accessory");
      expect(pieces.length, accessory).toBeGreaterThanOrEqual(1);
      return json(pieces);
    });
    expect(new Set(sets).size).toBe(6);

    const plain = partsFor(look({ accessory: "beret" }));
    const tinted = partsFor(look({ accessory: "beret", accessoryColor: "#0000ff" }));
    for (const piece of of(tinted, "accessory")) expect(piece.color).toEqual([0, 0, 1]);
    expect(json(tinted.filter((p) => p.role !== "accessory"))).toBe(json(plain.filter((p) => p.role !== "accessory")));
  });

  it("puts the eyes in front of the fur on every shape", () => {
    for (const shape of FIGURE_SHAPES)
      for (const eyes of FIGURE_EYES) {
        const l = look({ shape, eyes });
        const body = of(partsFor(l), "body")[0]!;
        for (const eye of anchorsFor(l).eyes) expect(eye[2], `${shape}/${eyes}`).toBeGreaterThanOrEqual(surfaceZ(l, eye[0], eye[1]) + body.furLength * 0.4);
      }
  });

  it("is symmetric left to right when it wears nothing", () => {
    for (const shape of FIGURE_SHAPES)
      for (const eyes of FIGURE_EYES)
        for (const eyewear of FIGURE_EYEWEAR) {
          // The highlight is where the light comes from: on the same side of both eyes, on purpose.
          const parts = partsFor(look({ shape, eyes, eyewear })).filter((p) => p.role !== "eyeHighlight");
          for (const part of parts) {
            if (Math.abs(part.position[0]) < 1e-9) continue;
            const mirror = parts.find((q) => q.role === part.role && q.mesh === part.mesh && Math.abs(q.position[0] + part.position[0]) < 1e-9 && Math.abs(q.position[1] - part.position[1]) < 1e-9);
            expect(mirror, `${shape}/${eyes}/${eyewear} ${part.role}`).toBeDefined();
          }
        }
  });

  it("rests the accessory on that shape's head", () => {
    expect(anchorsFor(look({ shape: "capsule" })).top[1]).toBeGreaterThan(anchorsFor(look({ shape: "drop" })).top[1]);
    for (const shape of FIGURE_SHAPES) {
      const l = look({ shape, accessory: "hat" });
      const lowest = Math.min(...of(partsFor(l), "accessory").map((p) => p.position[1]));
      expect(lowest, shape).toBeGreaterThan(anchorsFor(l).top[1] - 0.3);
    }
  });

  it("draws the default figure for anything that is not a look", () => {
    const fallback = json(partsFor(DEFAULT_LOOK));
    for (const raw of [undefined, { shape: "sparrow" }, null, 3]) expect(json(partsFor(raw))).toBe(fallback);
  });

  it("gives a black body light eyes", () => {
    for (const eye of of(partsFor(look({ color: "#000000" })), "eye")) expect(Math.min(...eye.color)).toBeGreaterThan(0.9);
    for (const eye of of(partsFor(look({ color: "#ff5fa8" })), "eye")) expect(Math.max(...eye.color)).toBeLessThan(0.2);
  });
});

describe("shadowOf", () => {
  it("is where a hat-like accessory sits, and nothing for what casts none", () => {
    for (const accessory of ["beret", "beanie", "crown", "hat"] as const) {
      const shadow = shadowOf(look({ accessory }));
      expect(shadow, accessory).not.toBeNull();
      expect(shadow!.center[1]).toBeGreaterThan(anchorsFor(look({ accessory })).top[1] - 0.35);
      expect(Math.min(...shadow!.size)).toBeGreaterThan(0);
    }
    for (const accessory of ["none", "bow", "headphones"] as const) expect(shadowOf(look({ accessory }))).toBeNull();
    expect(shadowOf(undefined)).toBeNull();
  });
});
