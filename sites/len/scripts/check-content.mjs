// prebuild: si algo falla, no hay build. Ver lib-checks.mjs.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import {
  checkParity,
  extractCommits,
  checkCifrasSinCommit,
  checkCommits,
  checkDenylist,
  checkAbierto,
  checkIndice,
  catalogToolNames,
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
  );
  hashes.push(...extractCommits(src));
}
errors.push(...checkCommits(hashes, isPublicCommit));

const groups = JSON.parse(readFileSync(join(SITE, "data", "herramientas.json"), "utf8"));
const catalog = catalogToolNames(readFileSync(join(REPO, "lib", "agent", "catalog.ts"), "utf8"));
errors.push(...checkToolGroups(groups, catalog));

// Los diccionarios: ni modelos ni proveedores, y los números que la tarjeta
// lleva ESCRITOS A MANO tienen que cuadrar con el catálogo de verdad.
for (const p of walk(join(SITE, "i18n"))) {
  const src = readFileSync(p, "utf8");
  const file = relative(SITE, p).replaceAll("\\", "/");
  errors.push(...checkDenylist(src, file));
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
