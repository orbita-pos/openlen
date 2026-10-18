import { ArtifactError } from "../../types";
export function validateRenderPng(bytes: Uint8Array, width: number, height: number): void {
  const b = Buffer.from(bytes);
  if (b.length < 33 || b.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || b.subarray(12, 16).toString() !== "IHDR" || b.readUInt32BE(16) !== width || b.readUInt32BE(20) !== height || b.subarray(-8, -4).toString() !== "IEND") throw new ArtifactError("invalid_render_png");
}
