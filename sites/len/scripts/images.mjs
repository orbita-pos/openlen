// Convierte las pinturas de assets/src/ en lo que sirve la web. El export
// estático no optimiza imágenes: esto lo hace una vez y se commitea la salida.
// `node scripts/images.mjs len31` hace sólo ésa: las demás salidas ya están commiteadas y sus fuentes
// (assets/src/, fuera del repo) no tienen por qué estar en esta máquina.
import sharp from "sharp";
import { existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(SITE, "assets", "src");
const OUT = join(SITE, "public", "img");
mkdirSync(join(OUT, "og"), { recursive: true });

const TRABAJOS = [
  { nombre: "len3", anchos: [832, 1664] },
  { nombre: "len31", anchos: [832, 1664] },
  { nombre: "primera", anchos: [1080, 2160] },
  { nombre: "segunda", anchos: [1080, 2160] },
  { nombre: "tercera", anchos: [1080, 1536] },
];
/** Las portadas de versión llevan su texto dentro: la de compartir se encaja entera, sin recortar. */
const esDeVersion = (nombre) => /^len\d+$/.test(nombre);

const pedidos = process.argv.slice(2);
for (const { nombre, anchos } of TRABAJOS.filter((t) => pedidos.length === 0 || pedidos.includes(t.nombre))) {
  const src = join(SRC, `${nombre}.png`);
  if (!existsSync(src)) {
    console.warn(`⚠ ${nombre}: no está ${src} — se dejan sus salidas como están`);
    continue;
  }
  const { width } = await sharp(src).metadata();
  for (const w of anchos) {
    if (w > width) console.warn(`⚠ ${nombre}: se pide ${w}px y la fuente tiene ${width}px — se reescala hacia arriba (spec §8)`);
    await sharp(src).resize({ width: w }).avif({ quality: 55 }).toFile(join(OUT, `${nombre}-${w}.avif`));
    await sharp(src).resize({ width: w }).webp({ quality: 78 }).toFile(join(OUT, `${nombre}-${w}.webp`));
  }
  await sharp(src)
    .resize(1200, 630, { fit: esDeVersion(nombre) ? "contain" : "cover", position: esDeVersion(nombre) ? "centre" : "attention", background: "#15191d" })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(join(OUT, "og", `${nombre}.jpg`));
}
console.log("✔ imágenes en public/img");
