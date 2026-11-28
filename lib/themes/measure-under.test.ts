// @vitest-environment node
import { deflateSync, crc32 } from "node:zlib";

import { describe, expect, it } from "vitest";

import { stripMean } from "./measure-under";

/** A PNG the way Chromium writes one (8 bits, RGB, no interlace, filter 0 on every row), from a pixel function. */
function png(width: number, height: number, pixel: (x: number, y: number) => readonly [number, number, number]): Uint8Array {
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const at = y * (width * 3 + 1);
    rows[at] = 0;
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      rows.set([r, g, b], at + 1 + x * 3);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, "ascii");
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 0);
    return Buffer.concat([head, data, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return new Uint8Array(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]));
}

describe("stripMean", () => {
  it("is the mean colour of the chat panel's columns (x 64 to 444), and only those", () => {
    // Red up to the strip, white inside it, blue after it: only the white counts.
    const image = png(500, 10, (x) => (x < 64 ? [255, 0, 0] : x < 444 ? [255, 255, 255] : [0, 0, 255]));
    expect(stripMean(image)).toBe("#ffffff");
  });

  it("averages what is inside the strip", () => {
    // Left half of the strip black, right half white: grey.
    const image = png(500, 10, (x) => (x < 254 ? [0, 0, 0] : [255, 255, 255]));
    const hex = stripMean(image)!;
    expect(hex).toMatch(/^#[0-9a-f]{6}$/);
    const channel = parseInt(hex.slice(1, 3), 16);
    expect(channel).toBeGreaterThanOrEqual(126);
    expect(channel).toBeLessThanOrEqual(129);
  });

  it("is null when the picture is not wide enough to hold the strip, or is not a PNG", () => {
    expect(stripMean(png(300, 10, () => [10, 10, 10]))).toBeNull();
    expect(stripMean(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});
