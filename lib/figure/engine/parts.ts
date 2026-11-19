// FROM A LOOK, THE PIECES TO DRAW (spec local 2026-11-10-figuras-del-asistente, §5.1–5.2). Pure: no WebGL here,
// so what a look is made of can be tested without a browser.
//
// Units are the body's: its radius is about 1, +y is up, +z comes toward the camera. The catalog is ours — these
// shapes and accessories are drawn here from numbers, copied from nobody.
import { eyeInk, lookOrDefault, rgb, type FigureAccessory, type FigureEyes, type FigureEyewear, type FigureLook, type FigureShape } from "../look";

export type PartKind = "fur" | "solid" | "gloss";
/** `sphere` goes through the silhouette; the others are rigid. `torus` is a full ring, `arc` its upper half. */
export type PartMesh = "sphere" | "torus" | "arc" | "cone" | "cylinder";
export type Vec3 = readonly [number, number, number];

/** The body's outline as numbers the vertex shader reads (see `shape()` in shaders.ts). */
export interface Silhouette {
  /** Superellipse power: 2 is round, more is squarer. */
  power: number;
  lobes: number;
  lobeDepth: number;
  notchTop: number;
  pointBottom: number;
  taperBottom: number;
  taperTop: number;
  squashBottom: number;
  widenBottom: number;
}

export interface Part {
  role: "body" | "ear" | "eye" | "eyeHighlight" | "eyewear" | "accessory";
  mesh: PartMesh;
  kind: PartKind;
  position: Vec3;
  scale: Vec3;
  /** yaw, pitch, roll in radians. */
  rotation: Vec3;
  /** 0..1 per channel. */
  color: Vec3;
  /** 0 when it is not fur. */
  furLength: number;
  silhouette?: Silhouette;
  /** For `torus` and `arc`: the tube's radius, as a share of the ring's. */
  tube?: number;
}

export const ROUND: Silhouette = { power: 2, lobes: 0, lobeDepth: 0, notchTop: 0, pointBottom: 0, taperBottom: 0, taperTop: 0, squashBottom: 0, widenBottom: 0 };
export const FUR = 0.13;

interface Body {
  scale: Vec3;
  silhouette: Silhouette;
  /** Where the eyes sit. */
  eyeY: number;
}

const BODIES: Record<FigureShape, Body> = {
  drop: { scale: [0.93, 0.95, 0.9], silhouette: { ...ROUND, squashBottom: 0.28, widenBottom: 0.14, taperTop: 0.1 }, eyeY: 0.05 },
  round: { scale: [1, 0.95, 0.9], silhouette: ROUND, eyeY: 0.1 },
  capsule: { scale: [0.74, 1.12, 0.74], silhouette: { ...ROUND, power: 2.6 }, eyeY: 0.3 },
  cube: { scale: [0.95, 0.92, 0.85], silhouette: { ...ROUND, power: 4.2 }, eyeY: 0.1 },
  ears: { scale: [0.95, 0.9, 0.88], silhouette: ROUND, eyeY: 0.05 },
  heart: { scale: [1.05, 1, 0.8], silhouette: { ...ROUND, notchTop: 0.3, pointBottom: 0.1, taperBottom: 0.5 }, eyeY: 0.15 },
  flower: { scale: [0.95, 0.95, 0.8], silhouette: { ...ROUND, lobes: 6, lobeDepth: 0.13 }, eyeY: 0.08 },
  triangle: { scale: [1.05, 1, 0.85], silhouette: { ...ROUND, power: 2.5, taperTop: 0.6, squashBottom: 0.2 }, eyeY: -0.15 },
  star: { scale: [0.95, 0.95, 0.8], silhouette: { ...ROUND, lobes: 5, lobeDepth: 0.16 }, eyeY: 0.06 },
  cloud: { scale: [1.04, 0.92, 0.84], silhouette: { ...ROUND, notchTop: -0.22, squashBottom: 0.48, widenBottom: 0.14 }, eyeY: -0.02 },
  diamond: { scale: [1.02, 1.02, 0.85], silhouette: { ...ROUND, power: 1.35 }, eyeY: 0.06 },
  teardrop: { scale: [0.88, 1.02, 0.85], silhouette: { ...ROUND, taperTop: 0.56, widenBottom: 0.24, squashBottom: 0.16 }, eyeY: -0.1 },
  clover: { scale: [0.98, 0.98, 0.82], silhouette: { ...ROUND, lobes: 4, lobeDepth: -0.15 }, eyeY: 0.06 },
  cat: { scale: [0.94, 0.86, 0.86], silhouette: { ...ROUND, squashBottom: 0.12, widenBottom: 0.08 }, eyeY: 0.02 },
  bean: { scale: [0.95, 0.82, 0.84], silhouette: { ...ROUND, power: 2.8, lobes: 2, lobeDepth: 0.28 }, eyeY: 0.24 },
};

