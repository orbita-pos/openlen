// Convierte las pinturas de assets/src/ en lo que sirve la web. El export
// estático no optimiza imágenes: esto lo hace una vez y se commitea la salida.
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(SITE, "assets", "src");
const OUT = join(SITE, "public", "img");
mkdirSync(join(OUT, "og"), { recursive: true });

const TRABAJOS = [
  { nombre: "primera", anchos: [1080, 2160] },
  { nombre: "segunda", anchos: [1080, 2160] },
  { nombre: "tercera", anchos: [1080, 1536] },
];

for (const { nombre, anchos } of TRABAJOS) {
  const src = join(SRC, `${nombre}.png`);
  const { width } = await sharp(src).metadata();
  for (const w of anchos) {
    if (w > width) console.warn(`⚠ ${nombre}: se pide ${w}px y la fuente tiene ${width}px — se reescala hacia arriba (spec §8)`);
    await sharp(src).resize({ width: w }).avif({ quality: 55 }).toFile(join(OUT, `${nombre}-${w}.avif`));
    await sharp(src).resize({ width: w }).webp({ quality: 78 }).toFile(join(OUT, `${nombre}-${w}.webp`));
  }
  await sharp(src)
    .resize(1200, 630, { fit: "cover", position: "attention" })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(join(OUT, "og", `${nombre}.jpg`));
}
console.log("✔ imágenes en public/img");
