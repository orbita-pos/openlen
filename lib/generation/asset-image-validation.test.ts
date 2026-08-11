import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { beforeAll, describe, expect, it } from "vitest";

import { validateGeneratedImage } from "@/lib/generation/asset-image-validation";
import { processImage } from "@/lib/images";

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let value = 0; value < 256; value += 1) {
    let crc = value;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    table[value] = crc >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(kind: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(kind, "ascii"), data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, checksum]);
}

function validPng(width: number, height: number): Buffer {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  Buffer.from([8, 6, 0, 0, 0]).copy(ihdr, 8);
  const rowLength = 1 + width * 4;
  const pixels = Buffer.alloc(rowLength * height);
  for (let row = 0; row < height; row += 1) {
    const offset = row * rowLength;
    pixels[offset] = 0;
    for (let column = 0; column < width; column += 1) {
      const pixel = offset + 1 + column * 4;
      pixels[pixel] = 35;
      pixels[pixel + 1] = 85;
      pixels[pixel + 2] = 170;
      pixels[pixel + 3] = 255;
    }
  }
  return Buffer.concat([
    signature,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function headerOnlyPng(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  Buffer.from([8, 2, 0, 0, 0]).copy(bytes, 24);
  return bytes;
}

function headerOnlyJpeg(width: number, height: number): Buffer {
  return Buffer.from([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00,
    0xff, 0xc0, 0x00, 0x0b, 0x08,
    (height >>> 8) & 0xff, height & 0xff,
    (width >>> 8) & 0xff, width & 0xff,
    0x01, 0x01, 0x11, 0x00, 0xff, 0xd9,
  ]);
}

function headerOnlyWebp(width: number, height: number): Buffer {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0, "ascii");
  bytes.writeUInt32LE(22, 4);
  bytes.write("WEBPVP8X", 8, "ascii");
  bytes.writeUInt32LE(10, 16);
  bytes.writeUIntLE(width - 1, 24, 3);
  bytes.writeUIntLE(height - 1, 27, 3);
  return bytes;
}

const fixturePng = validPng(120, 80);
let fixtureJpeg: Buffer;
let fixtureWebp: Buffer;

function corruptPng(bytes: Buffer): Buffer {
  const corrupted = Buffer.from(bytes);
  const idat = corrupted.indexOf(Buffer.from("IDAT", "ascii"));
  corrupted[idat + 4] = 0;
  return corrupted;
}

function corruptJpeg(bytes: Buffer): Buffer {
  const sof = bytes.findIndex((byte, index) => byte === 0xff
    && index + 1 < bytes.length
    && bytes[index + 1] >= 0xc0
    && bytes[index + 1] <= 0xcf
    && ![0xc4, 0xc8, 0xcc].includes(bytes[index + 1]));
  const segmentLength = bytes.readUInt16BE(sof + 2);
  return Buffer.concat([bytes.subarray(0, sof + 2 + segmentLength), Buffer.from([0xff, 0xd9])]);
}

function corruptWebp(bytes: Buffer): Buffer {
  const corrupted = Buffer.from(bytes);
  corrupted[20] |= 1;
  return corrupted;
}

function truncatedWebp(bytes: Buffer): Buffer {
  const truncated = Buffer.from(bytes.subarray(0, Math.max(30, Math.floor(bytes.length / 2))));
  truncated.writeUInt32LE(truncated.length - 8, 4);
  truncated.writeUInt32LE(truncated.length - 20, 16);
  return truncated;
}

beforeAll(async () => {
  const { variants } = await processImage({
    input: fixturePng,
    variants: [
      { width: 0, format: "jpeg", quality: 90 },
      { width: 0, format: "webp", quality: 90 },
    ],
    autoOrient: false,
    withoutEnlargement: true,
  });
  fixtureJpeg = variants.find((variant) => variant.format === "jpeg")!.bytes;
  fixtureWebp = variants.find((variant) => variant.format === "webp")!.bytes;
});

describe("validateGeneratedImage", () => {
  it.each([
    ["PNG", () => fixturePng, "image/png", "png"],
    ["JPEG", () => fixtureJpeg, "image/jpeg", "jpg"],
    ["WebP", () => fixtureWebp, "image/webp", "webp"],
  ])("fully decodes a valid real %s fixture", async (_name, getBytes, mimeType, ext) => {
    const bytes = getBytes();
    await expect(validateGeneratedImage(bytes, mimeType)).resolves.toEqual({
      mimeType,
      ext,
      width: 120,
      height: 80,
      checksum: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
    });
  });

  it.each([
    ["header-only PNG", headerOnlyPng(120, 80), "image/png"],
    ["header-only JPEG", headerOnlyJpeg(120, 80), "image/jpeg"],
    ["header-only WebP", headerOnlyWebp(120, 80), "image/webp"],
  ])("rejects %s data that has parseable dimensions", async (_name, bytes, mimeType) => {
    await expect(Promise.resolve().then(() => validateGeneratedImage(bytes, mimeType))).rejects.toThrow("invalid_image_data");
  });

  it.each([
    ["PNG", () => fixturePng.subarray(0, -1), "image/png"],
    ["JPEG", () => fixtureJpeg.subarray(0, -1), "image/jpeg"],
    ["WebP", () => truncatedWebp(fixtureWebp), "image/webp"],
  ])("rejects truncated %s data with an intact dimension header", async (_name, getBytes, mimeType) => {
    await expect(Promise.resolve().then(() => validateGeneratedImage(getBytes(), mimeType))).rejects.toThrow("invalid_image_data");
  });

  it.each([
    ["PNG", () => corruptPng(fixturePng), "image/png"],
    ["JPEG", () => corruptJpeg(fixtureJpeg), "image/jpeg"],
    ["WebP", () => corruptWebp(fixtureWebp), "image/webp"],
  ])("rejects corrupt %s data with an intact dimension header", async (_name, getBytes, mimeType) => {
    await expect(Promise.resolve().then(() => validateGeneratedImage(getBytes(), mimeType))).rejects.toThrow("invalid_image_data");
  });

  it.each([
    [() => fixturePng, "image/jpeg"],
    [() => fixtureJpeg, "image/webp"],
    [() => fixtureWebp, "image/png"],
  ])("rejects when declared and actual image types disagree", async (getBytes, mimeType) => {
    await expect(Promise.resolve().then(() => validateGeneratedImage(getBytes(), mimeType))).rejects.toThrow("mime_type_mismatch");
  });

  it.each([
    [Buffer.from("<svg/>"), "image/svg+xml"],
    [Buffer.from("<?xml version='1.0'?><svg/>"), "application/xml"],
  ])("rejects SVG and XML rather than treating active content as an image", async (bytes, mimeType) => {
    await expect(Promise.resolve().then(() => validateGeneratedImage(bytes, mimeType))).rejects.toThrow("unsupported_image_type");
  });

  it.each([
    [headerOnlyPng(0, 630), "zero width"],
    [headerOnlyPng(1200, 0), "zero height"],
    [headerOnlyPng(63, 630), "width below the floor"],
    [headerOnlyPng(1200, 63), "height below the floor"],
    [headerOnlyPng(4097, 630), "oversized width"],
    [headerOnlyPng(1200, 4097), "oversized height"],
    [headerOnlyPng(100_000, 100_000), "decompression-bomb dimensions"],
  ])("rejects %s before decode", async (bytes) => {
    await expect(Promise.resolve().then(() => validateGeneratedImage(bytes, "image/png"))).rejects.toThrow("invalid_image_dimensions");
  });

  it("rejects empty bytes", async () => {
    await expect(Promise.resolve().then(() => validateGeneratedImage(Buffer.alloc(0), "image/png"))).rejects.toThrow("invalid_image_data");
  });

  it("rejects bytes above the 6 MiB cap before parsing", async () => {
    await expect(Promise.resolve().then(() => validateGeneratedImage(Buffer.alloc(6 * 1024 * 1024 + 1), "image/png"))).rejects.toThrow("image_too_large");
  });
});