const NONE: Vec3 = [0, 0, 0];
const EYE_X = 0.32;
const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** The outline's radius at an angle: the same formula as `shape()` in the vertex shader, before its tapers. */
function radius(s: Silhouette, th: number): number {
  let r = (Math.abs(Math.cos(th)) ** s.power + Math.abs(Math.sin(th)) ** s.power) ** (-1 / s.power);
  r *= 1 + s.lobeDepth * Math.cos(s.lobes * (th - Math.PI / 2));
  const up = wrap(th - Math.PI / 2), down = wrap(th + Math.PI / 2), side = Math.abs(up) - 1.05;
  r *= 1 - Math.max(s.notchTop, 0) * Math.exp((-up * up) / 0.08) + Math.min(s.notchTop, 0) * Math.exp((-side * side) / 0.06);
  r *= 1 + s.pointBottom * Math.exp((-down * down) / 0.12);
  return r;
}

/** How far toward the camera the body's skin is at (x, y), fur not counted. Close enough near the face. */
export function surfaceZ(look: unknown, x: number, y: number): number {
  const body = BODIES[lookOrDefault(look).shape];
  const u = x / body.scale[0], v = y / body.scale[1];
  const rho = Math.hypot(u, v) / radius(body.silhouette, Math.atan2(v, u));
  return body.scale[2] * Math.sqrt(Math.max(0, 1 - rho * rho));
}

/** Where the eyes and the top of the head are for that shape: accessories and the engine's own shadows need them. */
export function anchorsFor(look: unknown): { eyes: readonly [Vec3, Vec3]; top: Vec3 } {
  const l = lookOrDefault(look);
  const body = BODIES[l.shape];
  const z = surfaceZ(l, EYE_X, body.eyeY) + FUR * 0.55;
  return {
    eyes: [[-EYE_X, body.eyeY, z], [EYE_X, body.eyeY, z]],
    top: [0, body.scale[1] * radius(body.silhouette, Math.PI / 2), 0],
  };
}

function eyes(kind: FigureEyes, at: readonly [Vec3, Vec3], ink: Vec3): Part[] {
  const parts: Part[] = [];
  for (const [x, y, z] of at) {
    const side = Math.sign(x);
    if (kind === "smile" || kind === "sleepy" || (kind === "wink" && side > 0)) {
      // An arc: ∩ for a smile/wink, ∪ and flatter for sleepy.
      const sleepy = kind === "sleepy";
      parts.push({ role: "eye", mesh: "arc", kind: "solid", position: [x, y + (sleepy ? 0.03 : -0.04), z + 0.02], scale: sleepy ? [0.12, 0.07, 0.12] : [0.12, 0.12, 0.12], rotation: [0, 0, sleepy ? Math.PI : 0], color: ink, furLength: 0, tube: 0.26 });
      continue;
    }
    if (kind === "cheerful") {
      parts.push({ role: "eye", mesh: "arc", kind: "solid", position: [x, y, z + 0.02], scale: [0.11, 0.11, 0.11], rotation: [0, 0, side < 0 ? -Math.PI / 2 : Math.PI / 2], color: ink, furLength: 0, tube: 0.26 });
      continue;
    }
    if (kind === "calm") {
      parts.push({ role: "eye", mesh: "sphere", kind: "solid", position: [x, y, z + 0.02], scale: [0.135, 0.032, 0.04], rotation: NONE, color: ink, furLength: 0 });
      continue;
    }
    if (kind === "sparkle") {
      parts.push(
        { role: "eye", mesh: "sphere", kind: "gloss", position: [x, y, z], scale: [0.15, 0.165, 0.06], rotation: NONE, color: ink, furLength: 0 },
        { role: "eyeHighlight", mesh: "sphere", kind: "gloss", position: [x - 0.042, y + 0.06, z + 0.052], scale: [0.042, 0.042, 0.016], rotation: NONE, color: [1, 1, 1], furLength: 0 },
        { role: "eyeHighlight", mesh: "sphere", kind: "gloss", position: [x + 0.045, y - 0.05, z + 0.052], scale: [0.024, 0.024, 0.014], rotation: NONE, color: [1, 1, 1], furLength: 0 },
      );
      continue;
    }
    if (kind === "lash") {
      parts.push(
        { role: "eye", mesh: "sphere", kind: "gloss", position: [x, y, z], scale: [0.11, 0.145, 0.055], rotation: NONE, color: ink, furLength: 0 },
        { role: "eyeHighlight", mesh: "sphere", kind: "gloss", position: [x - 0.034, y + 0.055, z + 0.046], scale: [0.028, 0.028, 0.014], rotation: NONE, color: [1, 1, 1], furLength: 0 },
        { role: "eyeHighlight", mesh: "sphere", kind: "solid", position: [x + 0.115 * side, y + 0.075, z + 0.02], scale: [0.055, 0.02, 0.02], rotation: [0, 0, 0.38 * side], color: ink, furLength: 0 },
      );
      continue;
    }
    const scale: Vec3 = kind === "round" ? [0.13, 0.13, 0.055] : kind === "dot" ? [0.07, 0.07, 0.045] : [0.1, 0.145, 0.055];
    parts.push({ role: "eye", mesh: "sphere", kind: "gloss", position: [x, y, z], scale, rotation: NONE, color: ink, furLength: 0 });
    if (kind !== "dot") parts.push({ role: "eyeHighlight", mesh: "sphere", kind: "gloss", position: [x - 0.034, y + 0.055, z + 0.046], scale: [0.028, 0.028, 0.014], rotation: NONE, color: [1, 1, 1], furLength: 0 });
  }
  return parts;
}

