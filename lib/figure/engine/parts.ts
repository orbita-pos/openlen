// FROM A LOOK, THE PIECES TO DRAW (spec local 2026-11-10-figuras-del-asistente, §5.1–5.2). Pure: no WebGL here,
// so what a look is made of can be tested without a browser.
//
// Units are the body's: its radius is about 1, +y is up, +z comes toward the camera.
import { eyeInk, lookOrDefault, rgb } from "../look";

export type PartKind = "fur" | "solid" | "gloss";
export type PartMesh = "sphere";
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
}

export const ROUND: Silhouette = { power: 2, lobes: 0, lobeDepth: 0, notchTop: 0, pointBottom: 0, taperBottom: 0, taperTop: 0, squashBottom: 0, widenBottom: 0 };
export const FUR = 0.13;

const NONE: Vec3 = [0, 0, 0];

export function partsFor(look: unknown): Part[] {
  const l = lookOrDefault(look);
  const ink = rgb(eyeInk(l.color));
  const z = 0.93;
  const parts: Part[] = [{ role: "body", mesh: "sphere", kind: "fur", position: NONE, scale: [1, 0.95, 0.9], rotation: NONE, color: rgb(l.color), furLength: FUR, silhouette: ROUND }];
  for (const side of [-1, 1]) {
    parts.push({ role: "eye", mesh: "sphere", kind: "gloss", position: [0.3 * side, 0.1, z], scale: [0.085, 0.115, 0.05], rotation: NONE, color: ink, furLength: 0 });
    parts.push({ role: "eyeHighlight", mesh: "sphere", kind: "gloss", position: [0.3 * side - 0.028, 0.145, z + 0.042], scale: [0.022, 0.022, 0.012], rotation: NONE, color: [1, 1, 1], furLength: 0 });
  }
  return parts;
}
