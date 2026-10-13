// lib/apps/npm/node-modules.ts — the app's /node_modules as Len reads it in
// bash: what an `npm install` leaves for a reader, each package's package.json
// and its type declarations (.d.ts). Read-only, and only what we really have:
// the catalog's and the test kit's types (`types.json`, the checker's own
// node_modules) and, for the packages installed from esm.sh, the .d.ts the
// lock names (`npmTypesFor`). Their JavaScript isn't here: it comes built for
// the browser, not as npm ships it.
//
// Like Claude Code: node_modules opens by its path (`cat`, `ls`), and a search
// of the project doesn't enter it (its Grep is ripgrep, which honours
// .gitignore; the terminal's `grep -r` skips it unless it's named).
import { readFileSync } from "node:fs";
import path from "node:path";
import { directorioVendor } from "@/lib/apps/servir";
import { testKitFor } from "@/lib/apps/tests/test-kit";
import { catalogPartsLocked, readEsmLock, readPackageJson, sourceOf, type LockedPackage } from "./lock";
import { npmTypesFor } from "./types-for-check";

export const NODE_MODULES = "/node_modules";

export interface NodeModulesView {
  /** Every file, known without reading any. */
  readonly paths: readonly string[];
  /** Its text, or null if it isn't one of `paths` or can't be read now. */
  read(file: string): Promise<string | null>;
}

const packsByName = new Map<string, Readonly<Record<string, string>>>();

/** A `types.json` (`/node_modules/...` → text), read once per process. */
function typesPack(name: string): Readonly<Record<string, string>> {
  const cached = packsByName.get(name);
  if (cached) return cached;
  let pack: Record<string, string> = {};
  try {
    pack = JSON.parse(readFileSync(path.join(directorioVendor(), name, "types.json"), "utf8")) as Record<string, string>;
  } catch {
    // No types pack: none of its files.
  }
  packsByName.set(name, pack);
  return pack;
}

const packageRoot = (name: string) => `${NODE_MODULES}/${name}/`;

export function nodeModulesOf(
  files: Readonly<Record<string, string>>,
  catalogName: string,
  o: { readonly npmTypes?: () => Promise<Record<string, string>>; readonly pack?: (name: string) => Readonly<Record<string, string>> } = {},
): NodeModulesView {
  const pack = o.pack ?? typesPack;
  const packs = [pack(catalogName), pack(testKitFor(catalogName))];

  // The packages installed from esm.sh: their .d.ts, and a package.json for one
  // whose types came from its @types (`leaflet` → `@types/leaflet`), as npm leaves it.
  const installed = new Map<string, LockedPackage>();
  for (const name of Object.keys(readPackageJson(files)?.dependencies ?? {})) {
    const source = sourceOf(name, files, catalogName);
    if (source.kind === "esm") installed.set(name, source.locked);
  }
  const fromLock = new Set<string>();
  const made = new Map<string, string>();
  const shadowed: string[] = [];
  for (const [name, locked] of installed) {
    // Another version than the catalog's: the catalog's files of it aren't there.
    shadowed.push(packageRoot(name));
    if (locked.typesFrom && locked.typesFrom.name !== name) shadowed.push(packageRoot(locked.typesFrom.name));
    for (const p of Object.keys(locked.types ?? {})) fromLock.add(p);
    const manifest = `${packageRoot(name)}package.json`;
    if (!fromLock.has(manifest)) made.set(manifest, `${JSON.stringify({ name, version: locked.version }, null, 2)}\n`);
  }
  // The parts of catalog packages (`react-dom/server`): only the .d.ts the catalog's types lack.
  for (const name of Object.keys(readEsmLock(files).packages)) {
    for (const p of Object.keys(catalogPartsLocked(name, files, catalogName)?.types ?? {})) fromLock.add(p);
  }

  const fromPacks = new Map<string, string>();
  for (const p of packs) {
    for (const [file, text] of Object.entries(p)) {
      if (!shadowed.some((root) => file.startsWith(root)) && !fromPacks.has(file)) fromPacks.set(file, text);
    }
  }

  let lockTexts: Promise<Record<string, string>> | null = null;
  const npmTypes = o.npmTypes ?? (() => npmTypesFor(files, catalogName));
  return {
    paths: [...new Set([...fromPacks.keys(), ...fromLock, ...made.keys()])].sort(),
    async read(file) {
      if (fromLock.has(file)) {
        const texts = await (lockTexts ??= npmTypes().catch(() => ({}) as Record<string, string>));
        if (texts[file] !== undefined) return texts[file]!;
      }
      return made.get(file) ?? fromPacks.get(file) ?? null;
    },
  };
}
