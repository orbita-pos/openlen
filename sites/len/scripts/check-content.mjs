// prebuild: si algo falla, no hay build. Ver lib-checks.mjs.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  checkParity,
  extractCommits,
  extractCommitsDeDiccionario,
  extractRutas,
  checkRutas,
  checkCifrasSinCommit,
  checkCommits,
  checkDenylist,
  checkAbierto,
  checkIndice,
  checkToolGroups,
  checkTitularTotal,
  checkNotasDeGrupo,
} from "./lib-checks.mjs";

const SITE = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(SITE, "..", "..");
const CONTENT = join(SITE, "content");

function walk(dir) {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function isPublicCommit(hash) {
  try {
    execFileSync("git", ["cat-file", "-e", `${hash}^{commit}`], { cwd: REPO, stdio: "ignore" });
  } catch {
    return false;
  }
  const out = execFileSync("git", ["branch", "-r", "--contains", hash], { cwd: REPO, encoding: "utf8" });
  return /^\s*origin\/master\s*$/m.test(out);
}

/** ¿Existe `ruta` en la referencia `ref` (`origin/master` o un commit)? */
function existeEn(ref, ruta) {
  try {
    execFileSync("git", ["cat-file", "-e", `${ref}:${ruta}`], { cwd: REPO, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const mdx = walk(CONTENT).filter((p) => p.endsWith(".mdx"));
const rel = mdx.map((p) => relative(CONTENT, p).replaceAll("\\", "/"));
const errors = [...checkParity(rel)];
const hashes = [];

for (const [i, p] of mdx.entries()) {
  const src = readFileSync(p, "utf8");
  errors.push(
    ...checkCifrasSinCommit(src, rel[i]),
    ...checkDenylist(src, rel[i]),
    ...checkAbierto(src, rel[i]),
    ...checkIndice(src, rel[i]),
    ...checkRutas(extractRutas(src), existeEn, rel[i]),
  );
  hashes.push(...extractCommits(src), ...extractCommitsDeDiccionario(src));
}
errors.push(...checkCommits(hashes, isPublicCommit));

const groups = JSON.parse(readFileSync(join(SITE, "data", "herramientas.json"), "utf8"));
// LAS QUE LEN RECIBE DE VERDAD, del propio catálogo (`catalogo-de-len.mts`).
// Antes se LEÍAN los nombres de tres ficheros (`catalog.ts`, `declaraciones.ts`
// y las constantes de `web/herramientas.ts`), y Len 2.5 declaró las suyas en
// otros cinco: la puerta contaba 18 con 26 de verdad, y seguía dando por buena
// `preguntar` (que ya es `ask_user_question`) y Grep y Glob (que la terminal
// sustituye). Preguntárselo al catálogo no se queda viejo.
const catalog = JSON.parse(
  execFileSync(process.execPath, [join(REPO, "node_modules", "tsx", "dist", "cli.mjs"), join(SITE, "scripts", "catalogo-de-len.mts")], {
    cwd: REPO,
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .at(-1),
);
errors.push(...checkToolGroups(groups, catalog));

// Los diccionarios: ni modelos ni proveedores, y los números que la tarjeta
// lleva ESCRITOS A MANO tienen que cuadrar con el catálogo de verdad.
for (const p of walk(join(SITE, "i18n"))) {
  const src = readFileSync(p, "utf8");
  const file = relative(SITE, p).replaceAll("\\", "/");
  errors.push(...checkDenylist(src, file), ...checkCommits(extractCommitsDeDiccionario(src), isPublicCommit).map((e) => `${file}: ${e}`));
  const lang = /(?:^|\/)(en|es)\.ts$/.exec(file)?.[1];
  if (!lang) continue;
  errors.push(...checkTitularTotal(src, file, catalog.length, lang), ...checkNotasDeGrupo(src, file, groups, lang));
}

if (errors.length) {
  console.error(`✘ ${errors.length} problema(s) en el contenido:\n  - ${errors.join("\n  - ")}`);
  process.exit(1);
}
console.log(
  `✔ contenido: ${mdx.length} ficheros MDX · ${new Set(hashes).size} commits públicos · ${catalog.length} herramientas`,
);