function eyewear(kind: FigureEyewear, at: readonly [Vec3, Vec3], ink: Vec3): Part[] {
  if (kind === "none") return [];
  const [, y, z] = at[0];
  const dark = Math.max(...ink) < 0.5;
  const parts: Part[] = [];
  if (kind === "round") {
    for (const [x] of at) parts.push({ role: "eyewear", mesh: "torus", kind: "solid", position: [x, y, z + 0.05], scale: [0.21, 0.21, 0.21], rotation: NONE, color: ink, furLength: 0, tube: 0.09 });
    parts.push({ role: "eyewear", mesh: "sphere", kind: "solid", position: [0, y + 0.02, z + 0.05], scale: [0.13, 0.016, 0.016], rotation: NONE, color: ink, furLength: 0 });
    return parts;
  }
  if (kind === "square") {
    for (const [x] of at) {
      const s = Math.sign(x);
      parts.push(
        { role: "eyewear", mesh: "sphere", kind: "solid", position: [x, y + 0.16, z + 0.055], scale: [0.19, 0.022, 0.02], rotation: NONE, color: ink, furLength: 0 },
        { role: "eyewear", mesh: "sphere", kind: "solid", position: [x, y - 0.16, z + 0.055], scale: [0.19, 0.022, 0.02], rotation: NONE, color: ink, furLength: 0 },
        { role: "eyewear", mesh: "sphere", kind: "solid", position: [x + 0.18 * s, y, z + 0.055], scale: [0.022, 0.17, 0.02], rotation: NONE, color: ink, furLength: 0 },
        { role: "eyewear", mesh: "sphere", kind: "solid", position: [x - 0.18 * s, y, z + 0.055], scale: [0.022, 0.17, 0.02], rotation: NONE, color: ink, furLength: 0 },
      );
    }
    parts.push({ role: "eyewear", mesh: "sphere", kind: "solid", position: [0, y + 0.03, z + 0.055], scale: [0.14, 0.022, 0.02], rotation: NONE, color: ink, furLength: 0 });
    return parts;
  }
  if (kind === "heart") {
    const ruby: Vec3 = [0.48, 0.06, 0.19];
    const heartSil: Silhouette = { ...ROUND, notchTop: 0.35, pointBottom: 0.12, taperBottom: 0.55 };
    for (const [x] of at) parts.push({ role: "eyewear", mesh: "sphere", kind: "gloss", position: [x, y, z + 0.06], scale: [0.24, 0.21, 0.045], rotation: NONE, color: ruby, furLength: 0, silhouette: heartSil });
    parts.push({ role: "eyewear", mesh: "sphere", kind: "solid", position: [0, y + 0.03, z + 0.06], scale: [0.14, 0.022, 0.02], rotation: NONE, color: ruby, furLength: 0 });
    return parts;
  }
  if (kind === "star") {
    const amber: Vec3 = [0.96, 0.62, 0.04];
    const starSil: Silhouette = { ...ROUND, lobes: 5, lobeDepth: 0.2 };
    for (const [x] of at) parts.push({ role: "eyewear", mesh: "sphere", kind: "gloss", position: [x, y, z + 0.06], scale: [0.23, 0.23, 0.045], rotation: NONE, color: amber, furLength: 0, silhouette: starSil });
    parts.push({ role: "eyewear", mesh: "sphere", kind: "solid", position: [0, y + 0.02, z + 0.06], scale: [0.14, 0.022, 0.02], rotation: NONE, color: amber, furLength: 0 });
    return parts;
  }
  if (kind === "visor") {
    const cyan: Vec3 = [0.12, 0.72, 0.92];
    return [
      { role: "eyewear", mesh: "sphere", kind: "gloss", position: [0, y, z + 0.065], scale: [0.58, 0.14, 0.05], rotation: NONE, color: cyan, furLength: 0, silhouette: { ...ROUND, power: 3.6 } },
      { role: "eyewear", mesh: "sphere", kind: "solid", position: [0, y + 0.13, z + 0.07], scale: [0.55, 0.022, 0.03], rotation: NONE, color: ink, furLength: 0 },
    ];
  }
  const lens: Vec3 = dark ? [0.05, 0.05, 0.07] : [0.12, 0.12, 0.15];
  if (kind === "catEye") {
    const catSil: Silhouette = { ...ROUND, power: 2.6, taperBottom: 0.3 };
    for (const [x] of at)
      parts.push({
        role: "eyewear",
        mesh: "sphere",
        kind: "gloss",
        position: [x, y + 0.02, z + 0.06],
        scale: [0.24, 0.15, 0.045],
        rotation: [0, 0, 0.28 * Math.sign(x)],
        color: lens,
        furLength: 0,
        silhouette: catSil,
      });
    parts.push({ role: "eyewear", mesh: "sphere", kind: "solid", position: [0, y + 0.03, z + 0.06], scale: [0.14, 0.022, 0.02], rotation: NONE, color: lens, furLength: 0 });
    return parts;
  }
  for (const [x] of at) parts.push({ role: "eyewear", mesh: "sphere", kind: "gloss", position: [x, y, z + 0.06], scale: [0.23, 0.18, 0.045], rotation: NONE, color: lens, furLength: 0 });
  parts.push({ role: "eyewear", mesh: "sphere", kind: "solid", position: [0, y + 0.04, z + 0.06], scale: [0.14, 0.022, 0.02], rotation: NONE, color: lens, furLength: 0 });
  return parts;
}

