// Node smoke tests for the @openlen/images napi binding. Hits the real
// `.node` binary; mirrors the high-value Rust tests so the JS surface is
// exercised end-to-end including Buffer marshalling, async resolution,
// and the JSON error envelope.

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { deflateSync } from "node:zlib";

import { processImage } from "../index.js";

// PNG fixture generator. Cheaper than baking base64 in (multiple sizes
// without bloating the test file) and avoids a `node-png` dependency.
// Implements just enough of the PNG spec to emit a valid RGBA solid-color
// file: 8-byte signature → IHDR → one zlib-compressed IDAT → IEND.

const CRC_TABLE = (() => {
  const tbl = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    tbl[n] = c >>> 0;
  }
  return tbl;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const td = Buffer.concat([t, data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, c]);
}

function makePng(w, h, [r, g, b, a]) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.writeUInt8(8, 8);   // bit depth
  ihdr.writeUInt8(6, 9);   // colour type: RGBA
  ihdr.writeUInt8(0, 10);  // compression
  ihdr.writeUInt8(0, 11);  // filter
  ihdr.writeUInt8(0, 12);  // interlace: none
  const rowLen = 1 + w * 4;
  const raw = Buffer.alloc(h * rowLen);
  for (let y = 0; y < h; y++) {
    const base = y * rowLen;
    raw[base] = 0; // filter byte: None
    for (let x = 0; x < w; x++) {
      const off = base + 1 + x * 4;
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
      raw[off + 3] = a;
    }
  }
  const idat = deflateSync(raw);
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const RED_10x10_PNG = makePng(10, 10, [255, 0, 0, 255]);
const BLUE_200x100_PNG = makePng(200, 100, [30, 60, 180, 255]);

function parseEnvelope(err) {
  return JSON.parse(err.message);
}

