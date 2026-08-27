// Tests for the publish-time responsive-image bake — variant fan-out via the
// Rust @openlen/images pipeline + DOM rewrite via the Rust html-engine pass.
// The pure candidate collector is tested in isolation; the full bake runs
// against a tmp-dir assets layout with generated PNG fixtures.
//
// Run via: npx tsx --test lib/publish/image-bake.test.ts
//
// Prerequisites (same contract as html-engine.test.ts):
//   cd crates/html-engine && npm run build
//   cd crates/images && npm run build

import { test } from "node:test";
import { strict as assert } from "node:assert";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { deflateSync } from "node:zlib";

import { bakeResponsiveImages, classifySource, collectImgSrcCandidates } from "./image-bake";

// ─── PNG fixture generator ───────────────────────────────────────────────────
// Same minimal RGBA solid-color PNG writer as crates/images/__test__/
// process-image.test.mjs — multiple sizes without baking base64 blobs in.

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

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, c]);
}

function makePng(w: number, h: number, [r, g, b, a]: number[]): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.writeUInt8(8, 8);
  ihdr.writeUInt8(6, 9);
  ihdr.writeUInt8(0, 10);
  ihdr.writeUInt8(0, 11);
  ihdr.writeUInt8(0, 12);
  const rowLen = 1 + w * 4;
  const raw = Buffer.alloc(h * rowLen);
  for (let y = 0; y < h; y++) {
    const base = y * rowLen;
    raw[base] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const px = base + 1 + x * 4;
      raw[px] = r;
      raw[px + 1] = g;
      raw[px + 2] = b;
      raw[px + 3] = a;
    }
  }
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ─── Harness ────────────────────────────────────────────────────────────────

async function makeSubDir(): Promise<string> {
  const subDir = await mkdtemp(path.join(tmpdir(), "image-bake-"));
  await mkdir(path.join(subDir, "assets"), { recursive: true });
  return subDir;
}