const NEUTRAL: Vec3 = [0.15, 0.15, 0.17];
const GOLD: Vec3 = [0.95, 0.76, 0.36];
const LEAF: Vec3 = [0.2, 0.78, 0.35];
const PETAL: Vec3 = [1, 0.94, 0.96];
const CHEF: Vec3 = [0.96, 0.96, 0.98];
const PARTY: Vec3 = [0.66, 0.33, 0.97];
const CYAN: Vec3 = [0.12, 0.78, 0.96];

function accessory(kind: FigureAccessory, l: FigureLook, top: Vec3, eye: Vec3): Part[] {
  if (kind === "none") return [];
  const custom = l.accessoryColor ? rgb(l.accessoryColor) : null;
  const color =
    custom ??
    (kind === "crown" || kind === "halo"
      ? GOLD
      : kind === "sprout"
        ? LEAF
        : kind === "flower"
          ? PETAL
          : kind === "chef"
            ? CHEF
            : kind === "party"
              ? PARTY
              : NEUTRAL);
  const y = top[1] + FUR * 0.3;
  const piece = (mesh: PartMesh, kindOf: PartKind, position: Vec3, scale: Vec3, rotation: Vec3 = NONE, more: Partial<Part> = {}): Part => ({ role: "accessory", mesh, kind: kindOf, position, scale, rotation, color, furLength: 0, ...more });
  switch (kind) {
    case "beret":
      return [
        piece("sphere", "fur", [0.1, y + 0.02, 0.02], [0.62, 0.2, 0.58], [0, 0, -0.22], { furLength: 0.05 }),
        piece("sphere", "solid", [0.16, y + 0.22, 0.02], [0.05, 0.09, 0.05], [0, 0, -0.22]),
      ];
    case "beanie":
      return [
        piece("sphere", "fur", [0, y - 0.14, 0], [0.6, 0.52, 0.58], NONE, { furLength: 0.04 }),
        piece("sphere", "fur", [0, y + 0.42, 0], [0.13, 0.13, 0.13], NONE, { furLength: 0.07 }),
      ];
    case "bow":
      return [
        piece("cone", "solid", [-0.3, y + 0.12, 0.05], [0.16, 0.3, 0.09], [0, 0, -Math.PI / 2]),
        piece("cone", "solid", [0.3, y + 0.12, 0.05], [0.16, 0.3, 0.09], [0, 0, Math.PI / 2]),
        piece("sphere", "solid", [0, y + 0.12, 0.07], [0.07, 0.08, 0.07]),
      ];
    case "crown":
      return [
        piece("cylinder", "solid", [0, y - 0.03, 0], [0.34, 0.14, 0.34]),
        ...[0, 1, 2, 3, 4].map((i) => {
          const a = (i / 5) * Math.PI * 2 + Math.PI / 2;
          return piece("cone", "solid", [0.27 * Math.cos(a), y + 0.1, 0.27 * Math.sin(a)], [0.09, 0.2, 0.09]);
        }),
      ];
    case "hat":
      return [piece("sphere", "solid", [0, y + 0.01, 0], [0.64, 0.04, 0.62]), piece("cylinder", "solid", [0, y, 0], [0.36, 0.36, 0.36])];
    case "headphones": {
      // The band runs over the head from ear to ear; a cup on each side at the eyes' height.
      const reach = lookWidth(l, eye[1]) + FUR * 0.6;
      const rise = y + 0.1 - eye[1];
      return [
        piece("arc", "solid", [0, eye[1], 0], [reach, rise, reach], NONE, { tube: 0.05 }),
        piece("sphere", "solid", [-reach, eye[1], 0], [0.1, 0.2, 0.17]),
        piece("sphere", "solid", [reach, eye[1], 0], [0.1, 0.2, 0.17]),
      ];
    }
    case "halo":
      return [piece("torus", "gloss", [0, y + 0.22, 0], [0.46, 0.46, 0.46], [0, 1.32, 0], { tube: 0.13 })];
    case "cap":
      return [
        piece("sphere", "fur", [0, y - 0.1, 0], [0.58, 0.36, 0.56], NONE, { furLength: 0.03 }),
        piece("sphere", "solid", [0.22, y - 0.11, 0.32], [0.48, 0.045, 0.34], [0, 0.15, -0.06]),
        piece("sphere", "solid", [0, y + 0.25, 0], [0.06, 0.04, 0.06]),
      ];
    case "wizard":
      return [
        piece("sphere", "solid", [0, y + 0.01, 0], [0.68, 0.045, 0.64]),
        piece("cone", "solid", [0, y, 0], [0.38, 0.6, 0.38], [0, 0, -0.14]),
      ];
    case "flower":
      return [
        ...[0, 1, 2, 3, 4].map((i) => {
          const a = (i * Math.PI * 2) / 5 - Math.PI / 2;
          return piece("sphere", "solid", [0.34 + 0.14 * Math.cos(a), y + 0.06 + 0.14 * Math.sin(a), 0.22], [0.11, 0.11, 0.06]);
        }),
        piece("sphere", "gloss", [0.34, y + 0.06, 0.26], [0.09, 0.09, 0.06], NONE, { color: custom ?? GOLD }),
      ];
    case "sprout":
      return [
        piece("cylinder", "solid", [0, y - 0.02, 0], [0.035, 0.24, 0.035]),
        piece("sphere", "solid", [-0.14, y + 0.24, 0], [0.16, 0.055, 0.09], [0, 0, 0.35]),
        piece("sphere", "solid", [0.14, y + 0.25, 0], [0.16, 0.055, 0.09], [0, 0, -0.35]),
      ];
    case "horns":
      return [
        piece("cone", "gloss", [-0.36, y - 0.04, 0.04], [0.12, 0.32, 0.12], [0, 0, 0.38]),
        piece("cone", "gloss", [0.36, y - 0.04, 0.04], [0.12, 0.32, 0.12], [0, 0, -0.38]),
      ];
    case "chef":
      return [
        piece("cylinder", "solid", [0, y - 0.03, 0], [0.36, 0.16, 0.36]),
        piece("sphere", "fur", [0, y + 0.24, 0], [0.48, 0.26, 0.46], NONE, { furLength: 0.02, silhouette: { ...ROUND, lobes: 5, lobeDepth: 0.12 } }),
      ];
    case "antenna":
      return [
        piece("sphere", "solid", [0, y, 0], [0.14, 0.06, 0.14]),
        piece("cylinder", "solid", [0, y + 0.04, 0], [0.032, 0.32, 0.032]),
        piece("sphere", "gloss", [0, y + 0.4, 0], [0.11, 0.11, 0.11], NONE, { color: custom ?? CYAN }),
      ];
    case "party":
      return [
        piece("cone", "solid", [0, y - 0.03, 0], [0.28, 0.5, 0.28]),
        piece("sphere", "fur", [0, y + 0.5, 0], [0.1, 0.1, 0.1], NONE, { furLength: 0.05, color: custom ?? GOLD }),
      ];
  }
}

