// Next exporta su propio /_not-found a out/404.html y pisa el de public/.
// El suyo sale sin `lang` en el <html> y arrastra los chunks de Next para una
// página que Caddy sirve sola, sin Node. El nuestro es autocontenido y
// bilingüe, así que se vuelve a poner encima. check-build.mjs comprueba que
// ganó el nuestro.
import { copyFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..");
copyFileSync(join(SITE, "public", "404.html"), join(SITE, "out", "404.html"));
console.log("✔ 404: el nuestro, encima del de Next");
