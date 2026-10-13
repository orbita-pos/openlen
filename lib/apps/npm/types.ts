// A package's TypeScript types for the checker (lib/apps/checker/), read raw
// from esm.sh (`?raw` keeps the original files and specifiers) into the same
// virtual node_modules layout as the catalogs' types.json. Its own types if it
// has them (`types`, `typings`, `exports["."].types`); else @types/<name> at
// the same major.minor, through the gate like any other version.
import path from "node:path";
import semver from "semver";
import { rawUrl } from "./esm-url";
import { fetchText } from "./fetch-graph";
import { checkResolved, type GateDeps } from "./gate";
import { esmOrigin } from "./paths";
import { mapLimited } from "./pool";
import { getPackument, type FetchLike } from "./registry";

const MAX_FILES = 600;
const MAX_BYTES = 8 * 1024 * 1024;

interface TypesOptions {
  readonly fetch: FetchLike;
  readonly gate: GateDeps;
  readonly deadline: number;
  readonly origin?: string;
}

type Manifest = { types?: unknown; typings?: unknown; exports?: unknown };

/** The `types` of an `exports` entry, through its conditions. */
function pickTypes(x: unknown): string | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  if (typeof o.types === "string") return o.types;
  for (const k of ["import", "default", "require"]) {
    const inner = pickTypes(o[k]);
    if (inner) return inner;
  }
  return null;
}

const exportOf = (manifest: Manifest, key: string): unknown =>
  manifest.exports && typeof manifest.exports === "object" ? (manifest.exports as Record<string, unknown>)[key] : null;

function typesEntryOf(manifest: Manifest): string | null {
  for (const v of [manifest.types, manifest.typings]) if (typeof v === "string") return v;
  return pickTypes(exportOf(manifest, "."));
}

