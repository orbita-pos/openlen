import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(SITE, "out");
const fallos = [];
const debe = (cond, msg) => {
  if (!cond) fallos.push(msg);
};
const leer = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "");

// React serializa el atributo como hrefLang=, no hreflang=. HTML no distingue
// mayúsculas, pero un `includes` en minúsculas sí: esta puerta daba falso
// negativo hasta que se midió contra el HTML de verdad.
const tiene = (html, attr, valor) => new RegExp(`${attr}="${valor}"`, "i").test(html);

const slugs = readdirSync(join(SITE, "content", "research"))
  .filter((f) => f.endsWith(".en.mdx"))
  .map((f) => f.replace(".en.mdx", ""));

for (const lang of ["en", "es"]) {
  const rutas = ["", "research/", "principles/", ...slugs.map((s) => `research/${s}/`)];
  for (const r of rutas) {
    const html = leer(join(OUT, lang, r, "index.html"));
    debe(html, `falta out/${lang}/${r}index.html`);
    debe(html.includes(`<html lang="${lang}"`), `out/${lang}/${r}: <html lang="${lang}">`);
    for (const h of ["en", "es", "x-default"]) debe(tiene(html, "hreflang", h), `out/${lang}/${r}: falta hreflang="${h}"`);
    const og = html.match(/property="og:image" content="https:\/\/len\.openlen\.com(\/img\/og\/[^"]+)"/);
    if (r !== "research/" && r !== "principles/")
      debe(og && existsSync(join(OUT, og[1])), `out/${lang}/${r}: og:image que no existe`);
  }
}

// El 404 lo sirve Caddy sin pasar por Next, así que tiene que ser EL NUESTRO:
// Next exporta su propio /_not-found a out/404.html y podría pisarlo.
const html404 = leer(join(OUT, "404.html"));
debe(html404, "falta out/404.html");
debe(html404.includes("Esta página no existe."), "out/404.html no es el nuestro (¿lo pisó el _not-found de Next?)");

const sitemap = leer(join(OUT, "sitemap.xml"));
for (const s of slugs) debe(sitemap.includes(`/research/${s}/`), `sitemap.xml sin ${s}`);
debe(leer(join(OUT, "robots.txt")).includes("Sitemap: https://len.openlen.com/sitemap.xml"), "robots.txt sin Sitemap");

const hero = join(OUT, "img", "primera-1080.avif");
debe(existsSync(hero) && statSync(hero).size <= 256000, "el héroe AVIF pasa de 250 KB");

if (fallos.length) {
  console.error(`✘ ${fallos.length} fallo(s) en out/:\n  - ${fallos.join("\n  - ")}`);
  process.exit(1);
}
console.log(`✔ build: ${slugs.length} artículos × 2 idiomas, hreflang, OG, sitemap, robots, 404`);
