// The image modal still optimizes (spec local 2026-10-28-ficheros-al-nivel-de-claude-code, Jesús's decision 4):
// 2000 px on the long side and WebP 85, as /api/projects/[id]/assets always did; SVG and GIF as they are.
// Run: npx tsx --require ./scripts/test-node-server-only-shim.cjs --test lib/files/image-upload.node.spec.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { crc32, deflateSync } from "node:zlib";

import { optimizeImageForWeb } from "./image-upload";

/** A solid PNG of `w`×`h`, built by hand (RGB, no filter). */
function png(w: number, h: number): Uint8Array {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 0x80)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return new Uint8Array(
    Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]),
  );
}

describe("optimizeImageForWeb", () => {
  it("a 4000 px PNG becomes a 2000 px WebP", async () => {
    const r = await optimizeImageForWeb(png(4000, 20), "image/png");
    assert.ok(r, "optimized");
    assert.equal(r.ext, "webp");
    assert.equal(r.width, 2000);
    assert.equal(Buffer.from(r.bytes.subarray(0, 4)).toString("ascii"), "RIFF");
    assert.equal(Buffer.from(r.bytes.subarray(8, 12)).toString("ascii"), "WEBP");
  });

  it("SVG and GIF are not touched (null: keep the original)", async () => {
    assert.equal(await optimizeImageForWeb(new TextEncoder().encode("<svg/>"), "image/svg+xml"), null);
    assert.equal(await optimizeImageForWeb(Uint8Array.from([0x47, 0x49, 0x46]), "image/gif"), null);
  });

  it("bytes the pipeline can't read: null, and the original is kept", async () => {
    assert.equal(await optimizeImageForWeb(Uint8Array.from([1, 2, 3]), "image/jpeg"), null);
  });
});