test("processImage with a single webp variant returns matching dims", async () => {
  const result = await processImage({
    input: RED_10x10_PNG,
    variants: [{ width: 10, format: "webp", quality: 80 }],
    autoOrient: false,
    withoutEnlargement: true,
  });
  assert.equal(result.variants.length, 1);
  const v = result.variants[0];
  assert.equal(v.width, 10);
  assert.equal(v.height, 10);
  assert.equal(v.format, "webp");
  assert.equal(v.mime, "image/webp");
  assert.ok(Buffer.isBuffer(v.bytes));
  assert.ok(v.bytes.length > 12);
  assert.equal(v.bytes.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(v.bytes.subarray(8, 12).toString("ascii"), "WEBP");
  assert.equal(v.size, v.bytes.length);
});

test("processImage with multiple formats at one width returns all", async () => {
  const result = await processImage({
    input: RED_10x10_PNG,
    variants: [
      { width: 10, format: "webp", quality: 80 },
      { width: 10, format: "avif", quality: 65 },
      { width: 10, format: "jpeg", quality: 85 },
      { width: 10, format: "png", quality: 0 },
    ],
    autoOrient: false,
    withoutEnlargement: true,
  });
  assert.equal(result.variants.length, 4);
  const formats = result.variants.map((v) => v.format);
  assert.deepEqual(formats, ["webp", "avif", "jpeg", "png"]);
  for (const v of result.variants) {
    assert.equal(v.width, 10);
    assert.equal(v.height, 10);
    assert.ok(v.bytes.length > 0, `${v.format} produced empty output`);
  }
  // Format-specific magic bytes.
  const webp = result.variants[0];
  assert.equal(webp.bytes.subarray(0, 4).toString("ascii"), "RIFF");
  const avif = result.variants[1];
  assert.equal(avif.bytes.subarray(4, 8).toString("ascii"), "ftyp");
  const jpeg = result.variants[2];
  assert.equal(jpeg.bytes[0], 0xff);
  assert.equal(jpeg.bytes[1], 0xd8);
  const png = result.variants[3];
  assert.deepEqual(
    Array.from(png.bytes.subarray(0, 4)),
    [0x89, 0x50, 0x4e, 0x47],
  );
});

test("processImage withoutEnlargement clamps to original width", async () => {
  // Input is 10×10; asking for 200w with withoutEnlargement should
  // keep the output at 10×10.
  const result = await processImage({
    input: RED_10x10_PNG,
    variants: [{ width: 200, format: "webp", quality: 80 }],
    autoOrient: false,
    withoutEnlargement: true,
  });
  assert.equal(result.variants[0].width, 10);
  assert.equal(result.variants[0].height, 10);
});

test("processImage with width 0 uses original size", async () => {
  const result = await processImage({
    input: RED_10x10_PNG,
    variants: [{ width: 0, format: "png", quality: 0 }],
    autoOrient: false,
    withoutEnlargement: false,
  });
  assert.equal(result.variants[0].width, 10);
  assert.equal(result.variants[0].height, 10);
});

test("processImage defaults autoOrient + withoutEnlargement to true", async () => {
  // Omitting both flags should still work and behave as if true. The
  // 10×10 input means withoutEnlargement clamps 200→10.
  const result = await processImage({
    input: RED_10x10_PNG,
    variants: [{ width: 200, format: "webp", quality: 80 }],
  });
  assert.equal(result.variants[0].width, 10);
});

test("processImage rejects empty input with envelope", async () => {
  await assert.rejects(
    processImage({
      input: Buffer.alloc(0),
      variants: [{ width: 10, format: "webp", quality: 80 }],
    }),
    (err) => {
      const env = parseEnvelope(err);
      assert.equal(env.kind, "invalid_input");
      assert.equal(env.retryable, false);
      assert.ok(env.message.length > 0);
      return true;
    },
  );
});

test("processImage rejects corrupt input with decode envelope", async () => {
  await assert.rejects(
    processImage({
      input: Buffer.from("not actually an image"),
      variants: [{ width: 10, format: "webp", quality: 80 }],
    }),
    (err) => {
      const env = parseEnvelope(err);
      assert.equal(env.kind, "decode");
      assert.equal(env.retryable, false);
      return true;
    },
  );
});

test("processImage rejects empty variants with envelope", async () => {
  await assert.rejects(
    processImage({
      input: RED_10x10_PNG,
      variants: [],
    }),
    (err) => {
      const env = parseEnvelope(err);
      assert.equal(env.kind, "invalid_input");
      return true;
    },
  );
});

test("processImage rejects unknown format with envelope", async () => {
  await assert.rejects(
    processImage({
      input: RED_10x10_PNG,
      variants: [{ width: 10, format: "bmp", quality: 80 }],
    }),
    (err) => {
      const env = parseEnvelope(err);
      assert.equal(env.kind, "invalid_input");
      assert.ok(env.message.toLowerCase().includes("bmp"));
      return true;
    },
  );
});

test("processImage accepts 'jpg' as alias for 'jpeg'", async () => {
  const result = await processImage({
    input: RED_10x10_PNG,
    variants: [{ width: 10, format: "jpg", quality: 85 }],
    autoOrient: false,
  });
  assert.equal(result.variants[0].format, "jpeg");
  assert.equal(result.variants[0].mime, "image/jpeg");
});

test("processImage accepts case-insensitive format strings", async () => {
  const result = await processImage({
    input: RED_10x10_PNG,
    variants: [{ width: 10, format: "WEBP", quality: 80 }],
    autoOrient: false,
  });
  assert.equal(result.variants[0].format, "webp");
});

test("processImage with non-square input preserves aspect ratio on resize", async () => {
  // 200×100 input → request three target widths. Each output's height
  // should be exactly half the width (matches the 2:1 source aspect).
  const result = await processImage({
    input: BLUE_200x100_PNG,
    variants: [
      { width: 200, format: "webp", quality: 80 },
      { width: 100, format: "webp", quality: 80 },
      { width: 40, format: "webp", quality: 80 },
    ],
    autoOrient: false,
    withoutEnlargement: true,
  });
  assert.deepEqual(
    result.variants.map((v) => [v.width, v.height]),
    [
      [200, 100],
      [100, 50],
      [40, 20],
    ],
  );
});

test("processImage returns mime matching format for every variant", async () => {
  const result = await processImage({
    input: RED_10x10_PNG,
    variants: [
      { width: 10, format: "webp", quality: 80 },
      { width: 10, format: "avif", quality: 65 },
      { width: 10, format: "jpeg", quality: 85 },
      { width: 10, format: "png", quality: 0 },
    ],
    autoOrient: false,
  });
  const expected = {
    webp: "image/webp",
    avif: "image/avif",
    jpeg: "image/jpeg",
    png: "image/png",
  };
  for (const v of result.variants) {
    assert.equal(v.mime, expected[v.format]);
  }
});

test("processImage with placeholder:true returns a populated placeholder", async () => {
  const result = await processImage({
    input: BLUE_200x100_PNG,
    variants: [{ width: 100, format: "webp", quality: 80 }],
    autoOrient: false,
    placeholder: true,
  });
  assert.ok(result.placeholder, "expected result.placeholder to be set");
  const p = result.placeholder;
  assert.equal(typeof p.blurhash, "string");
  assert.ok(p.blurhash.length >= 10, `unexpected blurhash length ${p.blurhash.length}`);
  assert.match(p.dominantColor, /^#[0-9a-f]{6}$/);
  assert.notEqual(p.dominantColor, "#000000");
  // 200×100 input → 32×16 thumb (longest-edge scaling).
  assert.equal(p.width, 32);
  assert.equal(p.height, 16);
});

test("processImage without placeholder flag leaves result.placeholder absent", async () => {
  const result = await processImage({
    input: BLUE_200x100_PNG,
    variants: [{ width: 100, format: "webp", quality: 80 }],
    autoOrient: false,
  });
  // napi omits the property when None — `placeholder in result` is the
  // strict check; checking == undefined catches both absent and explicit.
  assert.equal(result.placeholder, undefined);
});

test("processImage with alphaQuality routes WebP through encode_advanced", async () => {
  // Transparent input exercises the alpha path; alphaQuality 95 with a
  // low color quality 40 routes through the libwebp WebPConfig branch.
  const TRANSPARENT_PNG = makePng(16, 16, [220, 60, 60, 128]);
  const result = await processImage({
    input: TRANSPARENT_PNG,
    variants: [{ width: 16, format: "webp", quality: 40, alphaQuality: 95 }],
    autoOrient: false,
  });
  assert.equal(result.variants.length, 1);
  const v = result.variants[0];
  assert.equal(v.format, "webp");
  assert.equal(v.bytes.subarray(0, 4).toString("ascii"), "RIFF");
  assert.ok(v.bytes.length > 12);
});

test("processImage placeholder dimensions track the oriented base", async () => {
  // 200×100 landscape → 32×16. Verifies the placeholder thumb is
  // computed from the SAME oriented base buffer the variants pipeline
  // resizes from (not the raw decoded image), so EXIF rotation would
  // flow through correctly when present.
  const result = await processImage({
    input: BLUE_200x100_PNG,
    variants: [{ width: 100, format: "webp", quality: 80 }],
    autoOrient: true,
    placeholder: true,
  });
  assert.ok(result.placeholder);
  assert.equal(result.placeholder.width, 32);
  assert.equal(result.placeholder.height, 16);
});
