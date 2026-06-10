// One-shot: ingest the ChatGPT-generated temática backdrops from Downloads,
// archive the originals into .tematicas-art/<kit>/, generate WebP variants
// (1920w hero / 800w thumb / 1080w mobile for portrait sources) and upload
// them through the openlen-images storage adapter (R2 when R2_* env vars are
// set, else ./public/openlen-images/) under the tematicas/ prefix.
//
// Source PNGs are read-only. Prints the final URL map for lib/tematicas/
// presets.ts. Run with:
//   npx tsx --env-file=.env.local --tsconfig tsconfig.eval.json scripts/tematicas-art-process.ts

import { copyFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { getOpenLenImageStorage } from "../lib/storage/openlen-images";

const DL = join(process.env.USERPROFILE ?? process.env.HOME ?? "", "Downloads");
const F = (name: string) => join(DL, name);

interface Piece {
  src: string;
  kit: string;
  scene: string;
  /** variant = 1920 hero + 800 thumb · mobile = 1080 portrait companion */
  role: "variant" | "mobile";
}

const PIECES: Piece[] = [
  // Coquette — 21_22_34
  { src: "ChatGPT Image 9 jun 2026, 21_22_34 (1).png", kit: "coquette", scene: "satin", role: "variant" },
  { src: "ChatGPT Image 9 jun 2026, 21_22_34 (2).png", kit: "coquette", scene: "petals", role: "variant" },
  { src: "ChatGPT Image 9 jun 2026, 21_22_34 (3).png", kit: "coquette", scene: "lace", role: "variant" },
  { src: "ChatGPT Image 9 jun 2026, 21_22_34 (4).png", kit: "coquette", scene: "tulle", role: "variant" },
  // Y2K — 21_22_44
  { src: "ChatGPT Image 9 jun 2026, 21_22_44 (1).png", kit: "y2k", scene: "waves", role: "variant" },
  { src: "ChatGPT Image 9 jun 2026, 21_22_44 (2).png", kit: "y2k", scene: "horizon", role: "variant" },
  { src: "ChatGPT Image 9 jun 2026, 21_22_44 (3).png", kit: "y2k", scene: "blobs", role: "variant" },
  { src: "ChatGPT Image 9 jun 2026, 21_22_44 (4).png", kit: "y2k", scene: "brushed", role: "variant" },
  // Anime Dream — 21_27_36/37
  { src: "ChatGPT Image 9 jun 2026, 21_27_36 (1).png", kit: "anime-dream", scene: "sunset", role: "variant" },
  { src: "ChatGPT Image 9 jun 2026, 21_27_36 (2).png", kit: "anime-dream", scene: "moon", role: "variant" },
  { src: "ChatGPT Image 9 jun 2026, 21_27_37 (3).png", kit: "anime-dream", scene: "cloudsea", role: "variant" },
  { src: "ChatGPT Image 9 jun 2026, 21_27_37 (4).png", kit: "anime-dream", scene: "girl", role: "variant" },
  // Anime Noir — 21_27_43/44
  { src: "ChatGPT Image 9 jun 2026, 21_27_43 (1).png", kit: "anime-noir", scene: "alley", role: "variant" },
  { src: "ChatGPT Image 9 jun 2026, 21_27_43 (2).png", kit: "anime-noir", scene: "rooftop", role: "variant" },
  { src: "ChatGPT Image 9 jun 2026, 21_27_43 (3).png", kit: "anime-noir", scene: "rainglass", role: "variant" },
  { src: "ChatGPT Image 9 jun 2026, 21_27_44 (4).png", kit: "anime-noir", scene: "vending", role: "variant" },
  // Wanderlust — 21_47 (landscape + portrait pairs)
  { src: "ChatGPT Image 9 jun 2026, 21_47_07 (1).png", kit: "wanderlust", scene: "pool", role: "variant" },
  { src: "ChatGPT Image 9 jun 2026, 21_47_07 (2).png", kit: "wanderlust", scene: "pool-p", role: "mobile" },
  { src: "ChatGPT Image 9 jun 2026, 21_47_07 (3).png", kit: "wanderlust", scene: "water", role: "variant" },
  { src: "ChatGPT Image 9 jun 2026, 21_47_07 (4).png", kit: "wanderlust", scene: "water-p", role: "mobile" },
  { src: "ChatGPT Image 9 jun 2026, 21_47_07 (5).png", kit: "wanderlust", scene: "suite", role: "variant" },
  { src: "ChatGPT Image 9 jun 2026, 21_47_08 (6).png", kit: "wanderlust", scene: "suite-p", role: "mobile" },
  { src: "ChatGPT Image 9 jun 2026, 21_47_08 (7).png", kit: "wanderlust", scene: "road", role: "variant" },
  { src: "ChatGPT Image 9 jun 2026, 21_47_09 (8).png", kit: "wanderlust", scene: "road-p", role: "mobile" },
];

async function webp(buf: Buffer, width: number): Promise<Buffer> {
  return sharp(buf)
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
}

async function main() {
  const storage = getOpenLenImageStorage();
  const urls: Record<string, string> = {};

  for (const p of PIECES) {
    const dir = join(".tematicas-art", p.kit);
    await mkdir(dir, { recursive: true });
    await copyFile(F(p.src), join(dir, `${p.scene}.png`));

    const buf = await readFile(F(p.src));
    const base = `${p.kit}-${p.scene}`;
    if (p.role === "variant") {
      const hero = await webp(buf, 1920);
      const thumb = await webp(buf, 800);
      const u1 = await storage.upload({
        key: `tematicas/${base}-1920.webp`,
        contentType: "image/webp",
        body: hero,
      });
      const u2 = await storage.upload({
        key: `tematicas/${base}-800.webp`,
        contentType: "image/webp",
        body: thumb,
      });
      urls[`${base}-1920`] = u1.url;
      urls[`${base}-800`] = u2.url;
      console.log(`✔ ${base}: hero ${(hero.length / 1024).toFixed(0)}KB + thumb ${(thumb.length / 1024).toFixed(0)}KB`);
    } else {
      const mobile = await webp(buf, 1080);
      const u = await storage.upload({
        key: `tematicas/${base}-1080.webp`,
        contentType: "image/webp",
        body: mobile,
      });
      urls[`${base}-1080`] = u.url;
      console.log(`✔ ${base}: mobile ${(mobile.length / 1024).toFixed(0)}KB`);
    }
  }

  console.log("\nURL map for presets.ts:");
  for (const [k, v] of Object.entries(urls)) console.log(`  ${k} → ${v}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