async function withSubDir<T>(fn: (subDir: string) => Promise<T>): Promise<T> {
  const subDir = await makeSubDir();
  try {
    return await fn(subDir);
  } finally {
    await rm(subDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ─── collectImgSrcCandidates (pure) ─────────────────────────────────────────

test("collect: document order, dedupe, both quote styles", () => {
  const html = `
    <img src="/assets/a.png">
    <img src='/assets/b.png'>
    <img src="/assets/a.png">
  `;
  assert.deepEqual(collectImgSrcCandidates(html), [
    "/assets/a.png",
    "/assets/b.png",
  ]);
});

test("collect: imgs with an author srcset are skipped", () => {
  const html =
    '<img src="/assets/a.png" srcset="/assets/a-400.png 400w"><img src="/assets/b.png">';
  assert.deepEqual(collectImgSrcCandidates(html), ["/assets/b.png"]);
});

test("collect: entity-encoded URLs are decoded", () => {
  const html =
    '<img src="https://images.unsplash.com/photo?a=1&amp;w=2">';
  assert.deepEqual(collectImgSrcCandidates(html), [
    "https://images.unsplash.com/photo?a=1&w=2",
  ]);
});

test("collect: imgs without src are ignored", () => {
  assert.deepEqual(collectImgSrcCandidates("<img alt='x'><img src=''>"), []);
});

// ─── Full bake ──────────────────────────────────────────────────────────────

test("bake: local hero gets srcset/sizes/dimensions, hero preload, below-fold lazy", async () => {
  await withSubDir(async (subDir) => {
    await writeFile(
      path.join(subDir, "assets", "hero.png"),
      makePng(1200, 800, [200, 30, 30, 255]),
    );
    await writeFile(
      path.join(subDir, "assets", "logo.png"),
      makePng(200, 80, [30, 30, 200, 255]),
    );
    const html = [
      "<html><head></head><body>",
      '<img src="/assets/logo.png" alt="logo">',
      '<img src="/assets/hero.png" alt="hero">',
      '<img src="/assets/hero.png" alt="again">',
      "</body></html>",
    ].join("");

    const r = await bakeResponsiveImages({ html, subDir });
    assert.equal(r.rewritten, 3);
    assert.equal(r.heroSrc, "/assets/hero.png");
    assert.equal(r.lazied, 1);

    // 1400/2000 targets clamp to the 1200px intrinsic width and dedupe.
    assert.match(r.html, /srcset="[^"]*-400w\.webp 400w, [^"]*-800w\.webp 800w, [^"]*-1200w\.webp 1200w"/);
    assert.ok(r.html.includes('width="1200"'));
    assert.ok(r.html.includes('height="800"'));
    assert.ok(r.html.includes('fetchpriority="high"'));
    assert.ok(r.html.includes("data-ol-img-preload"));
    assert.ok(r.html.includes('sizes="100vw"'));
    assert.ok(r.html.includes('sizes="auto, 100vw"'));
    assert.ok(r.html.includes('loading="lazy"'));
    // No original src survives.
    assert.ok(!r.html.includes("/assets/hero.png"));

    // Variant files + sidecars actually landed on disk.
    const variantRe = /\/assets\/([a-f0-9]{16}-\d+w\.webp)/g;
    const files = new Set([...r.html.matchAll(variantRe)].map((m) => m[1]));
    assert.ok(files.size >= 4); // 3 hero widths + ≥1 logo width
    for (const f of files) {
      await stat(path.join(subDir, "assets", f));
    }

    // AVIF: the <img> is wrapped in a <picture> with an AVIF <source>, the
    // hero preload is AVIF-typed, and the .avif variant files landed on disk.
    assert.ok(r.html.includes("<picture>"), "expected <picture> wrapping");
    assert.match(
      r.html,
      /<source type="image\/avif" srcset="[^"]*-400w\.avif 400w, [^"]*-800w\.avif 800w, [^"]*-1200w\.avif 1200w"/,
    );
    assert.match(
      r.html,
      /<link rel="preload" as="image" type="image\/avif" imagesrcset="[^"]*\.avif/,
    );
    const avifFiles = new Set(
      [...r.html.matchAll(/\/assets\/([a-f0-9]{16}-\d+w\.avif)/g)].map((m) => m[1]),
    );
    assert.ok(avifFiles.size >= 3, `expected ≥3 AVIF variants, got ${avifFiles.size}`);
    for (const f of avifFiles) {
      await stat(path.join(subDir, "assets", f));
    }
  });
});

test("bake: small-only page gets variants but no hero treatment", async () => {
  await withSubDir(async (subDir) => {
    await writeFile(
      path.join(subDir, "assets", "logo.png"),
      makePng(200, 80, [0, 0, 0, 255]),
    );
    const html =
      '<html><head></head><body><img src="/assets/logo.png"></body></html>';
    const r = await bakeResponsiveImages({ html, subDir });
    assert.equal(r.rewritten, 1);
    assert.equal(r.heroSrc, null);
    assert.ok(!r.html.includes("fetchpriority"));
    assert.ok(!r.html.includes("data-ol-img-preload"));
    assert.match(r.html, /srcset="[^"]*-200w\.webp 200w"/);
    assert.ok(r.html.includes('width="200"'));
  });
});

test("bake: republish reuses the sidecar — no re-encode, identical output", async () => {
  await withSubDir(async (subDir) => {
    await writeFile(
      path.join(subDir, "assets", "hero.png"),
      makePng(1200, 800, [10, 120, 10, 255]),
    );
    const html =
      '<html><head></head><body><img src="/assets/hero.png"></body></html>';

    const first = await bakeResponsiveImages({ html, subDir });
    const variant = /\/assets\/([a-f0-9]{16}-1200w\.webp)/.exec(first.html);
    assert.ok(variant);
    const variantPath = path.join(subDir, "assets", variant[1]);
    const before = (await stat(variantPath)).mtimeMs;

    const second = await bakeResponsiveImages({ html, subDir });
    assert.equal(second.html, first.html);
    // The sidecar short-circuits before any write — mtime untouched.
    assert.equal((await stat(variantPath)).mtimeMs, before);
  });
});

test("bake: foreign hosts, data URIs and extension-less GIF bytes pass through", async () => {
  await withSubDir(async (subDir) => {
    // GIF magic under a neutral extension — classify lets it through, the
    // byte sniff rejects it.
    await writeFile(
      path.join(subDir, "assets", "sneaky.bin"),
      Buffer.from("GIF89a-not-really-a-gif"),
    );
    const html = [
      "<html><head></head><body>",
      '<img src="https://evil.example.com/x.jpg">',
      '<img src="data:image/png;base64,AAAA">',
      '<img src="/assets/missing.png">',
      '<img src="/assets/sneaky.bin">',
      "</body></html>",
    ].join("");
    const r = await bakeResponsiveImages({ html, subDir });
    assert.equal(r.html, html);
    assert.equal(r.rewritten, 0);
  });
});

test("bake: corrupt image bytes degrade to the original markup", async () => {
  await withSubDir(async (subDir) => {
    await writeFile(
      path.join(subDir, "assets", "broken.png"),
      Buffer.from("definitely not a png"),
    );
    const html =
      '<html><head></head><body><img src="/assets/broken.png"></body></html>';
    const r = await bakeResponsiveImages({ html, subDir });
    assert.equal(r.html, html);
    assert.equal(r.rewritten, 0);
  });
});

test("bake: page without bakeable images returns input verbatim", async () => {
  await withSubDir(async (subDir) => {
    const html = "<html><head></head><body><p>no images</p></body></html>";
    const r = await bakeResponsiveImages({ html, subDir });
    assert.equal(r.html, html);
    assert.equal(r.rewritten, 0);
  });
});

// ─── Las subidas del PROPIO dueño ────────────────────────────────────────────
//
// EL FALLO. En desarrollo no hay R2, así que nuestro propio subidor devuelve
// `http://localhost:3000/api/projects/<id>/assets/<fichero>`. Ese host no está
// —ni puede estar— en la lista de hosts remotos permitidos, así que el horneado
// lo ignoraba y la URL salía TAL CUAL al HTML publicado: imagen rota para
// cualquier visitante, y en silencio (el flight-check mide velocidad, no
// imágenes).
//
// MEDIDO el 2026-08-27: Jesús adjuntó una foto suya y el Agente se negó a
// colocarla diciendo que esa URL «sólo existe en tu máquina». Tenía razón en el
// fondo, y su remedio —«súbela desde el tab Contenido»— era el MISMO subidor.
// El defecto era nuestro.
//
// Se reconoce por la RUTA, no por el host: vale para localhost en dev, para una
// instalación autoalojada con dominio propio, y para el día que el host cambie.

test("una subida propia se reconoce por su RUTA, no por su host", () => {
  assert.deepEqual(
    classifySource("http://localhost:3000/api/projects/p1/assets/casa.png"),
    { kind: "propia", projectId: "p1", filename: "casa.png" },
  );
  // Un host cualquiera con la misma ruta: la instalación autoalojada.
  assert.deepEqual(
    classifySource("https://mi-openlen.example.com/api/projects/p1/assets/casa.png"),
    { kind: "propia", projectId: "p1", filename: "casa.png" },
  );
});

test("y gana a la lista de hosts, que es lo que la dejaba fuera", () => {
  // localhost NUNCA estará en allowedRemoteHosts — por eso la ruta va antes.
  const r = classifySource("http://localhost:3000/api/projects/p1/assets/x.webp");
  assert.notEqual(r, null);
  assert.equal(r?.kind, "propia");
});

test("un SVG o un GIF siguen sin hornearse, subida propia o no", () => {
  assert.equal(classifySource("http://localhost:3000/api/projects/p1/assets/a.svg"), null);
  assert.equal(classifySource("http://localhost:3000/api/projects/p1/assets/a.gif"), null);
});

test("y una ruta que sólo se le PARECE no cuenta como nuestra", () => {
  // Sin el tramo /assets/ no es una subida; y un host ajeno con una ruta
  // parecida pero mal formada cae en la lista de hosts, que lo rechaza.
  assert.equal(classifySource("http://localhost:3000/api/projects/p1/casa.png"), null);
  assert.equal(
    classifySource("https://evil.example.com/api/projects/p1/assets/../../etc/passwd"),
    null,
  );
});

test("lo de siempre no cambia: /assets/ local y los hosts permitidos", () => {
  assert.deepEqual(classifySource("/assets/hero.webp"), { kind: "local", file: "hero.webp" });
  assert.deepEqual(classifySource("https://images.unsplash.com/photo-1"), {
    kind: "remote",
    url: "https://images.unsplash.com/photo-1",
  });
  assert.equal(classifySource("https://evil.example.com/x.png"), null);
  assert.equal(classifySource("data:image/png;base64,AAAA"), null);
});
