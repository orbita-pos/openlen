import { createHash } from "node:crypto";

const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MIN_DIMENSION = 64;
const MAX_DIMENSION = 4096;
const MAX_PIXELS = 16_777_216;

type SupportedImageMimeType = "image/png" | "image/jpeg" | "image/webp";

export interface ValidatedImage {
  mimeType: SupportedImageMimeType;
  ext: "png" | "jpg" | "webp";
  width: number;
  height: number;
  checksum: string;
}

function invalid(code: string): never {
  throw new Error(code);
}

function isPng(bytes: Buffer): boolean {
  return bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
}

function pngDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 33 || bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") {
    return invalid("invalid_image_data");
  }
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function isJpeg(bytes: Buffer): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

function jpegDimensions(bytes: Buffer): { width: number; height: number } {
  let offset = 2;
  let traversed = 0;
  while (offset < bytes.length && traversed < 128) {
    if (bytes[offset] !== 0xff) return invalid("invalid_image_data");
    while (offset < bytes.length && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.length) return invalid("invalid_image_data");
    const marker = bytes[offset];
    offset += 1;
    traversed += 1;

    if (marker === 0xd9 || marker === 0xda) return invalid("invalid_image_data");
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return invalid("invalid_image_data");
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return invalid("invalid_image_data");

    const isStartOfFrame = (marker >= 0xc0 && marker <= 0xcf)
      && ![0xc4, 0xc8, 0xcc].includes(marker);
    if (isStartOfFrame) {
      if (segmentLength < 8 || offset + 7 > bytes.length) return invalid("invalid_image_data");
      return { width: bytes.readUInt16BE(offset + 5), height: bytes.readUInt16BE(offset + 3) };
    }
    offset += segmentLength;
  }
  return invalid("invalid_image_data");
}

function isWebp(bytes: Buffer): boolean {
  return bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP";
}

function webpDimensions(bytes: Buffer): { width: number; height: number } {
  if (bytes.length < 20 || bytes.readUInt32LE(4) + 8 !== bytes.length) return invalid("invalid_image_data");
  const kind = bytes.toString("ascii", 12, 16);
  const chunkLength = bytes.readUInt32LE(16);
  if (20 + chunkLength + (chunkLength % 2) > bytes.length) return invalid("invalid_image_data");

  if (kind === "VP8X") {
    if (chunkLength < 10) return invalid("invalid_image_data");
    return { width: bytes.readUIntLE(24, 3) + 1, height: bytes.readUIntLE(27, 3) + 1 };
  }
  if (kind === "VP8 ") {
    if (chunkLength < 10 || bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) {
      return invalid("invalid_image_data");
    }
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  if (kind === "VP8L") {
    if (chunkLength < 5 || bytes[20] !== 0x2f) return invalid("invalid_image_data");
    const packed = bytes.readUInt32LE(21);
    return { width: (packed & 0x3fff) + 1, height: ((packed >>> 14) & 0x3fff) + 1 };
  }
  return invalid("invalid_image_data");
}

export function validateGeneratedImage(input: Uint8Array, declaredMimeType: string): ValidatedImage {
  if (declaredMimeType !== "image/png" && declaredMimeType !== "image/jpeg" && declaredMimeType !== "image/webp") {
    return invalid("unsupported_image_type");
  }
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (bytes.length > MAX_IMAGE_BYTES) return invalid("image_too_large");
  if (bytes.length === 0) return invalid("invalid_image_data");

  let actualMimeType: SupportedImageMimeType;
  let dimensions: { width: number; height: number };
  let ext: ValidatedImage["ext"];
  if (isPng(bytes)) {
    actualMimeType = "image/png";
    dimensions = pngDimensions(bytes);
    ext = "png";
  } else if (isJpeg(bytes)) {
    actualMimeType = "image/jpeg";
    dimensions = jpegDimensions(bytes);
    ext = "jpg";
  } else if (isWebp(bytes)) {
    actualMimeType = "image/webp";
    dimensions = webpDimensions(bytes);
    ext = "webp";
  } else {
    return invalid("invalid_image_data");
  }

  if (actualMimeType !== declaredMimeType) return invalid("mime_type_mismatch");
  const { width, height } = dimensions;
  if (width < MIN_DIMENSION || height < MIN_DIMENSION || width > MAX_DIMENSION || height > MAX_DIMENSION || width * height > MAX_PIXELS) {
    return invalid("invalid_image_dimensions");
  }
  return {
    mimeType: actualMimeType,
    ext,
    width,
    height,
    checksum: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
  };
}
