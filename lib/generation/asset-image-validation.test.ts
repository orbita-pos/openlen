import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { validateGeneratedImage } from "@/lib/generation/asset-image-validation";

function png(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes, 0);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  Buffer.from([8, 2, 0, 0, 0]).copy(bytes, 24);
  return bytes;
}

function jpeg(width: number, height: number): Buffer {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

function webpChunk(kind: "VP8X" | "VP8 " | "VP8L", payload: Buffer): Buffer {
  const padded = payload.length + (payload.length % 2);
  const bytes = Buffer.alloc(20 + padded);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(bytes.length - 8, 4);
  bytes.write("WEBP", 8, "ascii");
  bytes.write(kind, 12, "ascii");
  bytes.writeUInt32LE(payload.length, 16);
  payload.copy(bytes, 20);
  return bytes;
}

function webpVp8x(width: number, height: number): Buffer {
  const payload = Buffer.alloc(10);
  payload.writeUIntLE(width - 1, 4, 3);
  payload.writeUIntLE(height - 1, 7, 3);
  return webpChunk("VP8X", payload);
}

function webpVp8(width: number, height: number): Buffer {
  const payload = Buffer.from([
    0x00, 0x00, 0x00, 0x9d, 0x01, 0x2a,
    width & 0xff, (width >>> 8) & 0x3f,
    height & 0xff, (height >>> 8) & 0x3f,
  ]);
  return webpChunk("VP8 ", payload);
}

function webpVp8l(width: number, height: number): Buffer {
  const packed = ((width - 1) | ((height - 1) << 14)) >>> 0;
  const payload = Buffer.alloc(5);
  payload[0] = 0x2f;
  payload.writeUInt32LE(packed, 1);
  return webpChunk("VP8L", payload);
}

describe("validateGeneratedImage", () => {
  it.each([
    ["PNG IHDR", png(1200, 630), "image/png", "png"],
    ["JPEG SOF0", jpeg(1600, 900), "image/jpeg", "jpg"],
    ["WebP VP8X", webpVp8x(1024, 768), "image/webp", "webp"],
    ["WebP VP8", webpVp8(800, 600), "image/webp", "webp"],
    ["WebP VP8L", webpVp8l(640, 480), "image/webp", "webp"],
  ])("reads bounded dimensions from %s bytes", (_name, bytes, mimeType, ext) => {
    const result = validateGeneratedImage(bytes as Buffer, mimeType as string);
    const expected = {
      mimeType,
      ext,
      width: _name === "PNG IHDR" ? 1200 : _name === "JPEG SOF0" ? 1600 : _name === "WebP VP8X" ? 1024 : _name === "WebP VP8" ? 800 : 640,
      height: _name === "PNG IHDR" ? 630 : _name === "JPEG SOF0" ? 900 : _name === "WebP VP8X" ? 768 : _name === "WebP VP8" ? 600 : 480,
      checksum: `sha256:${createHash("sha256").update(bytes as Buffer).digest("hex")}`,
    };
    expect(result).toEqual(expected);
  });

  it.each([
    [png(1200, 630), "image/jpeg"],
    [jpeg(1200, 630), "image/webp"],
    [webpVp8x(1200, 630), "image/png"],
  ])("rejects when declared and actual image types disagree", (bytes, mimeType) => {
    expect(() => validateGeneratedImage(bytes, mimeType)).toThrow("mime_type_mismatch");
  });

  it.each([
    [Buffer.from("<svg/>"), "image/svg+xml"],
    [Buffer.from("<?xml version='1.0'?><svg/>") , "application/xml"],
  ])("rejects SVG and XML rather than treating active content as an image", (bytes, mimeType) => {
    expect(() => validateGeneratedImage(bytes, mimeType)).toThrow("unsupported_image_type");
  });

  it.each([
    [png(1200, 630).subarray(0, 28), "image/png"],
    [Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08]), "image/jpeg"],
    [webpVp8x(1200, 630).subarray(0, 25), "image/webp"],
  ])("rejects truncated image structures", (bytes, mimeType) => {
    expect(() => validateGeneratedImage(bytes, mimeType)).toThrow("invalid_image_data");
  });

  it.each([
    [png(0, 630), "zero width"],
    [png(1200, 0), "zero height"],
    [png(63, 630), "width below the floor"],
    [png(1200, 63), "height below the floor"],
    [png(4097, 630), "oversized width"],
    [png(1200, 4097), "oversized height"],
    [png(100_000, 100_000), "decompression-bomb dimensions"],
  ])("rejects %s", (bytes) => {
    expect(() => validateGeneratedImage(bytes, "image/png")).toThrow("invalid_image_dimensions");
  });

  it("accepts the exact maximum dimension and pixel boundary", () => {
    expect(validateGeneratedImage(png(4096, 4096), "image/png")).toMatchObject({ width: 4096, height: 4096 });
  });

  it("rejects empty bytes", () => {
    expect(() => validateGeneratedImage(Buffer.alloc(0), "image/png")).toThrow("invalid_image_data");
  });

  it("rejects bytes above the 6 MiB cap before parsing", () => {
    expect(() => validateGeneratedImage(Buffer.alloc(6 * 1024 * 1024 + 1), "image/png")).toThrow("image_too_large");
  });
});
