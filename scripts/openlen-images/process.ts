// Reads the ChatGPT-exported PNGs from a source directory (default:
// $USERPROFILE/Downloads/img-chatgpt or $HOME/Downloads/img-chatgpt), sorts
// them by file mtime (= generation order = prompt order, with #19 skipped per
// meta.ts), generates 3 WebP variants per image (1920w hero / 800w tablet /
// 400w thumb), and uploads them through the openlen-images storage adapter
// (R2 when R2_* env vars are set, else ./public/openlen-images/). Emits
// public/openlen-images/manifest.json — committed; its src URLs point wherever
// the adapter uploaded (absolute R2 URLs in prod).
//
// Source PNGs are read-only — this script never modifies the input directory.
//
// Run with: npm run openlen-images:process
// Override input: OPENLEN_IMAGES_INPUT=/some/other/dir npm run openlen-images:process

import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { processImage } from "../../lib/images";
import { IMAGE_META, type ImageMeta, type ImageStyle } from "./meta";
import { PREMIUM_IMAGES } from "./premium-meta";
import type { TemplateFamily } from "../../lib/templates/families";
import { getOpenLenImageStorage } from "../../lib/storage/openlen-images";

const DEFAULT_INPUT_DIR = join(
  process.env.USERPROFILE ?? process.env.HOME ?? "",
  "Downloads",
  "img-chatgpt",
);
const INPUT_DIR = process.env.OPENLEN_IMAGES_INPUT ?? DEFAULT_INPUT_DIR;
const OUTPUT_DIR = resolve("public", "openlen-images");

const SIZES = [
  { key: "hero",   width: 1920 },
  { key: "tablet", width: 800  },
  { key: "thumb",  width: 400  },
] as const;

interface ManifestImage {
  id: string;
  promptNum: number;
  style: ImageStyle;
  family: TemplateFamily[];
  alt: string;
  src: { hero: string; tablet: string; thumb: string };
}

interface Manifest {
  version: number;
  generated: string;
  count: number;
  images: ManifestImage[];
}

function id(meta: ImageMeta): string {
  return `${String(meta.promptNum).padStart(2, "0")}-${meta.slug}`;
}

async function main() {
  const storage = getOpenLenImageStorage();
  const usingR2 = !!(
    process.env.R2_ACCOUNT_ID &&
    process.env.R2_ACCESS_KEY &&
    process.env.R2_SECRET_KEY
  );
  console.log(`Input:   ${INPUT_DIR}`);
  console.log(
    usingR2
      ? `Storage: R2 — ${process.env.R2_IMAGES_BUCKET || "openlen-images"}`
      : `Storage: filesystem — ${OUTPUT_DIR}\n         (manifest URLs will be local; set R2_* to upload to R2)`,
  );
  console.log("");

  let files: string[];
  try {
    const pngs = (await readdir(INPUT_DIR)).filter((f) => /\.png$/i.test(f));
    // Sort by file mtime, not filename: PNGs are generated in prompt order, but
    // ChatGPT's export filename format varies between batches, so a plain
    // lexicographic sort interleaves them. Creation time is the true order.
    const stamped = await Promise.all(
      pngs.map(async (name) => ({
        name,
        mtimeMs: (await stat(join(INPUT_DIR, name))).mtimeMs,
      })),
    );
    stamped.sort((a, b) => a.mtimeMs - b.mtimeMs);
    files = stamped.map((s) => s.name);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Cannot read ${INPUT_DIR}: ${msg}`);
  }

  if (files.length !== IMAGE_META.length) {
    throw new Error(
      `Found ${files.length} PNGs in ${INPUT_DIR}, expected ${IMAGE_META.length}. ` +
        `If you regenerated or added images, update meta.ts to match.`,
    );
  }

  await mkdir(OUTPUT_DIR, { recursive: true });

  const manifest: Manifest = {
    version: 1,
    generated: new Date().toISOString(),
    count: 0,
    images: [],
  };

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const meta = IMAGE_META[i];
    const baseId = id(meta);
    const inputPath = join(INPUT_DIR, file);

    const inputBytes = await readFile(inputPath);
    // One decode + 3 resizes in a single native call. The previous code
    // re-decoded the same file for each variant; the new pipeline pays
    // the decode cost once and shares the base image across all three
    // width buckets.
    const { variants } = await processImage({
      input: inputBytes,
      variants: SIZES.map((s) => ({
        width: s.width,
        format: "webp" as const,
        quality: 82,
      })),
      autoOrient: false,
      withoutEnlargement: true,
    });
    const src = {} as ManifestImage["src"];
    for (let s = 0; s < SIZES.length; s++) {
      const size = SIZES[s];
      const { url } = await storage.upload({
        key: `${baseId}-${size.width}.webp`,
        contentType: "image/webp",
        body: variants[s].bytes,
      });
      src[size.key] = url;
    }

    manifest.images.push({
      id: baseId,
      promptNum: meta.promptNum,
      style: meta.style,
      family: meta.family,
      alt: meta.alt,
      src,
    });

    console.log(`  ok  #${String(meta.promptNum).padStart(2)} ${baseId}`);
  }

  // Premium template imagery already lives on R2 — append so the "By OpenLen"
  // picker surfaces it too (and a reprocess never drops it). See premium-meta.ts.
  manifest.images.push(...PREMIUM_IMAGES);

  manifest.count = manifest.images.length;
  const manifestPath = join(OUTPUT_DIR, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  console.log(
    `\nDone. ${manifest.count} images × 3 sizes = ${manifest.count * 3} WebP variants ${usingR2 ? "uploaded to R2" : "written to disk"}.`,
  );
  console.log(`Manifest: ${manifestPath}`);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\nFAILED: ${msg}`);
  process.exit(1);
});