/** The file TypeScript reads for a JS file of the package: x.js → x.d.ts (.mjs → .d.mts, .cjs → .d.cts). */
function dtsOf(target: string): string | null {
  if (target.includes("*")) return null;
  const t = target.replace(/^\.\//, "");
  if (/\.d\.[mc]?ts$/.test(t)) return t;
  if (t.endsWith(".js")) return t.replace(/\.js$/, ".d.ts");
  if (t.endsWith(".mjs")) return t.replace(/\.mjs$/, ".d.mts");
  if (t.endsWith(".cjs")) return t.replace(/\.cjs$/, ".d.cts");
  return null;
}

/** Every file an `exports` entry can send TypeScript to: its `types` condition, else the .d.ts of each target. */
function exportTargets(x: unknown): string[] {
  if (typeof x === "string") {
    const d = dtsOf(x);
    return d ? [d] : [];
  }
  if (!x || typeof x !== "object") return [];
  const o = x as Record<string, unknown>;
  if (typeof o.types === "string") return [o.types.replace(/^\.\//, "")];
  return Object.values(o).flatMap(exportTargets);
}

/** Where a subpath's types may start ("" = the package's): "types" and what "exports" points at —
 *  TypeScript resolves through "exports" (@types/three's "types" is index.d.ts, its "exports"
 *  build/three.module.d.ts) — else the file by name. */
function entriesFor(manifest: Manifest, subpath: string, rootFallback: string | null): string[] {
  const fromExports = exportTargets(exportOf(manifest, subpath ? `./${subpath}` : "."));
  if (subpath === "") {
    const declared = [manifest.types, manifest.typings].filter((v): v is string => typeof v === "string");
    const all = [...declared, ...fromExports];
    return all.length > 0 ? all : rootFallback ? [rootFallback] : [];
  }
  return fromExports.length > 0 ? fromExports : [`${subpath}.d.ts`, `${subpath}/index.d.ts`];
}

/** Every subpath's types, in ONE crawl (what two entries share is fetched once); null if no entry exists. */
async function crawlSubpaths(pkg: string, version: string, manifest: { text: string; manifest: Manifest }, subpaths: readonly string[], rootFallback: string | null, opts: TypesOptions): Promise<Record<string, string> | null> {
  const entries = subpaths.flatMap((subpath) => entriesFor(manifest.manifest, subpath, rootFallback));
  return entries.length > 0 ? crawl(pkg, version, entries, manifest.text, opts) : null;
}

const mangle = (name: string) => (name.startsWith("@") ? name.slice(1).replace("/", "__") : name);

/** `foo__bar` (the @types name of `@foo/bar`) → `@foo/bar`. */
const unmangle = (name: string) => (name.includes("__") ? `@${name.replace("__", "/")}` : name);

/** The name an esm.sh types URL stands for: `@types/three@~0.186.0/index.d.ts` → `three`,
 *  `zustand@5.0.15/esm/traditional.d.mts` → `zustand/traditional`. */
function bareOf(pkg: string, rest: string): string {
  const file = rest.replace(/\.d\.[mc]?ts$/, "");
  if (pkg.startsWith("@types/")) {
    const sub = file.replace(/(?:^|\/)index$/, "");
    const name = unmangle(pkg.slice("@types/".length));
    return sub ? `${name}/${sub}` : name;
  }
  const base = file.split("/").pop()!;
  return base === "index" ? pkg : `${pkg}/${base}`;
}

/**
 * esm.sh rewrites a .d.ts's package imports into its own URLs, even with
 * `?raw` (measured 2026-10-13: fiber's three-types.d.ts imports
 * "https://esm.sh/@types/three@~0.186.0/index.d.ts"). TypeScript can't resolve
 * a URL, so fiber's JSX elements lost three's types. They go back to the names
 * the package wrote ("three"), which the checker's node_modules does resolve.
 */
export function bareTypeImports(text: string, origin: string): string {
  const escaped = origin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const url = new RegExp(`(["'])${escaped}/((?:@[^/@"']+/)?[^/@"']+)@[^/"']+/([^"']*)\\1`, "g");
  return text.replace(url, (_m, quote: string, pkg: string, rest: string) => `${quote}${bareOf(pkg, rest)}${quote}`);
}

function candidatesFor(fromFile: string, spec: string): string[] {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec));
  if (base.endsWith(".d.ts") || base.endsWith(".d.mts") || base.endsWith(".d.cts")) return [base];
  if (/\.(?:m|c)?js$/.test(base)) return [base.replace(/\.js$/, ".d.ts").replace(/\.mjs$/, ".d.mts").replace(/\.cjs$/, ".d.cts")];
  return [`${base}.d.ts`, `${base}/index.d.ts`];
}

async function crawl(pkgName: string, pkgVersion: string, entries: readonly string[], manifestText: string, opts: TypesOptions): Promise<Record<string, string> | null> {
  const origin = opts.origin ?? esmOrigin();
  const root = `/node_modules/${pkgName}/`;
  const files: Record<string, string> = { [`${root}package.json`]: manifestText };
  const entryFiles = [...new Set(entries.map((e) => path.posix.normalize(e.replace(/^\.\//, ""))))];
  const seen = new Set(entryFiles);
  let found = false;
  let bytes = manifestText.length;
  // In waves, each fetched several at a time (measured in the box rehearsal:
  // @types/three's 415 files one by one took 52.6 s of the 60 s install).
  let wave = entryFiles;
  while (wave.length > 0) {
    const got = await mapLimited(wave, (file) => fetchText(rawUrl(pkgName, pkgVersion, file, origin), opts));
    const next: string[] = [];
    for (const [i, file] of wave.entries()) {
      const g = got[i]!;
      // An entry may not exist (a "require" target with no .d.cts), and a
      // reference has two candidates (x.d.ts / x/index.d.ts): only one is there.
      if (!g.ok) continue;
      found = true;
      const text = bareTypeImports(g.text, origin);
      files[`${root}${file}`] = text;
      bytes += text.length;
      if (Object.keys(files).length > MAX_FILES || bytes > MAX_BYTES) return files;
      const refs = [
        ...[...text.matchAll(/(?:from|import)\s*\(?\s*["'](\.{1,2}\/[^"']+)["']/g)].map((m) => m[1]!),
        ...[...text.matchAll(/\/\/\/\s*<reference\s+path=["']([^"']+)["']/g)].map((m) => m[1]!),
      ];
      for (const ref of refs) {
        for (const candidate of candidatesFor(file, ref.startsWith(".") ? ref : `./${ref}`)) {
          if (!seen.has(candidate)) {
            seen.add(candidate);
            next.push(candidate);
          }
        }
      }
    }
    wave = next;
  }
  return found ? files : null;
}

async function manifestOf(name: string, version: string, opts: TypesOptions): Promise<{ text: string; manifest: Manifest } | null> {
  const got = await fetchText(rawUrl(name, version, "package.json", opts.origin ?? esmOrigin()), opts);
  if (!got.ok) return null;
  try {
    return { text: got.text, manifest: JSON.parse(got.text) as Manifest };
  } catch {
    return null;
  }
}

/** The .d.ts files, and the package they were read from (the package itself or its @types). */
export interface TypesFetched {
  readonly name: string;
  readonly version: string;
  readonly files: Record<string, string>;
}

/** `subpaths`: the parts whose types are wanted ("" = the package itself). */
export async function fetchTypes(name: string, version: string, opts: TypesOptions, subpaths: readonly string[] = [""]): Promise<TypesFetched | null> {
  const own = await manifestOf(name, version, opts);
  // A package that types its own entry types its parts too.
  if (own && typesEntryOf(own.manifest)) {
    const files = await crawlSubpaths(name, version, own, subpaths, null, opts);
    return files && { name, version, files };
  }

  const typesName = `@types/${mangle(name)}`;
  const doc = await getPackument(typesName, opts.fetch).catch(() => null);
  if (!doc) return null;
  const parsed = semver.parse(version);
  const candidates = Object.keys(doc.versions).filter((v) => semver.valid(v) && !semver.prerelease(v)).sort(semver.rcompare);
  const sameMinor = parsed ? candidates.filter((v) => semver.major(v) === parsed.major && semver.minor(v) === parsed.minor) : [];
  for (const v of [...sameMinor, ...candidates]) {
    if (!(await checkResolved(typesName, v, opts.gate)).ok) continue;
    const m = await manifestOf(typesName, v, opts);
    if (!m) return null;
    const files = await crawlSubpaths(typesName, v, m, subpaths, "index.d.ts", opts);
    return files && { name: typesName, version: v, files };
  }
  return null;
}
