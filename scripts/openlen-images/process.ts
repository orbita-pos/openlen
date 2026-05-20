// Reads the 50 ChatGPT-exported PNGs from a source directory (default:
// $USERPROFILE/Downloads/img-chatgpt or $HOME/Downloads/img-chatgpt), sorts
// them by filename (which matches generation order = prompt order with #19
// skipped per meta.ts), generates 3 WebP variants per image (1920w hero /
// 800w tablet / 400w thumb), writes them to public/openlen-images/ and emits
// a manifest.json the picker reads at runtime.
//
// Source PNGs are read-only — this script never modifies the input directory.
//
// Run with: npm run openlen-images:process
// Override input: OPENLEN_IMAGES_INPUT=/some/other/dir npm run openlen-images:process

import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import sharp from "sharp";
import { IMAGE_META, type ImageMeta, type ImageStyle } from "./meta";
import type { TemplateFamily } from "../../lib/templates/families";

const DEFAULT_INPUT_DIR = join(
  process.env.USERPROFILE ?? process.env.HOME ?? "",
  "Downloads",
  "img-chatgpt",
);
const INPUT_DIR = process.env.OPENLEN_IMAGES_INPUT ?? DEFAULT_INPUT_DIR;
const OUTPUT_DIR = resolve("public", "openlen-images");
const PUBLIC_URL_BASE = "/openlen-images";

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
  console.log(`Input:  ${INPUT_DIR}`);
  console.log(`Output: ${OUTPUT_DIR}\n`);

  let files: string[];
  try {
    files = (await readdir(INPUT_DIR))
      .filter((f) => /\.png$/i.test(f))
      .sort();
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

    const src = {} as ManifestImage["src"];
    for (const size of SIZES) {
      const outName = `${baseId}-${size.width}.webp`;
      const outPath = join(OUTPUT_DIR, outName);
      await sharp(inputPath)
        .resize({ width: size.width, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(outPath);
      src[size.key] = `${PUBLIC_URL_BASE}/${outName}`;
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

  manifest.count = manifest.images.length;
  const manifestPath = join(OUTPUT_DIR, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  console.log(`\nDone. ${manifest.count} images × 3 sizes = ${manifest.count * 3} WebP files written.`);
  console.log(`Manifest: ${manifestPath}`);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`\nFAILED: ${msg}`);
  process.exit(1);
});
