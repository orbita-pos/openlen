// Dos cosas después del export, las dos medidas:
//
// 1. Next exporta su propio /_not-found a out/404.html y pisa el de public/.
//    El suyo sale sin `lang` en el <html> y arrastra los chunks de Next para
//    una página que Caddy sirve sola, sin Node. El nuestro es autocontenido y
//    bilingüe, así que se vuelve a poner encima.
//
// 2. Se quita el runtime de React del HTML. Esta web no tiene ni un
//    componente de cliente, ni un manejador, ni un estado: son ~102 KB de JS
//    que hidratan un marcado idéntico al que ya llegó pintado. Con ellos,
//    Lighthouse móvil daba 92/93; sin ellos, mira el commit. Es además lo que
//    manda la casa: el documento publicado es HTML estático, sin runtime.
//    Se pierde la navegación de cliente de <Link> — en un sitio de seis
//    páginas, un enlace normal hace el mismo trabajo.
//    El <script type="application/ld+json"> de los artículos NO se toca.
import { copyFileSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(SITE, "out");

copyFileSync(join(SITE, "public", "404.html"), join(OUT, "404.html"));

const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));

let tocados = 0;
let quitados = 0;
for (const f of walk(OUT).filter((p) => p.endsWith(".html"))) {
  const antes = readFileSync(f, "utf8");
  let despues = antes
    // <script src="/_next/...">…</script>
    .replace(/<script[^>]*\ssrc="\/_next\/[^"]*"[^>]*><\/script>/g, "")
    // los inline del arranque de React (self.__next_f.push(...))
    .replace(/<script[^>]*>(?:(?!<\/script>)[\s\S])*?__next_f(?:(?!<\/script>)[\s\S])*?<\/script>/g, "")
    // los preloads de esos mismos scripts
    .replace(/<link[^>]*\sas="script"[^>]*>/g, "");
  if (despues !== antes) {
    quitados += (antes.match(/<script/g) || []).length - (despues.match(/<script/g) || []).length;
    writeFileSync(f, despues);
    tocados += 1;
  }
  if (/\/_next\/static\/chunks/.test(despues)) {
    console.error(`✘ ${relative(OUT, f)}: quedó una referencia a los chunks de Next`);
    process.exit(1);
  }
}

console.log(`✔ 404: el nuestro, encima del de Next · sin runtime: ${quitados} scripts fuera de ${tocados} páginas`);
