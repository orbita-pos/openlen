// Uploads pre-prepared transparent LUME PNGs (bg removed manually in Canva) to
// the images bucket as transparent WebPs at 3 widths, with a `-nobg-` suffix
// in the key so the originals stay intact (avoids the immutable CDN cache).
//
// Run with: npm run lume:remove-bg

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { getOpenLenImageStorage } from "../../lib/storage/openlen-images";

const INPUT_DIR = join(
  process.env.USERPROFILE ?? process.env.HOME ?? "",
  "Downloads",
  "img-chatgpt",
);

// File → R2 key prefix. Each entry produces 3 uploaded variants (1920/800/400).
const MAPPING: { file: string; baseId: string; label: string }[] = [
  { file: "Diseño sin título.png",     baseId: "376-lume-lemon-lime",       label: "Lemon Lime" },
  { file: "Diseño sin título (1).png", baseId: "377-lume-berry-blast",      label: "Berry Blast" },
  { file: "Diseño sin título (2).png", baseId: "378-lume-tropical-mango",   label: "Tropical Mango" },
  { file: "watermelon.png",            baseId: "379-lume-watermelon-crush", label: "Watermelon Crush" },
  { file: "raspberry.png",             baseId: "380-lume-blue-raspberry",   label: "Blue Raspberry" },
  { file: "peach.png",                 baseId: "381-lume-peach-mint",       label: "Peach Mint" },
  { file: "grape.png",                 baseId: "382-lume-grape-storm",      label: "Grape Storm" },
  { file: "citrus.png",                baseId: "383-lume-citrus-spark",     label: "Citrus Spark" },
];

const SIZES = [
  { key: "hero",   width: 1920 },
  { key: "tablet", width: 800  },
  { key: "thumb",  width: 400  },
] as const;

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
      : `Storage: filesystem (set R2_* to push to R2)`,
  );
  console.log("");

  const heroUrls: { label: string; url: string }[] = [];

  for (const { file, baseId, label } of MAPPING) {
    const path = join(INPUT_DIR, file);
    process.stdout.write(`  ${baseId}  ←  ${file}  ... `);

    const buf = await readFile(path);

    for (const { width } of SIZES) {
      const body = await sharp(buf)
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 90, alphaQuality: 90 })
        .toBuffer();
      const { url } = await storage.upload({
        key: `${baseId}-nobg-${width}.webp`,
        contentType: "image/webp",
        body,
      });
      if (width === 1920) heroUrls.push({ label, url });
    }

    console.log("ok");
  }

  console.log(`\nHero URLs (transparent webp, 1920w):`);
  heroUrls.forEach(({ label, url }) => console.log(`  ${label.padEnd(14)} ${url}`));
}

main().catch((err) => {
  console.error(`\nFAILED: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
});