/** How far the camera sees from its center (y = 0.2), in body units. The usual frame, or more for a tall hat. */
export const REACH = 1.5;
export function reachFor(look: unknown): number {
  const top = Math.max(...partsFor(look).map((part) => part.position[1] + part.scale[1] + part.furLength));
  // Talking stretches the figure up to 9% and lifts it 0.04: what it wears must still be inside.
  return Math.max(REACH, top * 1.09 + 0.04 + 0.03 - 0.2);
}

/** What a hat-like accessory shades: where it sits and how far its shadow reaches. Null for what casts none. */
export function shadowOf(look: unknown): { center: Vec3; size: Vec3 } | null {
  const l = lookOrDefault(look);
  const size: Partial<Record<FigureAccessory, Vec3>> = {
    beret: [0.62, 0.36, 1.6],
    beanie: [0.6, 0.6, 1.6],
    hat: [0.64, 0.3, 1.6],
    crown: [0.36, 0.26, 1.6],
    cap: [0.6, 0.38, 1.6],
    wizard: [0.68, 0.32, 1.6],
    chef: [0.5, 0.36, 1.6],
    party: [0.3, 0.3, 1.6],
  };
  const reach = size[l.accessory];
  if (!reach) return null;
  const anchors = anchorsFor(l);
  const first = accessory(l.accessory, l, anchors.top, anchors.eyes[0])[0]!;
  return { center: first.position, size: reach };
}

