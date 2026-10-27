/**
 * What an image file of the box really is, by its first bytes, as Claude Code's Read checks before it
 * shows one (spec local 2026-10-27-len-pdf-skill): a name ending in .png can hold the error page a
 * download saved instead.
 */

/** Claude Code's Read takes these as images; a .bmp is a binary file to it. */
export const IMAGE_FILE = /\.(png|jpe?g|gif|webp)$/i;

/** Claude Code's limit for an image Read, checked on the size before reading (134217728 bytes). */
export const MAX_IMAGE_READ_BYTES = 128 * 1024 * 1024;

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));

/** The image's type by its magic bytes, or null when they are not a PNG, JPEG, GIF or WebP. */
export function imageTypeOf(bytes: Uint8Array): "png" | "jpeg" | "gif" | "webp" | null {
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  if (bytes.length >= 6 && /^GIF8[79]a$/.test(ascii(bytes, 0, 6))) return "gif";
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "webp";
  return null;
}

/** What the bytes look like instead, in Claude Code's words. */
export function describeNonImage(bytes: Uint8Array): string {
  const head = bytes.subarray(0, 32);
  const text = String.fromCharCode(...head).replace(/[^\x20-\x7e]/g, ".");
  const lower = text.toLowerCase();
  if (lower.includes("<!doctype") || lower.includes("<html")) return `HTML document (starts with "${text.slice(0, 24)}")`;
  if (lower.startsWith("<?xml") || lower.startsWith("<svg")) return `XML/SVG document (starts with "${text.slice(0, 24)}")`;
  if (lower.startsWith("{") || lower.startsWith("[")) return `JSON/text (starts with "${text.slice(0, 24)}")`;
  if (ascii(head, 0, 5) === "%PDF-") return "PDF document";
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return "ZIP archive (Office documents such as .pptx/.docx/.xlsx are ZIPs)";
  const hex = [...head.subarray(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join(" ");
  return `unrecognized bytes (hex: ${hex})`;
}

/** Claude Code's three refusals, with Len's terminal tool (`bash`) where it names its own. */
export const imageTooLarge = (path: string, limit: string) =>
  `File is too large to read as an image (the limit is ${limit}): ${path}. If it is an image, resize it or export a smaller copy, then read that.`;
export const imageEmpty = (path: string) => `Image file is empty: ${path}`;
export const notAnImage = (path: string, bytes: Uint8Array) =>
  `File has an image extension but its content is not a valid PNG/JPEG/GIF/WebP. Detected: ${describeNonImage(bytes)}. This usually means a download saved an error/login page instead of the image. Use \`file "${path}"\` to confirm, or read it as text with bash (e.g. \`head -c 500\`).`;
