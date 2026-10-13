// Writes lib/apps/npm/catalog-versions.json: for every catalog, the exact
// version of each package its specifiers name (also the ones that come inside
// another, like @radix-ui/react-dialog inside radix-ui). Read from the catalog's
// own lockfile when it has one (scripts/app-catalog/<catalog>/package-lock.json),
// else from `versiones` in lib/apps/dependencias.ts. Run it when a NEW catalog
// is added: existing catalogs are frozen, so their rows never change.
//
// Run: npx tsx --tsconfig tsconfig.eval.json scripts/app-catalog-versions.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CATALOGOS } from "../lib/apps/dependencias";
import { parseBareSpecifier } from "../lib/apps/npm/specifier";

const out: Record<string, Record<string, string>> = {};
for (const [name, catalog] of Object.entries(CATALOGOS)) {
  const lockPath = join("scripts", "app-catalog", name, "package-lock.json");
  const lock = existsSync(lockPath)
    ? (JSON.parse(readFileSync(lockPath, "utf8")) as { packages: Record<string, { version?: string }> })
    : null;
  const table: Record<string, string> = { ...catalog.versiones };
  for (const dep of catalog.dependencias) {
    const pkg = parseBareSpecifier(dep.especificador)?.name;
    if (!pkg || table[pkg]) continue;
    const version = lock?.packages[`node_modules/${pkg}`]?.version;
    if (version) table[pkg] = version;
  }
  out[name] = Object.fromEntries(Object.entries(table).sort(([a], [b]) => a.localeCompare(b)));
}
writeFileSync(join("lib", "apps", "npm", "catalog-versions.json"), `${JSON.stringify(out, null, 2)}\n`);
console.log(`catalog-versions.json: ${Object.keys(out).join(", ")}`);