/** The body's half width at a height. */
function lookWidth(l: FigureLook, y: number): number {
  const body = BODIES[l.shape];
  const v = Math.min(0.95, Math.abs(y / body.scale[1]));
  return body.scale[0] * Math.sqrt(1 - v * v);
}

export function partsFor(look: unknown): Part[] {
  const l = lookOrDefault(look);
  const body = BODIES[l.shape];
  const ink = rgb(eyeInk(l.color));
  const color = rgb(l.color);
  const anchors = anchorsFor(l);
  const parts: Part[] = [{ role: "body", mesh: "sphere", kind: "fur", position: NONE, scale: body.scale, rotation: NONE, color, furLength: FUR, silhouette: body.silhouette }];
  if (l.shape === "ears") for (const side of [-1, 1]) parts.push({ role: "ear", mesh: "sphere", kind: "fur", position: [0.66 * side, 0.72, 0], scale: [0.3, 0.3, 0.24], rotation: NONE, color, furLength: FUR });
  if (l.shape === "cat")
    for (const side of [-1, 1])
      parts.push({
        role: "ear",
        mesh: "sphere",
        kind: "fur",
        position: [0.58 * side, 0.72, 0],
        scale: [0.28, 0.42, 0.22],
        rotation: [0, 0, -0.34 * side],
        color,
        furLength: FUR,
        silhouette: { ...ROUND, power: 2.2, taperTop: 0.66, squashBottom: 0.22 },
      });
  return [...parts, ...eyes(l.eyes, anchors.eyes, ink), ...eyewear(l.eyewear, anchors.eyes, ink), ...accessory(l.accessory, l, anchors.top, anchors.eyes[0])];
}
