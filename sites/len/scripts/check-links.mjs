import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { internalRefs, resolves } from "./lib-links.mjs";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "out");
const walk = (d) => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]));
const rotos = [];
for (const f of walk(OUT).filter((p) => p.endsWith(".html"))) {
  for (const ref of internalRefs(readFileSync(f, "utf8"))) if (!resolves(OUT, ref)) rotos.push(`${relative(OUT, f)} → ${ref}`);
}
if (rotos.length) {
  console.error(`✘ ${rotos.length} enlace(s) roto(s):\n  - ${rotos.join("\n  - ")}`);
  process.exit(1);
}
console.log("✔ enlaces internos: todos resuelven");
